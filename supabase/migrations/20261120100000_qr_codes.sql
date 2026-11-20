-- QR editables: cada remito lleva un QR que apunta a /r/<código>. Lo que muestra (remito, OC, factura, remito firmado,
-- conformidad, WhatsApp, un link o un menú con opciones) se cambia desde la app sin reimprimir el papel.

create table if not exists public.qr_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  color text not null default '#0f3d2e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  logo boolean not null default true,
  caption text not null default 'Escaneá para ver este remito',
  mode text not null default 'menu' check (mode in ('single', 'menu')),
  target text not null default 'remito' check (target in ('remito', 'oc', 'factura', 'firmado', 'conformidad', 'whatsapp', 'url')),
  menu text[] not null default '{remito,factura,conformidad,reclamo,whatsapp}',
  custom_url text check (custom_url is null or custom_url ~ '^https://'),
  whatsapp text,
  updated_at timestamptz not null default now()
);
alter table public.qr_settings enable row level security;
create policy qr_settings_select on public.qr_settings for select to authenticated using (public.is_org_member(org_id));
create policy qr_settings_write on public.qr_settings for all to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists public.qr_codes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null unique check (code ~ '^[A-Za-z0-9]{6,12}$'),
  remito_id uuid unique references public.remitos(id) on delete cascade,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  label text,
  -- null = usa lo de la plantilla general
  mode text check (mode in ('single', 'menu')),
  target text check (target in ('remito', 'oc', 'factura', 'firmado', 'conformidad', 'whatsapp', 'url')),
  menu text[],
  custom_url text check (custom_url is null or custom_url ~ '^https://'),
  active boolean not null default true,
  scans integer not null default 0,
  last_scan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists qr_codes_org on public.qr_codes (org_id, created_at desc);
alter table public.qr_codes enable row level security;
create policy qr_codes_select on public.qr_codes for select to authenticated using (public.is_org_member(org_id));
create policy qr_codes_update on public.qr_codes for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists public.qr_scans (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  at timestamptz not null default now(),
  choice text,
  city text,
  country text,
  device text
);
create index if not exists qr_scans_qr on public.qr_scans (qr_id, at desc);
alter table public.qr_scans enable row level security;
create policy qr_scans_select on public.qr_scans for select to authenticated using (public.is_org_member(org_id));

-- Reclamos y conformidades que deja el que escanea
create table if not exists public.qr_claims (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  qr_id uuid not null references public.qr_codes(id) on delete cascade,
  remito_id uuid references public.remitos(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  kind text not null check (kind in ('reclamo', 'conformidad')),
  name text not null,
  contact text,
  message text,
  status text not null default 'nuevo' check (status in ('nuevo', 'visto', 'resuelto')),
  created_at timestamptz not null default now()
);
create index if not exists qr_claims_org on public.qr_claims (org_id, created_at desc);
alter table public.qr_claims enable row level security;
create policy qr_claims_select on public.qr_claims for select to authenticated using (public.is_org_member(org_id));
create policy qr_claims_update on public.qr_claims for update to authenticated using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create or replace function public.qr_new_code() returns text
language plpgsql set search_path = '' as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; b bytea; s text; i int;
begin
  loop
    b := extensions.gen_random_bytes(8); s := '';
    for i in 0..7 loop s := s || substr(a, (get_byte(b, i) % length(a)) + 1, 1); end loop;
    exit when not exists (select 1 from public.qr_codes where code = s);
  end loop;
  return s;
end;
$$;

-- El QR de un remito (lo crea la primera vez)
create or replace function public.qr_for_remito(p_remito uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_po uuid; v_code text; v_label text;
begin
  select org_id, purchase_order_id into v_org, v_po from public.remitos where id = p_remito;
  if v_org is null or not public.is_org_member(v_org) then raise exception 'Remito inexistente' using errcode = '42501'; end if;
  select code into v_code from public.qr_codes where remito_id = p_remito;
  if v_code is not null then return v_code; end if;
  select 'Remito ' || coalesce(label, '') into v_label from public.remitos_overview where id = p_remito;
  insert into public.qr_settings (org_id) values (v_org) on conflict do nothing;
  insert into public.qr_codes (org_id, code, remito_id, purchase_order_id, label)
  values (v_org, public.qr_new_code(), p_remito, v_po, v_label)
  on conflict (remito_id) do nothing
  returning code into v_code;
  if v_code is null then select code into v_code from public.qr_codes where remito_id = p_remito; end if;
  return v_code;
end;
$$;
revoke all on function public.qr_for_remito(uuid) from public, anon;
grant execute on function public.qr_for_remito(uuid) to authenticated;

-- Lo que ve el que escanea (sin sesión): solo lo de ese remito
create or replace function public.qr_public(p_code text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q public.qr_codes; st public.qr_settings; r record; v_wa text; v_po uuid; v_items jsonb; v_inv jsonb; v_po_json jsonb;
begin
  if p_code !~ '^[A-Za-z0-9]{6,12}$' then return null; end if;
  select * into q from public.qr_codes where code = p_code;
  if q.id is null or not q.active then return null; end if;
  select * into st from public.qr_settings where org_id = q.org_id;
  select * into r from public.remitos_overview where id = q.remito_id;
  v_po := coalesce(q.purchase_order_id, r.purchase_order_id);
  select coalesce(st.whatsapp, rs.whatsapp) into v_wa from public.remito_settings rs where rs.org_id = q.org_id;
  select coalesce(jsonb_agg(jsonb_build_object('description', i.description, 'quantity', i.quantity, 'detail', i.detail, 'unit_price', i.unit_price) order by i.line_no), '[]')
    into v_items from public.remito_items i where i.remito_id = q.remito_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'invoice_type', s.invoice_type, 'point_of_sale', s.point_of_sale, 'number', s.number,
           'issue_date', s.issue_date, 'total', s.total_amount, 'currency', s.currency, 'cae', s.cae, 'document_id', s.document_id) order by s.issue_date), '[]')
    into v_inv from public.sales_invoices s where s.purchase_order_id = v_po and s.status <> 'anulada';
  select jsonb_build_object('number', coalesce(o.bac_number, o.display_number), 'customer', o.customer_name, 'issue_date', o.issue_date,
           'delivery_place', o.delivery_place, 'status', o.status)
    into v_po_json from public.purchase_orders_overview o where o.id = v_po;
  return jsonb_build_object(
    'code', q.code, 'label', q.label,
    'mode', coalesce(q.mode, st.mode, 'menu'), 'target', coalesce(q.target, st.target, 'remito'),
    'menu', to_jsonb(coalesce(q.menu, st.menu, '{remito,factura,conformidad,reclamo,whatsapp}'::text[])),
    'custom_url', coalesce(q.custom_url, st.custom_url),
    'color', coalesce(st.color, '#0f3d2e'), 'logo', coalesce(st.logo, true), 'caption', st.caption,
    'whatsapp', v_wa,
    'remito', case when r.id is null then null else jsonb_build_object(
      'label', r.label, 'provisional', r.provisional, 'issued_at', r.issued_at, 'status', r.status,
      'recipient', jsonb_build_object('name', r.recipient_name, 'address', r.recipient_address, 'iva', r.recipient_iva, 'cuit', r.recipient_cuit),
      'notes', r.notes, 'issuer', r.issuer, 'po_number', r.po_number, 'signed_document_id', r.signed_document_id, 'items', v_items) end,
    'po', v_po_json, 'invoices', v_inv);
end;
$$;
revoke all on function public.qr_public(text) from public;
grant execute on function public.qr_public(text) to anon, authenticated;

create or replace function public.qr_scan(p_code text, p_choice text, p_city text, p_country text, p_device text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.qr_codes;
begin
  select * into q from public.qr_codes where code = p_code and active;
  if q.id is null then return; end if;
  -- no cuenta los rebotes del mismo celular en menos de 1 minuto
  if exists (select 1 from public.qr_scans where qr_id = q.id and at > now() - interval '1 minute' and device is not distinct from left(p_device, 120) and choice is not distinct from left(p_choice, 30)) then return; end if;
  insert into public.qr_scans (org_id, qr_id, choice, city, country, device)
  values (q.org_id, q.id, left(p_choice, 30), left(p_city, 80), left(p_country, 8), left(p_device, 120));
  if p_choice is null then update public.qr_codes set scans = scans + 1, last_scan_at = now() where id = q.id; end if;
end;
$$;
revoke all on function public.qr_scan(text, text, text, text, text) from public;
grant execute on function public.qr_scan(text, text, text, text, text) to anon, authenticated;

create or replace function public.qr_claim(p_code text, p_kind text, p_name text, p_contact text, p_message text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare q public.qr_codes; v_label text; v_po text;
begin
  select * into q from public.qr_codes where code = p_code and active;
  if q.id is null or p_kind not in ('reclamo', 'conformidad') or length(btrim(coalesce(p_name, ''))) < 2 then return false; end if;
  -- freno a spam: hasta 10 por QR por día
  if (select count(*) from public.qr_claims where qr_id = q.id and created_at > now() - interval '1 day') >= 10 then return false; end if;
  insert into public.qr_claims (org_id, qr_id, remito_id, purchase_order_id, kind, name, contact, message)
  values (q.org_id, q.id, q.remito_id, q.purchase_order_id, p_kind, left(btrim(p_name), 120), left(btrim(p_contact), 120), left(btrim(p_message), 2000));
  select r.label, r.po_number into v_label, v_po from public.remitos_overview r where r.id = q.remito_id;
  perform public.notify(q.org_id, 'qr-' || p_kind || ':' || q.id || ':' || extract(epoch from now())::bigint,
    case when p_kind = 'reclamo' then 'Reclamo por el remito ' || coalesce(v_label, '') else 'Conformidad del remito ' || coalesce(v_label, '') end,
    left(btrim(p_name), 120) || coalesce(' · ' || nullif(btrim(p_contact), ''), '') || coalesce(' · OC ' || v_po, '') || coalesce(': ' || nullif(left(btrim(p_message), 300), ''), ''),
    '/remitos/qr?v=avisos', now(), case when p_kind = 'reclamo' then 'alta' else 'normal' end);
  return true;
end;
$$;
revoke all on function public.qr_claim(text, text, text, text, text) from public;
grant execute on function public.qr_claim(text, text, text, text, text) to anon, authenticated;

-- Archivos que se pueden bajar desde un QR: el remito firmado y las facturas en PDF de esa OC
create or replace function public.qr_doc_path(p_code text, p_doc uuid) returns text
language sql stable security definer set search_path = '' as $$
  select d.storage_path from public.qr_codes q
    join public.remitos r on r.id = q.remito_id
    join public.documents d on d.id = p_doc and d.org_id = q.org_id
   where q.code = p_code and q.active
     and (d.id = r.signed_document_id
          or d.id in (select s.document_id from public.sales_invoices s where s.purchase_order_id = coalesce(q.purchase_order_id, r.purchase_order_id) and s.status <> 'anulada'))
$$;
revoke all on function public.qr_doc_path(text, uuid) from public;
grant execute on function public.qr_doc_path(text, uuid) to anon, authenticated;

create or replace function public.qr_storage_allowed(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.documents d
      join public.remitos r on r.org_id = d.org_id
      join public.qr_codes q on q.remito_id = r.id and q.active
     where d.storage_path = p_name
       and (d.id = r.signed_document_id
            or d.id in (select s.document_id from public.sales_invoices s where s.purchase_order_id = coalesce(q.purchase_order_id, r.purchase_order_id) and s.status <> 'anulada')))
$$;
revoke all on function public.qr_storage_allowed(text) from public;
grant execute on function public.qr_storage_allowed(text) to anon, authenticated;

drop policy if exists documents_qr_public on storage.objects;
create policy documents_qr_public on storage.objects for select to anon
  using (bucket_id = 'documents' and public.qr_storage_allowed(name));
