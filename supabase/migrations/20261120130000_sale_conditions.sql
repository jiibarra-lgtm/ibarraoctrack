-- Condiciones de venta (como en Tango): tabla propia con el tipo de ARCA y los plazos de pago.
-- WSFEv1 no tiene campo de condición de venta: va impresa en la factura y define el vencimiento de cobro.
-- Tipos de ARCA (Comprobantes en línea): contado, tarjeta de débito, tarjeta de crédito, cuenta corriente, cheque,
-- tiquet, otros medios de pago electrónicos, otra.

create table if not exists public.sale_conditions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code smallint not null,
  name text not null check (length(btrim(name)) between 2 and 60),
  arca_kind text not null check (arca_kind in ('contado', 'tarjeta_debito', 'tarjeta_credito', 'cuenta_corriente', 'cheque', 'tiquet', 'otros_electronicos', 'otra')),
  -- plazos en días desde la fecha de la factura; varios = cuotas iguales (ej. {30,60,90})
  days integer[] not null default '{}' check (array_length(days, 1) is null or array_length(days, 1) <= 12),
  is_default boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, code)
);
create unique index if not exists sale_conditions_one_default on public.sale_conditions (org_id) where is_default;
alter table public.sale_conditions enable row level security;
create policy sale_conditions_select on public.sale_conditions for select to authenticated using (public.is_org_member(org_id));
create policy sale_conditions_write on public.sale_conditions for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

-- Las de siempre para arrancar
insert into public.sale_conditions (org_id, code, name, arca_kind, days, is_default)
select o.id, x.code, x.name, x.kind, x.days, x.def
  from public.organizations o
 cross join (values
   (1::smallint, 'Contado', 'contado', '{}'::int[], false),
   (2::smallint, 'Cuenta corriente 30 días', 'cuenta_corriente', '{30}'::int[], true),
   (3::smallint, 'Cuenta corriente 60 días', 'cuenta_corriente', '{60}'::int[], false),
   (4::smallint, 'Cuenta corriente 90 días', 'cuenta_corriente', '{90}'::int[], false),
   (5::smallint, 'Transferencia bancaria', 'otros_electronicos', '{}'::int[], false),
   (6::smallint, 'Cheque a 30 días', 'cheque', '{30}'::int[], false),
   (7::smallint, 'Tarjeta de débito', 'tarjeta_debito', '{}'::int[], false),
   (8::smallint, 'Tarjeta de crédito', 'tarjeta_credito', '{}'::int[], false)
 ) as x(code, name, kind, days, def)
on conflict (org_id, code) do nothing;

alter table public.customers add column if not exists sale_condition_id uuid references public.sale_conditions(id) on delete set null;

-- Lo que se emitió: condición, vencimiento de pago y concepto (productos / servicios)
alter table public.arca_emissions add column if not exists sale_condition_id uuid references public.sale_conditions(id) on delete set null;
alter table public.arca_emissions add column if not exists sale_condition text;
alter table public.arca_emissions add column if not exists payment_kind text;
alter table public.arca_emissions add column if not exists payment_due date;
alter table public.arca_emissions add column if not exists concept smallint not null default 1 check (concept in (1, 2, 3));
alter table public.arca_emissions add column if not exists service_from date;
alter table public.arca_emissions add column if not exists service_to date;

-- einvoice_record: guarda esos datos, pone el vencimiento en la factura de la OC y recuerda la condición del cliente
do $$
declare d text := pg_get_functiondef('public.einvoice_record(uuid,jsonb)'::regprocedure);
begin
  if position('payment_due' in d) = 0 then
    d := replace(d, $a$  returning id into v_id;

  -- Facturación de la OC$a$, $a$  returning id into v_id;

  update public.arca_emissions set
    sale_condition_id = (select sc.id from public.sale_conditions sc where sc.id = nullif(p_e->>'sale_condition_id', '')::uuid and sc.org_id = p_org),
    sale_condition = left(nullif(p_e->>'sale_condition', ''), 80),
    payment_kind = nullif(p_e->>'payment_kind', ''),
    payment_due = nullif(p_e->>'payment_due', '')::date,
    concept = coalesce(nullif(p_e->>'concept', '')::smallint, 1),
    service_from = nullif(p_e->>'service_from', '')::date,
    service_to = nullif(p_e->>'service_to', '')::date
  where id = v_id;

  -- Facturación de la OC$a$);
    d := replace(d, $a$insert into public.sales_invoices (org_id, purchase_order_id, invoice_type, point_of_sale, number, issue_date, net_amount, vat_amount, total_amount, cae, notes, created_by)
      values (p_org, v_po, v_letter, p_e->>'point_of_sale', p_e->>'number', (p_e->>'issue_date')::date, (p_e->>'net')::numeric, (p_e->>'vat')::numeric,
        (p_e->>'total')::numeric, p_e->>'cae', 'Factura electrónica emitida desde la app', auth.uid())$a$,
      $a$insert into public.sales_invoices (org_id, purchase_order_id, invoice_type, point_of_sale, number, issue_date, due_date, net_amount, vat_amount, total_amount, cae, notes, created_by)
      values (p_org, v_po, v_letter, p_e->>'point_of_sale', p_e->>'number', (p_e->>'issue_date')::date, nullif(p_e->>'payment_due', '')::date, (p_e->>'net')::numeric, (p_e->>'vat')::numeric,
        (p_e->>'total')::numeric, p_e->>'cae', concat_ws(' · ', 'Factura electrónica emitida desde la app', nullif(p_e->>'sale_condition', '')), auth.uid())$a$);
    d := replace(d, $a$      iva_condition = (p_e->>'iva_condition')::smallint
    where id = v_cust;$a$, $a$      iva_condition = (p_e->>'iva_condition')::smallint,
      sale_condition_id = coalesce((select sc.id from public.sale_conditions sc where sc.id = nullif(p_e->>'sale_condition_id', '')::uuid and sc.org_id = p_org), sale_condition_id)
    where id = v_cust;$a$);
    if position('payment_due' in d) = 0 or position('due_date' in d) = 0 or position('sale_condition_id = coalesce' in d) = 0 then
      raise exception 'No se pudo actualizar einvoice_record';
    end if;
    execute d;
  end if;
end $$;

-- einvoice_order: trae la condición de venta habitual del cliente
do $$
declare d text := pg_get_functiondef('public.einvoice_order(uuid,uuid)'::regprocedure);
begin
  if position('sale_condition_id' in d) = 0 then
    d := replace(d, $a$'iva_condition', c.iva_condition)$a$, $a$'iva_condition', c.iva_condition, 'sale_condition_id', c.sale_condition_id)$a$);
    if position('sale_condition_id' in d) = 0 then raise exception 'No se pudo actualizar einvoice_order'; end if;
    execute d;
  end if;
end $$;

-- la vista toma las columnas nuevas
drop view if exists public.arca_emissions_overview;
create view public.arca_emissions_overview with (security_invoker = true) as
select e.*,
  coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')) as po_label,
  (select n.id from public.arca_emissions n where n.associated_id = e.id and n.kind = 'nota_credito' limit 1) as credit_note_id,
  a.voucher_type as associated_type, a.point_of_sale as associated_pv, a.number as associated_number
from public.arca_emissions e
left join public.purchase_orders po on po.id = e.purchase_order_id
left join public.arca_emissions a on a.id = e.associated_id;
grant select on public.arca_emissions_overview to authenticated;
