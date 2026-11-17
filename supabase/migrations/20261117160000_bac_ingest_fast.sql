-- Igual que con el banco: cada aviso de pago de SIGAF insertaba en bac_payments y disparaba la conciliación
-- completa (≈0,2 s por aviso). Un lote con muchos pagos se pasaba del tiempo y trababa la sincronización.
-- Durante la carga el trigger no hace nada; se concilia una vez al final.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.ingest_bac_events(text,jsonb)'::regprocedure);
  if d not like '%app.bank_bulk%' then
    d := replace(d, '  for v_e in select * from jsonb_array_elements(p_events) loop',
                    '  perform set_config(''app.bank_bulk'', ''1'', true);
  for v_e in select * from jsonb_array_elements(p_events) loop');
    d := replace(d, '  update public.inbound_tokens set last_used_at = now(), last_received = jsonb_array_length(p_events), total_events = total_events + v_new',
                    '  perform set_config(''app.bank_bulk'', '''', true);
  if v_new > 0 and exists (select 1 from jsonb_array_elements(p_events) x where x->>''kind'' = ''pago'') then
    perform public.bank_match_gcba(v_org);
    perform public.bank_match_others(v_org);
    perform public.bank_fixed_costs(v_org);
  end if;
  update public.inbound_tokens set last_used_at = now(), last_received = jsonb_array_length(p_events), total_events = total_events + v_new');
    if d not like '%set_config(''app.bank_bulk'', ''1''%' or d not like '%perform public.bank_fixed_costs(v_org)%' then raise exception 'ingest_bac_events: no se pudo aplicar'; end if;
    execute d;
  end if;
end $$;
