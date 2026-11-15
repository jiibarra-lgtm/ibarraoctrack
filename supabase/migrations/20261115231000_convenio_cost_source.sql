-- Costo de un renglón de convenio tomado de un producto comprado
alter table public.convenio_lines add column if not exists cost_source_item_id uuid references public.supplier_invoice_items(id) on delete set null;
alter table public.convenio_lines add column if not exists cost_source_divisor numeric(18,4) check (cost_source_divisor is null or cost_source_divisor > 0);

create or replace function public.convenio_set_cost_source(p_org uuid, p_line uuid, p_source uuid, p_divisor numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_source is not null and not exists (select 1 from public.supplier_invoice_items where id = p_source and org_id = p_org) then
    raise exception 'Producto no encontrado' using errcode = '22023';
  end if;
  update public.convenio_lines set cost_source_item_id = p_source, cost_source_divisor = case when p_source is null then null else p_divisor end
   where id = p_line and org_id = p_org;
end;
$$;
revoke all on function public.convenio_set_cost_source(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.convenio_set_cost_source(uuid, uuid, uuid, numeric) to authenticated;
