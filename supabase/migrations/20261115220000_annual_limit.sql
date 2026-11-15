-- Límite anual de facturación (tope de categoría, de un régimen o uno propio) editable desde Impuestos y ARCA
create or replace function public.tax_annual_limit_save(p_org uuid, p_amount numeric, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_amount is not null and (p_amount <= 0 or p_amount > 1e14) then raise exception 'Monto inválido' using errcode = '22023'; end if;
  insert into public.tax_settings (org_id) values (p_org) on conflict do nothing;
  update public.tax_settings set annual_limit = round(p_amount, 2), annual_limit_label = nullif(left(trim(coalesce(p_label, '')), 80), ''), updated_at = now()
   where org_id = p_org;
end;
$$;
revoke all on function public.tax_annual_limit_save(uuid, numeric, text) from public, anon;
grant execute on function public.tax_annual_limit_save(uuid, numeric, text) to authenticated;
