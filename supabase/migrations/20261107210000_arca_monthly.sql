-- =====================================================================
-- Impuestos: resumen mensual en la base (la pantalla ya no trae todos los comprobantes)
-- y se ocultan los recibidos que por un error quedaron también cargados como emitidos.
-- =====================================================================
create or replace view public.arca_vouchers_overview with (security_invoker = true) as
select v.*,
  public.arca_letter(v.voucher_type) as letter,
  case when v.credit_note then -1 else 1 end as sign,
  si.purchase_order_id, coalesce(po.bac_number, po.display_number) as po_number,
  s.name as supplier_name
from public.arca_vouchers v
left join public.sales_invoices si on si.id = v.sales_invoice_id
left join public.purchase_orders_overview po on po.id = si.purchase_order_id
left join public.suppliers s on s.id = v.supplier_id
where not (v.direction = 'emitido' and exists (
  select 1 from public.arca_vouchers r where r.org_id = v.org_id and r.direction = 'recibido'
    and r.voucher_type = v.voucher_type and r.point_of_sale = v.point_of_sale and r.number = v.number and r.doc_number = v.doc_number));

create view public.arca_monthly with (security_invoker = true) as
select org_id, to_char(issue_date, 'YYYY-MM') as month, direction, count(*) as vouchers,
  sum(sign * total * exchange_rate)::numeric(18,2) as total,
  sum(sign * vat * exchange_rate)::numeric(18,2) as vat,
  sum(sign * (net_taxed + net_untaxed + exempt) * exchange_rate)::numeric(18,2) as net,
  sum(sign * other_taxes * exchange_rate)::numeric(18,2) as other_taxes
from public.arca_vouchers_overview
group by org_id, to_char(issue_date, 'YYYY-MM'), direction;
grant select on public.arca_monthly to authenticated;
