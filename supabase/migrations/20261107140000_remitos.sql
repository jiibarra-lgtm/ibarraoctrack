-- =====================================================================
-- Remitos: emisión con numeración correlativa, contenido inmutable,
-- historial de eventos (emitido, impreso, entregado, firmado, anulado)
-- y vínculo opcional con la orden de compra y su entrega.
-- =====================================================================

-- Datos del emisor y numeración por empresa
create table public.remito_settings (
  org_id         uuid primary key references public.organizations(id) on delete cascade,
  issuer_name    text not null default '',
  address_line   text not null default '',
  phones_line    text not null default '',
  iva_condition  text not null default 'I.V.A Responsable Inscripto',
  cuit           text not null default '',
  iibb           text not null default '',
  start_date     text not null default '',
  whatsapp       text,
  point_of_sale  integer not null default 1 check (point_of_sale between 1 and 99999),
  next_number    bigint not null default 1 check (next_number > 0),
  updated_at     timestamptz not null default now()
);
alter table public.remito_settings enable row level security;
create policy remito_settings_select on public.remito_settings for select to authenticated using (public.is_org_member(org_id));
create policy remito_settings_update on public.remito_settings for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));

insert into public.remito_settings (org_id, issuer_name, address_line, phones_line, cuit, iibb, start_date, whatsapp)
select id, 'Juan Ernesto Ibarra', 'Laguna 1311-(1407) Capital Federal', 'Tel/fax: 4671-0446 · celular: 15-5992-1045 - 1559921034',
       '20-04424052-2', '901-941842-3', '01/10/88', '5491159921034'
from public.organizations
on conflict do nothing;

-- Lugares / destinatarios guardados
create table public.remito_places (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  address        text,
  cuit           text,
  iva_condition  text,
  customer_id    uuid references public.customers(id) on delete set null,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index uq_remito_places_name on public.remito_places(org_id, public.norm(name));
create trigger trg_remito_places_updated before update on public.remito_places for each row execute function public.tg_set_updated_at();
alter table public.remito_places enable row level security;
create policy remito_places_select on public.remito_places for select to authenticated using (public.is_org_member(org_id));
create policy remito_places_insert on public.remito_places for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));
create policy remito_places_update on public.remito_places for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));

create table public.remitos (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  point_of_sale       integer not null,
  number              bigint not null,
  provisional         boolean not null default true,
  issued_at           timestamptz not null,
  recipient_name      text not null check (length(trim(recipient_name)) > 0),
  recipient_address   text,
  recipient_cuit      text,
  recipient_iva       text,
  place_id            uuid references public.remito_places(id) on delete set null,
  customer_id         uuid references public.customers(id) on delete set null,
  purchase_order_id   uuid references public.purchase_orders(id) on delete set null,
  delivery_id         uuid references public.deliveries(id) on delete set null,
  notes               text,
  issuer              jsonb not null default '{}'::jsonb,   -- copia de los datos del emisor al momento de emitir
  status              text not null default 'emitido' check (status in ('emitido', 'entregado', 'firmado', 'anulado')),
  void_reason         text,
  voided_at           timestamptz,
  voided_by           uuid references auth.users(id) on delete set null,
  signed_document_id  uuid references public.documents(id) on delete set null,
  print_count         integer not null default 0,
  last_printed_at     timestamptz,
  created_by          uuid references auth.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (org_id, point_of_sale, number),
  check (status <> 'anulado' or (void_reason is not null and length(trim(void_reason)) > 0))
);
create index idx_remitos_org on public.remitos(org_id, issued_at desc);
create index idx_remitos_po on public.remitos(purchase_order_id);
create index idx_remitos_recipient_trgm on public.remitos using gin (public.norm(recipient_name) extensions.gin_trgm_ops);
create trigger trg_remitos_updated before update on public.remitos for each row execute function public.tg_set_updated_at();

create table public.remito_items (
  id                      uuid primary key default gen_random_uuid(),
  org_id                  uuid not null references public.organizations(id) on delete cascade,
  remito_id               uuid not null references public.remitos(id) on delete cascade,
  line_no                 integer not null check (line_no > 0),
  description             text not null check (length(trim(description)) > 0),
  quantity                numeric(18,4) not null check (quantity > 0),
  detail                  text,
  purchase_order_item_id  uuid references public.purchase_order_items(id) on delete set null,
  product_id              uuid references public.products(id) on delete set null,
  unique (remito_id, line_no)
);
create index idx_remito_items_remito on public.remito_items(remito_id);

create table public.remito_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  remito_id   uuid not null references public.remitos(id) on delete cascade,
  kind        text not null check (kind in ('emitido', 'impreso', 'entregado', 'firmado', 'anulado', 'nota')),
  note        text,
  actor       uuid references auth.users(id) on delete set null,
  at          timestamptz not null default now()
);
create index idx_remito_events_remito on public.remito_events(remito_id, at);

-- Lectura para miembros; toda escritura pasa por las funciones de abajo
alter table public.remitos enable row level security;
alter table public.remito_items enable row level security;
alter table public.remito_events enable row level security;
create policy remitos_select on public.remitos for select to authenticated using (public.is_org_member(org_id));
create policy remito_items_select on public.remito_items for select to authenticated using (public.is_org_member(org_id));
create policy remito_events_select on public.remito_events for select to authenticated using (public.is_org_member(org_id));

create trigger trg_audit_remitos after insert or update or delete on public.remitos for each row execute function public.tg_audit();
create trigger trg_audit_remito_places after insert or update or delete on public.remito_places for each row execute function public.tg_audit();
create trigger trg_audit_remito_settings after insert or update or delete on public.remito_settings for each row execute function public.tg_audit();

-- El contenido de un remito emitido no se modifica (se anula y se emite otro)
create or replace function public.tg_remito_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.point_of_sale, new.number, new.provisional, new.issued_at, new.recipient_name, new.recipient_address, new.recipient_cuit,
      new.recipient_iva, new.purchase_order_id, new.notes, new.issuer, new.org_id, new.created_by)
     is distinct from
     (old.point_of_sale, old.number, old.provisional, old.issued_at, old.recipient_name, old.recipient_address, old.recipient_cuit,
      old.recipient_iva, old.purchase_order_id, old.notes, old.issuer, old.org_id, old.created_by) then
    raise exception 'Un remito emitido no se puede modificar: anulalo y emití uno nuevo' using errcode = '23514';
  end if;
  if old.status = 'anulado' and new.status <> 'anulado' then
    raise exception 'El remito está anulado' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger trg_remitos_immutable before update on public.remitos for each row execute function public.tg_remito_immutable();

create or replace function public.tg_remito_items_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Los renglones de un remito emitido no se pueden modificar' using errcode = '23514';
end;
$$;
create trigger trg_remito_items_immutable before update or delete on public.remito_items
  for each row when (pg_trigger_depth() = 0) execute function public.tg_remito_items_immutable();

create or replace function public.remito_label(p_pv integer, p_number bigint)
returns text language sql immutable set search_path = '' as $$
  select lpad(p_pv::text, 4, '0') || '-' || lpad(p_number::text, 8, '0')
$$;

-- Emite un remito: numera, guarda renglones, agrega productos nuevos al catálogo,
-- guarda el lugar si se pide y (opcional) registra la entrega en la orden.
create or replace function public.emit_remito(p_org uuid, p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_set     public.remito_settings;
  v_id      uuid;
  v_it      jsonb;
  v_line    integer := 0;
  v_po      uuid := nullif(p_payload->>'purchase_order_id', '')::uuid;
  v_place   uuid := nullif(p_payload->>'place_id', '')::uuid;
  v_cust    uuid := nullif(p_payload->>'customer_id', '')::uuid;
  v_name    text := trim(coalesce(p_payload->>'recipient_name', ''));
  v_desc    text;
  v_prod    uuid;
  v_poi     uuid;
  v_deliv   uuid;
  v_items   jsonb := '[]'::jsonb;
  v_new_products integer := 0;
  v_at      timestamptz;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas','logistica']::public.app_role[]) then
    raise exception 'Sin permisos para emitir remitos' using errcode = '42501';
  end if;
  if v_name = '' then raise exception 'Indicá el destinatario' using errcode = '22023'; end if;
  if jsonb_typeof(p_payload->'items') <> 'array' or not exists (
       select 1 from jsonb_array_elements(p_payload->'items') x
       where trim(coalesce(x->>'description', '')) <> '' and coalesce((x->>'quantity')::numeric, 0) > 0) then
    raise exception 'El remito tiene que tener al menos un producto con cantidad' using errcode = '22023';
  end if;
  if v_po is not null and not exists (select 1 from public.purchase_orders where id = v_po and org_id = p_org) then
    raise exception 'Orden inexistente' using errcode = 'P0002';
  end if;
  v_at := coalesce(nullif(p_payload->>'issued_at', '')::timestamptz, now());

  -- Numeración correlativa sin huecos (bloquea la fila de la empresa)
  insert into public.remito_settings (org_id) values (p_org) on conflict do nothing;
  select * into v_set from public.remito_settings where org_id = p_org for update;
  update public.remito_settings set next_number = next_number + 1, updated_at = now() where org_id = p_org;

  -- Guardar el lugar en la lista
  if v_place is null and coalesce((p_payload->>'save_place')::boolean, false) then
    insert into public.remito_places (org_id, name, address, cuit, iva_condition, customer_id, created_by)
    values (p_org, v_name, nullif(trim(p_payload->>'recipient_address'), ''), nullif(trim(p_payload->>'recipient_cuit'), ''),
            nullif(trim(p_payload->>'recipient_iva'), ''), v_cust, auth.uid())
    on conflict (org_id, public.norm(name)) do update set
      address = coalesce(excluded.address, public.remito_places.address), cuit = coalesce(excluded.cuit, public.remito_places.cuit),
      iva_condition = coalesce(excluded.iva_condition, public.remito_places.iva_condition)
    returning id into v_place;
  end if;

  insert into public.remitos (org_id, point_of_sale, number, provisional, issued_at, recipient_name, recipient_address, recipient_cuit,
    recipient_iva, place_id, customer_id, purchase_order_id, notes, issuer, created_by)
  values (p_org, v_set.point_of_sale, v_set.next_number, coalesce((p_payload->>'provisional')::boolean, true), v_at, v_name,
    nullif(trim(p_payload->>'recipient_address'), ''), nullif(trim(p_payload->>'recipient_cuit'), ''), nullif(trim(p_payload->>'recipient_iva'), ''),
    v_place, v_cust, v_po, nullif(trim(p_payload->>'notes'), ''),
    jsonb_build_object('name', v_set.issuer_name, 'address', v_set.address_line, 'phones', v_set.phones_line, 'iva', v_set.iva_condition,
                       'cuit', v_set.cuit, 'iibb', v_set.iibb, 'start', v_set.start_date, 'whatsapp', v_set.whatsapp),
    auth.uid())
  returning id into v_id;

  for v_it in select x from jsonb_array_elements(p_payload->'items') x loop
    v_desc := trim(coalesce(v_it->>'description', ''));
    continue when v_desc = '' or coalesce((v_it->>'quantity')::numeric, 0) <= 0;
    v_line := v_line + 1;
    v_poi  := nullif(v_it->>'purchase_order_item_id', '')::uuid;
    if v_poi is not null and (v_po is null or not exists (select 1 from public.purchase_order_items where id = v_poi and purchase_order_id = v_po)) then
      v_poi := null;
    end if;
    v_prod := nullif(v_it->>'product_id', '')::uuid;
    if v_prod is not null and not exists (select 1 from public.products where id = v_prod and org_id = p_org) then v_prod := null; end if;
    if v_prod is null and v_poi is not null then
      select product_id into v_prod from public.purchase_order_items where id = v_poi;
    end if;
    -- Producto nuevo (sin OC): se agrega al catálogo
    if v_prod is null and v_poi is null then
      select id into v_prod from public.products where org_id = p_org and public.norm(description) = public.norm(v_desc) limit 1;
      if v_prod is null then
        insert into public.products (org_id, description, created_by) values (p_org, v_desc, auth.uid()) returning id into v_prod;
        v_new_products := v_new_products + 1;
      end if;
    end if;
    insert into public.remito_items (org_id, remito_id, line_no, description, quantity, detail, purchase_order_item_id, product_id)
    values (p_org, v_id, v_line, left(v_desc, 500), (v_it->>'quantity')::numeric, nullif(trim(v_it->>'detail'), ''), v_poi, v_prod);
    if v_poi is not null then
      v_items := v_items || jsonb_build_object('purchase_order_item_id', v_poi, 'quantity', (v_it->>'quantity')::numeric);
    end if;
  end loop;

  -- Registrar la entrega en la orden con los renglones vinculados
  if v_po is not null and coalesce((p_payload->>'register_delivery')::boolean, false) and jsonb_array_length(v_items) > 0 then
    v_deliv := public.save_delivery(p_org, jsonb_build_object(
      'purchase_order_id', v_po, 'actual_date', (v_at at time zone 'America/Argentina/Buenos_Aires')::date,
      'planned_date', (v_at at time zone 'America/Argentina/Buenos_Aires')::date,
      'delivery_place', coalesce(nullif(trim(p_payload->>'recipient_address'), ''), v_name),
      'remito_number', public.remito_label(v_set.point_of_sale, v_set.next_number),
      'status', 'entregada', 'notes', 'Remito emitido desde el sistema', 'items', v_items));
    update public.remitos set delivery_id = v_deliv where id = v_id;
  end if;

  insert into public.remito_events (org_id, remito_id, kind, note, actor)
  values (p_org, v_id, 'emitido',
    concat_ws(' · ', case when coalesce((p_payload->>'provisional')::boolean, true) then 'Provisorio' else 'Definitivo' end,
      v_line || case when v_line = 1 then ' renglón' else ' renglones' end,
      case when v_deliv is not null then 'entrega registrada en la orden' end,
      case when v_new_products > 0 then v_new_products || case when v_new_products = 1 then ' producto nuevo al catálogo' else ' productos nuevos al catálogo' end end),
    auth.uid());
  return v_id;
end;
$$;
revoke all on function public.emit_remito(uuid, jsonb) from public, anon;
grant execute on function public.emit_remito(uuid, jsonb) to authenticated;

-- Acciones posteriores: impreso, entregado, firmado (con el escaneo), anulado (con motivo), nota
create or replace function public.remito_action(p_id uuid, p_kind text, p_note text default null, p_document uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.remitos;
begin
  select * into v_r from public.remitos where id = p_id for update;
  if v_r.id is null then raise exception 'Remito inexistente' using errcode = 'P0002'; end if;
  if not public.is_org_member(v_r.org_id) then raise exception 'Remito inexistente' using errcode = 'P0002'; end if;
  if p_kind <> 'impreso' and not public.has_org_role(v_r.org_id, array['admin','compras','finanzas','logistica']::public.app_role[]) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if v_r.status = 'anulado' and p_kind not in ('impreso', 'nota') then
    raise exception 'El remito está anulado' using errcode = '23514';
  end if;

  if p_kind = 'impreso' then
    update public.remitos set print_count = print_count + 1, last_printed_at = now() where id = p_id;
    -- una sola entrada por hora para no llenar el historial
    if exists (select 1 from public.remito_events where remito_id = p_id and kind = 'impreso' and at > now() - interval '1 hour') then return; end if;
  elsif p_kind = 'entregado' then
    if v_r.status = 'emitido' then update public.remitos set status = 'entregado' where id = p_id; end if;
  elsif p_kind = 'firmado' then
    if p_document is not null and not exists (select 1 from public.documents where id = p_document and org_id = v_r.org_id) then
      raise exception 'Documento inválido' using errcode = '22023';
    end if;
    update public.remitos set status = 'firmado', signed_document_id = coalesce(p_document, signed_document_id) where id = p_id;
  elsif p_kind = 'anulado' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Indicá el motivo de la anulación' using errcode = '22023'; end if;
    update public.remitos set status = 'anulado', void_reason = trim(p_note), voided_at = now(), voided_by = auth.uid() where id = p_id;
    if v_r.delivery_id is not null then
      perform public.set_delivery_status(v_r.delivery_id, 'cancelada', 'Remito ' || public.remito_label(v_r.point_of_sale, v_r.number) || ' anulado: ' || trim(p_note));
    end if;
  elsif p_kind = 'nota' then
    if coalesce(trim(p_note), '') = '' then raise exception 'Escribí la nota' using errcode = '22023'; end if;
  else
    raise exception 'Acción inválida' using errcode = '22023';
  end if;

  insert into public.remito_events (org_id, remito_id, kind, note, actor) values (v_r.org_id, p_id, p_kind, nullif(trim(p_note), ''), auth.uid());
end;
$$;
revoke all on function public.remito_action(uuid, text, text, uuid) from public, anon;
grant execute on function public.remito_action(uuid, text, text, uuid) to authenticated;

create view public.remitos_overview with (security_invoker = true) as
select r.*,
  public.remito_label(r.point_of_sale, r.number) as label,
  coalesce(po.bac_number, po.display_number) as po_number,
  (select count(*) from public.remito_items i where i.remito_id = r.id) as items_count,
  (select coalesce(sum(i.quantity), 0) from public.remito_items i where i.remito_id = r.id) as units,
  (select string_agg(i.description, ' · ' order by i.line_no) from public.remito_items i where i.remito_id = r.id) as items_text,
  coalesce(p.full_name, p.email) as created_by_name
from public.remitos r
left join public.purchase_orders_overview po on po.id = r.purchase_order_id
left join public.profiles p on p.id = r.created_by;
grant select on public.remitos_overview to authenticated;
