-- =====================================================================
-- Actos administrativos del BAC (ampliación, prórroga, rescisión, penalidad) vinculados a la OC,
-- avisos fiscales (e-Ventanilla de ARCA y AGIP) con VEP cruzado contra el banco,
-- y la tarjeta de Mercado Pago completa (resumen, vencimiento, pagado, parcial).
-- =====================================================================

-- 1) Actos administrativos del BAC
create table public.bac_contract_acts (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  message_id      text not null,
  act             text not null check (act in ('ampliacion', 'prorroga', 'rescision', 'penalidad', 'disminucion', 'otro')),
  bac_number      text,
  contract_number text,
  act_number      text,
  process_number  text,
  process_name    text,
  received_at     timestamptz not null,
  reviewed_at     timestamptz,
  unique (org_id, message_id)
);
create index idx_bac_acts_oc on public.bac_contract_acts(org_id, bac_number);
alter table public.bac_contract_acts enable row level security;
create policy bac_acts_read on public.bac_contract_acts for select to authenticated using (public.is_org_member(org_id));
grant select on public.bac_contract_acts to authenticated;

create or replace function public.ingest_bac_acts(p_token text, p_acts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; n integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_acts) <> 'array' or jsonb_array_length(p_acts) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.bac_contract_acts (org_id, message_id, act, bac_number, contract_number, act_number, process_number, process_name, received_at)
  select v_org, left(x->>'message_id', 200),
    case when x->>'act' in ('ampliacion', 'prorroga', 'rescision', 'penalidad', 'disminucion') then x->>'act' else 'otro' end,
    case when upper(x->>'bac_number') ~ '^\d{2,5}-\d{3,7}-OC\d{2}$' then upper(x->>'bac_number') end,
    left(upper(x->>'contract_number'), 40), left(x->>'act_number', 80), left(upper(x->>'process_number'), 40), left(x->>'process_name', 300),
    (x->>'received_at')::timestamptz
  from jsonb_array_elements(p_acts) x
  where coalesce(x->>'message_id', '') <> '' and x->>'received_at' ~ '^\d{4}-\d{2}-\d{2}'
  on conflict (org_id, message_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_bac_acts(text, jsonb) from public;
grant execute on function public.ingest_bac_acts(text, jsonb) to anon, authenticated;

create view public.bac_contract_acts_overview with (security_invoker = true) as
select a.*, po.id as purchase_order_id, po.status as po_status
from public.bac_contract_acts a
left join public.purchase_orders po on po.org_id = a.org_id and upper(po.bac_number) = a.bac_number;
grant select on public.bac_contract_acts_overview to authenticated;

create or replace function public.bac_act_review(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  update public.bac_contract_acts set reviewed_at = now() where id = p_id and org_id = p_org;
end;
$$;
revoke all on function public.bac_act_review(uuid, uuid) from public, anon;
grant execute on function public.bac_act_review(uuid, uuid) to authenticated;

-- 2) Avisos fiscales (ARCA e-Ventanilla / AGIP)
create table public.tax_notices (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  message_id  text not null,
  at          timestamptz not null,
  source      text not null check (source in ('arca', 'agip')),
  system      text not null,
  title       text not null,
  severity    text not null check (severity in ('danger', 'warn', 'info')),
  kind        text not null check (kind in ('dfe', 'falta_presentacion', 'intimacion', 'plan', 'vep', 'embargo', 'otro')),
  vep_number  text,
  cuit        text,
  seen_at     timestamptz,
  unique (org_id, message_id)
);
create index idx_tax_notices_org on public.tax_notices(org_id, at desc);
alter table public.tax_notices enable row level security;
create policy tax_notices_read on public.tax_notices for select to authenticated using (public.is_org_member(org_id));
grant select on public.tax_notices to authenticated;

create or replace function public.ingest_tax_notices(p_token text, p_notices jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; n integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_notices) <> 'array' or jsonb_array_length(p_notices) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.tax_notices (org_id, message_id, at, source, system, title, severity, kind, vep_number, cuit)
  select v_org, left(x->>'message_id', 200), (x->>'at')::timestamptz,
    case when x->>'source' = 'agip' then 'agip' else 'arca' end, left(coalesce(x->>'system', ''), 160), left(coalesce(x->>'title', 'Aviso'), 200),
    case when x->>'severity' in ('danger', 'warn', 'info') then x->>'severity' else 'warn' end,
    case when x->>'kind' in ('dfe', 'falta_presentacion', 'intimacion', 'plan', 'vep', 'embargo') then x->>'kind' else 'otro' end,
    case when x->>'vep_number' ~ '^\d{6,14}$' then x->>'vep_number' end, case when x->>'cuit' ~ '^\d{11}$' then x->>'cuit' end
  from jsonb_array_elements(p_notices) x
  where coalesce(x->>'message_id', '') <> '' and x->>'at' ~ '^\d{4}-\d{2}-\d{2}'
  on conflict (org_id, message_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_tax_notices(text, jsonb) from public;
grant execute on function public.ingest_tax_notices(text, jsonb) to anon, authenticated;

create or replace function public.tax_notice_seen(p_org uuid, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  update public.tax_notices set seen_at = now() where org_id = p_org and (p_id is null or id = p_id) and seen_at is null;
end;
$$;
revoke all on function public.tax_notice_seen(uuid, uuid) from public, anon;
grant execute on function public.tax_notice_seen(uuid, uuid) to authenticated;

-- VEP generado → débito en el banco: por el número de VEP en el detalle, o un pago a ARCA/AGIP en los 30 días siguientes
create view public.tax_notices_overview with (security_invoker = true) as
select n.*,
  (select b.id from public.bank_movements b where b.org_id = n.org_id and n.vep_number is not null and b.direction is distinct from 'in'
     and (b.detail like '%' || n.vep_number || '%'
          or (b.mov_date between (n.at at time zone 'America/Argentina/Buenos_Aires')::date and (n.at at time zone 'America/Argentina/Buenos_Aires')::date + 30
              and b.detail ~* (case when n.source = 'agip' then 'AGIP|RENTAS|GCBA|VEP' else 'AFIP|ARCA|VEP' end)))
   order by (b.detail like '%' || n.vep_number || '%') desc, b.mov_date limit 1) as paid_movement_id
from public.tax_notices n;
grant select on public.tax_notices_overview to authenticated;

-- 3) Tarjeta Mercado Pago completa
alter table public.card_alerts add column if not exists kind text not null default 'parcial' check (kind in ('resumen', 'pagado', 'parcial', 'sin_deuda'));
alter table public.card_alerts add column if not exists due_date date;
alter table public.card_alerts add column if not exists amount numeric(18,2);
alter table public.card_alerts alter column missing drop not null;

create or replace function public.ingest_card_alerts(p_token text, p_alerts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; n integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_alerts) <> 'array' or jsonb_array_length(p_alerts) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.card_alerts (org_id, message_id, at, card, kind, due_date, amount, debited, missing)
  select v_org, left(x->>'message_id', 200), (x->>'at')::timestamptz, left(x->>'card', 80),
    case when x->>'kind' in ('resumen', 'pagado', 'parcial', 'sin_deuda') then x->>'kind' else 'parcial' end,
    case when x->>'due_date' ~ '^\d{4}-\d{2}-\d{2}$' then (x->>'due_date')::date end,
    case when x->>'amount' ~ '^\d{1,15}(\.\d{1,2})?$' then (x->>'amount')::numeric end,
    case when x->>'debited' ~ '^\d{1,15}(\.\d{1,2})?$' then (x->>'debited')::numeric end,
    case when x->>'missing' ~ '^\d{1,15}(\.\d{1,2})?$' then (x->>'missing')::numeric end
  from jsonb_array_elements(p_alerts) x
  where x->>'at' ~ '^\d{4}-\d{2}-\d{2}' and coalesce(x->>'message_id', '') <> ''
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_card_alerts(text, jsonb) from public;
grant execute on function public.ingest_card_alerts(text, jsonb) to anon, authenticated;

-- Resumen de cada vencimiento: total, cuánto se debitó y cuánto falta
create view public.card_statements with (security_invoker = true) as
with r as (
  select org_id, card, due_date, max(amount) as total, min(at) as closed_at
  from public.card_alerts where kind = 'resumen' and due_date is not null
  group by org_id, card, due_date
)
select r.*,
  coalesce((select sum(coalesce(a.debited, a.amount)) from public.card_alerts a
            where a.org_id = r.org_id and a.card = r.card and a.kind in ('pagado', 'parcial')
              and a.at >= r.closed_at and (a.at at time zone 'America/Argentina/Buenos_Aires')::date <= r.due_date + 25), 0) as paid
from r;
grant select on public.card_statements to authenticated;

-- 4) Suscripción detectada en la tarjeta → gasto fijo (y sus pagos quedan asociados y marcados por mes)
create or replace function public.add_subscription(p_org uuid, p_payee_key text, p_name text, p_amount numeric, p_category text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_cost uuid;
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if coalesce(p_payee_key, '') = '' or length(p_payee_key) > 60 then raise exception 'Comercio inválido'; end if;
  insert into public.fixed_costs (org_id, name, category, amount, source, provider_key, account_ref, created_by)
  values (p_org, left(coalesce(nullif(p_name, ''), p_payee_key), 120),
          case when p_category in ('sueldos','alquiler','servicios','telefonia','salud','impuestos','seguros','bancos','software','vehiculos','honorarios') then p_category else 'software' end,
          greatest(0, round(coalesce(p_amount, 0), 2)), 'banco', 'pago', p_payee_key, auth.uid())
  on conflict (org_id, provider_key, account_ref) where provider_key is not null do update set active = true, amount = excluded.amount
  returning id into v_cost;
  insert into public.payee_rules (org_id, payee_key, not_fixed) values (p_org, p_payee_key, false)
  on conflict (org_id, payee_key) do update set not_fixed = false;
  update public.payments_out set cost_id = v_cost where org_id = p_org and payee_key = p_payee_key and cost_id is null;
  insert into public.fixed_cost_bills (org_id, cost_id, dedupe_key, period, amount, paid, paid_at, source)
  select p_org, v_cost, 'pago|' || v_cost || '|' || to_char(p.paid_at, 'YYYY-MM'), to_char(p.paid_at, 'YYYY-MM'), sum(p.amount), true, max(p.paid_at), 'manual'
  from public.payments_out p where p.org_id = p_org and p.cost_id = v_cost
  group by to_char(p.paid_at, 'YYYY-MM')
  on conflict (org_id, dedupe_key) do update set amount = excluded.amount, paid_at = excluded.paid_at, paid = true;
  return v_cost;
end;
$$;
revoke all on function public.add_subscription(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.add_subscription(uuid, text, text, numeric, text) to authenticated;
