-- =====================================================================
-- OC SISTEMA · Fase 2 — Compras, costos, asignaciones y rentabilidad
-- Principios:
--  · Una compra puede abastecer varias órdenes y una orden varias compras (asignaciones explícitas).
--  · Nunca se asigna más cantidad que la comprada ni más importe que el del gasto (sin doble conteo).
--  · El costo unitario se congela al asignar: cambios de precio posteriores no alteran el histórico.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración financiera por empresa
-- ---------------------------------------------------------------------
create table public.financial_settings (
  org_id              uuid primary key references public.organizations(id) on delete cascade,
  vat_recoverable     boolean not null default true,   -- Responsable Inscripto: IVA compras recuperable
  sales_include_vat   boolean not null default true,   -- Precios BAC con IVA incluido
  default_vat_rate    numeric(5,2) not null default 21 check (default_vat_rate between 0 and 100),
  min_margin_pct      numeric(6,2) not null default 15,
  default_allocation  text not null default 'importe' check (default_allocation in ('importe', 'unidades')),
  updated_at          timestamptz not null default now()
);
alter table public.financial_settings enable row level security;
create policy fs_select on public.financial_settings for select to authenticated using (public.is_org_member(org_id));
create policy fs_insert on public.financial_settings for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
create policy fs_update on public.financial_settings for update to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
create trigger trg_fs_updated before update on public.financial_settings for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Categorías de costos
-- ---------------------------------------------------------------------
create type public.cost_kind as enum ('logistico', 'operativo', 'financiero', 'administrativo', 'otro');

create table public.cost_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  kind        public.cost_kind not null default 'otro',
  created_at  timestamptz not null default now()
);
create unique index uq_cost_categories on public.cost_categories(org_id, public.norm(name));

-- Datos iniciales por empresa (nuevas y existentes)
create or replace function public.seed_org_defaults(p_org uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.financial_settings (org_id) values (p_org) on conflict do nothing;
  insert into public.cost_categories (org_id, name, kind)
  select p_org, n, k::public.cost_kind from (values
    ('Flete','logistico'),('Combustible','logistico'),('Peajes','logistico'),('Embalaje','logistico'),
    ('Mano de obra','operativo'),('Almacenamiento','operativo'),('Comisiones','operativo'),('Seguros','operativo'),
    ('Gastos bancarios','financiero'),('Gastos financieros','financiero'),('Gastos administrativos','administrativo'),
    ('Penalidades','otro'),('Reposiciones','otro'),('Devoluciones','otro'),('Otros gastos','otro')
  ) v(n, k)
  on conflict do nothing;
$$;
revoke execute on function public.seed_org_defaults(uuid) from public, anon, authenticated;

create or replace function public.tg_org_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_org_defaults(new.id);
  return null;
end;
$$;
revoke execute on function public.tg_org_defaults() from public, anon, authenticated;
create trigger trg_org_defaults after insert on public.organizations for each row execute function public.tg_org_defaults();
select public.seed_org_defaults(id) from public.organizations;

-- ---------------------------------------------------------------------
-- Costo estimado por renglón (antes de comprar)
-- ---------------------------------------------------------------------
alter table public.purchase_order_items
  add column estimated_unit_cost numeric(18,4) check (estimated_unit_cost is null or estimated_unit_cost >= 0),
  add column supplier_id uuid references public.suppliers(id) on delete set null;

-- ---------------------------------------------------------------------
-- Compras (facturas de proveedores)
-- ---------------------------------------------------------------------
create type public.purchase_status as enum ('confirmada', 'anulada');

create table public.purchases (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id) on delete restrict,
  doc_type       text not null default 'factura_a'
                 check (doc_type in ('factura_a','factura_b','factura_c','factura_m','ticket','remito','otro')),
  point_of_sale  text,
  number         text,
  invoice_date   date not null,
  due_date       date,
  currency       char(3) not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  net_amount     numeric(18,2) not null default 0 check (net_amount >= 0),
  vat_amount     numeric(18,2) not null default 0 check (vat_amount >= 0),
  other_taxes    numeric(18,2) not null default 0 check (other_taxes >= 0),  -- percepciones, IIBB, etc.
  total_amount   numeric(18,2) not null check (total_amount >= 0),
  payment_terms  text,
  paid           boolean not null default false,
  paid_date      date,
  cae            text,
  status         public.purchase_status not null default 'confirmada',
  document_id    uuid references public.documents(id) on delete set null,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index uq_purchases_doc on public.purchases(org_id, supplier_id, doc_type, coalesce(point_of_sale, ''), number) where number is not null;
create index idx_purchases_org_date on public.purchases(org_id, invoice_date desc);
create index idx_purchases_supplier on public.purchases(supplier_id);
create trigger trg_purchases_updated before update on public.purchases for each row execute function public.tg_set_updated_at();

create table public.purchase_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  purchase_id   uuid not null references public.purchases(id) on delete cascade,
  line_number   integer not null check (line_number > 0),
  product_id    uuid references public.products(id) on delete set null,
  description   text not null check (length(trim(description)) > 0),
  quantity      numeric(18,4) not null check (quantity > 0),
  unit          text,
  unit_price    numeric(18,4) not null check (unit_price >= 0),
  discount_pct  numeric(6,3) not null default 0 check (discount_pct between 0 and 100),
  vat_rate      numeric(5,2) not null default 21 check (vat_rate between 0 and 100),
  net_amount    numeric(18,2) not null check (net_amount >= 0),     -- cantidad × precio × (1 − bonificación)
  created_at    timestamptz not null default now(),
  unique (purchase_id, line_number)
);
create index idx_purchase_items_purchase on public.purchase_items(purchase_id);
create index idx_purchase_items_desc_trgm on public.purchase_items using gin (public.norm(description) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Asignación compra → renglón de orden
-- ---------------------------------------------------------------------
create table public.purchase_allocations (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  purchase_item_id        uuid not null references public.purchase_items(id) on delete cascade,
  purchase_order_item_id  uuid not null references public.purchase_order_items(id) on delete restrict,
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete restrict,
  quantity                numeric(18,4) not null check (quantity > 0),
  unit_cost               numeric(18,6) not null check (unit_cost >= 0),   -- congelado al asignar
  amount                  numeric(18,2) not null check (amount >= 0),
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  unique (purchase_item_id, purchase_order_item_id)
);
create index idx_palloc_po on public.purchase_allocations(purchase_order_id);
create index idx_palloc_poi on public.purchase_allocations(purchase_order_item_id);

create or replace function public.tg_purchase_allocation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pi        public.purchase_items;
  v_poi       public.purchase_order_items;
  v_used      numeric;
  v_used_poi  numeric;
  v_recov     boolean;
begin
  select * into v_pi from public.purchase_items where id = new.purchase_item_id for update;
  select * into v_poi from public.purchase_order_items where id = new.purchase_order_item_id for update;
  if v_pi.id is null or v_poi.id is null then
    raise exception 'Compra o renglón inexistente';
  end if;
  if v_pi.org_id <> v_poi.org_id then
    raise exception 'La compra y la orden pertenecen a empresas distintas';
  end if;
  new.org_id := v_pi.org_id;
  new.purchase_order_id := v_poi.purchase_order_id;

  select coalesce(sum(quantity), 0) into v_used from public.purchase_allocations
   where purchase_item_id = new.purchase_item_id and id <> new.id;
  if v_used + new.quantity > v_pi.quantity then
    raise exception 'Se asignarían % unidades, pero la compra tiene % (ya asignadas %)',
      v_used + new.quantity, v_pi.quantity, v_used using errcode = '23514';
  end if;

  select coalesce(sum(pa.quantity), 0) into v_used_poi from public.purchase_allocations pa
    join public.purchase_items pi on pi.id = pa.purchase_item_id
    join public.purchases p on p.id = pi.purchase_id and p.status = 'confirmada'
   where pa.purchase_order_item_id = new.purchase_order_item_id and pa.id <> new.id;
  if v_used_poi + new.quantity > v_poi.quantity then
    raise exception 'El renglón % de la orden tiene % unidades y quedarían % compradas',
      v_poi.line_number, v_poi.quantity, v_used_poi + new.quantity using errcode = '23514';
  end if;

  -- Costo unitario congelado: neto (IVA recuperable) o con IVA (no recuperable)
  if tg_op = 'INSERT' or new.unit_cost is null then
    select coalesce(fs.vat_recoverable, true) into v_recov from public.financial_settings fs where fs.org_id = new.org_id;
    new.unit_cost := (v_pi.net_amount / v_pi.quantity) * case when coalesce(v_recov, true) then 1 else 1 + v_pi.vat_rate / 100 end;
  end if;
  new.amount := round(new.quantity * new.unit_cost, 2);
  return new;
end;
$$;
create trigger trg_purchase_allocation before insert or update on public.purchase_allocations
  for each row execute function public.tg_purchase_allocation();

-- ---------------------------------------------------------------------
-- Costos adicionales (flete, embalaje, comisiones…) y su asignación
-- ---------------------------------------------------------------------
create table public.costs (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  category_id        uuid not null references public.cost_categories(id) on delete restrict,
  description        text not null check (length(trim(description)) > 0),
  cost_date          date not null,
  supplier_id        uuid references public.suppliers(id) on delete set null,
  net_amount         numeric(18,2) not null check (net_amount >= 0),
  vat_amount         numeric(18,2) not null default 0 check (vat_amount >= 0),
  total_amount       numeric(18,2) not null check (total_amount >= 0),
  allocation_method  text not null default 'importe' check (allocation_method in ('manual', 'importe', 'unidades')),
  status             text not null default 'confirmado' check (status in ('confirmado', 'anulado')),
  document_id        uuid references public.documents(id) on delete set null,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_costs_org_date on public.costs(org_id, cost_date desc);
create trigger trg_costs_updated before update on public.costs for each row execute function public.tg_set_updated_at();

create table public.cost_allocations (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  cost_id                 uuid not null references public.costs(id) on delete cascade,
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete restrict,
  purchase_order_item_id  uuid references public.purchase_order_items(id) on delete restrict,
  amount                  numeric(18,2) not null check (amount >= 0),
  created_at              timestamptz not null default now()
);
create index idx_calloc_po on public.cost_allocations(purchase_order_id);
create index idx_calloc_cost on public.cost_allocations(cost_id);

-- Importe asignable de un gasto: neto si el IVA es recuperable, total si no
create or replace function public.cost_allocable(p_cost uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when coalesce(fs.vat_recoverable, true) then c.net_amount else c.total_amount end
    from public.costs c left join public.financial_settings fs on fs.org_id = c.org_id
   where c.id = p_cost
$$;

create or replace function public.tg_cost_allocation_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_sum numeric; v_max numeric;
begin
  select coalesce(sum(amount), 0) into v_sum from public.cost_allocations where cost_id = new.cost_id;
  v_max := public.cost_allocable(new.cost_id);
  if v_sum > v_max then
    raise exception 'El gasto se asignaría por % pero vale %', v_sum, v_max using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger trg_cost_allocation_check after insert or update on public.cost_allocations
  deferrable initially deferred for each row execute function public.tg_cost_allocation_check();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['cost_categories','purchases','purchase_items','purchase_allocations','costs','cost_allocations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (public.is_org_member(org_id))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))$p$, t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
end
$$;
create trigger trg_audit_financial_settings after insert or update or delete on public.financial_settings
  for each row execute function public.tg_audit();
