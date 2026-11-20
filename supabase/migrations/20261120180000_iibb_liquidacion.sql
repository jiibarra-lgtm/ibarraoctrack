-- Liquidación mensual de Ingresos Brutos (Convenio Multilateral, CM03): coeficientes y alícuotas por jurisdicción
-- y la liquidación de cada mes con su saldo a favor que pasa al siguiente.
create table if not exists public.iibb_jurisdictions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  code smallint not null check (code between 901 and 924),
  coefficient numeric(7,4) not null default 0 check (coefficient between 0 and 1),
  rate numeric(6,3) not null default 3 check (rate between 0 and 20),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (org_id, code)
);
alter table public.iibb_jurisdictions enable row level security;
create policy iibb_jurisdictions_select on public.iibb_jurisdictions for select to authenticated using (public.is_org_member(org_id));
create policy iibb_jurisdictions_write on public.iibb_jurisdictions for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

-- Para arrancar: todo en CABA con la alícuota que ya estaba cargada en Impuestos
insert into public.iibb_jurisdictions (org_id, code, coefficient, rate)
select o.id, 901, 1, coalesce((select t.iibb_rate from public.tax_settings t where t.org_id = o.id), 3) from public.organizations o
on conflict do nothing;
insert into public.iibb_jurisdictions (org_id, code, coefficient, rate, active)
select o.id, 902, 0, 3.5, false from public.organizations o
on conflict do nothing;

create table if not exists public.iibb_filings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  base numeric(16,2) not null default 0,
  -- [{code, coefficient, rate, base, tax, retenciones, percepciones, sircreb, favor_prev, due, favor_next}]
  detail jsonb not null default '[]'::jsonb,
  total_tax numeric(16,2) not null default 0,
  total_due numeric(16,2) not null default 0,
  status text not null default 'borrador' check (status in ('borrador', 'presentada')),
  presented_at date,
  paid_at date,
  notes text,
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (org_id, month)
);
alter table public.iibb_filings enable row level security;
create policy iibb_filings_select on public.iibb_filings for select to authenticated using (public.is_org_member(org_id));
create policy iibb_filings_write on public.iibb_filings for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
