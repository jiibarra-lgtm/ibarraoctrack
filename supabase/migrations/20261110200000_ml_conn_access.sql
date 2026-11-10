-- Mercado Libre: sin "acceso offline" no hay refresh token; igual se usa el access token mientras dure (6 h)
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
      'connected', v_c.refresh_token is not null or (v_c.access_token is not null and v_c.expires_at > now()),
      'offline', v_c.refresh_token is not null, 'expires_at', v_c.expires_at, 'nickname', v_c.nickname, 'connected_at', coalesce(v_c.connected_at, case when v_c.access_token is not null then v_c.updated_at end),
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
    if v_c.refresh_token is null and (v_c.access_token is null or v_c.expires_at <= now()) then
      return jsonb_build_object('connected', false, 'expired', v_c.access_token is not null);
    end if;
    return jsonb_build_object('connected', true, 'org_id', v_org, 'client_id', v_c.client_id, 'client_secret', v_c.client_secret,
      'access_token', v_c.access_token, 'refresh_token', v_c.refresh_token, 'expires_at', v_c.expires_at, 'ml_user_id', v_c.ml_user_id,
      'last_sync_at', v_c.last_sync_at);

  elsif p_action = 'save_tokens' then
    update public.ml_connection set
      access_token = coalesce(p_data->>'access_token', access_token), refresh_token = coalesce(p_data->>'refresh_token', refresh_token),
      expires_at = coalesce((p_data->>'expires_at')::timestamptz, expires_at), ml_user_id = coalesce((p_data->>'ml_user_id')::bigint, ml_user_id),
      nickname = coalesce(p_data->>'nickname', nickname), connected_at = coalesce(connected_at, case when p_data ? 'access_token' then now() end),
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
