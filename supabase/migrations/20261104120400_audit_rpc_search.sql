-- =====================================================================
-- OC SISTEMA · Fase 1 · 005 — Auditoría, notificaciones, RPC, búsqueda
-- =====================================================================

-- ---------------------------------------------------------------------
-- Auditoría inmutable
-- Sólo la escribe el trigger (security definer). Sin políticas de
-- insert/update/delete y sin privilegios de escritura para clientes.
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  org_id      uuid,
  table_name  text not null,
  record_id   text,
  action      text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data    jsonb,
  new_data    jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);
create index idx_audit_org_at on public.audit_logs(org_id, at desc);
create index idx_audit_record on public.audit_logs(table_name, record_id);

alter table public.audit_logs enable row level security;
create policy audit_select on public.audit_logs for select to authenticated
  using (org_id is not null and public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
revoke insert, update, delete, truncate on public.audit_logs from anon, authenticated;

create or replace function public.tg_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  v_row jsonb := coalesce(v_new, v_old);
begin
  if tg_op = 'UPDATE' and v_old - 'updated_at' - 'version' = v_new - 'updated_at' - 'version' then
    return null; -- sin cambios reales
  end if;
  insert into public.audit_logs (org_id, table_name, record_id, action, old_data, new_data, actor)
  values (
    nullif(coalesce(v_row->>'org_id', case when tg_table_name = 'organizations' then v_row->>'id' end), '')::uuid,
    tg_table_name,
    v_row->>'id',
    tg_op,
    v_old,
    v_new,
    (select auth.uid())
  );
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['organizations','organization_members','customers','suppliers','products',
                           'product_aliases','procurement_processes','purchase_orders','purchase_order_items',
                           'documents','import_jobs']
  loop
    execute format('create trigger trg_audit_%1$s after insert or update or delete on public.%1$I
                    for each row execute function public.tg_audit()', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Notificaciones (centro de alertas completo en Fase 5)
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,  -- null = toda la organización
  kind        text not null,
  title       text not null,
  body        text,
  href        text,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create unique index uq_notifications_dedupe on public.notifications(org_id, dedupe_key) where dedupe_key is not null;
create index idx_notifications_user on public.notifications(org_id, user_id, read_at, created_at desc);

alter table public.notifications enable row level security;
create policy notif_select on public.notifications for select to authenticated
  using (public.is_org_member(org_id) and (user_id is null or user_id = (select auth.uid())));
create policy notif_update on public.notifications for update to authenticated
  using (public.is_org_member(org_id) and (user_id is null or user_id = (select auth.uid())))
  with check (public.is_org_member(org_id) and (user_id is null or user_id = (select auth.uid())));

-- ---------------------------------------------------------------------
-- Guardar orden + renglones de forma atómica (alta manual, edición, importación)
-- Corre con permisos del usuario: RLS aplica a todo.
-- Campos vacíos ("") se tratan como NULL.
-- ---------------------------------------------------------------------
create or replace function public.jsonb_strip_empty(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k, case when jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '' then 'null'::jsonb
                                         when jsonb_typeof(v) = 'string' then to_jsonb(trim(v #>> '{}'))
                                         else v end), '{}'::jsonb)
  from jsonb_each(p) e(k, v)
$$;

create or replace function public.save_purchase_order(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_p           jsonb := public.jsonb_strip_empty(p_payload);
  r             public.purchase_orders;
  v_id          uuid;
  v_version     integer := (v_p->>'version')::integer;
  v_cust_name   text := v_p->>'customer_name';
  v_items       jsonb := coalesce(p_payload->'items', '[]'::jsonb);
  v_item        jsonb;
  ri            public.purchase_order_items;
  v_keep        uuid[];
  v_current_ver integer;
  v_net         numeric(18,2);
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas']::public.app_role[]) then
    raise exception 'Sin permisos para guardar órdenes' using errcode = '42501';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'La orden debe tener al menos un renglón' using errcode = '22023';
  end if;

  r := jsonb_populate_record(null::public.purchase_orders, v_p - 'items' - 'authorizers');
  r.authorizers := coalesce(p_payload->'authorizers', '[]'::jsonb);
  v_id := r.id;

  -- Organismo: existente o alta automática por nombre
  if r.customer_id is null and v_cust_name is not null then
    select c.id into r.customer_id from public.customers c
     where c.org_id = p_org and public.norm(c.name) = public.norm(v_cust_name);
    if r.customer_id is null then
      insert into public.customers (org_id, name, address, created_by)
      values (p_org, v_cust_name, r.buyer_address, (select auth.uid()))
      returning id into r.customer_id;
    end if;
  end if;

  -- Proceso de compra
  if r.process_number is not null then
    select p.id into r.procurement_process_id from public.procurement_processes p
     where p.org_id = p_org and upper(p.process_number) = upper(r.process_number);
    if r.procurement_process_id is null then
      insert into public.procurement_processes (org_id, customer_id, process_number, expediente_number,
                                                contratacion_number, process_type, title)
      values (p_org, r.customer_id, r.process_number, r.expediente_number,
              r.contratacion_number, r.process_type, r.modality)
      returning id into r.procurement_process_id;
    end if;
  end if;

  select sum(round((x->>'total_amount')::numeric, 2)) into v_net from jsonb_array_elements(v_items) x;
  r.net_amount   := coalesce(r.net_amount, v_net);
  r.currency     := coalesce(r.currency, 'ARS');
  r.status       := coalesce(r.status, 'recibida');
  r.source       := coalesce(r.source, 'manual');

  if v_id is null then
    insert into public.purchase_orders (
      org_id, bac_number, expediente_number, process_number, contratacion_number, procurement_process_id,
      bac_type, fiscal_year, bac_status, contract_duration, process_type, modality, process_class,
      legal_framework, award_act_number, customer_id, jurisdiction, dependencia, buyer_phone, buyer_address,
      buyer_notes, awardee_name, awardee_cuit, awardee_entity_number, authorizers, issue_date, received_date,
      perfected_date, delivery_term_text, delivery_term_days, due_date, delivery_place, payment_terms,
      contract_terms, currency, discount_amount, net_amount, vat_amount, total_amount, notes, status, source
    ) values (
      p_org, r.bac_number, r.expediente_number, r.process_number, r.contratacion_number, r.procurement_process_id,
      r.bac_type, r.fiscal_year, r.bac_status, r.contract_duration, r.process_type, r.modality, r.process_class,
      r.legal_framework, r.award_act_number, r.customer_id, r.jurisdiction, r.dependencia, r.buyer_phone, r.buyer_address,
      r.buyer_notes, r.awardee_name, r.awardee_cuit, r.awardee_entity_number, r.authorizers, r.issue_date, r.received_date,
      r.perfected_date, r.delivery_term_text, r.delivery_term_days, r.due_date, r.delivery_place, r.payment_terms,
      r.contract_terms, r.currency, r.discount_amount, r.net_amount, r.vat_amount, r.total_amount, r.notes, r.status, r.source
    ) returning id into v_id;
  else
    select po.version into v_current_ver from public.purchase_orders po
     where po.id = v_id and po.org_id = p_org for update;
    if v_current_ver is null then
      raise exception 'Orden inexistente' using errcode = 'P0002';
    end if;
    if v_version is not null and v_version <> v_current_ver then
      raise exception 'La orden fue modificada por otro usuario. Recargá antes de guardar.' using errcode = '40001';
    end if;
    if v_p->>'status_reason' is not null then
      perform set_config('app.status_reason', v_p->>'status_reason', true);
    end if;

    update public.purchase_orders set
      bac_number = r.bac_number, expediente_number = r.expediente_number, process_number = r.process_number,
      contratacion_number = r.contratacion_number, procurement_process_id = r.procurement_process_id,
      bac_type = r.bac_type, fiscal_year = r.fiscal_year, bac_status = r.bac_status,
      contract_duration = r.contract_duration, process_type = r.process_type, modality = r.modality,
      process_class = r.process_class, legal_framework = r.legal_framework, award_act_number = r.award_act_number,
      customer_id = r.customer_id, jurisdiction = r.jurisdiction, dependencia = r.dependencia,
      buyer_phone = r.buyer_phone, buyer_address = r.buyer_address, buyer_notes = r.buyer_notes,
      awardee_name = r.awardee_name, awardee_cuit = r.awardee_cuit, awardee_entity_number = r.awardee_entity_number,
      authorizers = r.authorizers, issue_date = r.issue_date, received_date = r.received_date,
      perfected_date = r.perfected_date, delivery_term_text = r.delivery_term_text,
      delivery_term_days = r.delivery_term_days, due_date = r.due_date, delivery_place = r.delivery_place,
      payment_terms = r.payment_terms, contract_terms = r.contract_terms, currency = r.currency,
      discount_amount = r.discount_amount, net_amount = r.net_amount, vat_amount = r.vat_amount,
      total_amount = r.total_amount, notes = r.notes,
      status = coalesce((v_p->>'status')::public.po_status, status)
    where id = v_id;

    select coalesce(array_agg((x->>'id')::uuid), '{}') into v_keep
      from jsonb_array_elements(v_items) x where nullif(x->>'id', '') is not null;
    delete from public.purchase_order_items i
     where i.purchase_order_id = v_id and not (i.id = any(v_keep));
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    ri := jsonb_populate_record(null::public.purchase_order_items, public.jsonb_strip_empty(v_item));
    if ri.description_original is null then
      raise exception 'Renglón % sin descripción', ri.line_number using errcode = '22023';
    end if;
    ri.option_number := coalesce(ri.option_number, 1);
    ri.total_amount  := round(ri.total_amount, 2);
    if ri.id is null then
      insert into public.purchase_order_items (
        org_id, purchase_order_id, line_number, option_number, bac_code, internal_code, product_id,
        description_original, description_normalized, quantity, unit, unit_price, total_amount, packaging,
        delivery_address, delivery_phone, delivery_term, delivery_notes, notes
      ) values (
        p_org, v_id, ri.line_number, ri.option_number, ri.bac_code, ri.internal_code, ri.product_id,
        ri.description_original, ri.description_normalized, ri.quantity, ri.unit, ri.unit_price, ri.total_amount,
        ri.packaging, ri.delivery_address, ri.delivery_phone, ri.delivery_term, ri.delivery_notes, ri.notes
      );
    else
      update public.purchase_order_items set
        line_number = ri.line_number, option_number = ri.option_number, bac_code = ri.bac_code,
        internal_code = ri.internal_code, product_id = ri.product_id,
        description_original = ri.description_original, description_normalized = ri.description_normalized,
        quantity = ri.quantity, unit = ri.unit, unit_price = ri.unit_price, total_amount = ri.total_amount,
        packaging = ri.packaging, delivery_address = ri.delivery_address, delivery_phone = ri.delivery_phone,
        delivery_term = ri.delivery_term, delivery_notes = ri.delivery_notes, notes = ri.notes
      where id = ri.id and purchase_order_id = v_id;
      if not found then
        raise exception 'Renglón % no pertenece a la orden', ri.id using errcode = '22023';
      end if;
    end if;
  end loop;

  return v_id;
end;
$$;

revoke all on function public.save_purchase_order(uuid, jsonb) from public, anon;
grant execute on function public.save_purchase_order(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Confirmar importación: crea la orden, vincula el PDF y cierra el job
-- (una sola transacción)
-- ---------------------------------------------------------------------
create or replace function public.confirm_po_import(p_job uuid, p_payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job public.import_jobs;
  v_po  uuid;
begin
  select * into v_job from public.import_jobs where id = p_job for update;
  if v_job.id is null then
    raise exception 'Importación inexistente' using errcode = 'P0002';
  end if;
  if v_job.status <> 'revision' then
    raise exception 'La importación no está lista para confirmar (estado: %)', v_job.status using errcode = '55000';
  end if;

  v_po := public.save_purchase_order(
    v_job.org_id,
    (p_payload - 'id' - 'version') || jsonb_build_object('source', 'importacion')
  );

  update public.documents
     set purchase_order_id = v_po, doc_type = 'orden_compra'
   where id = v_job.document_id;

  update public.import_jobs
     set status = 'confirmado', result_purchase_order_id = v_po,
         confirmed_by = (select auth.uid()), finished_at = now()
   where id = p_job;

  return v_po;
end;
$$;

revoke all on function public.confirm_po_import(uuid, jsonb) from public, anon;
grant execute on function public.confirm_po_import(uuid, jsonb) to authenticated;
revoke all on function public.claim_import_job(uuid) from public, anon;
grant execute on function public.claim_import_job(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Buscador global: parcial, sin tildes, por relevancia, respeta RLS
-- ---------------------------------------------------------------------
create or replace function public.global_search(p_org uuid, p_q text, p_limit integer default 20)
returns table (kind text, id uuid, title text, subtitle text, href text, score real)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (select public.norm(trim(p_q)) as t)
  select * from (
    -- Órdenes por números (exacto/prefijo pesa más)
    select 'orden'::text, po.id,
           coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')),
           concat_ws(' · ', c.name, po.expediente_number, po.process_number),
           '/ordenes/' || po.id,
           greatest(
             extensions.similarity(public.norm(po.bac_number), q.t),
             extensions.similarity(public.norm(po.expediente_number), q.t),
             extensions.similarity(public.norm(po.process_number), q.t),
             extensions.similarity(public.norm(po.contratacion_number), q.t),
             case when public.norm(concat_ws(' ', po.bac_number, po.expediente_number, po.process_number,
                                             po.contratacion_number, 'oc-' || lpad(po.internal_number::text, 6, '0')))
                       like '%' || q.t || '%' then 0.9 else 0 end
           )::real
      from public.purchase_orders po
      left join public.customers c on c.id = po.customer_id, q
     where po.org_id = p_org
       and (public.norm(concat_ws(' ', po.bac_number, po.expediente_number, po.process_number,
                                  po.contratacion_number, 'oc-' || lpad(po.internal_number::text, 6, '0'))) like '%' || q.t || '%'
            or public.norm(po.bac_number) operator(extensions.%) q.t
            or public.norm(po.expediente_number) operator(extensions.%) q.t
            or public.norm(po.process_number) operator(extensions.%) q.t)
    union all
    -- Órdenes por organismo
    select 'orden', po.id,
           coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')),
           concat_ws(' · ', c.name, po.jurisdiction), '/ordenes/' || po.id,
           (greatest(extensions.similarity(public.norm(c.name), q.t),
                     extensions.word_similarity(q.t, public.norm(concat_ws(' ', c.name, po.dependencia, po.jurisdiction)))) * 0.8)::real
      from public.purchase_orders po
      left join public.customers c on c.id = po.customer_id, q
     where po.org_id = p_org
       and (public.norm(concat_ws(' ', c.name, po.dependencia, po.jurisdiction)) like '%' || q.t || '%'
            or q.t operator(extensions.<%) public.norm(concat_ws(' ', c.name, po.dependencia, po.jurisdiction)))
    union all
    -- Renglones (producto, descripción, códigos)
    select 'renglon', po.id,
           left(i.description_original, 90),
           concat_ws(' · ', coalesce(po.bac_number, 'OC-' || lpad(po.internal_number::text, 6, '0')),
                     'Renglón ' || i.line_number, i.bac_code),
           '/ordenes/' || po.id || '?tab=productos',
           greatest(
             extensions.word_similarity(q.t, public.norm(i.description_original)),
             case when public.norm(coalesce(i.bac_code,'') || ' ' || coalesce(i.internal_code,'')) like '%' || q.t || '%' then 0.95 else 0 end
           )::real
      from public.purchase_order_items i
      join public.purchase_orders po on po.id = i.purchase_order_id, q
     where i.org_id = p_org
       and (public.norm(i.description_original) like '%' || q.t || '%'
            or q.t operator(extensions.<%) public.norm(i.description_original)
            or public.norm(coalesce(i.bac_code,'') || ' ' || coalesce(i.internal_code,'')) like '%' || q.t || '%')
    union all
    select 'organismo', c.id, c.name, c.cuit, '/organismos?id=' || c.id,
           extensions.similarity(public.norm(c.name), q.t)::real
      from public.customers c, q
     where c.org_id = p_org
       and (public.norm(c.name) like '%' || q.t || '%' or public.norm(c.name) operator(extensions.%) q.t)
    union all
    select 'proveedor', s.id, s.name, s.cuit, '/proveedores?id=' || s.id,
           extensions.similarity(public.norm(s.name), q.t)::real
      from public.suppliers s, q
     where s.org_id = p_org
       and (public.norm(s.name) like '%' || q.t || '%' or public.norm(s.name) operator(extensions.%) q.t)
    union all
    select 'producto', p.id, p.description, concat_ws(' · ', p.internal_code, p.bac_code), '/productos?id=' || p.id,
           greatest(extensions.word_similarity(q.t, public.norm(p.description)),
                    case when public.norm(concat_ws(' ', p.internal_code, p.bac_code)) like '%' || q.t || '%' then 0.95 else 0 end)::real
      from public.products p, q
     where p.org_id = p_org
       and (public.norm(concat_ws(' ', p.description, p.internal_code, p.bac_code)) like '%' || q.t || '%'
            or q.t operator(extensions.<%) public.norm(p.description))
  ) r(kind, id, title, subtitle, href, score)
  where length((select t from q)) >= 2
  order by score desc, title
  limit least(greatest(p_limit, 1), 50)
$$;

revoke all on function public.global_search(uuid, text, integer) from public, anon;
grant execute on function public.global_search(uuid, text, integer) to authenticated;
