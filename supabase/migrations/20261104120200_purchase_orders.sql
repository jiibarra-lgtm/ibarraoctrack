-- =====================================================================
-- OC SISTEMA · Fase 1 · 003 — Órdenes de compra, renglones, historial
-- =====================================================================

create type public.po_status as enum (
  'borrador',       -- cargada, sin confirmar datos
  'recibida',       -- OC recibida y validada
  'perfeccionada',  -- perfeccionamiento / notificación formal
  'en_ejecucion',   -- con compras o entregas en curso
  'completada',     -- todo entregado
  'cerrada',        -- entregado, facturado y cobrado
  'anulada'
);

create type public.po_source as enum ('manual', 'importacion');

create table public.purchase_orders (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  internal_number        bigint generated always as identity,
  bac_number             text,
  expediente_number      text,
  process_number         text,
  contratacion_number    text,
  procurement_process_id uuid references public.procurement_processes(id) on delete set null,
  -- Datos de la OC en BAC
  bac_type               text,          -- Original / Ampliación / ...
  fiscal_year            integer check (fiscal_year is null or fiscal_year between 2000 and 2100),
  bac_status             text,          -- Estado informado por BAC (Perfeccionado, Autorizado...)
  contract_duration      text,
  -- Datos del proceso de compra
  process_type           text,          -- Bienes / Servicios
  modality               text,          -- Convenio Marco / Licitación Pública ...
  process_class          text,
  legal_framework        text,
  award_act_number       text,          -- Acto administrativo de adjudicación (RS-...)
  -- Datos comprador
  customer_id            uuid references public.customers(id) on delete restrict,
  jurisdiction           text,          -- Jurisdicción solicitante (401 - MINISTERIO DE SALUD)
  dependencia            text,          -- Unidad ejecutora (412 - HTAL. COSME ARGERICH)
  buyer_phone            text,
  buyer_address          text,
  buyer_notes            text,
  -- Datos adjudicatario
  awardee_name           text,
  awardee_cuit           text,
  awardee_entity_number  text,
  authorizers            jsonb not null default '[]'::jsonb,  -- [{nombre, cargo, fecha}] (no monetario)
  issue_date             date,
  received_date          date,
  perfected_date         date,
  delivery_term_text     text,
  delivery_term_days     integer check (delivery_term_days is null or delivery_term_days >= 0),
  due_date               date,
  delivery_place         text,
  payment_terms          text,
  contract_terms         text,
  currency               char(3) not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  discount_amount        numeric(18,2) check (discount_amount is null or discount_amount >= 0), -- importe bonificado
  net_amount             numeric(18,2) check (net_amount is null or net_amount >= 0),
  vat_amount             numeric(18,2) check (vat_amount is null or vat_amount >= 0),
  total_amount           numeric(18,2) check (total_amount is null or total_amount >= 0),
  notes                  text,
  status                 public.po_status not null default 'borrador',
  source                 public.po_source not null default 'manual',
  version                integer not null default 1,
  created_by             uuid references auth.users(id) on delete set null,
  updated_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index uq_po_bac_number on public.purchase_orders(org_id, upper(bac_number)) where bac_number is not null;
create index idx_po_org_status   on public.purchase_orders(org_id, status);
create index idx_po_customer     on public.purchase_orders(customer_id);
create index idx_po_issue_date   on public.purchase_orders(org_id, issue_date desc);
create index idx_po_due_date     on public.purchase_orders(org_id, due_date);
create index idx_po_bac_trgm     on public.purchase_orders using gin (public.norm(bac_number) extensions.gin_trgm_ops);
create index idx_po_exp_trgm     on public.purchase_orders using gin (public.norm(expediente_number) extensions.gin_trgm_ops);
create index idx_po_proc_trgm    on public.purchase_orders using gin (public.norm(process_number) extensions.gin_trgm_ops);
create index idx_po_contr_trgm   on public.purchase_orders using gin (public.norm(contratacion_number) extensions.gin_trgm_ops);

create table public.purchase_order_items (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete cascade,
  line_number             integer not null check (line_number > 0),
  option_number           integer not null default 1 check (option_number > 0),
  bac_code                text,          -- código catálogo BAC (18.10.001.0001.1)
  internal_code           text,
  product_id              uuid references public.products(id) on delete set null,
  description_original    text not null check (length(trim(description_original)) > 0),
  description_normalized  text,
  quantity                numeric(18,4) not null check (quantity > 0),
  unit                    text,
  unit_price              numeric(18,4) not null check (unit_price >= 0),
  total_amount            numeric(18,2) not null check (total_amount >= 0),
  packaging               text,
  -- Detalle de entrega BAC por renglón
  delivery_address        text,
  delivery_phone          text,
  delivery_term           text,
  delivery_notes          text,
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (purchase_order_id, line_number, option_number)
);
create index idx_poi_po        on public.purchase_order_items(purchase_order_id);
create index idx_poi_product   on public.purchase_order_items(product_id);
create index idx_poi_bac_code  on public.purchase_order_items(org_id, bac_code);
create index idx_poi_desc_trgm on public.purchase_order_items using gin (public.norm(description_original) extensions.gin_trgm_ops);
create index idx_poi_code_trgm on public.purchase_order_items using gin (public.norm(coalesce(bac_code,'') || ' ' || coalesce(internal_code,'')) extensions.gin_trgm_ops);
create trigger trg_poi_updated before update on public.purchase_order_items
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Historial de estados
-- ---------------------------------------------------------------------
create table public.purchase_order_status_history (
  id                 bigint generated always as identity primary key,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  from_status        public.po_status,
  to_status          public.po_status not null,
  reason             text,
  changed_by         uuid references auth.users(id) on delete set null,
  changed_at         timestamptz not null default now()
);
create index idx_po_status_hist on public.purchase_order_status_history(purchase_order_id, changed_at desc);

-- ---------------------------------------------------------------------
-- Revisiones (snapshot de la cabecera anterior a cada cambio)
-- ---------------------------------------------------------------------
create table public.purchase_order_revisions (
  id                 bigint generated always as identity primary key,
  org_id             uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete cascade,
  revision           integer not null,
  snapshot           jsonb not null,
  changed_by         uuid references auth.users(id) on delete set null,
  changed_at         timestamptz not null default now(),
  unique (purchase_order_id, revision)
);

create or replace function public.tg_po_before()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    new.updated_by := new.created_by;
    new.version    := 1;
  else
    if new.org_id <> old.org_id then
      raise exception 'No se puede cambiar la organización de una orden';
    end if;
    new.version    := old.version + 1;
    new.updated_at := now();
    new.updated_by := coalesce((select auth.uid()), new.updated_by);
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function public.tg_po_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.purchase_order_status_history (org_id, purchase_order_id, from_status, to_status, changed_by)
    values (new.org_id, new.id, null, new.status, (select auth.uid()));
  elsif tg_op = 'UPDATE' then
    insert into public.purchase_order_revisions (org_id, purchase_order_id, revision, snapshot, changed_by)
    values (old.org_id, old.id, old.version, to_jsonb(old), (select auth.uid()));
    if new.status is distinct from old.status then
      insert into public.purchase_order_status_history (org_id, purchase_order_id, from_status, to_status, changed_by, reason)
      values (new.org_id, new.id, old.status, new.status, (select auth.uid()),
              nullif(current_setting('app.status_reason', true), ''));
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_po_before before insert or update on public.purchase_orders
  for each row execute function public.tg_po_before();
create trigger trg_po_after after insert or update on public.purchase_orders
  for each row execute function public.tg_po_after();

-- Coherencia org de renglones
create or replace function public.tg_poi_org()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  select po.org_id into new.org_id from public.purchase_orders po where po.id = new.purchase_order_id;
  if new.org_id is null then
    raise exception 'Orden inexistente';
  end if;
  return new;
end;
$$;
create trigger trg_poi_org before insert or update of purchase_order_id on public.purchase_order_items
  for each row execute function public.tg_poi_org();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.purchase_orders               enable row level security;
alter table public.purchase_order_items          enable row level security;
alter table public.purchase_order_status_history enable row level security;
alter table public.purchase_order_revisions      enable row level security;

create policy po_select on public.purchase_orders for select to authenticated
  using (public.is_org_member(org_id));
create policy po_insert on public.purchase_orders for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy po_update on public.purchase_orders for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy po_delete on public.purchase_orders for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]) and status = 'borrador');

create policy poi_select on public.purchase_order_items for select to authenticated
  using (public.is_org_member(org_id));
create policy poi_insert on public.purchase_order_items for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy poi_update on public.purchase_order_items for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy poi_delete on public.purchase_order_items for delete to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));

-- Historial y revisiones: sólo lectura (los escribe el trigger)
create policy posh_select on public.purchase_order_status_history for select to authenticated
  using (public.is_org_member(org_id));
create policy por_select on public.purchase_order_revisions for select to authenticated
  using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- Vista de resumen (respeta RLS del invocador)
-- ---------------------------------------------------------------------
create view public.purchase_orders_overview
with (security_invoker = true) as
select
  po.*,
  c.name as customer_name,
  coalesce(i.items_count, 0)        as items_count,
  coalesce(i.items_total, 0)::numeric(18,2) as items_total,
  'OC-' || lpad(po.internal_number::text, 6, '0') as display_number
from public.purchase_orders po
left join public.customers c on c.id = po.customer_id
left join lateral (
  select count(*)::int as items_count, sum(x.total_amount) as items_total
  from public.purchase_order_items x where x.purchase_order_id = po.id
) i on true;
