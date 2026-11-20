-- Facturación como en RCEL (paso a paso de Ibarra):
--  * "Transferencia Bancaria" es una condición de venta propia en Comprobantes en línea
--  * "Otra" como condición predeterminada (así se factura al GCBA)
--  * Datos fijos del receptor: siempre GCBA, IVA Sujeto Exento, Factura B, Productos
--  * Comprobantes asociados: Remito R oficial (punto de venta + número), cargado a mano

alter table public.sale_conditions drop constraint if exists sale_conditions_arca_kind_check;
alter table public.sale_conditions add constraint sale_conditions_arca_kind_check
  check (arca_kind in ('contado', 'tarjeta_debito', 'tarjeta_credito', 'cuenta_corriente', 'cheque', 'transferencia', 'tiquet', 'otros_electronicos', 'otra'));
update public.sale_conditions set arca_kind = 'transferencia' where code = 5 and name = 'Transferencia bancaria' and arca_kind = 'otros_electronicos';

insert into public.sale_conditions (org_id, code, name, arca_kind, days, is_default)
select o.id, 9, 'Otra', 'otra', '{}'::int[], false from public.organizations o
on conflict (org_id, code) do nothing;
update public.sale_conditions set is_default = false where is_default and code <> 9;
update public.sale_conditions set is_default = true where code = 9 and name = 'Otra';

create table if not exists public.einvoice_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  fixed_receiver boolean not null default true,
  receiver_cuit text not null check (receiver_cuit ~ '^\d{11}$'),
  receiver_name text not null check (length(btrim(receiver_name)) between 2 and 200),
  receiver_address text,
  iva_condition smallint not null default 4,
  sale_condition_id uuid references public.sale_conditions(id) on delete set null,
  concept smallint not null default 1 check (concept in (1, 2, 3)),
  require_remito boolean not null default true,
  remito_pv integer check (remito_pv between 1 and 99999),
  updated_at timestamptz not null default now()
);
alter table public.einvoice_settings enable row level security;
create policy einvoice_settings_select on public.einvoice_settings for select to authenticated using (public.is_org_member(org_id));
create policy einvoice_settings_write on public.einvoice_settings for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

insert into public.einvoice_settings (org_id, receiver_cuit, receiver_name, receiver_address, iva_condition, sale_condition_id, concept, remito_pv)
select o.id, '34999032089', 'GOBIERNO DE LA CIUDAD DE BUENOS AIRES', 'Belgrano 840, CABA', 4,
  (select sc.id from public.sale_conditions sc where sc.org_id = o.id and sc.code = 9), 1, 1
from public.organizations o
on conflict (org_id) do nothing;

-- Remitos R asociados: [{pv, number, date}]
alter table public.arca_emissions add column if not exists remitos jsonb not null default '[]'::jsonb;

do $$
declare d text := pg_get_functiondef('public.einvoice_record(uuid,jsonb)'::regprocedure);
begin
  if position('remitos' in d) = 0 then
    d := replace(d, $a$    service_to = nullif(p_e->>'service_to', '')::date
  where id = v_id;$a$, $a$    service_to = nullif(p_e->>'service_to', '')::date,
    remitos = coalesce(case when jsonb_typeof(p_e->'remitos') = 'array' then p_e->'remitos' end, '[]'::jsonb)
  where id = v_id;$a$);
    -- con receptor fijo (GCBA) no se pisan los datos del hospital de la OC
    d := replace(d, $a$  if v_cust is not null then
    update public.customers set$a$, $a$  if v_cust is not null and not coalesce((p_e->>'fixed_receiver')::boolean, false) then
    update public.customers set$a$);
    if position('remitos = coalesce' in d) = 0 or position('fixed_receiver' in d) = 0 then raise exception 'No se pudo actualizar einvoice_record'; end if;
    execute d;
  end if;
end $$;

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
