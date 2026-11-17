-- =====================================================================
-- 1) Débitos automáticos = gasto fijo. Cada salida del banco paga la boleta del gasto fijo con el mismo importe;
--    los débitos que no tienen boleta crean su propio gasto fijo (pagado con ese débito).
-- 2) Aviso push cuando entra plata al banco (GCBA con la factura que paga, transferencias, depósitos, cheques).
-- 3) Flete: configuración del vehículo y direcciones ubicadas en el mapa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Gastos fijos desde el banco
-- ---------------------------------------------------------------------
alter table public.fixed_cost_bills drop constraint if exists fixed_cost_bills_source_check;
alter table public.fixed_cost_bills add constraint fixed_cost_bills_source_check check (source in ('mail', 'manual', 'arca', 'banco'));
alter table public.fixed_cost_bills add column if not exists bank_movement_id uuid references public.bank_movements(id) on delete set null;
create unique index if not exists uq_fixed_cost_bills_mov on public.fixed_cost_bills(bank_movement_id) where bank_movement_id is not null;

create or replace function public.bank_debit_category(p text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p ~* '(TELEFONICA|MOVISTAR|CTI|CLARO|AMX|PERSONAL|TELECOM|FIBERTEL|IPLAN)' then 'telefonia'
    when p ~* '(EDESUR|EDENOR|AYSA|METROGAS|NATURGY|ABL|AGIP|LUZ|GAS|AGUA)' then 'servicios'
    when p ~* '(SEGURO|SEG\.|MERCANTIL|ZURICH|SANCOR|FEDERACION PATRONAL|LA CAJA)' then 'seguros'
    when p ~* '(AUTOPISTA|AUSA|AUBASA|PEAJE|TELEPEAJE|PATENTE|YPF|SHELL|AXION)' then 'vehiculos'
    when p ~* '(GOOGLE|MICROSOFT|VERCEL|SUPABASE|ADOBE|OPENAI|ANTHROPIC|APPLE|NETFLIX|SPOTIFY)' then 'software'
    else 'otros' end
$$;

create or replace function public.bank_fixed_costs(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare b record; m record; v_cost uuid; v_key text; v_name text; n integer := 0;
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
    -- si ese débito ya había creado un gasto "del banco", la boleta real lo reemplaza
    delete from public.fixed_cost_bills u where u.bank_movement_id = m.id and u.source = 'banco';
    update public.fixed_cost_bills set paid = true, paid_at = m.mov_date, bank_movement_id = m.id where id = b.id;
    n := n + 1;
  end loop;
  update public.fixed_costs f set active = false, updated_at = now()
   where f.org_id = p_org and f.source = 'banco' and f.active and not exists (select 1 from public.fixed_cost_bills u where u.cost_id = f.id);

  -- b) débitos automáticos sin boleta → su propio gasto fijo (todos cuentan como gasto fijo)
  for m in select x.* from public.bank_movements x
            where x.org_id = p_org and x.kind = 'debito_automatico'
              and not exists (select 1 from public.fixed_cost_bills u where u.bank_movement_id = x.id)
              and not exists (select 1 from public.bank_supplier_matches s where s.bank_movement_id = x.id)
  loop
    v_name := btrim(regexp_replace(regexp_replace(m.detail, '^\s*(PAGO DE SERVICIO|DEBITO AUTOMATICO|DEB\.? AUT\.?)\s*-?\s*', '', 'i'), '\s+', ' ', 'g'));
    if v_name = '' or v_name ~* '^(DEBITO AUTOMATICO|-)$' then v_name := 'Débito automático sin nombre'; end if;
    v_key := 'banco:' || upper(v_name);
    select id into v_cost from public.fixed_costs where org_id = p_org and provider_key = v_key;
    if v_cost is null then
      insert into public.fixed_costs (org_id, name, category, amount, source, provider_key, notes)
      values (p_org, left(initcap(v_name), 120), public.bank_debit_category(v_name), m.amount, 'banco', v_key, 'Creado solo desde los débitos automáticos del banco')
      returning id into v_cost;
    else
      update public.fixed_costs set active = true, amount = m.amount, updated_at = now() where id = v_cost and m.mov_date >= coalesce(
        (select max(paid_at) from public.fixed_cost_bills where cost_id = v_cost), '1900-01-01');
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

-- Corre sola cuando entran movimientos del banco o facturas de ARCA
create or replace function public.tg_bank_match_gcba()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select distinct org_id from new_rows loop
    perform public.bank_match_gcba(o);
    perform public.bank_match_others(o);
    perform public.bank_fixed_costs(o);
  end loop;
  return null;
end;
$$;

-- …y cada vez que se generan las boletas de los gastos fijos
create or replace function public.fixed_bills_sync(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  insert into public.fixed_cost_bills (org_id, cost_id, dedupe_key, period, due_date, amount, source, subject)
  select p_org, f.id, 'arca:' || v.id, to_char(v.issue_date, 'YYYY-MM'), v.issue_date + 15,
         (case when v.credit_note then -1 else 1 end) * v.total * v.exchange_rate, 'arca',
         left(public.arca_letter(v.voucher_type) || ' ' || lpad(v.point_of_sale::text, 5, '0') || '-' || lpad(v.number::text, 8, '0') || ' · ' || v.name, 300)
    from public.arca_vouchers v
    join public.fixed_costs f on f.org_id = v.org_id and f.active and regexp_replace(coalesce(f.supplier_cuit, ''), '\D', '', 'g') = v.doc_number
   where v.org_id = p_org and v.direction = 'recibido' and v.issue_date >= current_date - 400
  on conflict (org_id, dedupe_key) do nothing;
  get diagnostics n = row_count;
  perform public.bank_fixed_costs(p_org);
  return n;
end;
$$;
revoke all on function public.fixed_bills_sync(uuid) from public, anon;
grant execute on function public.fixed_bills_sync(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Aviso cuando entra plata
-- ---------------------------------------------------------------------
alter table public.bank_movements add column if not exists push_sent_at timestamptz;
update public.bank_movements set push_sent_at = coalesce(first_seen_at, created_at) where push_sent_at is null;

create or replace function public.bank_in_label(p_mov uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when b.kind = 'gcba' then 'GCBA' || coalesce(' · paga ' || (
      select string_agg(public.arca_letter(v.voucher_type) || ' ' || v.point_of_sale || '-' || v.number, ', ' order by v.number)
        from public.bank_matches bm join public.arca_vouchers v on v.id = bm.arca_voucher_id where bm.bank_movement_id = b.id), ' · todavía sin factura cruzada')
    when b.kind = 'deposito' then 'Depósito acreditado'
    when b.kind = 'cheque_depositado' then 'Cheque acreditado' || coalesce(' · ' || b.counterpart_name, '')
    else coalesce(nullif(b.counterpart_name, ''), (select max(v.name) from public.arca_vouchers v where v.doc_number = b.counterpart_cuit), left(b.detail, 60))
      || coalesce(' · paga ' || (
        select string_agg(public.arca_letter(v.voucher_type) || ' ' || v.point_of_sale || '-' || v.number, ', ')
          from public.bank_matches bm join public.arca_vouchers v on v.id = bm.arca_voucher_id where bm.bank_movement_id = b.id), '')
  end
  from public.bank_movements b where b.id = p_mov
$$;
revoke all on function public.bank_in_label(uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.push_outbox(text,text,text)'::regprocedure);
  if d not like '%''bank_in''%' then
    d := replace(d, $x$select jsonb_build_object('id', v_org, 'type', 'weekly'$x$, $x$(select jsonb_build_object('id', b.id, 'type', 'bank_in', 'contract', b.amount::text,
                 'name', left(public.bank_in_label(b.id), 200), 'ends_on', b.mov_date, 'stock', false)
           from public.bank_movements b
          where b.org_id = v_org and b.direction = 'in' and b.push_sent_at is null
            and b.kind in ('gcba', 'pago_recibido', 'transferencia', 'deposito', 'cheque_depositado')
            and coalesce(b.first_seen_at, b.created_at) >= now() - interval '3 days'
          order by b.mov_date, b.amount desc limit 8)
        union all
        select jsonb_build_object('id', v_org, 'type', 'weekly'$x$);
    if d not like '%''bank_in''%' then raise exception 'push_outbox: no se pudo aplicar el cambio'; end if;
    execute d;
  end if;

  d := pg_get_functiondef('public.push_mark(text,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if d not like '%push_sent_at%' then
    d := replace(d, $x$  update public.bac_orders_inbox b set missing_sent_at = now()$x$, $x$  update public.bank_movements m set push_sent_at = now()
  where m.org_id = v_org and m.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'bank_in');
  update public.bac_orders_inbox b set missing_sent_at = now()$x$);
    if d not like '%push_sent_at%' then raise exception 'push_mark: no se pudo aplicar el cambio'; end if;
    execute d;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3) Flete
-- ---------------------------------------------------------------------
create table if not exists public.freight_settings (
  org_id            uuid primary key references public.organizations(id) on delete cascade,
  origin_address    text not null default 'Laguna 1311, CABA' check (length(origin_address) between 3 and 300),
  vehicle_name      text not null default 'Mercedes-Benz Sprinter 411 CDI Street' check (length(vehicle_name) <= 120),
  consumption_l100  numeric(6,2) not null default 12 check (consumption_l100 between 3 and 40),
  fuel_price        numeric(12,2) not null default 2469 check (fuel_price > 0),
  fuel_price_on     date not null default current_date,
  extra_per_km      numeric(12,2) not null default 0 check (extra_per_km >= 0),
  road_factor       numeric(4,2) not null default 1.35 check (road_factor between 1 and 3),
  share_vehicle_fixed boolean not null default true,
  updated_at        timestamptz not null default now()
);
alter table public.freight_settings enable row level security;
create policy freight_settings_select on public.freight_settings for select to authenticated using (public.is_org_member(org_id));
create policy freight_settings_write on public.freight_settings for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas','logistica']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas','logistica']::public.app_role[]));

create table if not exists public.geo_places (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  query      text not null check (length(query) between 3 and 300),
  lat        numeric(9,6),
  lng        numeric(9,6),
  label      text check (label is null or length(label) <= 300),
  status     text not null default 'ok' check (status in ('ok', 'no_encontrada', 'manual')),
  km_manual  numeric(8,2) check (km_manual is null or km_manual between 0 and 2000),
  updated_at timestamptz not null default now(),
  primary key (org_id, query)
);
alter table public.geo_places enable row level security;
create policy geo_places_select on public.geo_places for select to authenticated using (public.is_org_member(org_id));
create policy geo_places_write on public.geo_places for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas','logistica','compras']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas','logistica','compras']::public.app_role[]));

-- Primera pasada con los datos que ya están
select public.bank_fixed_costs(id) from public.organizations;

-- Qué gastos fijos son el combustible real y cuáles son del vehículo (peajes, seguro, patente)
alter table public.freight_settings add column if not exists fuel_cost_ids uuid[] not null default '{}';
alter table public.freight_settings add column if not exists vehicle_cost_ids uuid[] not null default '{}';
