-- =====================================================================
-- Gastos fijos: los que se cargan a mano (sueldos, alquiler…) y los que se detectan solos
-- por mail (gas, luz, agua, teléfono, prepaga, débitos automáticos) o por ARCA (proveedores recurrentes).
-- =====================================================================
create table public.fixed_costs (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  category       text not null default 'otros',
  amount         numeric(18,2) not null default 0 check (amount >= 0),
  frequency      integer not null default 1 check (frequency in (1, 2, 3, 6, 12)),   -- cada cuántos meses
  due_day        integer check (due_day between 1 and 31),
  active         boolean not null default true,
  source         text not null default 'manual' check (source in ('manual', 'mail', 'arca')),
  provider_key   text,
  account_ref    text,
  supplier_cuit  text,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index uq_fixed_costs_provider on public.fixed_costs(org_id, provider_key, account_ref) where provider_key is not null;
create unique index uq_fixed_costs_cuit on public.fixed_costs(org_id, supplier_cuit) where supplier_cuit is not null;
create trigger trg_fixed_costs_updated before update on public.fixed_costs for each row execute function public.tg_set_updated_at();

create table public.fixed_cost_bills (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  cost_id      uuid references public.fixed_costs(id) on delete cascade,
  dedupe_key   text not null,
  period       text not null check (period ~ '^\d{4}-\d{2}$'),
  due_date     date,
  amount       numeric(18,2),
  paid         boolean not null default false,
  paid_at      date,
  source       text not null default 'mail' check (source in ('mail', 'manual', 'arca')),
  message_id   text,
  subject      text,
  created_at   timestamptz not null default now(),
  unique (org_id, dedupe_key)
);
create index idx_fixed_cost_bills on public.fixed_cost_bills(org_id, period);

alter table public.fixed_costs enable row level security;
alter table public.fixed_cost_bills enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fixed_costs','fixed_cost_bills'] loop
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (public.is_org_member(org_id))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated with check (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated using (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[])) with check (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]))$p$, t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

-- Facturas de servicios leídas de los mails (lo llama /api/inbound/gmail con el token de la empresa)
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

-- Proveedores que facturan todos los meses según ARCA (sugeridos como gasto fijo)
create view public.arca_recurring_suppliers with (security_invoker = true) as
select v.org_id, v.doc_number as cuit, max(v.name) as name,
  count(distinct to_char(v.issue_date, 'YYYY-MM')) as months,
  round(sum(v.sign * v.total) / count(distinct to_char(v.issue_date, 'YYYY-MM')), 2) as avg_month,
  max(v.issue_date) as last_date
from public.arca_vouchers_overview v
where v.direction = 'recibido' and v.issue_date >= (current_date - interval '6 months')
group by v.org_id, v.doc_number
having count(distinct to_char(v.issue_date, 'YYYY-MM')) >= 4
   and not exists (select 1 from public.fixed_costs f where f.org_id = v.org_id and f.supplier_cuit = v.doc_number);
grant select on public.arca_recurring_suppliers to authenticated;
