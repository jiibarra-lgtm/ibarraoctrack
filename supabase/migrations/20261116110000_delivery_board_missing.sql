-- OC de la lista de entregas que todavía no están cargadas en el sistema (falta el documento de la OC)
create or replace view public.delivery_board_overview with (security_invoker = true) as
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
