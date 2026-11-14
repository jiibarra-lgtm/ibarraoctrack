-- Remito valorizado (opcional): precio unitario por renglón. Si ningún renglón tiene precio, el remito sale sin importes.
alter table public.remito_items add column if not exists unit_price numeric(18,2) check (unit_price is null or unit_price >= 0);

create or replace function public.remito_set_prices(p_org uuid, p_remito uuid, p_prices jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas','logistica']::public.app_role[]) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.remitos where id = p_remito and org_id = p_org and status <> 'anulado') then
    raise exception 'Remito inexistente o anulado' using errcode = '22023';
  end if;
  if jsonb_typeof(p_prices) <> 'array' or jsonb_array_length(p_prices) > 200 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  update public.remito_items ri set unit_price = round((x->>'unit_price')::numeric, 2)
    from jsonb_array_elements(p_prices) x
   where ri.remito_id = p_remito and ri.org_id = p_org and ri.line_no = (x->>'line_no')::integer
     and nullif(x->>'unit_price', '') is not null and (x->>'unit_price')::numeric between 0 and 1e12;
end;
$$;
revoke all on function public.remito_set_prices(uuid, uuid, jsonb) from public, anon;
grant execute on function public.remito_set_prices(uuid, uuid, jsonb) to authenticated;
