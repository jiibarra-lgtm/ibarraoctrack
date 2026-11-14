-- Resumen del mes: facturado y cobrado también desde ARCA (Mis Comprobantes) y los depósitos conciliados del banco
create or replace function public.month_stages(p_org uuid, p_month date, p_currency text default 'ARS')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_div numeric;
  r jsonb;
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  select case when coalesce(fs.sales_include_vat, true) then 1 + coalesce(fs.default_vat_rate, 21) / 100 else 1 end
    into v_div from public.financial_settings fs where fs.org_id = p_org;
  v_div := coalesce(v_div, 1.21);

  with pos as (
    select po.id, coalesce(po.total_amount, po.net_amount, 0) as gross
      from public.purchase_orders po
     where po.org_id = p_org and po.currency = p_currency and po.status not in ('anulada', 'borrador')
       and po.issue_date >= v_from and po.issue_date < v_to
  ),
  items as (
    select x.purchase_order_item_id, x.sales_gross, x.estimated_cost, x.quantity
      from public.po_item_profitability x join pos on pos.id = x.purchase_order_id
  ),
  deliv as (
    select coalesce(sum(di.quantity * i.unit_price), 0) as gross, count(distinct d.id) as n
      from public.delivery_items di
      join public.deliveries d on d.id = di.delivery_id
      join public.purchase_order_items i on i.id = di.purchase_order_item_id
      join public.purchase_orders po on po.id = d.purchase_order_id and po.currency = p_currency
     where d.org_id = p_org and d.status in ('entregada', 'recibida_provisional', 'conformada')
       and coalesce(d.actual_date, d.planned_date) >= v_from and coalesce(d.actual_date, d.planned_date) < v_to
  ),
  -- Facturado: facturas cargadas en la app + comprobantes emitidos en ARCA que no están vinculados a una de ellas
  inv as (
    select coalesce(sum(gross), 0) as gross, coalesce(sum(net), 0) as net, count(*) filter (where gross > 0) as n from (
      select si.total_amount as gross, si.net_amount as net
        from public.sales_invoices si
       where si.org_id = p_org and si.currency = p_currency and si.status not in ('anulada', 'borrador')
         and si.issue_date >= v_from and si.issue_date < v_to
      union all
      select case when v.credit_note then -v.total else v.total end * v.exchange_rate,
             case when v.credit_note then -1 else 1 end * (v.net_taxed + v.net_untaxed + v.exempt) * v.exchange_rate
        from public.arca_vouchers v
       where v.org_id = p_org and v.direction = 'emitido' and v.sales_invoice_id is null
         and v.issue_date >= v_from and v.issue_date < v_to
    ) z
  ),
  -- Cobrado: cobros cargados en la app + depósitos del banco conciliados con facturas de ARCA (con sus retenciones)
  col as (
    select coalesce(sum(gross), 0) as gross, coalesce(sum(cash), 0) as cash, coalesce(sum(withheld), 0) as withheld, coalesce(sum(n), 0) as n from (
      select sum(c.applied_amount) as gross, sum(c.amount_received) as cash, sum(c.withholdings) as withheld, count(*) as n
        from public.collections c
       where c.org_id = p_org and c.status <> 'anulado' and c.payment_date >= v_from and c.payment_date < v_to
      union all
      select sum(b.amount) + sum(r.ret), sum(b.amount), sum(r.ret), count(*)
        from public.bank_movements b
        join lateral (
          select coalesce(sum(coalesce(m.ret_iibb, 0) + coalesce(m.ret_ganancias, 0)), 0) as ret
            from public.bank_matches m join public.arca_vouchers v on v.id = m.arca_voucher_id
           where m.bank_movement_id = b.id and v.sales_invoice_id is null
        ) r on true
       where b.org_id = p_org and b.mov_date >= v_from and b.mov_date < v_to
         and exists (select 1 from public.bank_matches m join public.arca_vouchers v on v.id = m.arca_voucher_id
                      where m.bank_movement_id = b.id and v.sales_invoice_id is null)
    ) z
  )
  select jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'), 'vat_divisor', v_div,
    'awarded', jsonb_build_object('gross', (select coalesce(sum(gross), 0) from pos), 'net', round((select coalesce(sum(gross), 0) from pos) / v_div, 2), 'count', (select count(*) from pos)),
    'delivered', jsonb_build_object('gross', (select gross from deliv), 'net', round((select gross from deliv) / v_div, 2), 'count', (select n from deliv)),
    'invoiced', jsonb_build_object('gross', (select gross from inv), 'net', (select case when net > 0 then net else round(gross / v_div, 2) end from inv), 'count', (select n from inv)),
    'collected', jsonb_build_object('gross', (select gross from col), 'net', round((select gross from col) / v_div, 2), 'cash', (select cash from col), 'withheld', (select withheld from col), 'count', (select n from col)),
    'profit', jsonb_build_object(
      'sales_net', round((select coalesce(sum(sales_gross), 0) from items) / v_div, 2),
      'sales_net_with_cost', round((select coalesce(sum(sales_gross), 0) from items where estimated_cost is not null) / v_div, 2),
      'cost', (select coalesce(sum(estimated_cost), 0) from items where estimated_cost is not null),
      'items', (select count(*) from items),
      'items_without_cost', (select count(*) from items where estimated_cost is null))
  ) into r;
  return r;
end;
$$;
revoke all on function public.month_stages(uuid, date, text) from public, anon;
grant execute on function public.month_stages(uuid, date, text) to authenticated;
