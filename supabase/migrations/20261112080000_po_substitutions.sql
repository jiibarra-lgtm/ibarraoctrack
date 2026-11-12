-- =====================================================================
-- "Por otra cosa": un renglón de la OC se entrega con otros productos (ej. compran 10 shampoos y se entrega
-- 10 shampoos + 1 silla). Se carga lo entregado con su costo real, que pasa a ser el costo del renglón
-- y se compara contra la venta del renglón.
-- =====================================================================
create table public.po_item_substitutions (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id      uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  line                   integer not null default 1,
  description            text not null check (length(trim(description)) > 0),
  quantity               numeric(18,4) not null check (quantity > 0),
  unit_cost              numeric(18,4) not null check (unit_cost >= 0), -- sin IVA
  notes                  text,
  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now()
);
create index idx_po_subst_item on public.po_item_substitutions(purchase_order_item_id);
create index idx_po_subst_po on public.po_item_substitutions(purchase_order_id);
alter table public.po_item_substitutions enable row level security;
create policy po_subst_read on public.po_item_substitutions for select to authenticated using (public.is_org_member(org_id));
grant select on public.po_item_substitutions to authenticated;

-- Reemplaza lo entregado de un renglón (lista vacía = vuelve a ser "el mismo producto")
create or replace function public.save_po_substitution(p_item uuid, p_lines jsonb, p_notes text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_i public.purchase_order_items;
  v_l jsonb;
  v_n integer := 0;
begin
  select * into v_i from public.purchase_order_items where id = p_item;
  if v_i.id is null then raise exception 'Renglón inexistente' using errcode = 'P0002'; end if;
  if not public.has_org_role(v_i.org_id, array['admin','compras','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 50 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  delete from public.po_item_substitutions where purchase_order_item_id = p_item;
  for v_l in select x from jsonb_array_elements(p_lines) x loop
    continue when coalesce(trim(v_l->>'description'), '') = '';
    v_n := v_n + 1;
    insert into public.po_item_substitutions (org_id, purchase_order_id, purchase_order_item_id, line, description, quantity, unit_cost, notes, created_by)
    values (v_i.org_id, v_i.purchase_order_id, p_item, v_n, left(trim(v_l->>'description'), 300), (v_l->>'quantity')::numeric, (v_l->>'unit_cost')::numeric,
      nullif(left(p_notes, 500), ''), auth.uid());
  end loop;
  return v_n;
end;
$$;
revoke all on function public.save_po_substitution(uuid, jsonb, text) from public, anon;
grant execute on function public.save_po_substitution(uuid, jsonb, text) to authenticated;

-- Rentabilidad por renglón: si se entregó "por otra cosa", el costo del renglón es el de lo entregado.
create or replace view public.po_item_profitability with (security_invoker = true) as
select
  i.id as purchase_order_item_id, i.purchase_order_id, i.org_id, i.line_number, i.option_number,
  i.description_original, i.quantity, i.unit_price, i.total_amount as sales_gross, i.estimated_unit_cost,
  case when s.cnt > 0 then i.quantity else coalesce(a.qty, 0) end as purchased_qty,
  (case when s.cnt > 0 then s.cost else coalesce(a.cost, 0) end)::numeric(18,2) as purchased_cost,
  case
    when s.cnt > 0 then s.cost
    when coalesce(a.qty, 0) >= i.quantity then coalesce(a.cost, 0)
    when i.estimated_unit_cost is not null then coalesce(a.cost, 0) + (i.quantity - coalesce(a.qty, 0)) * i.estimated_unit_cost
    when coalesce(a.qty, 0) > 0 then a.cost / a.qty * i.quantity
    else null
  end::numeric(18,2) as estimated_cost,
  (s.cnt > 0 or coalesce(a.qty, 0) >= i.quantity) as fully_purchased,
  coalesce(dl.delivered_qty, 0) as delivered_qty,
  case when s.cnt > 0 and i.quantity > 0 then s.cost / i.quantity when coalesce(a.qty, 0) > 0 then a.cost / a.qty else i.estimated_unit_cost end as unit_cost_attributable,
  s.cnt > 0 as substituted,
  s.cost::numeric(18,2) as substitution_cost
from public.purchase_order_items i
left join lateral (
  select sum(pa.quantity) as qty, sum(pa.amount) as cost
    from public.purchase_allocations pa
    join public.purchase_items pi on pi.id = pa.purchase_item_id
    join public.purchases p on p.id = pi.purchase_id and p.status = 'confirmada'
   where pa.purchase_order_item_id = i.id
) a on true
left join lateral (
  select sum(di.quantity) as delivered_qty
    from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
   where di.purchase_order_item_id = i.id and d.status in ('entregada', 'recibida_provisional', 'conformada')
) dl on true
left join lateral (
  select count(*) as cnt, sum(x.quantity * x.unit_cost) as cost
    from public.po_item_substitutions x where x.purchase_order_item_id = i.id
) s on true;
