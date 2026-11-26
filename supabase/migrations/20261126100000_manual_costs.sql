-- Costos manuales: lista propia de costos por producto (cargada a mano o desde planilla),
-- separada de facturas de proveedores, compras y banco. No alimenta la ganancia automática de las OC:
-- se vincula a una OC / renglón sólo cuando el usuario lo hace a mano.

create table if not exists public.manual_costs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  sku           text,
  description   text not null check (length(trim(description)) > 0),
  supplier      text,
  cost          numeric(18,2) check (cost is null or cost >= 0),       -- tal como lo cargó el usuario
  includes_vat  boolean not null default false,                         -- ¿ese costo ya incluye IVA?
  vat_pct       numeric(5,2) not null default 21 check (vat_pct >= 0 and vat_pct <= 100),
  cost_net      numeric(18,2) generated always as (case when cost is null then null when includes_vat then round(cost / (1 + vat_pct / 100), 2) else cost end) stored,
  cost_gross    numeric(18,2) generated always as (case when cost is null then null when includes_vat then cost else round(cost * (1 + vat_pct / 100), 2) end) stored,
  unit          text,                                                   -- ej. "x 12 unidades", "x unidad"
  notes         text,
  source        text not null default 'manual' check (source in ('manual', 'planilla')),
  active        boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists manual_costs_org on public.manual_costs (org_id, active, description);

create table if not exists public.manual_cost_links (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  manual_cost_id          uuid not null references public.manual_costs(id) on delete cascade,
  purchase_order_id       uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id  uuid references public.purchase_order_items(id) on delete cascade,
  quantity                numeric(18,4) check (quantity is null or quantity > 0),   -- cuántas unidades de este costo lleva (vacío = la cantidad del renglón)
  notes                   text,
  created_by              uuid default auth.uid(),
  created_at              timestamptz not null default now()
);
create unique index if not exists manual_cost_links_unique on public.manual_cost_links (manual_cost_id, purchase_order_id, coalesce(purchase_order_item_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists manual_cost_links_po on public.manual_cost_links (purchase_order_id);

-- el renglón tiene que ser de la misma OC
create or replace function public.manual_cost_links_check() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.purchase_order_item_id is not null and not exists (
    select 1 from public.purchase_order_items i where i.id = new.purchase_order_item_id and i.purchase_order_id = new.purchase_order_id
  ) then raise exception 'El renglón no es de esa orden de compra'; end if;
  if not exists (select 1 from public.manual_costs c where c.id = new.manual_cost_id and c.org_id = new.org_id)
     or not exists (select 1 from public.purchase_orders p where p.id = new.purchase_order_id and p.org_id = new.org_id)
  then raise exception 'Costo u orden de otra organización'; end if;
  return new;
end $$;
drop trigger if exists manual_cost_links_check on public.manual_cost_links;
create trigger manual_cost_links_check before insert or update on public.manual_cost_links for each row execute function public.manual_cost_links_check();

create or replace function public.manual_costs_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists manual_costs_touch on public.manual_costs;
create trigger manual_costs_touch before update on public.manual_costs for each row execute function public.manual_costs_touch();

do $$
declare t text;
begin
  foreach t in array array['manual_costs', 'manual_cost_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[])) with check (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]))$p$, t || '_write', t);
  end loop;
end $$;
