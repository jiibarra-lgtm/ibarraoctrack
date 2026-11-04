-- =====================================================================
-- OC SISTEMA · Fase 4 — Facturación al organismo, cobranzas y finanzas
-- Sin borrados: facturas y cobros se anulan (status), nunca se eliminan.
-- =====================================================================

alter table public.financial_settings
  add column if not exists collection_days integer not null default 30 check (collection_days between 0 and 365);

-- ---------------------------------------------------------------------
-- Facturas emitidas al organismo
-- ---------------------------------------------------------------------
create table public.sales_invoices (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete restrict,
  customer_id        uuid references public.customers(id) on delete set null,
  invoice_type       text not null default 'B' check (invoice_type in ('A', 'B', 'C', 'M', 'E')),
  point_of_sale      text check (point_of_sale is null or point_of_sale ~ '^\d{1,5}$'),
  number             text check (number is null or number ~ '^\d{1,8}$'),
  issue_date         date not null,
  due_date           date,
  currency           char(3) not null default 'ARS' check (currency ~ '^[A-Z]{3}$'),
  net_amount         numeric(18,2) not null default 0 check (net_amount >= 0),
  vat_amount         numeric(18,2) not null default 0 check (vat_amount >= 0),
  other_taxes        numeric(18,2) not null default 0 check (other_taxes >= 0),
  total_amount       numeric(18,2) not null check (total_amount > 0),
  cae                text,
  status             text not null default 'emitida' check (status in ('emitida', 'anulada')),
  void_reason        text,
  document_id        uuid references public.documents(id) on delete set null,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (due_date is null or due_date >= issue_date),
  check (status <> 'anulada' or void_reason is not null)
);
create unique index uq_sales_invoices_number on public.sales_invoices(org_id, invoice_type, coalesce(point_of_sale, ''), number)
  where number is not null and status = 'emitida';
create index idx_sales_invoices_po on public.sales_invoices(purchase_order_id);
create index idx_sales_invoices_org_date on public.sales_invoices(org_id, issue_date desc);
create trigger trg_sales_invoices_updated before update on public.sales_invoices for each row execute function public.tg_set_updated_at();

-- Toma organismo y moneda de la orden; no permite facturar más que el total de la orden
create or replace function public.tg_sales_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_po       public.purchase_orders;
  v_cap      numeric;
  v_used     numeric;
  v_applied  numeric;
begin
  select * into v_po from public.purchase_orders where id = new.purchase_order_id for update;
  if v_po.id is null then raise exception 'Orden inexistente' using errcode = 'P0002'; end if;
  if v_po.org_id <> new.org_id then raise exception 'La orden pertenece a otra empresa'; end if;
  if v_po.status = 'anulada' and new.status = 'emitida' then raise exception 'No se puede facturar una orden anulada' using errcode = 'check_violation'; end if;
  new.customer_id := v_po.customer_id;
  new.currency := v_po.currency;
  if new.due_date is null then
    new.due_date := new.issue_date + coalesce((select collection_days from public.financial_settings where org_id = new.org_id), 30);
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'anulada' and new.status = 'emitida' then
      raise exception 'Una factura anulada no se puede reactivar' using errcode = 'check_violation';
    end if;
    select coalesce(sum(applied_amount), 0) into v_applied from public.collections where invoice_id = new.id and status = 'confirmado';
    if new.status = 'anulada' and v_applied > 0 then
      raise exception 'La factura tiene cobros registrados: anulá primero los cobros' using errcode = 'check_violation';
    end if;
    if new.total_amount < v_applied then
      raise exception 'El total no puede ser menor a lo ya cobrado (%)', v_applied using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'emitida' then
    v_cap := coalesce(v_po.total_amount, (select sum(total_amount) from public.purchase_order_items where purchase_order_id = v_po.id), 0);
    select coalesce(sum(total_amount), 0) into v_used from public.sales_invoices
     where purchase_order_id = v_po.id and status = 'emitida' and id <> new.id;
    if v_used + new.total_amount > v_cap then
      raise exception 'Facturado (% + %) supera el total de la orden (%)', v_used, new.total_amount, v_cap using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_sales_invoice before insert or update on public.sales_invoices
  for each row execute function public.tg_sales_invoice();

-- ---------------------------------------------------------------------
-- Cobros (con retenciones: lo cancelado = recibido + retenciones)
-- ---------------------------------------------------------------------
create table public.collections (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  invoice_id         uuid not null references public.sales_invoices(id) on delete restrict,
  purchase_order_id  uuid not null references public.purchase_orders(id) on delete restrict,
  payment_date       date not null,
  amount_received    numeric(18,2) not null default 0 check (amount_received >= 0),
  ret_iibb           numeric(18,2) not null default 0 check (ret_iibb >= 0),
  ret_ganancias      numeric(18,2) not null default 0 check (ret_ganancias >= 0),
  ret_iva            numeric(18,2) not null default 0 check (ret_iva >= 0),
  ret_suss           numeric(18,2) not null default 0 check (ret_suss >= 0),
  ret_otras          numeric(18,2) not null default 0 check (ret_otras >= 0),
  withholdings       numeric(18,2) generated always as (ret_iibb + ret_ganancias + ret_iva + ret_suss + ret_otras) stored,
  applied_amount     numeric(18,2) generated always as (amount_received + ret_iibb + ret_ganancias + ret_iva + ret_suss + ret_otras) stored,
  method             text not null default 'transferencia' check (method in ('transferencia', 'cheque', 'echeq', 'efectivo', 'otro')),
  reference          text,
  status             text not null default 'confirmado' check (status in ('confirmado', 'anulado')),
  void_reason        text,
  document_id        uuid references public.documents(id) on delete set null,
  notes              text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (amount_received + ret_iibb + ret_ganancias + ret_iva + ret_suss + ret_otras > 0),
  check (status <> 'anulado' or void_reason is not null)
);
create index idx_collections_invoice on public.collections(invoice_id);
create index idx_collections_po on public.collections(purchase_order_id);
create index idx_collections_org_date on public.collections(org_id, payment_date desc);
create trigger trg_collections_updated before update on public.collections for each row execute function public.tg_set_updated_at();

create or replace function public.tg_collection()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_inv   public.sales_invoices;
  v_used  numeric;
begin
  select * into v_inv from public.sales_invoices where id = new.invoice_id for update;
  if v_inv.id is null then raise exception 'Factura inexistente' using errcode = 'P0002'; end if;
  if v_inv.org_id <> new.org_id then raise exception 'La factura pertenece a otra empresa'; end if;
  new.purchase_order_id := v_inv.purchase_order_id;
  if tg_op = 'UPDATE' and old.status = 'anulado' and new.status = 'confirmado' then
    raise exception 'Un cobro anulado no se puede reactivar' using errcode = 'check_violation';
  end if;
  if new.status = 'confirmado' then
    if v_inv.status <> 'emitida' then raise exception 'La factura está anulada' using errcode = 'check_violation'; end if;
    if new.payment_date < v_inv.issue_date then
      raise exception 'La fecha de cobro es anterior a la factura' using errcode = 'check_violation';
    end if;
    select coalesce(sum(applied_amount), 0) into v_used from public.collections
     where invoice_id = v_inv.id and status = 'confirmado' and id <> new.id;
    if v_used + (new.amount_received + new.ret_iibb + new.ret_ganancias + new.ret_iva + new.ret_suss + new.ret_otras) > v_inv.total_amount then
      raise exception 'El cobro supera el saldo de la factura (saldo %)', v_inv.total_amount - v_used using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_collection before insert or update on public.collections
  for each row execute function public.tg_collection();

-- ---------------------------------------------------------------------
-- RLS + auditoría (sin política de borrado: se anula)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['sales_invoices', 'collections'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %1$s_select on public.%1$I for select to authenticated using (public.is_org_member(org_id))$p$, t);
    execute format($p$create policy %1$s_insert on public.%1$I for insert to authenticated
                     with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]) and created_by = auth.uid())$p$, t);
    execute format($p$create policy %1$s_update on public.%1$I for update to authenticated
                     using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
                     with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))$p$, t);
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I for each row execute function public.tg_audit()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Saldos por factura
-- ---------------------------------------------------------------------
create view public.invoice_balances with (security_invoker = true) as
select
  i.id as invoice_id, i.org_id, i.purchase_order_id, i.customer_id, i.invoice_type, i.point_of_sale, i.number,
  i.issue_date, i.due_date, i.currency, i.total_amount, i.status, i.document_id,
  coalesce(c.applied, 0) as collected_amount,
  coalesce(c.received, 0) as cash_received,
  coalesce(c.withheld, 0) as withholdings,
  case when i.status = 'anulada' then 0 else i.total_amount - coalesce(c.applied, 0) end as balance,
  c.last_payment,
  case
    when i.status = 'anulada' then 'anulada'
    when i.total_amount - coalesce(c.applied, 0) <= 0 then 'cobrada'
    when i.due_date is not null and i.due_date < (now() at time zone 'America/Argentina/Buenos_Aires')::date then 'vencida'
    when coalesce(c.applied, 0) > 0 then 'parcial'
    else 'pendiente'
  end as collection_status,
  case when i.status = 'emitida' and i.due_date is not null
       then (now() at time zone 'America/Argentina/Buenos_Aires')::date - i.due_date end as days_overdue,
  (now() at time zone 'America/Argentina/Buenos_Aires')::date - i.issue_date as days_since_issue
from public.sales_invoices i
left join lateral (
  select sum(applied_amount) applied, sum(amount_received) received, sum(withholdings) withheld, max(payment_date) last_payment
    from public.collections x where x.invoice_id = i.id and x.status = 'confirmado'
) c on true;

-- ---------------------------------------------------------------------
-- Facturación y cobranza por orden
-- ---------------------------------------------------------------------
create view public.po_billing with (security_invoker = true) as
select
  po.id as purchase_order_id, po.org_id, po.currency, po.customer_id, po.status,
  coalesce(po.total_amount, it.items_total, 0) as order_total,
  coalesce(b.invoiced, 0) as invoiced_amount,
  coalesce(b.collected, 0) as collected_amount,
  coalesce(b.received, 0) as cash_received,
  coalesce(b.withheld, 0) as withholdings,
  coalesce(po.total_amount, it.items_total, 0) - coalesce(b.invoiced, 0) as to_invoice,
  coalesce(b.invoiced, 0) - coalesce(b.collected, 0) as to_collect,
  case when coalesce(po.total_amount, it.items_total, 0) > 0
       then round(coalesce(b.invoiced, 0) / coalesce(po.total_amount, it.items_total) * 100, 2) else 0 end as invoiced_pct,
  case when coalesce(po.total_amount, it.items_total, 0) > 0
       then round(coalesce(b.collected, 0) / coalesce(po.total_amount, it.items_total) * 100, 2) else 0 end as collected_pct,
  coalesce(b.overdue, 0) as overdue_amount,
  b.invoices_count
from public.purchase_orders po
left join lateral (select sum(total_amount) items_total from public.purchase_order_items where purchase_order_id = po.id) it on true
left join lateral (
  select sum(ib.total_amount) invoiced, sum(ib.collected_amount) collected, sum(ib.cash_received) received,
         sum(ib.withholdings) withheld, sum(ib.balance) filter (where ib.collection_status = 'vencida') overdue,
         count(*) invoices_count
    from public.invoice_balances ib where ib.purchase_order_id = po.id and ib.status = 'emitida'
) b on true;

-- ---------------------------------------------------------------------
-- Flujo mensual (para finanzas y analítica)
-- ---------------------------------------------------------------------
create view public.monthly_flows with (security_invoker = true) as
with ev as (
  select org_id, currency, date_trunc('month', issue_date)::date as month, 'adjudicado' as kind, coalesce(total_amount, 0) as amount
    from public.purchase_orders where status <> 'anulada' and issue_date is not null
  union all
  select org_id, currency, date_trunc('month', issue_date)::date, 'facturado', total_amount
    from public.sales_invoices where status = 'emitida'
  union all
  select org_id, (select currency from public.sales_invoices s where s.id = c.invoice_id), date_trunc('month', payment_date)::date, 'cobrado', amount_received
    from public.collections c where status = 'confirmado'
  union all
  select org_id, (select currency from public.sales_invoices s where s.id = c.invoice_id), date_trunc('month', payment_date)::date, 'retenciones', withholdings
    from public.collections c where status = 'confirmado'
  union all
  select org_id, currency, date_trunc('month', invoice_date)::date, 'compras', total_amount
    from public.purchases where status = 'confirmada'
  union all
  select org_id, currency, date_trunc('month', coalesce(paid_date, invoice_date))::date, 'pagado', total_amount
    from public.purchases where status = 'confirmada' and paid
  union all
  select org_id, 'ARS', date_trunc('month', cost_date)::date, 'gastos', total_amount
    from public.costs where status = 'confirmado'
)
select org_id, currency, month,
  coalesce(sum(amount) filter (where kind = 'adjudicado'), 0) as awarded,
  coalesce(sum(amount) filter (where kind = 'facturado'), 0) as invoiced,
  coalesce(sum(amount) filter (where kind = 'cobrado'), 0) as collected,
  coalesce(sum(amount) filter (where kind = 'retenciones'), 0) as withheld,
  coalesce(sum(amount) filter (where kind = 'compras'), 0) as purchases,
  coalesce(sum(amount) filter (where kind = 'pagado'), 0) as paid,
  coalesce(sum(amount) filter (where kind = 'gastos'), 0) as expenses
from ev
group by org_id, currency, month;

grant select on public.invoice_balances, public.po_billing, public.monthly_flows to authenticated;
