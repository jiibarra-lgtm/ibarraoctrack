-- =====================================================================
-- OC SISTEMA · Fase 2 — RPC atómicas, catálogo automático y motor de rentabilidad
-- =====================================================================

alter table public.documents
  add column purchase_id uuid references public.purchases(id) on delete set null,
  add column cost_id uuid references public.costs(id) on delete set null;
create index idx_documents_purchase on public.documents(purchase_id);


-- ---------------------------------------------------------------------
-- Catálogo automático: el renglón de la OC define el producto; la descripción del
-- proveedor queda como equivalencia confirmada para futuras sugerencias.
-- ---------------------------------------------------------------------
create or replace function public.link_product_alias(p_poi uuid, p_alias text, p_supplier uuid)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_poi public.purchase_order_items;
  v_prod uuid;
begin
  select * into v_poi from public.purchase_order_items where id = p_poi;
  v_prod := v_poi.product_id;
  if v_prod is null then
    select p.id into v_prod from public.products p
     where p.org_id = v_poi.org_id
       and ((v_poi.bac_code is not null and p.bac_code = v_poi.bac_code)
            or public.norm(p.description) = public.norm(left(v_poi.description_original, 250)))
     limit 1;
    if v_prod is null then
      insert into public.products (org_id, bac_code, description, unit, created_by)
      values (v_poi.org_id, v_poi.bac_code, left(v_poi.description_original, 250), v_poi.unit, (select auth.uid()))
      returning id into v_prod;
    end if;
    update public.purchase_order_items set product_id = v_prod where id = p_poi;
  end if;
  if coalesce(trim(p_alias), '') <> '' then
    insert into public.product_aliases (org_id, product_id, alias, source, supplier_id, confirmed_by)
    values (v_poi.org_id, v_prod, left(trim(p_alias), 500), 'proveedor', p_supplier, (select auth.uid()))
    on conflict do nothing;
  end if;
  return v_prod;
end;
$$;

-- ---------------------------------------------------------------------
-- Guardar compra + renglones + asignaciones (una transacción)
-- ---------------------------------------------------------------------
create or replace function public.save_purchase(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p      jsonb := public.jsonb_strip_empty(p_payload);
  v_id     uuid := (v_p->>'id')::uuid;
  v_sup    uuid := (v_p->>'supplier_id')::uuid;
  v_items  jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_item   jsonb;
  v_alloc  jsonb;
  v_pi     uuid;
  v_line   integer := 0;
  v_q      numeric; v_price numeric; v_disc numeric; v_net numeric;
  v_prod   uuid;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas']::public.app_role[]) then
    raise exception 'Sin permisos para registrar compras' using errcode = '42501';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'La compra debe tener al menos un renglón' using errcode = '22023';
  end if;

  -- Proveedor: por id, por CUIT o por nombre (alta automática)
  if v_sup is null then
    if v_p->>'supplier_cuit' is not null then
      select id into v_sup from public.suppliers where org_id = p_org and replace(cuit, '-', '') = replace(v_p->>'supplier_cuit', '-', '');
    end if;
    if v_sup is null and v_p->>'supplier_name' is not null then
      select id into v_sup from public.suppliers where org_id = p_org and public.norm(name) = public.norm(v_p->>'supplier_name');
    end if;
    if v_sup is null then
      if v_p->>'supplier_name' is null then
        raise exception 'Indicá el proveedor' using errcode = '22023';
      end if;
      insert into public.suppliers (org_id, name, cuit, created_by)
      values (p_org, v_p->>'supplier_name', v_p->>'supplier_cuit', (select auth.uid()))
      returning id into v_sup;
    end if;
  end if;

  if v_id is null then
    insert into public.purchases (org_id, supplier_id, doc_type, point_of_sale, number, invoice_date, due_date, currency,
      net_amount, vat_amount, other_taxes, total_amount, payment_terms, paid, paid_date, cae, document_id, notes, created_by)
    values (p_org, v_sup, coalesce(v_p->>'doc_type', 'factura_a'), v_p->>'point_of_sale', v_p->>'number',
      (v_p->>'invoice_date')::date, (v_p->>'due_date')::date, coalesce(v_p->>'currency', 'ARS'),
      coalesce((v_p->>'net_amount')::numeric, 0), coalesce((v_p->>'vat_amount')::numeric, 0),
      coalesce((v_p->>'other_taxes')::numeric, 0), (v_p->>'total_amount')::numeric, v_p->>'payment_terms',
      coalesce((v_p->>'paid')::boolean, false), (v_p->>'paid_date')::date, v_p->>'cae', (v_p->>'document_id')::uuid,
      v_p->>'notes', (select auth.uid()))
    returning id into v_id;
  else
    update public.purchases set
      supplier_id = v_sup, doc_type = coalesce(v_p->>'doc_type', doc_type), point_of_sale = v_p->>'point_of_sale',
      number = v_p->>'number', invoice_date = (v_p->>'invoice_date')::date, due_date = (v_p->>'due_date')::date,
      currency = coalesce(v_p->>'currency', currency), net_amount = coalesce((v_p->>'net_amount')::numeric, 0),
      vat_amount = coalesce((v_p->>'vat_amount')::numeric, 0), other_taxes = coalesce((v_p->>'other_taxes')::numeric, 0),
      total_amount = (v_p->>'total_amount')::numeric, payment_terms = v_p->>'payment_terms',
      paid = coalesce((v_p->>'paid')::boolean, false), paid_date = (v_p->>'paid_date')::date, cae = v_p->>'cae', notes = v_p->>'notes'
    where id = v_id and org_id = p_org;
    if not found then raise exception 'Compra inexistente' using errcode = 'P0002'; end if;
    delete from public.purchase_items where purchase_id = v_id;  -- asignaciones en cascada; se recrean abajo
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_line  := v_line + 1;
    v_q     := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_disc  := coalesce(nullif(v_item->>'discount_pct', '')::numeric, 0);
    v_net   := coalesce(nullif(v_item->>'net_amount', '')::numeric, round(v_q * v_price * (1 - v_disc / 100), 2));
    insert into public.purchase_items (org_id, purchase_id, line_number, product_id, description, quantity, unit, unit_price,
      discount_pct, vat_rate, net_amount)
    values (p_org, v_id, v_line, nullif(v_item->>'product_id', '')::uuid, trim(v_item->>'description'), v_q,
      nullif(trim(v_item->>'unit'), ''), v_price, v_disc, coalesce(nullif(v_item->>'vat_rate', '')::numeric, 21), v_net)
    returning id into v_pi;

    for v_alloc in select * from jsonb_array_elements(coalesce(v_item->'allocations', '[]'::jsonb)) loop
      insert into public.purchase_allocations (org_id, purchase_item_id, purchase_order_item_id, purchase_order_id, quantity, unit_cost, created_by)
      select p_org, v_pi, poi.id, poi.purchase_order_id, (v_alloc->>'quantity')::numeric, null, (select auth.uid())
        from public.purchase_order_items poi
       where poi.id = (v_alloc->>'purchase_order_item_id')::uuid and poi.org_id = p_org;
      if not found then raise exception 'Renglón de orden inexistente' using errcode = '22023'; end if;
      v_prod := public.link_product_alias((v_alloc->>'purchase_order_item_id')::uuid, v_item->>'description', v_sup);
      update public.purchase_items set product_id = coalesce(product_id, v_prod) where id = v_pi;
    end loop;
  end loop;

  if (v_p->>'document_id') is not null then
    update public.documents set purchase_id = v_id, doc_type = 'factura_proveedor' where id = (v_p->>'document_id')::uuid and org_id = p_org;
  end if;
  if (v_p->>'import_job_id') is not null then
    update public.import_jobs set status = 'confirmado', confirmed_by = (select auth.uid()), finished_at = now()
     where id = (v_p->>'import_job_id')::uuid and org_id = p_org;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Guardar gasto y distribuirlo (manual / por importe / por unidades)
-- targets: [{purchase_order_id, purchase_order_item_id?, amount?}]
-- ---------------------------------------------------------------------
create or replace function public.save_cost(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p        jsonb := public.jsonb_strip_empty(p_payload);
  v_id       uuid := (v_p->>'id')::uuid;
  v_method   text := coalesce(v_p->>'allocation_method', 'importe');
  v_targets  jsonb := coalesce(p_payload->'targets', '[]'::jsonb);
  v_net      numeric := coalesce((v_p->>'net_amount')::numeric, 0);
  v_vat      numeric := coalesce((v_p->>'vat_amount')::numeric, 0);
  v_allocable numeric;
  v_weights  numeric[] := '{}';
  v_w        numeric;
  v_total_w  numeric := 0;
  v_t        jsonb;
  v_i        integer := 0;
  v_n        integer;
  v_amount   numeric;
  v_assigned numeric := 0;
  v_recov    boolean;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas']::public.app_role[]) then
    raise exception 'Sin permisos para registrar gastos' using errcode = '42501';
  end if;
  if v_method not in ('manual', 'importe', 'unidades') then
    raise exception 'Método de distribución inválido' using errcode = '22023';
  end if;
  select coalesce(vat_recoverable, true) into v_recov from public.financial_settings where org_id = p_org;
  v_allocable := case when coalesce(v_recov, true) then v_net else v_net + v_vat end;

  if v_id is null then
    insert into public.costs (org_id, category_id, description, cost_date, supplier_id, net_amount, vat_amount, total_amount,
      allocation_method, document_id, notes, created_by)
    values (p_org, (v_p->>'category_id')::uuid, v_p->>'description', (v_p->>'cost_date')::date, (v_p->>'supplier_id')::uuid,
      v_net, v_vat, v_net + v_vat, v_method, (v_p->>'document_id')::uuid, v_p->>'notes', (select auth.uid()))
    returning id into v_id;
  else
    update public.costs set category_id = (v_p->>'category_id')::uuid, description = v_p->>'description',
      cost_date = (v_p->>'cost_date')::date, supplier_id = (v_p->>'supplier_id')::uuid, net_amount = v_net,
      vat_amount = v_vat, total_amount = v_net + v_vat, allocation_method = v_method, notes = v_p->>'notes'
     where id = v_id and org_id = p_org;
    if not found then raise exception 'Gasto inexistente' using errcode = 'P0002'; end if;
    delete from public.cost_allocations where cost_id = v_id;
  end if;

  v_n := jsonb_array_length(v_targets);
  if v_n = 0 then return v_id; end if;   -- gasto general sin asignar

  -- Pesos según criterio explícito
  for v_t in select * from jsonb_array_elements(v_targets) loop
    if v_method = 'importe' then
      if nullif(v_t->>'purchase_order_item_id', '') is not null then
        select total_amount into v_w from public.purchase_order_items where id = (v_t->>'purchase_order_item_id')::uuid and org_id = p_org;
      else
        select coalesce(po.net_amount, (select sum(total_amount) from public.purchase_order_items where purchase_order_id = po.id))
          into v_w from public.purchase_orders po where po.id = (v_t->>'purchase_order_id')::uuid and po.org_id = p_org;
      end if;
    elsif v_method = 'unidades' then
      if nullif(v_t->>'purchase_order_item_id', '') is not null then
        select quantity into v_w from public.purchase_order_items where id = (v_t->>'purchase_order_item_id')::uuid and org_id = p_org;
      else
        select sum(quantity) into v_w from public.purchase_order_items where purchase_order_id = (v_t->>'purchase_order_id')::uuid and org_id = p_org;
      end if;
    else
      v_w := (v_t->>'amount')::numeric;
    end if;
    if v_w is null then raise exception 'Orden inexistente en la distribución' using errcode = '22023'; end if;
    v_weights := v_weights || v_w;
    v_total_w := v_total_w + v_w;
  end loop;

  for v_t in select * from jsonb_array_elements(v_targets) loop
    v_i := v_i + 1;
    if v_method = 'manual' then
      v_amount := round(v_weights[v_i], 2);
    elsif v_i = v_n then
      v_amount := v_allocable - v_assigned;       -- el último absorbe el redondeo: suma exacta
    else
      v_amount := case when v_total_w = 0 then 0 else round(v_allocable * v_weights[v_i] / v_total_w, 2) end;
    end if;
    v_assigned := v_assigned + v_amount;
    insert into public.cost_allocations (org_id, cost_id, purchase_order_id, purchase_order_item_id, amount)
    values (p_org, v_id, (v_t->>'purchase_order_id')::uuid, nullif(v_t->>'purchase_order_item_id', '')::uuid, v_amount);
  end loop;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Sugerencias de vínculo: descripción del proveedor → renglones abiertos
-- ---------------------------------------------------------------------
create or replace function public.suggest_po_items(p_org uuid, p_text text, p_limit integer default 6)
returns table (purchase_order_item_id uuid, purchase_order_id uuid, order_label text, customer_name text,
               line_number integer, description text, quantity numeric, purchased numeric, remaining numeric,
               unit_price numeric, score real, by_alias boolean)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select public.norm(p_text) as t),
  cand as (
    select i.*, po.bac_number, po.internal_number, c.name as cname,
           extensions.word_similarity(left(q.t, 120), public.norm(i.description_original)) as s_desc,
           coalesce((select max(extensions.similarity(public.norm(a.alias), q.t)) from public.product_aliases a
                      where a.product_id = i.product_id), 0) as s_alias
      from public.purchase_order_items i
      join public.purchase_orders po on po.id = i.purchase_order_id
      left join public.customers c on c.id = po.customer_id, q
     where i.org_id = p_org and po.status not in ('anulada', 'cerrada', 'borrador')
  )
  select c.id, c.purchase_order_id, coalesce(c.bac_number, 'OC-' || lpad(c.internal_number::text, 6, '0')), c.cname,
         c.line_number, left(c.description_original, 160), c.quantity,
         coalesce(pa.qty, 0), c.quantity - coalesce(pa.qty, 0), c.unit_price,
         greatest(c.s_desc, c.s_alias)::real, c.s_alias >= c.s_desc
    from cand c
    left join lateral (
      select sum(x.quantity) qty from public.purchase_allocations x
        join public.purchase_items pi on pi.id = x.purchase_item_id
        join public.purchases p on p.id = pi.purchase_id and p.status = 'confirmada'
       where x.purchase_order_item_id = c.id
    ) pa on true
   where greatest(c.s_desc, c.s_alias) > 0.25 and c.quantity - coalesce(pa.qty, 0) > 0
   order by greatest(c.s_desc, c.s_alias) desc
   limit least(greatest(p_limit, 1), 20)
$$;

-- ---------------------------------------------------------------------
-- Motor de rentabilidad (vistas con RLS del invocador)
-- ---------------------------------------------------------------------
create view public.po_item_profitability with (security_invoker = true) as
select
  i.id as purchase_order_item_id, i.purchase_order_id, i.org_id, i.line_number, i.option_number,
  i.description_original, i.quantity, i.unit_price, i.total_amount as sales_gross, i.estimated_unit_cost,
  coalesce(a.qty, 0) as purchased_qty,
  coalesce(a.cost, 0)::numeric(18,2) as purchased_cost,
  case
    when coalesce(a.qty, 0) >= i.quantity then coalesce(a.cost, 0)
    when i.estimated_unit_cost is not null then coalesce(a.cost, 0) + (i.quantity - coalesce(a.qty, 0)) * i.estimated_unit_cost
    when coalesce(a.qty, 0) > 0 then a.cost / a.qty * i.quantity          -- proyección al costo promedio comprado
    else null
  end::numeric(18,2) as estimated_cost,
  coalesce(a.qty, 0) >= i.quantity as fully_purchased
from public.purchase_order_items i
left join lateral (
  select sum(pa.quantity) as qty, sum(pa.amount) as cost
    from public.purchase_allocations pa
    join public.purchase_items pi on pi.id = pa.purchase_item_id
    join public.purchases p on p.id = pi.purchase_id and p.status = 'confirmada'
   where pa.purchase_order_item_id = i.id
) a on true;

create view public.po_profitability with (security_invoker = true) as
with base as (
  select
    po.id as purchase_order_id, po.org_id, po.currency, po.status, po.issue_date, po.customer_id,
    coalesce(po.net_amount, it.sales_items, 0) as sales_gross,
    coalesce(fs.sales_include_vat, true) as sales_include_vat,
    coalesce(fs.default_vat_rate, 21) as vat_rate,
    coalesce(fs.min_margin_pct, 15) as min_margin_pct,
    coalesce(it.purchased_cost, 0) as direct_cost_real,
    it.est_cost as direct_cost_estimated,
    coalesce(it.est_complete, false) as cost_estimate_complete,
    coalesce(it.fully_purchased, false) as fully_purchased,
    case when coalesce(it.qty, 0) > 0 then round(it.pqty / it.qty * 100, 2) else 0 end as purchased_pct,
    coalesce(oc.total, 0) as other_costs,
    coalesce(oc.logistic, 0) as logistic_costs,
    coalesce(oc.financial, 0) as financial_costs,
    coalesce(oc.operating, 0) as operating_costs
  from public.purchase_orders po
  left join public.financial_settings fs on fs.org_id = po.org_id
  left join lateral (
    select sum(x.sales_gross) sales_items, sum(x.purchased_cost) purchased_cost,
           case when bool_and(x.estimated_cost is not null) then sum(x.estimated_cost) end est_cost,
           bool_and(x.estimated_cost is not null) est_complete, bool_and(x.fully_purchased) fully_purchased,
           sum(x.quantity) qty, sum(x.purchased_qty) pqty
      from public.po_item_profitability x where x.purchase_order_id = po.id
  ) it on true
  left join lateral (
    select sum(ca.amount) total,
           sum(ca.amount) filter (where cc.kind = 'logistico') logistic,
           sum(ca.amount) filter (where cc.kind = 'financiero') financial,
           sum(ca.amount) filter (where cc.kind not in ('logistico', 'financiero')) operating
      from public.cost_allocations ca
      join public.costs c on c.id = ca.cost_id and c.status = 'confirmado'
      join public.cost_categories cc on cc.id = c.category_id
     where ca.purchase_order_id = po.id
  ) oc on true
),
calc as (
  select b.*,
    round(b.sales_gross / case when b.sales_include_vat then 1 + b.vat_rate / 100 else 1 end, 2) as sales_net
  from base b
)
select c.*,
  (c.sales_net - c.direct_cost_estimated) as gross_profit_estimated,
  (c.sales_net - c.direct_cost_estimated - c.other_costs) as operating_profit_estimated,
  round((c.sales_net - c.direct_cost_estimated) / nullif(c.sales_net, 0) * 100, 2) as gross_margin_estimated,
  round((c.sales_net - c.direct_cost_estimated - c.other_costs) / nullif(c.sales_net, 0) * 100, 2) as operating_margin_estimated,
  round((c.sales_net - c.direct_cost_estimated) / nullif(c.direct_cost_estimated, 0) * 100, 2) as markup_estimated
from calc c;

-- ---------------------------------------------------------------------
-- Anular compra / gasto (no se borra historial financiero)
-- ---------------------------------------------------------------------
create or replace function public.void_purchase(p_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.purchases set status = 'anulada', notes = concat_ws(E'\n', notes, 'Anulada: ' || coalesce(p_reason, '')) where id = p_id;
  if not found then raise exception 'Compra inexistente' using errcode = 'P0002'; end if;
end;
$$;
create or replace function public.void_cost(p_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  update public.costs set status = 'anulado', notes = concat_ws(E'\n', notes, 'Anulado: ' || coalesce(p_reason, '')) where id = p_id;
  if not found then raise exception 'Gasto inexistente' using errcode = 'P0002'; end if;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array['link_product_alias(uuid, text, uuid)', 'save_purchase(uuid, jsonb)', 'save_cost(uuid, jsonb)',
                           'suggest_po_items(uuid, text, integer)', 'void_purchase(uuid, text)', 'void_cost(uuid, text)',
                           'cost_allocable(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
revoke execute on function public.tg_purchase_allocation() from public, anon, authenticated;
revoke execute on function public.tg_cost_allocation_check() from public, anon, authenticated;
