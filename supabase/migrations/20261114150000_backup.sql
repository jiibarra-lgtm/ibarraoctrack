-- Copia de seguridad: todas las tablas de trabajo de la organización en un JSON (la app lo arma como Excel).
-- La pide el script de Gmail con su clave (copia semanal en el Drive del usuario) o un admin/finanzas desde la app.

create or replace function public.backup_tables(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := '{}'::jsonb; t text; rows jsonb;
begin
  foreach t in array array['purchase_orders', 'purchase_order_items', 'deliveries', 'delivery_items', 'remitos', 'remito_items',
                           'sales_invoices', 'collections', 'purchases', 'purchase_items', 'costs', 'customers', 'suppliers',
                           'convenio_lines', 'bac_orders_inbox'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x) - ''org_id''), ''[]''::jsonb) from (select * from public.%I where org_id = $1 limit 20000) x', t)
      into rows using p_org;
    r := r || jsonb_build_object(t, rows);
  end loop;
  return r;
end;
$$;
revoke all on function public.backup_tables(uuid) from public, anon, authenticated;

create or replace function public.backup_dump(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  return jsonb_build_object('org', (select name from public.organizations where id = v_org), 'tables', public.backup_tables(v_org));
end;
$$;
revoke all on function public.backup_dump(text) from public;
grant execute on function public.backup_dump(text) to anon, authenticated;

create or replace function public.backup_dump_org(p_org uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  return jsonb_build_object('org', (select name from public.organizations where id = p_org), 'tables', public.backup_tables(p_org));
end;
$$;
revoke all on function public.backup_dump_org(uuid) from public, anon;
grant execute on function public.backup_dump_org(uuid) to authenticated;
