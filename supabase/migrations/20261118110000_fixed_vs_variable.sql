-- Qué es gasto fijo y qué no.
--  · is_variable: se repite pero depende del uso (combustible, peajes, compras de todas las semanas): no suma en fijos.
--  · Los débitos del banco se juntan con el gasto que ya existe del mismo proveedor (Telefónica = Movistar, CTI = Claro/AMX).
--  · Un débito sin nombre no se adivina: queda en el banco "sin explicar" en vez de inventar un gasto fijo.
alter table public.fixed_costs add column if not exists is_variable boolean not null default false;

create or replace function public.provider_group(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p ~* '(TELEFONICA|MOVISTAR)' then 'movistar'
    when p ~* '(\yCTI\y|CLARO|\yAMX\y)' then 'claro'
    when p ~* '(PERSONAL|TELECOM|FIBERTEL|FLOW)' then 'personal'
    when p ~* 'EDESUR' then 'edesur'
    when p ~* 'EDENOR' then 'edenor'
    when p ~* 'METROGAS' then 'metrogas'
    when p ~* '(AYSA|AGUA Y SANEAMIENTOS)' then 'aysa'
    when p ~* '(MUNICIP\.? CIUDAD|\yAGIP\y|\yABL\y|GOBIERNO DE LA CIUDAD)' then 'abl'
    else null end
$$;

create or replace function public.bank_fixed_costs(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare b record; m record; v_cost uuid; v_key text; v_name text; v_grp text; n integer := 0;
begin
  -- a) boleta impaga ↔ salida del banco por el mismo importe (débito automático primero, la fecha más cercana)
  for b in select f.id, f.amount, f.period, f.due_date from public.fixed_cost_bills f
            where f.org_id = p_org and not f.paid and f.amount > 0 and f.source <> 'banco' and f.bank_movement_id is null
            order by f.period, f.due_date nulls last
  loop
    select x.id, x.mov_date into m from public.bank_movements x
     where x.org_id = p_org and coalesce(x.direction, 'out') = 'out'
       and x.kind in ('debito_automatico', 'transferencia', 'compra', 'otro', 'cheque_pagado')
       and abs(x.amount - b.amount) <= 1
       and x.mov_date between to_date(b.period || '-01', 'YYYY-MM-DD') - 5 and coalesce(b.due_date, to_date(b.period || '-01', 'YYYY-MM-DD') + 30) + 45
       and not exists (select 1 from public.fixed_cost_bills u where u.bank_movement_id = x.id and u.source <> 'banco')
       and not exists (select 1 from public.bank_supplier_matches s where s.bank_movement_id = x.id)
     order by (x.kind = 'debito_automatico') desc, abs(x.mov_date - coalesce(b.due_date, to_date(b.period || '-15', 'YYYY-MM-DD'))) limit 1;
    continue when m.id is null;
    delete from public.fixed_cost_bills u where u.bank_movement_id = m.id and u.source = 'banco';
    update public.fixed_cost_bills set paid = true, paid_at = m.mov_date, bank_movement_id = m.id where id = b.id;
    n := n + 1;
  end loop;
  update public.fixed_costs f set active = false, updated_at = now()
   where f.org_id = p_org and f.source = 'banco' and f.active and not exists (select 1 from public.fixed_cost_bills u where u.cost_id = f.id);

  -- b) débitos automáticos sin boleta → al gasto del mismo proveedor, o uno nuevo si el débito tiene nombre
  for m in select x.* from public.bank_movements x
            where x.org_id = p_org and x.kind = 'debito_automatico'
              and not exists (select 1 from public.fixed_cost_bills u where u.bank_movement_id = x.id)
              and not exists (select 1 from public.bank_supplier_matches s where s.bank_movement_id = x.id)
  loop
    v_name := btrim(regexp_replace(regexp_replace(m.detail, '^\s*(PAGO DE SERVICIO|DEBITO AUTOMATICO|DEB\.? AUT\.?)\s*-?\s*', '', 'i'), '\s+', ' ', 'g'));
    continue when v_name = '' or v_name ~* '^(DEBITO AUTOMATICO|-)$';
    v_grp := public.provider_group(v_name);
    v_cost := null;
    if v_grp is not null then
      select id into v_cost from public.fixed_costs where org_id = p_org and public.provider_group(name) = v_grp
       order by (source <> 'banco') desc, active desc, created_at limit 1;
    end if;
    if v_cost is null then
      v_key := 'banco:' || upper(v_name);
      select id into v_cost from public.fixed_costs where org_id = p_org and provider_key = v_key;
    end if;
    if v_cost is null then
      insert into public.fixed_costs (org_id, name, category, amount, source, provider_key, notes)
      values (p_org, left(initcap(v_name), 120), public.bank_debit_category(v_name), m.amount, 'banco', v_key, 'Creado solo desde los débitos automáticos del banco')
      returning id into v_cost;
    end if;
    insert into public.fixed_cost_bills (org_id, cost_id, dedupe_key, period, due_date, amount, paid, paid_at, source, subject, bank_movement_id)
    values (p_org, v_cost, 'banco:' || m.id, to_char(m.mov_date, 'YYYY-MM'), m.mov_date, m.amount, true, m.mov_date, 'banco', left(m.detail, 300), m.id)
    on conflict (org_id, dedupe_key) do nothing;
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.bank_fixed_costs(uuid) from public, anon, authenticated;

create or replace function public.bank_debit_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p ~* '(TELEFONICA|MOVISTAR|\yCTI\y|CLARO|\yAMX\y|PERSONAL|TELECOM|FIBERTEL|IPLAN)' then 'telefonia'
    when p ~* '(MUNICIP|\yAGIP\y|\yABL\y|ARBA|PATENTE|RENTAS)' then 'impuestos'
    when p ~* '(EDESUR|EDENOR|AYSA|METROGAS|NATURGY)' then 'servicios'
    when p ~* '(SEGURO|MERCANTIL|ZURICH|SANCOR|FEDERACION PATRONAL|LA CAJA)' then 'seguros'
    when p ~* '(GOOGLE|MICROSOFT|VERCEL|SUPABASE|ADOBE|OPENAI|ANTHROPIC|APPLE|NETFLIX|SPOTIFY)' then 'software'
    else 'otros' end
$$;

-- ---- Limpieza de lo que se creó mal ----
do $$
declare o uuid; c record; v_target uuid;
begin
  for o in select id from public.organizations loop
    -- duplicados del banco (Telefonica De A-…, Cti Sa-…) → al gasto de ARCA del mismo proveedor
    for c in select * from public.fixed_costs where org_id = o and source = 'banco' and public.provider_group(name) is not null loop
      select id into v_target from public.fixed_costs where org_id = o and id <> c.id and source <> 'banco' and public.provider_group(name) = public.provider_group(c.name)
       order by active desc, created_at limit 1;
      if v_target is not null then
        update public.fixed_cost_bills set cost_id = v_target where cost_id = c.id;
        delete from public.fixed_costs where id = c.id;
      end if;
    end loop;
    -- débito sin nombre: no es un gasto fijo identificable
    delete from public.fixed_cost_bills where org_id = o and source = 'banco'
       and cost_id in (select id from public.fixed_costs where org_id = o and source = 'banco' and provider_key ~* 'SIN NOMBRE$');
    delete from public.fixed_costs where org_id = o and source = 'banco' and provider_key ~* 'SIN NOMBRE$';
    -- tasas municipales y ABL: nombre claro y rubro impuestos
    update public.fixed_costs set category = 'impuestos',
           name = case when name ~* '^Municip\. Ciudad' then 'ABL Ciudad · partida ' || substring(name from '(\d{6,})')
                       else 'Tasa municipal · cuenta …' || right(substring(name from '(\d{6,})'), 6) end, updated_at = now()
     where org_id = o and source = 'banco' and name ~* '^Municip';
    -- se repiten pero dependen del uso: no son fijos
    update public.fixed_costs set is_variable = true, category = case when name ~* 'AUTOPISTA|AUBASA' then 'vehiculos' else category end, updated_at = now()
     where org_id = o and (name ~* '(AUTOPISTAS|AUBASA|\yAUSA\y|PEAJE)' or supplier_cuit = '30577704798');
  end loop;
end $$;
