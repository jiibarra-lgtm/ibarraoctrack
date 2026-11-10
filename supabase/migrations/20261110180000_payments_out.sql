-- =====================================================================
-- Pagos que salen (transferencias Red Link, consumos y débitos con tarjeta, resumen de tarjeta)
-- → gastos fijos detectados solos por repetición mensual, y gastos variables por rubro.
-- =====================================================================
alter table public.fixed_costs drop constraint if exists fixed_costs_source_check;
alter table public.fixed_costs add constraint fixed_costs_source_check check (source in ('manual', 'mail', 'arca', 'banco'));

create table public.payments_out (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  message_id  text not null,
  kind        text not null check (kind in ('transferencia', 'tarjeta', 'debito_automatico', 'resumen_tarjeta')),
  paid_at     date not null,
  amount      numeric(18,2) not null check (amount > 0),
  payee       text not null,
  payee_key   text not null,
  cbu         text,
  concept     text,
  card        text,
  due_date    date,
  category    text not null default 'otros',
  cost_id     uuid references public.fixed_costs(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (org_id, message_id)
);
create index idx_payments_out_org on public.payments_out(org_id, paid_at desc);
create index idx_payments_out_payee on public.payments_out(org_id, payee_key);

-- Reglas por destinatario: rubro corregido a mano o "es personal / no contar"
create table public.payee_rules (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  payee_key  text not null,
  category   text,
  ignore     boolean not null default false,
  not_fixed  boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (org_id, payee_key)
);

alter table public.payments_out enable row level security;
alter table public.payee_rules enable row level security;
create policy payments_out_select on public.payments_out for select to authenticated using (public.is_org_member(org_id));
create policy payee_rules_select on public.payee_rules for select to authenticated using (public.is_org_member(org_id));
create policy payee_rules_write on public.payee_rules for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]));

-- Detecta gastos fijos por repetición: mismo destinatario 3+ meses distintos en los últimos 6
-- (o 2+ meses si el concepto de la transferencia es sueldo, alquiler, seguro, honorarios o expensas)
create or replace function public.detect_fixed_from_payments(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r    record;
  v_cost uuid;
  v_n    integer := 0;
begin
  for v_r in
    select p.payee_key, max(p.payee) as payee, mode() within group (order by coalesce(r.category, p.category)) as category,
           count(distinct to_char(p.paid_at, 'YYYY-MM')) as months,
           percentile_cont(0.5) within group (order by m.total) as median_month,
           bool_or(p.concept in ('HAB', 'ALQ', 'SEG', 'HON', 'EXP')) as fixed_concept,
           bool_or(p.kind in ('debito_automatico', 'resumen_tarjeta')) as auto_debit
    from public.payments_out p
    join lateral (select sum(q.amount) as total from public.payments_out q
                  where q.org_id = p.org_id and q.payee_key = p.payee_key and to_char(q.paid_at, 'YYYY-MM') = to_char(p.paid_at, 'YYYY-MM')) m on true
    left join public.payee_rules r on r.org_id = p.org_id and r.payee_key = p.payee_key
    where p.org_id = p_org and p.paid_at >= current_date - interval '6 months'
      and coalesce(r.ignore, false) = false and coalesce(r.not_fixed, false) = false
      and coalesce(r.category, p.category) not in ('proveedores', 'compras', 'comida', 'ferreteria')
    group by p.payee_key
    having count(distinct to_char(p.paid_at, 'YYYY-MM')) >= case when bool_or(p.concept in ('HAB', 'ALQ', 'SEG', 'HON', 'EXP')) or bool_or(p.kind in ('debito_automatico', 'resumen_tarjeta')) then 2 else 3 end
  loop
    insert into public.fixed_costs (org_id, name, category, amount, source, provider_key, account_ref)
    values (p_org, left(initcap(lower(v_r.payee)), 120),
            case when v_r.category in ('sueldos','alquiler','servicios','telefonia','salud','impuestos','seguros','bancos','software','vehiculos','honorarios') then v_r.category else 'otros' end,
            round(v_r.median_month::numeric, 2), 'banco', 'pago', v_r.payee_key)
    on conflict (org_id, provider_key, account_ref) where provider_key is not null do update set amount = excluded.amount
    returning id into v_cost;
    update public.payments_out set cost_id = v_cost where org_id = p_org and payee_key = v_r.payee_key and cost_id is null;
    v_n := v_n + 1;
  end loop;

  -- Cada mes pagado de un gasto fijo detectado queda como "pagado" en ese mes
  insert into public.fixed_cost_bills (org_id, cost_id, dedupe_key, period, due_date, amount, paid, paid_at, source)
  select p_org, p.cost_id, 'pago|' || p.cost_id || '|' || to_char(p.paid_at, 'YYYY-MM'), to_char(p.paid_at, 'YYYY-MM'),
         max(p.due_date), sum(p.amount), true, max(p.paid_at), 'manual'
  from public.payments_out p
  where p.org_id = p_org and p.cost_id is not null
  group by p.cost_id, to_char(p.paid_at, 'YYYY-MM')
  on conflict (org_id, dedupe_key) do update set amount = excluded.amount, paid_at = excluded.paid_at, paid = true;
  return v_n;
end;
$$;
revoke all on function public.detect_fixed_from_payments(uuid) from public, anon, authenticated;

create or replace function public.ingest_payments(p_token text, p_payments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_p   jsonb;
  v_n   integer := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) > 3000 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for v_p in select x from jsonb_array_elements(p_payments) x loop
    continue when coalesce(v_p->>'amount', '') !~ '^\d{1,15}(\.\d{1,2})?$' or coalesce(v_p->>'paid_at', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_p->>'payee_key', '') = '' or v_p->>'kind' not in ('transferencia', 'tarjeta', 'debito_automatico', 'resumen_tarjeta');
    insert into public.payments_out (org_id, message_id, kind, paid_at, amount, payee, payee_key, cbu, concept, card, due_date, category)
    values (v_org, left(v_p->>'message_id', 200), v_p->>'kind', (v_p->>'paid_at')::date, (v_p->>'amount')::numeric, left(v_p->>'payee', 200),
            left(v_p->>'payee_key', 60), nullif(v_p->>'cbu', ''), nullif(v_p->>'concept', ''), nullif(v_p->>'card', ''),
            case when v_p->>'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then (v_p->>'due_date')::date end, left(coalesce(v_p->>'category', 'otros'), 30))
    on conflict (org_id, message_id) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('pagos', v_n, 'gastos_fijos', public.detect_fixed_from_payments(v_org));
end;
$$;
revoke all on function public.ingest_payments(text, jsonb) from public;
grant execute on function public.ingest_payments(text, jsonb) to anon, authenticated;

-- Para la pantalla: re-detectar después de cambiar reglas
create or replace function public.redetect_fixed(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  return public.detect_fixed_from_payments(p_org);
end; $$;
revoke all on function public.redetect_fixed(uuid) from public, anon;
grant execute on function public.redetect_fixed(uuid) to authenticated;

create view public.payments_out_overview with (security_invoker = true) as
select p.*, coalesce(r.category, p.category) as final_category, coalesce(r.ignore, false) as ignored, f.name as cost_name
from public.payments_out p
left join public.payee_rules r on r.org_id = p.org_id and r.payee_key = p.payee_key
left join public.fixed_costs f on f.id = p.cost_id;
grant select on public.payments_out_overview to authenticated;

-- Facturas de servicios por mail: si ya existe el gasto que vino de ARCA del mismo proveedor, se usa ese
create or replace function public.tg_fixed_cost_claim()
returns trigger language plpgsql set search_path = '' as $$
declare v_alias text;
begin
  v_alias := case new.provider_key when 'movistar' then 'telefonica' when 'claro' then 'amx' when 'personal' then 'telecom'
                                   when 'aysa' then 'agua y saneamientos' else new.provider_key end;
  if new.source = 'mail' and exists (select 1 from public.fixed_costs f where f.org_id = new.org_id and f.source = 'arca' and f.provider_key is null
       and (public.norm(f.name) like '%' || public.norm(v_alias) || '%' or public.norm(f.name) like '%' || public.norm(new.provider_key) || '%')) then
    update public.fixed_costs f set provider_key = new.provider_key, account_ref = new.account_ref,
      category = case when f.category = 'otros' then new.category else f.category end
    where f.id = (select id from public.fixed_costs f2 where f2.org_id = new.org_id and f2.source = 'arca' and f2.provider_key is null
                    and (public.norm(f2.name) like '%' || public.norm(v_alias) || '%' or public.norm(f2.name) like '%' || public.norm(new.provider_key) || '%') limit 1);
    return null;  -- la fila nueva no se inserta: el ON CONFLICT de ingest_bills la encuentra en el próximo aviso
  end if;
  return new;
end; $$;
create trigger trg_fixed_cost_claim before insert on public.fixed_costs for each row execute function public.tg_fixed_cost_claim();

-- ingest_bills: usa el gasto de ARCA que reclamó el proveedor
create or replace function public.ingest_bills(p_token text, p_bills jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_b    jsonb;
  v_cost uuid;
  v_key  text;
  v_due  date;
  v_amt  numeric;
  v_n    integer := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_bills) <> 'array' or jsonb_array_length(p_bills) > 2000 then raise exception 'Formato inválido' using errcode = '22023'; end if;

  for v_b in select x from jsonb_array_elements(p_bills) x order by x->>'received_at' loop
    continue when coalesce(v_b->>'provider_key', '') !~ '^[a-z0-9-]{2,40}$';
    v_due := case when v_b->>'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then (v_b->>'due_date')::date end;
    v_amt := case when v_b->>'amount' ~ '^\d{1,15}(\.\d{1,2})?$' then (v_b->>'amount')::numeric end;

    insert into public.fixed_costs (org_id, name, category, amount, due_day, source, provider_key, account_ref)
    values (v_org, left(v_b->>'provider_name' || case when coalesce(v_b->>'account_ref', 'general') not in ('general', 'débito automático') then ' · ' || (v_b->>'account_ref') else '' end, 120),
            left(coalesce(v_b->>'category', 'servicios'), 30), coalesce(v_amt, 0), extract(day from v_due)::int, 'mail', v_b->>'provider_key', left(coalesce(v_b->>'account_ref', 'general'), 60))
    on conflict (org_id, provider_key, account_ref) where provider_key is not null do update set
      amount = case when v_amt is not null then v_amt else public.fixed_costs.amount end,
      due_day = coalesce(extract(day from v_due)::int, public.fixed_costs.due_day)
    returning id into v_cost;
    if v_cost is null then  -- lo tomó un gasto que ya venía de ARCA
      select id into v_cost from public.fixed_costs where org_id = v_org and provider_key = v_b->>'provider_key' and account_ref = left(coalesce(v_b->>'account_ref', 'general'), 60);
    end if;

    v_key := (v_b->>'provider_key') || '|' || coalesce(v_b->>'account_ref', 'general') || '|' ||
             coalesce(v_due::text, to_char((v_b->>'received_at')::timestamptz, 'YYYY-MM') || '|' || coalesce(v_amt::text, '?'));
    insert into public.fixed_cost_bills (org_id, cost_id, dedupe_key, period, due_date, amount, paid, paid_at, source, message_id, subject)
    values (v_org, v_cost, v_key, to_char(coalesce(v_due, (v_b->>'received_at')::timestamptz::date), 'YYYY-MM'), v_due, v_amt,
            coalesce((v_b->>'paid')::boolean, false), case when (v_b->>'paid')::boolean then coalesce(v_due, (v_b->>'received_at')::timestamptz::date) end,
            'mail', left(v_b->>'message_id', 200), left(v_b->>'subject', 300))
    on conflict (org_id, dedupe_key) do update set
      amount = coalesce(public.fixed_cost_bills.amount, excluded.amount),
      paid = public.fixed_cost_bills.paid or excluded.paid,
      paid_at = coalesce(public.fixed_cost_bills.paid_at, excluded.paid_at);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('facturas', v_n);
end;
$$;
revoke all on function public.ingest_bills(text, jsonb) from public;
grant execute on function public.ingest_bills(text, jsonb) to anon, authenticated;
