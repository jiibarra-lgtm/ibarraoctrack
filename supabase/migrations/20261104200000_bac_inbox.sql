-- =====================================================================
-- OC SISTEMA · Avisos automáticos de BAC / SIGAF (desde Gmail)
-- Panel de órdenes avisadas (cargadas o no), PRD, perfeccionamiento, pagos y publicaciones.
-- El ingreso llega por un webhook protegido con un token por empresa (sólo se guarda su hash).
-- =====================================================================

create table public.inbound_tokens (
  org_id        uuid primary key references public.organizations(id) on delete cascade,
  token_hash    text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  last_received integer,
  total_events  integer not null default 0
);
alter table public.inbound_tokens enable row level security;
create policy inbound_tokens_select on public.inbound_tokens for select to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy inbound_tokens_insert on public.inbound_tokens for insert to authenticated
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy inbound_tokens_update on public.inbound_tokens for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));

-- Órdenes avisadas por BAC (aunque todavía no estén cargadas en el sistema)
create table public.bac_orders_inbox (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  bac_number       text not null check (bac_number ~ '^\d{2,5}-\d{3,7}-OC\d{2}$'),
  unit_code        text generated always as (split_part(bac_number, '-', 1)) stored,
  convenio_number  text,
  convenio_name    text,
  process_number   text,
  process_name     text,
  notified_at      timestamptz,
  perfected_at     timestamptz,
  prd_number       text,
  prd_at           timestamptz,
  dismissed        boolean not null default false,
  first_seen_at    timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (org_id, bac_number)
);
create index idx_bac_inbox_org on public.bac_orders_inbox(org_id, coalesce(notified_at, perfected_at, first_seen_at) desc);
create trigger trg_bac_inbox_updated before update on public.bac_orders_inbox for each row execute function public.tg_set_updated_at();

-- Oficinas de compra (código de unidad ejecutora → nombre), aprendidas de los avisos
create table public.bac_units (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  code        text not null check (code ~ '^\d{2,5}$'),
  name        text not null,
  updated_at  timestamptz not null default now(),
  primary key (org_id, code)
);

-- Pliegos publicados en rubros del proveedor (oportunidades)
create table public.bac_publications (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  process_number  text not null,
  unit_code       text,
  unit_name       text,
  title           text,
  opening_date    date,
  received_at     timestamptz,
  unique (org_id, process_number)
);
create index idx_bac_pub_org on public.bac_publications(org_id, opening_date desc);

-- Registro de cada aviso procesado (idempotente por mensaje)
create table public.bac_mail_events (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  message_id   text not null,
  kind         text not null check (kind in ('oc_generada', 'oc_perfeccionada', 'prd', 'pago', 'publicacion')),
  received_at  timestamptz not null,
  subject      text,
  data         jsonb not null,
  result       text,
  created_at   timestamptz not null default now(),
  unique (org_id, message_id, kind)
);
create index idx_bac_events_org on public.bac_mail_events(org_id, received_at desc);

alter table public.bac_orders_inbox enable row level security;
alter table public.bac_units enable row level security;
alter table public.bac_publications enable row level security;
alter table public.bac_mail_events enable row level security;
create policy bac_inbox_select on public.bac_orders_inbox for select to authenticated using (public.is_org_member(org_id));
create policy bac_inbox_update on public.bac_orders_inbox for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy bac_units_select on public.bac_units for select to authenticated using (public.is_org_member(org_id));
create policy bac_pub_select on public.bac_publications for select to authenticated using (public.is_org_member(org_id));
create policy bac_events_select on public.bac_mail_events for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- Ingreso de avisos (llamado por el webhook con el token de la empresa)
-- ---------------------------------------------------------------------
create or replace function public.ingest_bac_events(p_token text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_e       jsonb;
  v_d       jsonb;
  v_kind    text;
  v_at      timestamptz;
  v_day     date;
  v_new     integer := 0;
  v_applied integer := 0;
  v_result  text;
  v_id      uuid;
  v_inv     public.sales_invoices;
  v_bal     numeric;
  v_oc      text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Token inválido' using errcode = '28000';
  end if;
  select org_id into v_org from public.inbound_tokens
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception 'Formato inválido' using errcode = '22023';
  end if;

  for v_e in select * from jsonb_array_elements(p_events) loop
    v_id := null;
    v_kind := v_e->>'kind';
    v_d := coalesce(v_e->'data', '{}'::jsonb);
    v_at := coalesce((v_e->>'received_at')::timestamptz, now());
    v_day := (v_at at time zone 'America/Argentina/Buenos_Aires')::date;
    v_result := null;
    if v_kind not in ('oc_generada', 'oc_perfeccionada', 'prd', 'pago', 'publicacion')
       or coalesce(v_e->>'message_id', '') = '' then
      continue;
    end if;

    insert into public.bac_mail_events (org_id, message_id, kind, received_at, subject, data)
    values (v_org, left(v_e->>'message_id', 200), v_kind, v_at, left(v_e->>'subject', 300), v_d)
    on conflict (org_id, message_id, kind) do nothing
    returning id into v_id;
    if v_id is null then continue; end if;  -- ya procesado
    v_new := v_new + 1;

    v_oc := upper(v_d->>'bac_number');
    if v_kind in ('oc_generada', 'oc_perfeccionada', 'prd') and (v_oc is null or v_oc !~ '^\d{2,5}-\d{3,7}-OC\d{2}$') then
      update public.bac_mail_events set result = 'número de OC inválido' where id = v_id;
      v_id := null;
      continue;
    end if;

    if v_kind = 'oc_generada' then
      insert into public.bac_orders_inbox (org_id, bac_number, convenio_number, convenio_name, notified_at)
      values (v_org, v_oc, left(v_d->>'convenio_number', 40), left(v_d->>'convenio_name', 300), v_at)
      on conflict (org_id, bac_number) do update set
        convenio_number = coalesce(excluded.convenio_number, public.bac_orders_inbox.convenio_number),
        convenio_name = coalesce(excluded.convenio_name, public.bac_orders_inbox.convenio_name),
        notified_at = least(coalesce(public.bac_orders_inbox.notified_at, excluded.notified_at), excluded.notified_at);
      v_result := 'orden avisada';

    elsif v_kind = 'oc_perfeccionada' then
      insert into public.bac_orders_inbox (org_id, bac_number, process_number, process_name, perfected_at)
      values (v_org, v_oc, left(v_d->>'process_number', 40), left(v_d->>'process_name', 300), v_at)
      on conflict (org_id, bac_number) do update set
        process_number = coalesce(excluded.process_number, public.bac_orders_inbox.process_number),
        process_name = coalesce(excluded.process_name, public.bac_orders_inbox.process_name),
        perfected_at = coalesce(public.bac_orders_inbox.perfected_at, excluded.perfected_at);
      perform set_config('app.status_reason', 'Aviso de BAC: perfeccionamiento', true);
      update public.purchase_orders
         set perfected_date = coalesce(perfected_date, v_day),
             status = case when status in ('borrador', 'recibida') then 'perfeccionada'::public.po_status else status end
       where org_id = v_org and upper(bac_number) = v_oc;
      v_result := case when found then 'orden perfeccionada' else 'perfeccionamiento guardado (orden sin cargar)' end;
      if found then v_applied := v_applied + 1; end if;

    elsif v_kind = 'prd' then
      insert into public.bac_orders_inbox (org_id, bac_number, prd_number, prd_at)
      values (v_org, v_oc, left(v_d->>'prd_number', 40), v_at)
      on conflict (org_id, bac_number) do update set
        prd_number = coalesce(public.bac_orders_inbox.prd_number, excluded.prd_number),
        prd_at = coalesce(public.bac_orders_inbox.prd_at, excluded.prd_at);
      v_result := 'PRD registrado';

    elsif v_kind = 'pago' then
      select * into v_inv from public.sales_invoices
       where org_id = v_org and status = 'emitida' and invoice_type = upper(v_d->>'invoice_type')
         and point_of_sale = (v_d->>'point_of_sale') and number = (v_d->>'number')
       limit 1;
      if v_inv.id is null then
        v_result := 'factura no registrada en el sistema';
      else
        select v_inv.total_amount - coalesce(sum(applied_amount), 0) into v_bal
          from public.collections where invoice_id = v_inv.id and status = 'confirmado';
        if v_bal <= 0 then
          v_result := 'factura ya cobrada';
        else
          insert into public.collections (org_id, invoice_id, purchase_order_id, payment_date, amount_received, method, reference, notes)
          values (v_org, v_inv.id, v_inv.purchase_order_id, greatest(v_day, v_inv.issue_date), v_bal, 'transferencia', 'Aviso SIGAF',
                  'Pago acreditado según aviso de SIGAF. El aviso no trae importes: si hubo retenciones, anulá este cobro y cargalo con el detalle.');
          v_result := 'cobro registrado';
          v_applied := v_applied + 1;
        end if;
      end if;

    elsif v_kind = 'publicacion' then
      if coalesce(v_d->>'unit_code', '') ~ '^\d{2,5}$' and coalesce(v_d->>'unit_name', '') <> '' then
        insert into public.bac_units (org_id, code, name) values (v_org, v_d->>'unit_code', left(v_d->>'unit_name', 200))
        on conflict (org_id, code) do update set name = excluded.name, updated_at = now();
      end if;
      insert into public.bac_publications (org_id, process_number, unit_code, unit_name, title, opening_date, received_at)
      values (v_org, left(upper(v_d->>'process_number'), 40), v_d->>'unit_code', left(v_d->>'unit_name', 200), left(v_d->>'title', 300),
              (v_d->>'opening_date')::date, v_at)
      on conflict (org_id, process_number) do nothing;
      v_result := 'publicación';
    end if;

    update public.bac_mail_events set result = v_result where id = v_id;
    v_id := null;
  end loop;

  update public.inbound_tokens set last_used_at = now(), last_received = jsonb_array_length(p_events), total_events = total_events + v_new
   where org_id = v_org;
  return jsonb_build_object('recibidos', jsonb_array_length(p_events), 'nuevos', v_new, 'aplicados', v_applied);
end;
$$;
revoke all on function public.ingest_bac_events(text, jsonb) from public;
grant execute on function public.ingest_bac_events(text, jsonb) to anon, authenticated;

-- Al cargar una orden ya avisada como perfeccionada, completa la fecha
create or replace function public.tg_po_from_inbox()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.bac_number is not null and new.perfected_date is null then
    select (perfected_at at time zone 'America/Argentina/Buenos_Aires')::date into new.perfected_date
      from public.bac_orders_inbox where org_id = new.org_id and bac_number = upper(new.bac_number);
  end if;
  return new;
end;
$$;
create trigger trg_po_from_inbox before insert on public.purchase_orders
  for each row execute function public.tg_po_from_inbox();

-- Panel: avisadas vs cargadas
create view public.bac_inbox_overview with (security_invoker = true) as
select
  b.*,
  po.id as purchase_order_id, po.status as po_status, po.total_amount as po_total, po.currency as po_currency,
  coalesce(c.name, u.name, (select x.name from public.customers x where x.org_id = b.org_id and x.name like b.unit_code || ' - %' limit 1)) as unit_name,
  (po.id is not null) as loaded
from public.bac_orders_inbox b
left join public.purchase_orders po on po.org_id = b.org_id and upper(po.bac_number) = b.bac_number
left join public.customers c on c.id = po.customer_id
left join public.bac_units u on u.org_id = b.org_id and u.code = b.unit_code;

grant select on public.bac_inbox_overview to authenticated;
