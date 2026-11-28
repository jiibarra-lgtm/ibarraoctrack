-- Checker de facturas de compras de Mercado Libre: cada compra queda vinculada a su factura de proveedor
-- (bajada de ML, llegada por mail, de Drive o cargada a mano), o marcada como "no lleva factura".
alter table public.ml_orders add column if not exists invoice_id uuid references public.supplier_invoices(id) on delete set null;
alter table public.ml_orders add column if not exists invoice_link text check (invoice_link in ('auto', 'manual'));
alter table public.ml_orders add column if not exists invoice_none boolean not null default false;
create unique index if not exists ml_orders_invoice_unique on public.ml_orders(invoice_id) where invoice_id is not null;

-- Vincula sola cada compra con su factura: mismo producto (por el detalle o el asunto) y mismo importe, dentro de 3 días antes / 30 después
create or replace function public.ml_link_invoices(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer := 0; r record;
begin
  create temp table if not exists _mlinv_used_o (id uuid primary key) on commit drop;
  create temp table if not exists _mlinv_used_s (id uuid primary key) on commit drop;
  truncate _mlinv_used_o; truncate _mlinv_used_s;
  for r in
    with o as (
      select id, title, total_amount t, (coalesce(ordered_at, created_at) at time zone 'America/Argentina/Buenos_Aires')::date d
        from public.ml_orders
       where org_id = p_org and kind = 'compra' and merged_into is null and invoice_id is null and not invoice_none and status <> 'cancelada'
    ), si as (
      select s.id, s.source, s.mail_subject, s.total, s.issue_date,
             (select string_agg(x.description, ' ') from public.supplier_invoice_items x where x.invoice_id = s.id) items
        from public.supplier_invoices s
       where s.org_id = p_org and not s.hidden and s.issue_date is not null
         and not exists (select 1 from public.ml_orders m where m.invoice_id = s.id)
    ), c as (
      select o.id oid, si.id sid,
             (si.source = 'mercadolibre' and public.norm(coalesce(si.mail_subject, '')) = public.norm(o.title)) exact,
             (o.t is not null and si.total between o.t * 0.98 and o.t * 1.25) amt,
             (o.t is not null and abs(si.total - o.t) <= greatest(1, o.t * 0.005)) same,
             greatest(extensions.similarity(public.norm(coalesce(si.items, '')), public.norm(o.title)),
                      extensions.similarity(public.norm(coalesce(si.mail_subject, '')), public.norm(o.title))) sim,
             abs(si.issue_date - o.d) gap
        from o join si on si.issue_date between o.d - 3 and o.d + 30
    )
    select oid, sid, (case when exact then 3 else 0 end) + (case when same then 2 when amt then 1 else 0 end) + sim - gap / 100.0 score
      from c
     where exact or (amt and sim > 0.3) or (same and sim > 0.15) or (sim > 0.55 and (amt or not exists (select 1 from public.ml_orders x where x.id = c.oid and x.total_amount is not null)))
     order by 3 desc
  loop
    continue when exists (select 1 from _mlinv_used_o where id = r.oid) or exists (select 1 from _mlinv_used_s where id = r.sid);
    insert into _mlinv_used_o values (r.oid); insert into _mlinv_used_s values (r.sid);
    update public.ml_orders set invoice_id = r.sid, invoice_link = 'auto' where id = r.oid and invoice_id is null;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.ml_link_invoices(uuid) from public, anon, authenticated;

-- desde la pantalla (usuario con permiso de escritura): vincula lo nuevo al abrir el checker
create or replace function public.ml_link_invoices_now(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin', 'finanzas', 'compras']::public.app_role[]) then return 0; end if;
  return public.ml_link_invoices(p_org);
end $$;
revoke all on function public.ml_link_invoices_now(uuid) from public, anon;
grant execute on function public.ml_link_invoices_now(uuid) to authenticated;

drop view public.ml_orders_overview;
create view public.ml_orders_overview with (security_invoker = true) as
select o.*,
  coalesce(po.bac_number, po.display_number) as po_number, po.customer_name as po_customer,
  i.line_number as po_line, i.description_original as po_item_description, i.quantity as po_item_quantity, i.unit_price as po_item_unit_price,
  case when o.unit_price is not null then o.unit_price
       when o.total_amount is not null and o.quantity > 0 then round(o.total_amount / o.quantity, 2) end as unit_value,
  si.letter as inv_letter, si.point_of_sale as inv_pos, si.number as inv_number, si.total as inv_total,
  si.supplier_name as inv_supplier, si.issue_date as inv_date, si.source as inv_source
from public.ml_orders o
left join public.purchase_orders_overview po on po.id = o.purchase_order_id
left join public.purchase_order_items i on i.id = o.po_item_id
left join public.supplier_invoices si on si.id = o.invoice_id
where o.merged_into is null;
grant select on public.ml_orders_overview to authenticated;

select public.ml_link_invoices(org_id) from public.ml_connection;
