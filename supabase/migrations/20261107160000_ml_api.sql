-- =====================================================================
-- Conexión directa con la API de Mercado Libre (aplicación propia de la empresa).
-- Trae precios de compras y ventas, comisiones y operaciones que no llegaron por mail.
-- Todo pasa por ml_conn(): con sesión de admin o con el token de la conexión de Gmail.
-- =====================================================================
create table public.ml_connection (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  client_id       text,
  client_secret   text,
  ml_user_id      bigint,
  nickname        text,
  access_token    text,
  refresh_token   text,
  expires_at      timestamptz,
  oauth_state     text,
  oauth_verifier  text,
  connected_at    timestamptz,
  last_sync_at    timestamptz,
  last_error      text,
  updated_at      timestamptz not null default now()
);
alter table public.ml_connection enable row level security;
-- Sin políticas: nadie lee la tabla directo (secretos). Sólo por ml_conn().

alter table public.ml_orders add column api_ids text[] not null default '{}';
alter table public.ml_orders add column fees numeric(16,2);
alter table public.ml_orders add column api_synced_at timestamptz;
alter table public.ml_orders add column api_items jsonb;
create index idx_ml_orders_api_ids on public.ml_orders using gin (api_ids);

-- Aplica las órdenes que devuelve la API (compras como comprador, ventas como vendedor)
create or replace function public.ml_apply_api_orders(p_org uuid, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      jsonb;
  v_kind   text;
  v_ids    text[];
  v_row    uuid;
  v_title  text;
  v_at     timestamptz;
  v_items  jsonb;
  v_qty    numeric;
  v_total  numeric;
  v_upd    integer := 0;
  v_new    integer := 0;
begin
  for v_o in select x from jsonb_array_elements(p_orders) x loop
    v_kind  := v_o->>'kind';
    continue when v_kind not in ('compra', 'venta');
    v_ids   := array_remove(array[v_o->>'order_id', nullif(v_o->>'pack_id', '')], null);
    continue when coalesce(array_length(v_ids, 1), 0) = 0;
    v_items := coalesce(v_o->'items', '[]'::jsonb);
    v_title := left(coalesce(v_items->0->>'title', ''), 300);
    v_at    := (v_o->>'date')::timestamptz;
    v_qty   := (select sum((i->>'quantity')::numeric) from jsonb_array_elements(v_items) i);
    v_total := nullif(v_o->>'total', '')::numeric;
    v_row   := null;

    -- 1) por número (ya vinculado antes, o el número del mail coincide con orden o pack)
    select id into v_row from public.ml_orders
    where org_id = p_org and kind = v_kind and (ml_id = any(v_ids) or api_ids && v_ids)
    limit 1;
    -- 2) por producto y fecha (los mails de compra traen otro número)
    if v_row is null and length(v_title) >= 6 then
      select id into v_row from public.ml_orders
      where org_id = p_org and kind = v_kind and cardinality(api_ids) = 0
        and coalesce(ordered_at, created_at) between v_at - interval '2 days' and v_at + interval '2 days'
        and (public.norm(title) like left(public.norm(v_title), 25) || '%' or public.norm(v_title) like left(public.norm(title), 25) || '%'
             or extensions.similarity(public.norm(title), public.norm(v_title)) > 0.5)
      order by abs(extract(epoch from (coalesce(ordered_at, created_at) - v_at))) limit 1;
    end if;

    if v_row is null then
      -- Operación que no llegó por mail: se agrega
      insert into public.ml_orders (org_id, kind, ml_id, title, extra_items, quantity, unit_price, total_amount, counterpart, status, ordered_at,
                                    api_ids, fees, api_synced_at, api_items)
      values (p_org, v_kind, v_ids[array_length(v_ids, 1)], v_title, greatest(jsonb_array_length(v_items) - 1, 0), v_qty,
              case when jsonb_array_length(v_items) = 1 then (v_items->0->>'unit_price')::numeric end, v_total,
              left(v_o->>'counterpart', 200),
              case when v_o->>'status' = 'cancelled' then 'cancelada' when v_kind = 'venta' then 'vendida' when v_o->>'delivered' = 'true' then 'entregada' else 'comprada' end,
              v_at, v_ids, nullif(v_o->>'fees', '')::numeric, now(), v_items)
      on conflict (org_id, kind, ml_id) do nothing;
      if found then v_new := v_new + 1; end if;
    else
      update public.ml_orders o set
        api_ids       = (select array_agg(distinct x) from unnest(o.api_ids || v_ids) x),
        unit_price    = coalesce(o.unit_price, case when jsonb_array_length(v_items) >= 1 then (v_items->0->>'unit_price')::numeric end),
        total_amount  = coalesce(v_total, o.total_amount),
        quantity      = coalesce(o.quantity, v_qty),
        fees          = coalesce(nullif(v_o->>'fees', '')::numeric, o.fees),
        counterpart   = coalesce(o.counterpart, left(v_o->>'counterpart', 200)),
        status        = case when v_o->>'status' = 'cancelled' then 'cancelada'
                             when o.kind = 'compra' and v_o->>'delivered' = 'true' then 'entregada' else o.status end,
        title         = case when length(o.title) < 8 and length(v_title) > length(o.title) then v_title else o.title end,
        api_items     = v_items,
        api_synced_at = now()
      where o.id = v_row;
      v_upd := v_upd + 1;
    end if;
  end loop;
  return jsonb_build_object('actualizadas', v_upd, 'nuevas', v_new, 'vinculadas', public.ml_autolink(p_org));
end;
$$;
revoke all on function public.ml_apply_api_orders(uuid, jsonb) from public, anon, authenticated;

-- Punto único de acceso. Con p_token (script de Gmail / sincronización automática) o con sesión de admin.
create or replace function public.ml_conn(p_action text, p_org uuid default null, p_token text default null, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_c   public.ml_connection;
begin
  if p_token is not null then
    if length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
    select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
    if p_action not in ('creds', 'save_tokens', 'apply', 'error') then raise exception 'Acción no permitida' using errcode = '42501'; end if;
  else
    v_org := p_org;
    if v_org is null or not public.is_org_member(v_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
    if p_action <> 'status' and not public.has_org_role(v_org, array['admin','compras','finanzas']::public.app_role[]) then
      raise exception 'Sin permisos' using errcode = '42501';
    end if;
    if p_action in ('set_app', 'begin', 'finish', 'disconnect') and not public.has_org_role(v_org, array['admin']::public.app_role[]) then
      raise exception 'Sólo un administrador puede conectar Mercado Libre' using errcode = '42501';
    end if;
  end if;

  insert into public.ml_connection (org_id) values (v_org) on conflict do nothing;
  select * into v_c from public.ml_connection where org_id = v_org for update;

  if p_action = 'status' then
    return jsonb_build_object('has_app', v_c.client_id is not null and v_c.client_secret is not null, 'client_id', v_c.client_id,
      'connected', v_c.refresh_token is not null, 'nickname', v_c.nickname, 'connected_at', v_c.connected_at,
      'last_sync_at', v_c.last_sync_at, 'last_error', v_c.last_error);

  elsif p_action = 'set_app' then
    if coalesce(p_data->>'client_id', '') !~ '^\d{4,25}$' then raise exception 'El App ID son sólo números' using errcode = '22023'; end if;
    if length(coalesce(p_data->>'client_secret', '')) < 16 then raise exception 'La Secret Key no parece válida' using errcode = '22023'; end if;
    update public.ml_connection set client_id = p_data->>'client_id', client_secret = trim(p_data->>'client_secret'),
      access_token = null, refresh_token = null, expires_at = null, ml_user_id = null, nickname = null, connected_at = null, last_error = null, updated_at = now()
    where org_id = v_org;
    return jsonb_build_object('ok', true);

  elsif p_action = 'begin' then
    if v_c.client_id is null then raise exception 'Primero cargá el App ID y la Secret Key' using errcode = '22023'; end if;
    update public.ml_connection set oauth_state = p_data->>'state', oauth_verifier = p_data->>'verifier', updated_at = now() where org_id = v_org;
    return jsonb_build_object('client_id', v_c.client_id);

  elsif p_action = 'finish' then
    if v_c.oauth_state is null or v_c.oauth_state <> coalesce(p_data->>'state', '') then raise exception 'La autorización venció: volvé a tocar Conectar' using errcode = '22023'; end if;
    update public.ml_connection set oauth_state = null, oauth_verifier = null, updated_at = now() where org_id = v_org;
    return jsonb_build_object('client_id', v_c.client_id, 'client_secret', v_c.client_secret, 'verifier', v_c.oauth_verifier);

  elsif p_action = 'creds' then
    if v_c.refresh_token is null then return jsonb_build_object('connected', false); end if;
    return jsonb_build_object('connected', true, 'org_id', v_org, 'client_id', v_c.client_id, 'client_secret', v_c.client_secret,
      'access_token', v_c.access_token, 'refresh_token', v_c.refresh_token, 'expires_at', v_c.expires_at, 'ml_user_id', v_c.ml_user_id,
      'last_sync_at', v_c.last_sync_at);

  elsif p_action = 'save_tokens' then
    update public.ml_connection set
      access_token = coalesce(p_data->>'access_token', access_token), refresh_token = coalesce(p_data->>'refresh_token', refresh_token),
      expires_at = coalesce((p_data->>'expires_at')::timestamptz, expires_at), ml_user_id = coalesce((p_data->>'ml_user_id')::bigint, ml_user_id),
      nickname = coalesce(p_data->>'nickname', nickname), connected_at = coalesce(connected_at, case when p_data ? 'refresh_token' then now() end),
      last_error = null, updated_at = now()
    where org_id = v_org;
    return jsonb_build_object('ok', true);

  elsif p_action = 'apply' then
    update public.ml_connection set last_sync_at = now(), last_error = null, updated_at = now() where org_id = v_org;
    return public.ml_apply_api_orders(v_org, coalesce(p_data->'orders', '[]'::jsonb));

  elsif p_action = 'error' then
    update public.ml_connection set last_error = left(p_data->>'message', 500), updated_at = now() where org_id = v_org;
    return jsonb_build_object('ok', true);

  elsif p_action = 'disconnect' then
    update public.ml_connection set access_token = null, refresh_token = null, expires_at = null, connected_at = null, updated_at = now() where org_id = v_org;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end;
$$;
revoke all on function public.ml_conn(text, uuid, text, jsonb) from public;
grant execute on function public.ml_conn(text, uuid, text, jsonb) to anon, authenticated;

-- La vista incluye las columnas nuevas
drop view public.ml_orders_overview;
create view public.ml_orders_overview with (security_invoker = true) as
select o.*,
  coalesce(po.bac_number, po.display_number) as po_number, po.customer_name as po_customer,
  i.line_number as po_line, i.description_original as po_item_description, i.quantity as po_item_quantity, i.unit_price as po_item_unit_price,
  case when o.unit_price is not null then o.unit_price
       when o.total_amount is not null and o.quantity > 0 then round(o.total_amount / o.quantity, 2) end as unit_value
from public.ml_orders o
left join public.purchase_orders_overview po on po.id = o.purchase_order_id
left join public.purchase_order_items i on i.id = o.po_item_id;
grant select on public.ml_orders_overview to authenticated;
