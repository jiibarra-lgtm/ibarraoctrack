-- =====================================================================
-- ARCA (ex AFIP): certificado del web service de facturación electrónica (WSAA + WSFEv1).
-- La clave privada se genera en el servidor y nunca se muestra: sólo sale por arca_conn() al servidor.
-- =====================================================================
create table public.arca_connection (
  org_id          uuid primary key references public.organizations(id) on delete cascade,
  cuit            text,
  point_of_sale   integer check (point_of_sale is null or point_of_sale between 1 and 99998),
  alias           text not null default 'octrack',
  private_key     text,
  csr             text,
  certificate     text,
  cert_expires_at timestamptz,
  ta_token        text,
  ta_sign         text,
  ta_expires_at   timestamptz,
  last_check_at   timestamptz,
  last_check      text,
  last_error      text,
  updated_at      timestamptz not null default now()
);
alter table public.arca_connection enable row level security;
-- Sin políticas: sólo por arca_conn().

create or replace function public.arca_conn(p_action text, p_org uuid, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.arca_connection;
begin
  if p_org is null or not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if p_action <> 'status' and not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if p_action in ('set_config', 'save_csr', 'save_cert') and not public.has_org_role(p_org, array['admin']::public.app_role[]) then
    raise exception 'Sólo un administrador puede configurar ARCA' using errcode = '42501';
  end if;

  insert into public.arca_connection (org_id) values (p_org) on conflict do nothing;
  select * into v_c from public.arca_connection where org_id = p_org for update;

  if p_action = 'status' then
    return jsonb_build_object('cuit', v_c.cuit, 'point_of_sale', v_c.point_of_sale, 'alias', v_c.alias,
      'has_csr', v_c.csr is not null, 'has_cert', v_c.certificate is not null, 'cert_expires_at', v_c.cert_expires_at,
      'last_check_at', v_c.last_check_at, 'last_check', v_c.last_check, 'last_error', v_c.last_error);
  elsif p_action = 'set_config' then
    if coalesce(p_data->>'cuit', '') !~ '^\d{11}$' then raise exception 'El CUIT tiene que tener 11 números' using errcode = '22023'; end if;
    if coalesce(p_data->>'point_of_sale', '') !~ '^\d{1,5}$' then raise exception 'Punto de venta inválido' using errcode = '22023'; end if;
    update public.arca_connection set cuit = p_data->>'cuit', point_of_sale = (p_data->>'point_of_sale')::int,
      ta_token = case when cuit is distinct from p_data->>'cuit' then null else ta_token end, updated_at = now()
    where org_id = p_org;
    return jsonb_build_object('ok', true);
  elsif p_action = 'save_csr' then
    update public.arca_connection set private_key = p_data->>'private_key', csr = p_data->>'csr', alias = coalesce(p_data->>'alias', alias),
      certificate = null, cert_expires_at = null, ta_token = null, ta_sign = null, ta_expires_at = null, last_error = null, updated_at = now()
    where org_id = p_org;
    return jsonb_build_object('ok', true);
  elsif p_action = 'csr' then
    return jsonb_build_object('csr', v_c.csr, 'alias', v_c.alias, 'cuit', v_c.cuit);
  elsif p_action = 'save_cert' then
    if v_c.private_key is null then raise exception 'Primero generá el pedido de certificado' using errcode = '22023'; end if;
    update public.arca_connection set certificate = p_data->>'certificate', cert_expires_at = (p_data->>'expires_at')::timestamptz,
      ta_token = null, ta_sign = null, ta_expires_at = null, last_error = null, updated_at = now()
    where org_id = p_org;
    return jsonb_build_object('ok', true);
  elsif p_action = 'creds' then
    if v_c.private_key is null then raise exception 'Primero generá el pedido de certificado' using errcode = '22023'; end if;
    return jsonb_build_object('cuit', v_c.cuit, 'point_of_sale', v_c.point_of_sale, 'private_key', v_c.private_key, 'certificate', v_c.certificate,
      'ta_token', case when v_c.ta_expires_at > now() + interval '5 minutes' then v_c.ta_token end,
      'ta_sign', case when v_c.ta_expires_at > now() + interval '5 minutes' then v_c.ta_sign end);
  elsif p_action = 'save_ta' then
    update public.arca_connection set ta_token = p_data->>'token', ta_sign = p_data->>'sign', ta_expires_at = (p_data->>'expires_at')::timestamptz, updated_at = now()
    where org_id = p_org;
    return jsonb_build_object('ok', true);
  elsif p_action = 'check' then
    update public.arca_connection set last_check_at = now(), last_check = left(p_data->>'message', 500),
      last_error = case when (p_data->>'ok')::boolean then null else left(p_data->>'message', 500) end, updated_at = now()
    where org_id = p_org;
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end;
$$;
revoke all on function public.arca_conn(text, uuid, jsonb) from public, anon;
grant execute on function public.arca_conn(text, uuid, jsonb) to authenticated;
