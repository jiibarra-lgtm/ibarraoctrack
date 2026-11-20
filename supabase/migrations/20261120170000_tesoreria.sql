-- Tesorería como en Tango: cheques (en cartera y emitidos), caja y conciliación bancaria.

create table if not exists public.cheques (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  direction text not null check (direction in ('recibido', 'emitido')),
  kind text not null default 'fisico' check (kind in ('fisico', 'echeq')),
  bank text,
  number text,
  counterpart_name text,
  counterpart_cuit text,
  amount numeric(14,2) not null check (amount > 0),
  issue_date date not null default current_date,
  pay_date date not null,
  -- recibido: cartera → depositado → acreditado | endosado | rechazado | anulado
  -- emitido: emitido → debitado | rechazado | anulado
  status text not null default 'cartera' check (status in ('cartera', 'depositado', 'acreditado', 'endosado', 'emitido', 'debitado', 'rechazado', 'anulado')),
  status_date date,
  endorsed_to text,
  customer_id uuid references public.customers(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  bank_movement_id uuid references public.bank_movements(id) on delete set null,
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((direction = 'recibido' and status in ('cartera', 'depositado', 'acreditado', 'endosado', 'rechazado', 'anulado'))
      or (direction = 'emitido' and status in ('emitido', 'debitado', 'rechazado', 'anulado')))
);
create index if not exists cheques_org_pay on public.cheques (org_id, pay_date);
alter table public.cheques enable row level security;
create policy cheques_select on public.cheques for select to authenticated using (public.is_org_member(org_id));
create policy cheques_write on public.cheques for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  mov_date date not null default current_date,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(14,2) not null check (amount > 0),
  -- venta: cobro en efectivo · proveedor: pago a proveedor · gasto: gasto chico · retiro: retiro del titular · aporte: aporte del titular
  -- banco: extracción del banco (entra) o depósito en el banco (sale) · arqueo: ajuste por diferencia al contar
  category text not null check (category in ('venta', 'proveedor', 'gasto', 'retiro', 'aporte', 'banco', 'arqueo', 'otro')),
  concept text not null check (length(btrim(concept)) between 2 and 200),
  reference text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cash_movements_org_date on public.cash_movements (org_id, mov_date);
alter table public.cash_movements enable row level security;
create policy cash_movements_select on public.cash_movements for select to authenticated using (public.is_org_member(org_id));
create policy cash_movements_write on public.cash_movements for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

-- Conciliación: a qué corresponde cada movimiento del banco (cuando no lo explicó solo el sistema)
create table if not exists public.bank_reconciliations (
  bank_movement_id uuid primary key references public.bank_movements(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('cobro', 'pago_proveedor', 'gasto_fijo', 'cheque', 'caja', 'impuesto', 'banco', 'titular', 'otro')),
  ref_id uuid,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.bank_reconciliations enable row level security;
create policy bank_reconciliations_select on public.bank_reconciliations for select to authenticated using (public.is_org_member(org_id));
create policy bank_reconciliations_write on public.bank_reconciliations for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
