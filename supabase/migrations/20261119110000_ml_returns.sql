-- Devoluciones y reclamos de compras de Mercado Libre, leídos de los mails:
--  "Podés iniciar la devolución" (fecha límite), "Llevá el producto a un Punto de despacho" (fecha límite),
--  "tu compra sigue protegida hasta el …" y "Te devolvimos el dinero de …" (cierra la devolución).
create table if not exists public.ml_returns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  title text not null,
  ml_order_id uuid references public.ml_orders(id) on delete set null,
  stage text not null default 'abierta' check (stage in ('puede_devolver', 'despachar', 'protegida', 'reembolsada', 'abierta')),
  start_deadline date,
  ship_deadline date,
  protected_until date,
  refunded_at timestamptz,
  bank_movement_id uuid references public.bank_movements(id) on delete set null,
  claim_number text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
alter table public.ml_returns enable row level security;
create policy ml_returns_select on public.ml_returns for select to authenticated using (public.is_org_member(org_id));
create policy ml_returns_write on public.ml_returns for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create or replace function public.ingest_ml_returns(p_token text, p_events jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; e jsonb; v_key text; v_title text; v_order uuid; v_id uuid; n integer := 0; v_stage text; v_at timestamptz; v_dl date;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for e in select * from jsonb_array_elements(p_events) loop
    v_title := left(btrim(coalesce(e->>'title', '')), 300);
    continue when length(v_title) < 4;
    v_stage := e->>'stage';
    continue when v_stage not in ('puede_devolver', 'despachar', 'protegida', 'reembolsada');
    v_at := coalesce((e->>'at')::timestamptz, now());
    v_dl := case when e->>'deadline' ~ '^\d{4}-\d{2}-\d{2}$' then (e->>'deadline')::date end;
    v_key := left(public.norm(v_title), 30);
    select o.id into v_order from public.ml_orders o
     where o.org_id = v_org and o.kind = 'compra' and o.merged_into is null and public.norm(o.title) like v_key || '%'
     order by o.ordered_at desc nulls last limit 1;
    insert into public.ml_returns (org_id, key, title, ml_order_id, stage, start_deadline, ship_deadline, protected_until, refunded_at, claim_number, first_seen_at)
    values (v_org, v_key, v_title, v_order, v_stage,
            case when v_stage = 'puede_devolver' then v_dl end, case when v_stage = 'despachar' then v_dl end,
            case when v_stage = 'protegida' then v_dl end, case when v_stage = 'reembolsada' then v_at end, left(e->>'claim', 30), v_at)
    on conflict (org_id, key) do update set
      title = case when length(excluded.title) > length(public.ml_returns.title) then excluded.title else public.ml_returns.title end,
      ml_order_id = coalesce(public.ml_returns.ml_order_id, excluded.ml_order_id),
      start_deadline = coalesce(excluded.start_deadline, public.ml_returns.start_deadline),
      ship_deadline = coalesce(excluded.ship_deadline, public.ml_returns.ship_deadline),
      protected_until = coalesce(excluded.protected_until, public.ml_returns.protected_until),
      refunded_at = coalesce(public.ml_returns.refunded_at, excluded.refunded_at),
      claim_number = coalesce(public.ml_returns.claim_number, excluded.claim_number),
      -- el reembolso cierra; si no, avanza a la etapa más reciente
      stage = case when public.ml_returns.stage = 'reembolsada' or excluded.stage = 'reembolsada' then 'reembolsada' else excluded.stage end,
      updated_at = now()
    returning id into v_id;
    n := n + 1;
  end loop;
  perform public.ml_returns_match_bank(v_org);
  return n;
end;
$$;
revoke all on function public.ingest_ml_returns(text, jsonb) from public;
grant execute on function public.ingest_ml_returns(text, jsonb) to anon, authenticated;

-- 20) El reembolso se busca en el banco (devolución por el mismo importe de la compra, hasta 15 días después)
create or replace function public.ml_returns_match_bank(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  update public.ml_returns r set bank_movement_id = (
      select b.id from public.bank_movements b
        join public.ml_orders o on o.id = r.ml_order_id
       where b.org_id = r.org_id and b.direction = 'in' and abs(b.amount - o.total_amount) <= 1
         and b.mov_date between (r.refunded_at at time zone 'America/Argentina/Buenos_Aires')::date - 3 and (r.refunded_at at time zone 'America/Argentina/Buenos_Aires')::date + 15
         and not exists (select 1 from public.ml_returns x where x.bank_movement_id = b.id)
       order by b.mov_date limit 1), updated_at = now()
   where r.org_id = p_org and r.stage = 'reembolsada' and r.bank_movement_id is null and r.ml_order_id is not null;
$$;

-- 18 y 19) Avisos: un día antes de cada fecha límite
create or replace function public.auto_ml_returns(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  perform public.ml_returns_match_bank(p_org);
  for r in select * from public.ml_returns where org_id = p_org and stage <> 'reembolsada' loop
    if r.start_deadline >= current_date then
      perform public.notify(p_org, 'mlr-start:' || r.id || ':' || r.start_deadline, 'Último día para iniciar la devolución',
        left(r.title, 200) || ' · vence el ' || to_char(r.start_deadline, 'DD/MM'), '/mercadolibre/compras?v=devoluciones',
        greatest(now(), ((r.start_deadline - 1)::timestamp + time '10:00') at time zone 'America/Argentina/Buenos_Aires'), 'alta');
    end if;
    if r.ship_deadline >= current_date then
      perform public.notify(p_org, 'mlr-ship:' || r.id || ':' || r.ship_deadline, 'Llevá la devolución al punto de despacho',
        left(r.title, 200) || ' · tenés hasta el ' || to_char(r.ship_deadline, 'DD/MM'), '/mercadolibre/compras?v=devoluciones',
        greatest(now(), ((r.ship_deadline - 1)::timestamp + time '10:00') at time zone 'America/Argentina/Buenos_Aires'), 'alta');
    end if;
    if r.protected_until >= current_date then
      perform public.notify(p_org, 'mlr-prot:' || r.id || ':' || r.protected_until, 'Se vence la compra protegida',
        left(r.title, 200) || ' · protegida hasta el ' || to_char(r.protected_until, 'DD/MM') || '. Si no te resolvieron, reclamá antes.', '/mercadolibre/compras?v=devoluciones',
        greatest(now(), ((r.protected_until - 2)::timestamp + time '10:00') at time zone 'America/Argentina/Buenos_Aires'));
    end if;
  end loop;
end;
$$;

create or replace function public.automations_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select id from public.organizations loop
    begin perform public.auto_gmail_watchdog(o); exception when others then null; end;
    begin perform public.auto_po_close(o); exception when others then null; end;
    begin perform public.auto_po_extensions(o); exception when others then null; end;
    begin perform public.auto_prd_invoice(o); exception when others then null; end;
    begin perform public.auto_publications(o); exception when others then null; end;
    begin perform public.fixed_classify(o); exception when others then null; end;
    begin perform public.auto_weekly_bank(o); exception when others then null; end;
    begin perform public.auto_monthly_accounting(o); exception when others then null; end;
    begin perform public.auto_ml_shipments(o); exception when others then null; end;
    begin perform public.auto_ml_returns(o); exception when others then null; end;
  end loop;
end;
$$;
revoke all on function public.automations_tick() from public, anon, authenticated;
