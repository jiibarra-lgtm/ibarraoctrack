-- La tienda se autentica con la sesión de su propio panel: la base del sistema le pregunta a la base de la tienda
-- (extensión http) si ese token es de un administrador. Sin claves compartidas.
create extension if not exists http with schema extensions;

alter table public.store_link alter column token_hash drop not null;
alter table public.store_link add column if not exists store_url text;
alter table public.store_link add column if not exists store_key text;   -- clave publicable de la tienda (pública por diseño)
update public.store_link set token_hash = null, store_url = 'https://khxtmxbdrcigddvskalk.supabase.co', store_key = 'sb_publishable_6JE7pm5dau0e-UY5BMBVMw_CgtXMegU';

create table if not exists public.store_admin_cache (
  token_hash text primary key,
  email      text,
  expires_at timestamptz not null
);
alter table public.store_admin_cache enable row level security;

create or replace function public.store_admin_org(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_l public.store_link; v_h text; v_r extensions.http_response; v_email text;
begin
  if p_token is null or length(p_token) < 40 then raise exception 'Sesión inválida' using errcode = '28000'; end if;
  select * into v_l from public.store_link limit 1;
  if v_l.org_id is null or v_l.store_url is null then raise exception 'Tienda no vinculada' using errcode = '28000'; end if;
  v_h := encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if exists (select 1 from public.store_admin_cache where token_hash = v_h and expires_at > now()) then return v_l.org_id; end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS', '2500');
  select * into v_r from extensions.http((
    'GET', v_l.store_url || '/auth/v1/user',
    array[extensions.http_header('apikey', v_l.store_key), extensions.http_header('Authorization', 'Bearer ' || p_token)], null, null)::extensions.http_request);
  if v_r.status <> 200 then raise exception 'Sesión de la tienda vencida: volvé a entrar al panel' using errcode = '28000'; end if;
  v_email := (v_r.content::jsonb)->>'email';
  select * into v_r from extensions.http((
    'POST', v_l.store_url || '/rest/v1/rpc/es_admin',
    array[extensions.http_header('apikey', v_l.store_key), extensions.http_header('Authorization', 'Bearer ' || p_token)], 'application/json', '{}')::extensions.http_request);
  if v_r.status <> 200 or trim(v_r.content) <> 'true' then raise exception 'No sos administrador de la tienda' using errcode = '42501'; end if;

  delete from public.store_admin_cache where expires_at < now();
  insert into public.store_admin_cache values (v_h, v_email, now() + interval '10 minutes') on conflict (token_hash) do update set expires_at = excluded.expires_at;
  return v_l.org_id;
end $$;
revoke all on function public.store_admin_org(text) from public, anon, authenticated;

-- API para el panel de la tienda: list / set (mismo formato que antes) con la sesión del panel
create or replace function public.store_costs(p_token text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_i jsonb; v_n integer := 0;
begin
  v_org := public.store_admin_org(p_token);
  if p_action = 'list' then
    return jsonb_build_object(
      'costs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'description', description, 'supplier', supplier, 'cost_net', cost_net,
                 'cost_gross', cost_gross, 'includes_vat', includes_vat, 'vat_pct', vat_pct, 'unit', unit) order by description)
                 from public.manual_costs where org_id = v_org and active), '[]'::jsonb),
      'links', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'manual_cost_id', manual_cost_id, 'cost_override', cost_override))
                 from public.store_costs where org_id = v_org), '[]'::jsonb));
  elsif p_action = 'set' then
    for v_i in select x from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) x loop
      continue when coalesce(v_i->>'slug', '') = '';
      if nullif(v_i->>'manual_cost_id', '') is null and nullif(v_i->>'cost_override', '') is null then
        delete from public.store_costs where org_id = v_org and slug = v_i->>'slug';
      else
        if nullif(v_i->>'manual_cost_id', '') is not null and not exists (select 1 from public.manual_costs where id = (v_i->>'manual_cost_id')::uuid and org_id = v_org) then
          raise exception 'Costo inexistente' using errcode = '22023';
        end if;
        insert into public.store_costs (org_id, slug, name, manual_cost_id, cost_override, updated_at)
        values (v_org, left(v_i->>'slug', 200), left(v_i->>'name', 300), nullif(v_i->>'manual_cost_id', '')::uuid, nullif(v_i->>'cost_override', '')::numeric, now())
        on conflict (org_id, slug) do update set name = excluded.name, manual_cost_id = excluded.manual_cost_id, cost_override = excluded.cost_override, updated_at = now();
      end if;
      v_n := v_n + 1;
    end loop;
    return jsonb_build_object('ok', true, 'n', v_n);
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end $$;
revoke all on function public.store_costs(text, text, jsonb) from public;
grant execute on function public.store_costs(text, text, jsonb) to anon, authenticated;

drop function if exists public.store_costs_api(text, text, jsonb);
