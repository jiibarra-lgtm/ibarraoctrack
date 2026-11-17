-- El aviso del banco trae decenas de movimientos y el trigger de conciliación corría una vez por cada uno
-- (≈0,2 s c/u): con 50 movimientos se pasaba del tiempo máximo, el pedido fallaba y el script de Gmail
-- quedaba trabado reintentando el mismo lote. Ahora, durante la carga, el trigger no hace nada y
-- se concilia una sola vez al final.
create or replace function public.tg_bank_match_gcba()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  if current_setting('app.bank_bulk', true) = '1' then return null; end if;
  for o in select distinct org_id from new_rows loop
    perform public.bank_match_gcba(o);
    perform public.bank_match_others(o);
    perform public.bank_fixed_costs(o);
  end loop;
  return null;
end;
$$;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.ingest_bank_movements(text,jsonb,jsonb)'::regprocedure);
  if d not like '%app.bank_bulk%' then
    d := replace(d, '  for v_m in select * from jsonb_array_elements(p_movs) loop',
                    '  perform set_config(''app.bank_bulk'', ''1'', true);
  for v_m in select * from jsonb_array_elements(p_movs) loop');
    d := replace(d, '  perform public.bank_solve_directions(v_org);
  perform public.bank_match_others(v_org);',
                    '  perform set_config(''app.bank_bulk'', '''', true);
  perform public.bank_solve_directions(v_org);
  perform public.bank_match_gcba(v_org);
  perform public.bank_match_others(v_org);
  perform public.bank_fixed_costs(v_org);');
    if d not like '%bank_fixed_costs(v_org)%' or d not like '%set_config(''app.bank_bulk'', ''1''%' then raise exception 'ingest_bank_movements: no se pudo aplicar'; end if;
    execute d;
  end if;
end $$;
