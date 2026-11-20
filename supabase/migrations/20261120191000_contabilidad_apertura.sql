-- Asiento de apertura: el saldo del banco al inicio del primer período generado (contra Capital),
-- así el mayor del banco coincide con el saldo real.
do $$
declare d text := pg_get_functiondef('public.acc_generate(uuid,date,date)'::regprocedure);
begin
  if position('apertura' in d) = 0 then
    d := replace(d, $a$  delete from public.acc_entries where org_id = p_org and auto and entry_date between p_from and p_to;$a$,
    $a$  delete from public.acc_entries where org_id = p_org and auto and entry_date between p_from and p_to;

  -- Apertura: una sola, al comienzo de lo más viejo que se generó
  delete from public.acc_entries where org_id = p_org and auto and source = 'apertura';
  select least(p_from, coalesce(min(entry_date), p_from)) into v_open_date from public.acc_entries where org_id = p_org and auto;
  select b.balance into v_open from public.bank_balances b
   where b.org_id = p_org and b.as_of < ((v_open_date::timestamp + interval '12 hours') at time zone 'America/Argentina/Buenos_Aires')
   order by b.as_of desc limit 1;
  if v_open is not null and v_open <> 0 then
    perform public.acc_post(p_org, v_open_date, 'Apertura: saldo del banco al ' || to_char(v_open_date, 'DD/MM/YYYY'), 'apertura', 'banco',
      case when v_open > 0 then jsonb_build_array(jsonb_build_array('1.1.02', v_open, 0), jsonb_build_array('3.1.01', 0, v_open))
           else jsonb_build_array(jsonb_build_array('3.1.01', -v_open, 0), jsonb_build_array('1.1.02', 0, -v_open)) end);
  end if;$a$);
    d := replace(d, $a$  r record; v_n integer;$a$, $a$  r record; v_n integer; v_open numeric; v_open_date date;$a$);
    if position('v_open_date date' in d) = 0 or position('apertura' in d) = 0 then raise exception 'No se pudo actualizar acc_generate'; end if;
    execute d;
  end if;
end $$;
