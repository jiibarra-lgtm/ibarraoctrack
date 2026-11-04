-- =====================================================================
-- OC SISTEMA · Fase 1 · 002 — Datos maestros
-- Organismos (customers), proveedores, productos, procesos de compra
-- =====================================================================

-- ---------------------------------------------------------------------
-- Organismos compradores
-- ---------------------------------------------------------------------
create table public.customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null check (length(trim(name)) > 0),
  short_name  text,
  cuit        text,
  address     text,
  notes       text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index uq_customers_org_name on public.customers(org_id, public.norm(name));
create index idx_customers_name_trgm on public.customers using gin (public.norm(name) extensions.gin_trgm_ops);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.tg_set_updated_at();

create table public.customer_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  customer_id  uuid not null references public.customers(id) on delete cascade,
  name         text not null,
  role         text,
  dependency   text,
  phone        text,
  email        text,
  notes        text,
  created_at   timestamptz not null default now()
);
create index idx_customer_contacts_customer on public.customer_contacts(customer_id);

-- ---------------------------------------------------------------------
-- Proveedores (ficha completa en Fase 2)
-- ---------------------------------------------------------------------
create table public.suppliers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  cuit           text,
  phone          text,
  email          text,
  address        text,
  payment_terms  text,
  notes          text,
  rating         smallint check (rating between 1 and 5),
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index uq_suppliers_org_name on public.suppliers(org_id, public.norm(name));
create unique index uq_suppliers_org_cuit on public.suppliers(org_id, cuit) where cuit is not null;
create index idx_suppliers_name_trgm on public.suppliers using gin (public.norm(name) extensions.gin_trgm_ops);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.tg_set_updated_at();

create table public.supplier_contacts (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  name         text not null,
  role         text,
  phone        text,
  email        text,
  created_at   timestamptz not null default now()
);
create index idx_supplier_contacts_supplier on public.supplier_contacts(supplier_id);

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
create table public.product_categories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  created_at  timestamptz not null default now()
);
create unique index uq_product_categories on public.product_categories(org_id, public.norm(name));

create table public.products (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  internal_code  text,
  bac_code       text,
  description    text not null check (length(trim(description)) > 0),
  category_id    uuid references public.product_categories(id) on delete set null,
  unit           text,
  is_active      boolean not null default true,
  notes          text,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index uq_products_internal_code on public.products(org_id, internal_code) where internal_code is not null;
create index idx_products_bac_code on public.products(org_id, bac_code);
create index idx_products_desc_trgm on public.products using gin (public.norm(description) extensions.gin_trgm_ops);
create trigger trg_products_updated before update on public.products
  for each row execute function public.tg_set_updated_at();

-- Equivalencias confirmadas ("Papel hig. 100 mts" ↔ producto)
create table public.product_aliases (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  alias       text not null,
  source      text not null default 'manual' check (source in ('manual', 'bac', 'proveedor', 'remito')),
  supplier_id uuid references public.suppliers(id) on delete set null,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index uq_product_aliases on public.product_aliases(org_id, product_id, public.norm(alias));
create index idx_product_aliases_trgm on public.product_aliases using gin (public.norm(alias) extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------
-- Procesos de compra (licitación / contratación que origina la OC)
-- ---------------------------------------------------------------------
create table public.procurement_processes (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  customer_id          uuid references public.customers(id) on delete set null,
  process_number       text not null,
  expediente_number    text,
  contratacion_number  text,
  process_type         text,
  title                text,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create unique index uq_proc_process_number on public.procurement_processes(org_id, upper(process_number));
create trigger trg_procurement_updated before update on public.procurement_processes
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- RLS: lectura para miembros, escritura según rol
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['customers','customer_contacts','suppliers','supplier_contacts',
                           'product_categories','products','product_aliases','procurement_processes']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated
                     using (public.is_org_member(org_id))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (public.has_org_role(org_id, array['admin']::public.app_role[]))$p$, t);
  end loop;
end
$$;
