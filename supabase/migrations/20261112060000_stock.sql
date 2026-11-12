-- =====================================================================
-- Stock automático: entra con las facturas de proveedores (y bultos) y las compras de Mercado Libre,
-- sale con los remitos emitidos. Cada producto junta las distintas formas en que lo escriben
-- proveedores, Mercado Libre y las OC (alias); los dudosos se confirman a mano.
-- =====================================================================
create table public.stock_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null check (length(trim(name)) > 0),
  unit       text,
  min_qty    numeric(18,4) not null default 0 check (min_qty >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index idx_stock_items_org on public.stock_items(org_id);
create index idx_stock_items_name on public.stock_items using gin (public.norm(name) extensions.gin_trgm_ops);

create table public.stock_aliases (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  key        text not null,
  item_id    uuid references public.stock_items(id) on delete cascade, -- null = "no es stock" (no se cuenta)
  confirmed  boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);
create index idx_stock_aliases_item on public.stock_aliases(item_id);

create table public.stock_adjustments (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  item_id    uuid not null references public.stock_items(id) on delete cascade,
  qty        numeric(18,4) not null check (qty <> 0),
  note       text not null check (length(trim(note)) > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.stock_items enable row level security;
alter table public.stock_aliases enable row level security;
alter table public.stock_adjustments enable row level security;
create policy stock_items_read on public.stock_items for select to authenticated using (public.is_org_member(org_id));
create policy stock_aliases_read on public.stock_aliases for select to authenticated using (public.is_org_member(org_id));
create policy stock_adj_read on public.stock_adjustments for select to authenticated using (public.is_org_member(org_id));
grant select on public.stock_items, public.stock_aliases, public.stock_adjustments to authenticated;

-- Todo lo que mueve stock, con la clave del producto (descripción normalizada)
create view public.stock_raw with (security_invoker = true) as
select i.org_id, 'factura'::text as source, i.id as ref_id, s.issue_date as mov_date, public.norm(i.description) as key, i.description,
  i.quantity * coalesce(i.pack, 1) as qty, case when i.unit_final is not null then i.unit_final / coalesce(i.pack, 1) end as unit_cost,
  coalesce(s.supplier_name, '') as party, s.id as doc_id
from public.supplier_invoice_items i join public.supplier_invoices s on s.id = i.invoice_id
where not s.hidden and s.kind = 'factura'
union all
select o.org_id, 'mercadolibre', o.id, coalesce(o.ordered_at, o.created_at)::date, public.norm(o.title), o.title,
  coalesce(o.quantity, 1), case when o.unit_price is not null then o.unit_price when o.total_amount is not null and o.quantity > 0 then o.total_amount / o.quantity end,
  coalesce(o.counterpart, 'Mercado Libre'), o.id
from public.ml_orders o
where o.kind = 'compra' and o.merged_into is null and o.status <> 'cancelada' and length(o.title) >= 4
union all
select ri.org_id, 'remito', ri.id, r.issued_at::date, public.norm(ri.description), ri.description, -ri.quantity, null, r.recipient_name, r.id
from public.remito_items ri join public.remitos r on r.id = ri.remito_id
where r.status <> 'anulado';
grant select on public.stock_raw to authenticated;

-- Une cada descripción nueva con un producto (compras: casi idéntica, 80%; remitos: 60%, porque la OC lo escribe distinto).
-- Si es una compra y no se parece a ninguno, crea el producto;
-- si es una salida (remito) busca el más parecido. Devuelve cuántas se vincularon.
create or replace function public.stock_autolink(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_item uuid;
  v_n integer := 0;
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  for v in
    select distinct on (r.key) r.key, r.description, r.source, r.qty
    from public.stock_raw r
    where r.org_id = p_org and r.key <> '' and not exists (select 1 from public.stock_aliases a where a.org_id = p_org and a.key = r.key)
    order by r.key, (r.source = 'remito'), r.mov_date desc
  loop
    select it.id into v_item
    from public.stock_items it
    where it.org_id = p_org and it.active and extensions.similarity(public.norm(it.name), v.key) > case when v.source = 'remito' then 0.6 else 0.8 end
    order by extensions.similarity(public.norm(it.name), v.key) desc limit 1;
    if v_item is null then
      select a.item_id into v_item from public.stock_aliases a
      where a.org_id = p_org and a.item_id is not null and extensions.similarity(a.key, v.key) > case when v.source = 'remito' then 0.6 else 0.8 end
      order by extensions.similarity(a.key, v.key) desc limit 1;
    end if;
    if v_item is null and v.source <> 'remito' then
      insert into public.stock_items (org_id, name) values (p_org, left(v.description, 200)) returning id into v_item;
    end if;
    if v_item is not null then
      insert into public.stock_aliases (org_id, key, item_id) values (p_org, v.key, v_item) on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.stock_autolink(uuid) from public, anon;
grant execute on function public.stock_autolink(uuid) to authenticated;

-- Acciones: vincular una descripción a un producto (o marcarla como "no es stock"), ajustar, mínimo, renombrar, unir
create or replace function public.stock_action(p_org uuid, p_action text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas','logistica']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_action = 'link' then
    v_id := nullif(p->>'item_id', '')::uuid;
    if v_id is not null and not exists (select 1 from public.stock_items where id = v_id and org_id = p_org) then raise exception 'Producto inexistente'; end if;
    insert into public.stock_aliases (org_id, key, item_id, confirmed) values (p_org, p->>'key', v_id, true)
    on conflict (org_id, key) do update set item_id = excluded.item_id, confirmed = true;
  elsif p_action = 'new_item' then
    insert into public.stock_items (org_id, name, unit) values (p_org, left(trim(p->>'name'), 200), nullif(p->>'unit', '')) returning id into v_id;
    if p ? 'key' then
      insert into public.stock_aliases (org_id, key, item_id, confirmed) values (p_org, p->>'key', v_id, true)
      on conflict (org_id, key) do update set item_id = excluded.item_id, confirmed = true;
    end if;
    return jsonb_build_object('id', v_id);
  elsif p_action = 'adjust' then
    insert into public.stock_adjustments (org_id, item_id, qty, note, created_by)
    select p_org, id, (p->>'qty')::numeric, left(p->>'note', 300), auth.uid() from public.stock_items where id = (p->>'item_id')::uuid and org_id = p_org;
  elsif p_action = 'update' then
    update public.stock_items set
      name = coalesce(nullif(left(trim(p->>'name'), 200), ''), name), unit = coalesce(p->>'unit', unit),
      min_qty = coalesce((p->>'min_qty')::numeric, min_qty), active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'item_id')::uuid and org_id = p_org;
  elsif p_action = 'merge' then
    -- une "from" dentro de "into": pasan alias y ajustes
    if (p->>'from')::uuid = (p->>'into')::uuid then raise exception 'Elegí otro producto'; end if;
    if not exists (select 1 from public.stock_items where id = (p->>'into')::uuid and org_id = p_org) then raise exception 'Producto inexistente'; end if;
    update public.stock_aliases set item_id = (p->>'into')::uuid, confirmed = true where org_id = p_org and item_id = (p->>'from')::uuid;
    update public.stock_adjustments set item_id = (p->>'into')::uuid where org_id = p_org and item_id = (p->>'from')::uuid;
    update public.stock_items set active = false where id = (p->>'from')::uuid and org_id = p_org;
  else
    raise exception 'Acción inválida' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.stock_action(uuid, text, jsonb) from public, anon;
grant execute on function public.stock_action(uuid, text, jsonb) to authenticated;

-- Movimientos con su producto
create view public.stock_movements with (security_invoker = true) as
select r.*, a.item_id, a.confirmed
from public.stock_raw r join public.stock_aliases a on a.org_id = r.org_id and a.key = r.key
where a.item_id is not null
union all
select j.org_id, 'ajuste', j.id, j.created_at::date, '', j.note, j.qty, null, '', null, j.item_id, true
from public.stock_adjustments j;
grant select on public.stock_movements to authenticated;

-- Stock actual por producto
create view public.stock_levels with (security_invoker = true) as
select it.id, it.org_id, it.name, it.unit, it.min_qty, it.active,
  coalesce(sum(m.qty) filter (where m.qty > 0 and m.source <> 'ajuste'), 0) as entradas,
  coalesce(-sum(m.qty) filter (where m.qty < 0 and m.source <> 'ajuste'), 0) as salidas,
  coalesce(sum(m.qty) filter (where m.source = 'ajuste'), 0) as ajustes,
  coalesce(sum(m.qty), 0) as stock,
  (select m2.unit_cost from public.stock_movements m2 where m2.item_id = it.id and m2.unit_cost is not null order by m2.mov_date desc limit 1) as last_cost,
  max(m.mov_date) as last_move,
  (select count(*) from public.stock_aliases a where a.item_id = it.id) as aliases
from public.stock_items it
left join public.stock_movements m on m.item_id = it.id
group by it.id;
grant select on public.stock_levels to authenticated;

-- Salidas (remitos) que no se pudieron unir solas con un producto
create view public.stock_unlinked with (security_invoker = true) as
select r.org_id, r.key, max(r.description) as description, sum(-r.qty) as qty, count(*) as moves, max(r.mov_date) as last_date,
  (select it.id from public.stock_items it where it.org_id = r.org_id and it.active order by extensions.similarity(public.norm(it.name), r.key) desc limit 1) as suggestion_id,
  (select it.name from public.stock_items it where it.org_id = r.org_id and it.active order by extensions.similarity(public.norm(it.name), r.key) desc limit 1) as suggestion
from public.stock_raw r
where r.source = 'remito' and not exists (select 1 from public.stock_aliases a where a.org_id = r.org_id and a.key = r.key)
group by r.org_id, r.key;
grant select on public.stock_unlinked to authenticated;
