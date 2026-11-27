-- Hoja de ruta: cada tarjeta guarda también los productos separados por renglón
-- items = [{ "qty": 139, "pack": "x5 L", "product": "Toalla de papel blanca", "unit": "cajas", "note": "al 06/11" }, ...]
alter table public.delivery_board add column if not exists items jsonb not null default '[]'::jsonb;
alter table public.delivery_board drop constraint if exists delivery_board_items_array;
alter table public.delivery_board add constraint delivery_board_items_array check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) <= 60);

drop view if exists public.delivery_board_overview;
create view public.delivery_board_overview with (security_invoker = true) as
select b.*,
  coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.bac_number, 'customer', po.customer_name,
              'delivered_pct', ds.delivered_pct, 'status', po.status, 'due_date', ds.due_date) order by po.bac_number)
            from public.purchase_orders_overview po
            left join public.po_delivery_summary ds on ds.purchase_order_id = po.id
           where po.org_id = b.org_id and upper(po.bac_number) = any(b.oc_refs)), '[]'::jsonb) as orders,
  coalesce((select jsonb_agg(jsonb_build_object('number', r,
              'in_bac', exists (select 1 from public.bac_orders_inbox x where x.org_id = b.org_id and x.bac_number = r)) order by r)
            from unnest(b.oc_refs) r
           where not exists (select 1 from public.purchase_orders p where p.org_id = b.org_id and upper(p.bac_number) = r)), '[]'::jsonb) as missing
from public.delivery_board b;
grant select on public.delivery_board_overview to authenticated;
