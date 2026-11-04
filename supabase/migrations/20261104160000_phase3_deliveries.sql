-- =====================================================================
-- OC SISTEMA · Fase 3 — Entregas parciales, remitos y rentabilidad sobre lo entregado
-- · Nunca se entrega (ni se programa) más de lo adjudicado por renglón.
-- · Entrega física ≠ conformidad administrativa: estados separados.
-- =====================================================================

create type public.delivery_status as enum (
  'programada', 'en_preparacion', 'despachada', 'entregada',
  'recibida_provisional', 'conformada', 'rechazada', 'cancelada'
);

create table public.deliveries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete restrict,
  internal_number    bigint generated always as identity,
  planned_date       date,
  actual_date        date,
  delivery_place     text,
  dependencia        text,
  responsible        text,
  transport          text,
  remito_number      text,
  status             public.delivery_status not null default 'programada',
  notes              text,
  version            integer not null default 1,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_deliveries_po on public.deliveries(purchase_order_id);
create index idx_deliveries_org_planned on public.deliveries(org_id, planned_date);
create index idx_deliveries_org_status on public.deliveries(org_id, status);
create unique index uq_deliveries_remito on public.deliveries(org_id, purchase_order_id, remito_number) where remito_number is not null and status <> 'cancelada';

create table public.delivery_items (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  delivery_id             uuid not null references public.deliveries(id) on delete cascade,
  purchase_order_item_id  uuid not null references public.purchase_order_items(id) on delete restrict,
  quantity                numeric(18,4) not null check (quantity > 0),
  created_at              timestamptz not null default now(),
  unique (delivery_id, purchase_order_item_id)
);
create index idx_delivery_items_poi on public.delivery_items(purchase_order_item_id);

create table public.delivery_incidents (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  delivery_id  uuid not null references public.deliveries(id) on delete cascade,
  kind         text not null default 'otro' check (kind in ('faltante', 'rotura', 'rechazo', 'demora', 'diferencia', 'otro')),
  description  text not null,
  resolved_at  timestamptz,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index idx_delivery_incidents_delivery on public.delivery_incidents(delivery_id);

create table public.delivery_status_history (
  id           bigint generated always as identity primary key,
  org_id       uuid not null references public.organizations(id) on delete cascade,
  delivery_id  uuid not null references public.deliveries(id) on delete cascade,
  from_status  public.delivery_status,
  to_status    public.delivery_status not null,
  reason       text,
  changed_by   uuid references auth.users(id) on delete set null,
  changed_at   timestamptz not null default now()
);
create index idx_delivery_status_hist on public.delivery_status_history(delivery_id, changed_at desc);

alter table public.documents add column delivery_id uuid references public.deliveries(id) on delete set null;
create index idx_documents_delivery on public.documents(delivery_id);

-- ---------------------------------------------------------------------
-- Control de cantidades: lo activo (no rechazado/cancelado) nunca supera lo adjudicado
-- ---------------------------------------------------------------------
create or replace function public.check_delivery_capacity(p_poi uuid, p_exclude uuid, p_extra numeric)
returns void
language plpgsql
set search_path = ''
as $$
declare v_qty numeric; v_used numeric; v_line integer;
begin
  select quantity, line_number into v_qty, v_line from public.purchase_order_items where id = p_poi for update;
  select coalesce(sum(di.quantity), 0) into v_used
    from public.delivery_items di join public.deliveries d on d.id = di.delivery_id
   where di.purchase_order_item_id = p_poi and di.id is distinct from p_exclude
     and d.status not in ('rechazada', 'cancelada');
  if v_used + p_extra > v_qty then
    raise exception 'El renglón % tiene % unidades adjudicadas; con esta entrega serían % (excede)', v_line, v_qty, v_used + p_extra
      using errcode = '23514';
  end if;
end;
$$;

create or replace function public.tg_delivery_item()
returns trigger
language plpgsql
set search_path = ''
as $$
declare v_d public.deliveries; v_po uuid;
begin
  select * into v_d from public.deliveries where id = new.delivery_id;
  select purchase_order_id into v_po from public.purchase_order_items where id = new.purchase_order_item_id;
  if v_po is distinct from v_d.purchase_order_id then
    raise exception 'El renglón no pertenece a la orden de la entrega' using errcode = '22023';
  end if;
  new.org_id := v_d.org_id;
  if v_d.status not in ('rechazada', 'cancelada') then
    perform public.check_delivery_capacity(new.purchase_order_item_id, new.id, new.quantity);
  end if;
  return new;
end;
$$;
create trigger trg_delivery_item before insert or update on public.delivery_items
  for each row execute function public.tg_delivery_item();

create or replace function public.tg_delivery_before()
returns trigger
language plpgsql
set search_path = ''
as $$
declare r record;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    new.version := 1;
    return new;
  end if;
  if new.purchase_order_id <> old.purchase_order_id then
    raise exception 'No se puede mover una entrega a otra orden';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  -- Reactivar una entrega rechazada/cancelada vuelve a consumir cantidades
  if old.status in ('rechazada', 'cancelada') and new.status not in ('rechazada', 'cancelada') then
    for r in select purchase_order_item_id, id, quantity from public.delivery_items where delivery_id = new.id loop
      perform public.check_delivery_capacity(r.purchase_order_item_id, r.id, r.quantity);
    end loop;
  end if;
  return new;
end;
$$;
create trigger trg_delivery_before before insert or update on public.deliveries
  for each row execute function public.tg_delivery_before();

create or replace function public.tg_delivery_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.delivery_status_history (org_id, delivery_id, from_status, to_status, reason, changed_by)
    values (new.org_id, new.id, case when tg_op = 'UPDATE' then old.status end, new.status,
            nullif(current_setting('app.status_reason', true), ''), (select auth.uid()));
  end if;
  return null;
end;
$$;
revoke execute on function public.tg_delivery_after() from public, anon, authenticated;
create trigger trg_delivery_after after insert or update on public.deliveries
  for each row execute function public.tg_delivery_after();

-- ---------------------------------------------------------------------
-- Guardar entrega + renglones (una transacción, con control de concurrencia)
-- ---------------------------------------------------------------------
create or replace function public.save_delivery(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p     jsonb := public.jsonb_strip_empty(p_payload);
  v_id    uuid := (v_p->>'id')::uuid;
  v_items jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_it    jsonb;
  v_ver   integer;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas','logistica']::public.app_role[]) then
    raise exception 'Sin permisos para registrar entregas' using errcode = '42501';
  end if;
  if jsonb_array_length(v_items) = 0 then
    raise exception 'La entrega debe incluir al menos un renglón con cantidad' using errcode = '22023';
  end if;
  if v_p->>'status_reason' is not null then
    perform set_config('app.status_reason', v_p->>'status_reason', true);
  end if;

  if v_id is null then
    insert into public.deliveries (org_id, purchase_order_id, planned_date, actual_date, delivery_place, dependencia,
      responsible, transport, remito_number, status, notes)
    select p_org, po.id, (v_p->>'planned_date')::date, (v_p->>'actual_date')::date,
      coalesce(v_p->>'delivery_place', po.delivery_place), coalesce(v_p->>'dependencia', po.dependencia),
      v_p->>'responsible', v_p->>'transport', v_p->>'remito_number',
      coalesce(v_p->>'status', 'programada')::public.delivery_status, v_p->>'notes'
      from public.purchase_orders po where po.id = (v_p->>'purchase_order_id')::uuid and po.org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'Orden inexistente' using errcode = 'P0002'; end if;
  else
    select version into v_ver from public.deliveries where id = v_id and org_id = p_org for update;
    if v_ver is null then raise exception 'Entrega inexistente' using errcode = 'P0002'; end if;
    if (v_p->>'version') is not null and (v_p->>'version')::integer <> v_ver then
      raise exception 'La entrega fue modificada por otro usuario. Recargá.' using errcode = '40001';
    end if;
    update public.deliveries set planned_date = (v_p->>'planned_date')::date, actual_date = (v_p->>'actual_date')::date,
      delivery_place = v_p->>'delivery_place', dependencia = v_p->>'dependencia', responsible = v_p->>'responsible',
      transport = v_p->>'transport', remito_number = v_p->>'remito_number',
      status = coalesce(v_p->>'status', status::text)::public.delivery_status, notes = v_p->>'notes'
     where id = v_id;
    delete from public.delivery_items where delivery_id = v_id;
  end if;

  for v_it in select * from jsonb_array_elements(v_items) loop
    if coalesce((v_it->>'quantity')::numeric, 0) > 0 then
      insert into public.delivery_items (org_id, delivery_id, purchase_order_item_id, quantity)
      values (p_org, v_id, (v_it->>'purchase_order_item_id')::uuid, (v_it->>'quantity')::numeric);
    end if;
  end loop;
  return v_id;
end;
$$;

create or replace function public.set_delivery_status(p_id uuid, p_status public.delivery_status, p_reason text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_status in ('rechazada', 'cancelada') and coalesce(trim(p_reason), '') = '' then
    raise exception 'Indicá el motivo' using errcode = '22023';
  end if;
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.deliveries set status = p_status,
    actual_date = case when p_status in ('entregada', 'recibida_provisional', 'conformada') then coalesce(actual_date, (now() at time zone 'America/Argentina/Buenos_Aires')::date) else actual_date end
   where id = p_id;
  if not found then raise exception 'Entrega inexistente' using errcode = 'P0002'; end if;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS + auditoría
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['deliveries','delivery_items','delivery_incidents'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (public.is_org_member(org_id))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))
                     with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))$p$, t);
    execute format($p$create policy %1$s_delete on public.%1$I for delete to authenticated
                     using (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))$p$, t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
end
$$;
alter table public.delivery_status_history enable row level security;
create policy dsh_select on public.delivery_status_history for select to authenticated using (public.is_org_member(org_id));

-- ---------------------------------------------------------------------
-- Avance de entregas por renglón y por orden
-- ---------------------------------------------------------------------
create view public.po_item_delivery with (security_invoker = true) as
select i.id as purchase_order_item_id, i.purchase_order_id, i.org_id, i.quantity,
  coalesce(sum(di.quantity) filter (where d.status in ('entregada', 'recibida_provisional', 'conformada')), 0) as delivered_qty,
  coalesce(sum(di.quantity) filter (where d.status = 'conformada'), 0) as conformed_qty,
  coalesce(sum(di.quantity) filter (where d.status in ('programada', 'en_preparacion', 'despachada')), 0) as scheduled_qty
from public.purchase_order_items i
left join public.delivery_items di on di.purchase_order_item_id = i.id
left join public.deliveries d on d.id = di.delivery_id
group by i.id;

create view public.po_delivery_summary with (security_invoker = true) as
select po.id as purchase_order_id, po.org_id, po.due_date,
  coalesce(sum(x.quantity), 0) as quantity,
  coalesce(sum(x.delivered_qty), 0) as delivered_qty,
  coalesce(sum(x.conformed_qty), 0) as conformed_qty,
  coalesce(sum(x.scheduled_qty), 0) as scheduled_qty,
  case when coalesce(sum(x.quantity), 0) > 0 then round(sum(x.delivered_qty) / sum(x.quantity) * 100, 2) else 0 end as delivered_pct,
  (select min(d.planned_date) from public.deliveries d where d.purchase_order_id = po.id and d.status in ('programada', 'en_preparacion', 'despachada')) as next_planned_date,
  (select max(d.actual_date) from public.deliveries d where d.purchase_order_id = po.id and d.status in ('entregada', 'recibida_provisional', 'conformada')) as last_delivery_date,
  (po.due_date is not null and po.due_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date
     and coalesce(sum(x.delivered_qty), 0) < coalesce(sum(x.quantity), 0) and po.status not in ('anulada', 'cerrada')) as is_late
from public.purchase_orders po
left join public.po_item_delivery x on x.purchase_order_id = po.id
group by po.id;

-- ---------------------------------------------------------------------
-- Rentabilidad: se agregan columnas de lo entregado (al final, sin romper la vista)
-- Costo unitario atribuible = costo comprado promedio del renglón; si no hay compra, el estimado.
-- Gastos: los del renglón en proporción a lo entregado de ese renglón; los de la orden en proporción
-- a la venta entregada (criterio explícito y auditable).
-- ---------------------------------------------------------------------
create or replace view public.po_item_profitability with (security_invoker = true) as
select
  i.id as purchase_order_item_id, i.purchase_order_id, i.org_id, i.line_number, i.option_number,
  i.description_original, i.quantity, i.unit_price, i.total_amount as sales_gross, i.estimated_unit_cost,
  coalesce(a.qty, 0) as purchased_qty,
  coalesce(a.cost, 0)::numeric(18,2) as purchased_cost,
  case
    when coalesce(a.qty, 0) >= i.quantity then coalesce(a.cost, 0)
    when i.estimated_unit_cost is not null then coalesce(a.cost, 0) + (i.quantity - coalesce(a.qty, 0)) * i.estimated_unit_cost
    when coalesce(a.qty, 0) > 0 then a.cost / a.qty * i.quantity
    else null
  end::numeric(18,2) as estimated_cost,
  coalesce(a.qty, 0) >= i.quantity as fully_purchased,
  coalesce(dl.delivered_qty, 0) as delivered_qty,
  case when coalesce(a.qty, 0) > 0 then a.cost / a.qty else i.estimated_unit_cost end as unit_cost_attributable
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
) dl on true;

create or replace view public.po_profitability with (security_invoker = true) as
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
    coalesce(oc.operating, 0) as operating_costs,
    case when coalesce(it.qty, 0) > 0 then round(it.dqty / it.qty * 100, 2) else 0 end as delivered_pct,
    coalesce(it.sales_delivered, 0) as sales_delivered_gross,
    it.cost_delivered,
    coalesce(oc.item_level_delivered, 0)
      + case when coalesce(it.sales_items, 0) > 0 then coalesce(oc.order_level, 0) * coalesce(it.sales_delivered, 0) / it.sales_items else 0 end
      as other_costs_delivered
  from public.purchase_orders po
  left join public.financial_settings fs on fs.org_id = po.org_id
  left join lateral (
    select sum(x.sales_gross) sales_items, sum(x.purchased_cost) purchased_cost,
           case when bool_and(x.estimated_cost is not null) then sum(x.estimated_cost) end est_cost,
           bool_and(x.estimated_cost is not null) est_complete, bool_and(x.fully_purchased) fully_purchased,
           sum(x.quantity) qty, sum(x.purchased_qty) pqty, sum(x.delivered_qty) dqty,
           sum(x.delivered_qty * x.unit_price) sales_delivered,
           case when bool_and(x.delivered_qty = 0 or x.unit_cost_attributable is not null)
                then sum(x.delivered_qty * coalesce(x.unit_cost_attributable, 0)) end cost_delivered
      from public.po_item_profitability x where x.purchase_order_id = po.id
  ) it on true
  left join lateral (
    select sum(ca.amount) total,
           sum(ca.amount) filter (where cc.kind = 'logistico') logistic,
           sum(ca.amount) filter (where cc.kind = 'financiero') financial,
           sum(ca.amount) filter (where cc.kind not in ('logistico', 'financiero')) operating,
           sum(ca.amount) filter (where ca.purchase_order_item_id is null) order_level,
           sum(ca.amount * coalesce(ip.delivered_qty / nullif(ip.quantity, 0), 0)) filter (where ca.purchase_order_item_id is not null) item_level_delivered
      from public.cost_allocations ca
      join public.costs c on c.id = ca.cost_id and c.status = 'confirmado'
      join public.cost_categories cc on cc.id = c.category_id
      left join public.po_item_profitability ip on ip.purchase_order_item_id = ca.purchase_order_item_id
     where ca.purchase_order_id = po.id
  ) oc on true
),
calc as (
  select b.*,
    round(b.sales_gross / case when b.sales_include_vat then 1 + b.vat_rate / 100 else 1 end, 2) as sales_net,
    round(b.sales_delivered_gross / case when b.sales_include_vat then 1 + b.vat_rate / 100 else 1 end, 2) as sales_delivered_net
  from base b
)
select
  c.purchase_order_id, c.org_id, c.currency, c.status, c.issue_date, c.customer_id, c.sales_gross, c.sales_include_vat,
  c.vat_rate, c.min_margin_pct, c.direct_cost_real, c.direct_cost_estimated, c.cost_estimate_complete, c.fully_purchased,
  c.purchased_pct, c.other_costs, c.logistic_costs, c.financial_costs, c.operating_costs, c.sales_net,
  (c.sales_net - c.direct_cost_estimated) as gross_profit_estimated,
  (c.sales_net - c.direct_cost_estimated - c.other_costs) as operating_profit_estimated,
  round((c.sales_net - c.direct_cost_estimated) / nullif(c.sales_net, 0) * 100, 2) as gross_margin_estimated,
  round((c.sales_net - c.direct_cost_estimated - c.other_costs) / nullif(c.sales_net, 0) * 100, 2) as operating_margin_estimated,
  round((c.sales_net - c.direct_cost_estimated) / nullif(c.direct_cost_estimated, 0) * 100, 2) as markup_estimated,
  -- Lo entregado
  c.delivered_pct,
  c.sales_delivered_net,
  round(c.cost_delivered, 2) as cost_delivered,
  round(c.other_costs_delivered, 2) as other_costs_delivered,
  round(c.sales_delivered_net - c.cost_delivered, 2) as gross_profit_realized,
  round(c.sales_delivered_net - c.cost_delivered - c.other_costs_delivered, 2) as operating_profit_realized,
  round((c.sales_delivered_net - c.cost_delivered - c.other_costs_delivered) / nullif(c.sales_delivered_net, 0) * 100, 2) as operating_margin_realized
from calc c;

do $$
declare f text;
begin
  foreach f in array array['save_delivery(uuid, jsonb)', 'set_delivery_status(uuid, public.delivery_status, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end
$$;
revoke execute on function public.tg_delivery_item() from public, anon, authenticated;
revoke execute on function public.tg_delivery_before() from public, anon, authenticated;
