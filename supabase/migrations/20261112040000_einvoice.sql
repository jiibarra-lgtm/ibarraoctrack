-- =====================================================================
-- Facturación electrónica con CAE (WSFEv1): facturas y notas de crédito A/B emitidas desde la app.
-- Cada comprobante autorizado queda guardado tal cual (inmutable), registrado en Facturación (si es de una OC)
-- y en Impuestos (comprobantes emitidos).
-- =====================================================================
alter table public.customers add column if not exists iva_condition smallint;

create table public.arca_emissions (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  kind               text not null check (kind in ('factura', 'nota_credito')),
  voucher_type       integer not null check (voucher_type in (1, 3, 6, 8)),
  point_of_sale      integer not null,
  number             bigint not null,
  issue_date         date not null,
  cae                text not null check (cae ~ '^\d{14}$'),
  cae_due            date,
  doc_type           integer not null default 80,
  doc_number         text not null,
  receiver_name      text not null,
  receiver_address   text,
  iva_condition      smallint not null,
  net                numeric(18,2) not null,
  vat                numeric(18,2) not null,
  total              numeric(18,2) not null check (total > 0),
  vat_detail         jsonb not null default '[]'::jsonb,
  lines              jsonb not null default '[]'::jsonb,
  prices_include_vat boolean not null default true,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  customer_id        uuid references public.customers(id) on delete set null,
  sales_invoice_id   uuid references public.sales_invoices(id) on delete set null,
  associated_id      uuid references public.arca_emissions(id) on delete set null,
  notes              text,
  observations       text,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (org_id, voucher_type, point_of_sale, number)
);
create index idx_arca_emissions_org on public.arca_emissions(org_id, issue_date desc);
create index idx_arca_emissions_po on public.arca_emissions(purchase_order_id);
alter table public.arca_emissions enable row level security;
create policy arca_emissions_select on public.arca_emissions for select to authenticated using (public.is_org_member(org_id));
grant select on public.arca_emissions to authenticated;

-- Un comprobante autorizado no se modifica ni se borra (se anula con nota de crédito)
create or replace function public.tg_arca_emission_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Un comprobante autorizado por ARCA no se puede borrar: emití una nota de crédito' using errcode = 'check_violation'; end if;
  if (new.voucher_type, new.point_of_sale, new.number, new.issue_date, new.cae, new.doc_number, new.total, new.net, new.vat, new.lines, new.receiver_name)
     is distinct from (old.voucher_type, old.point_of_sale, old.number, old.issue_date, old.cae, old.doc_number, old.total, old.net, old.vat, old.lines, old.receiver_name) then
    raise exception 'Un comprobante autorizado por ARCA no se puede modificar' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_arca_emission_immutable before update or delete on public.arca_emissions for each row execute function public.tg_arca_emission_immutable();

-- Datos para facturar una OC: cliente, renglones y cuánto falta facturar
create or replace function public.einvoice_order(p_org uuid, p_po uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v jsonb;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  select jsonb_build_object(
    'id', po.id, 'label', coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')), 'currency', po.currency, 'status', po.status,
    'customer', jsonb_build_object('id', c.id, 'name', coalesce(c.name, ''), 'cuit', c.cuit, 'address', c.address, 'iva_condition', c.iva_condition),
    'order_total', coalesce(po.total_amount, (select sum(total_amount) from public.purchase_order_items where purchase_order_id = po.id), 0),
    'invoiced', coalesce((select sum(total_amount) from public.sales_invoices where purchase_order_id = po.id and status = 'emitida'), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'line', i.line_number, 'description', i.description_original, 'quantity', i.quantity,
                       'unit', i.unit, 'unit_price', i.unit_price, 'total', i.total_amount) order by i.line_number, i.option_number)
                       from public.purchase_order_items i where i.purchase_order_id = po.id), '[]'::jsonb))
  into v
  from public.purchase_orders po left join public.customers c on c.id = po.customer_id
  where po.id = p_po and po.org_id = p_org;
  if v is null then raise exception 'Orden inexistente' using errcode = 'P0002'; end if;
  return v;
end;
$$;
revoke all on function public.einvoice_order(uuid, uuid) from public, anon;
grant execute on function public.einvoice_order(uuid, uuid) to authenticated;

-- Registra un comprobante que ARCA ya autorizó. Nunca falla por lo accesorio (facturación de la OC):
-- el comprobante existe en ARCA y tiene que quedar guardado sí o sí.
create or replace function public.einvoice_record(p_org uuid, p_e jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id    uuid;
  v_si    uuid;
  v_kind  text := p_e->>'kind';
  v_type  integer := (p_e->>'voucher_type')::int;
  v_po    uuid := nullif(p_e->>'purchase_order_id', '')::uuid;
  v_cust  uuid := nullif(p_e->>'customer_id', '')::uuid;
  v_asoc  public.arca_emissions;
  v_letter text := case when v_type in (1, 3) then 'A' else 'B' end;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if v_po is not null and not exists (select 1 from public.purchase_orders where id = v_po and org_id = p_org) then v_po := null; end if;
  if v_cust is not null and not exists (select 1 from public.customers where id = v_cust and org_id = p_org) then v_cust := null; end if;
  if v_kind = 'nota_credito' then
    select * into v_asoc from public.arca_emissions where id = nullif(p_e->>'associated_id', '')::uuid and org_id = p_org;
    v_po := coalesce(v_po, v_asoc.purchase_order_id);
    v_cust := coalesce(v_cust, v_asoc.customer_id);
  end if;

  insert into public.arca_emissions (org_id, kind, voucher_type, point_of_sale, number, issue_date, cae, cae_due, doc_type, doc_number,
    receiver_name, receiver_address, iva_condition, net, vat, total, vat_detail, lines, prices_include_vat, purchase_order_id, customer_id,
    associated_id, notes, observations, created_by)
  values (p_org, v_kind, v_type, (p_e->>'point_of_sale')::int, (p_e->>'number')::bigint, (p_e->>'issue_date')::date, p_e->>'cae',
    nullif(p_e->>'cae_due', '')::date, coalesce((p_e->>'doc_type')::int, 80), p_e->>'doc_number', left(p_e->>'receiver_name', 200),
    left(p_e->>'receiver_address', 300), (p_e->>'iva_condition')::smallint, (p_e->>'net')::numeric, (p_e->>'vat')::numeric, (p_e->>'total')::numeric,
    coalesce(p_e->'vat_detail', '[]'::jsonb), coalesce(p_e->'lines', '[]'::jsonb), coalesce((p_e->>'prices_include_vat')::boolean, true),
    v_po, v_cust, v_asoc.id, left(p_e->>'notes', 1000), left(p_e->>'observations', 1000), auth.uid())
  returning id into v_id;

  -- Facturación de la OC
  if v_kind = 'factura' and v_po is not null then
    begin
      insert into public.sales_invoices (org_id, purchase_order_id, invoice_type, point_of_sale, number, issue_date, net_amount, vat_amount, total_amount, cae, notes, created_by)
      values (p_org, v_po, v_letter, p_e->>'point_of_sale', p_e->>'number', (p_e->>'issue_date')::date, (p_e->>'net')::numeric, (p_e->>'vat')::numeric,
        (p_e->>'total')::numeric, p_e->>'cae', 'Factura electrónica emitida desde la app', auth.uid())
      returning id into v_si;
      update public.arca_emissions set sales_invoice_id = v_si where id = v_id;
    exception when others then
      update public.arca_emissions set observations = concat_ws(' · ', observations, 'No se pudo registrar en la OC: ' || sqlerrm) where id = v_id;
    end;
  elsif v_kind = 'nota_credito' and v_asoc.sales_invoice_id is not null and (p_e->>'total')::numeric >= v_asoc.total then
    begin
      update public.sales_invoices set status = 'anulada', void_reason = 'Anulada con ' || (case when v_type = 3 then 'NC A ' else 'NC B ' end)
        || lpad(p_e->>'point_of_sale', 5, '0') || '-' || lpad(p_e->>'number', 8, '0')
      where id = v_asoc.sales_invoice_id and status = 'emitida';
    exception when others then
      update public.arca_emissions set observations = concat_ws(' · ', observations, 'No se pudo anular la factura en la OC: ' || sqlerrm) where id = v_id;
    end;
  end if;

  -- Impuestos: comprobante emitido
  begin
    insert into public.arca_vouchers (org_id, direction, issue_date, voucher_type, point_of_sale, number, cae, doc_type, doc_number, name,
      net_taxed, vat, total, vat_detail, credit_note, source, sales_invoice_id)
    values (p_org, 'emitido', (p_e->>'issue_date')::date, v_type, (p_e->>'point_of_sale')::int, (p_e->>'number')::bigint, p_e->>'cae',
      coalesce(p_e->>'doc_type', '80'), p_e->>'doc_number', left(p_e->>'receiver_name', 200), (p_e->>'net')::numeric, (p_e->>'vat')::numeric,
      (p_e->>'total')::numeric, coalesce((select jsonb_object_agg(x->>'rate', x->'amount') from jsonb_array_elements(coalesce(p_e->'vat_detail', '[]'::jsonb)) x), '{}'::jsonb),
      v_kind = 'nota_credito', 'wsfe', v_si)
    on conflict do nothing;
  exception when others then null;
  end;

  -- Recordar los datos fiscales del cliente
  if v_cust is not null then
    update public.customers set
      cuit = coalesce(nullif(cuit, ''), p_e->>'doc_number'),
      address = coalesce(nullif(address, ''), nullif(p_e->>'receiver_address', '')),
      iva_condition = (p_e->>'iva_condition')::smallint
    where id = v_cust;
  end if;
  return v_id;
end;
$$;
revoke all on function public.einvoice_record(uuid, jsonb) from public, anon;
grant execute on function public.einvoice_record(uuid, jsonb) to authenticated;

create view public.arca_emissions_overview with (security_invoker = true) as
select e.*,
  coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')) as po_label,
  (select n.id from public.arca_emissions n where n.associated_id = e.id and n.kind = 'nota_credito' limit 1) as credit_note_id,
  a.voucher_type as associated_type, a.point_of_sale as associated_pv, a.number as associated_number
from public.arca_emissions e
left join public.purchase_orders po on po.id = e.purchase_order_id
left join public.arca_emissions a on a.id = e.associated_id;
grant select on public.arca_emissions_overview to authenticated;
