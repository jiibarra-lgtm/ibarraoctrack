-- Contabilidad: plan de cuentas, asientos (automáticos desde ventas, compras, banco, caja, cheques e IIBB, y manuales),
-- de donde salen el libro diario, el mayor y el balance de sumas y saldos.

create table if not exists public.acc_accounts (
  org_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (code ~ '^\d(\.\d{1,2}){0,2}$'),
  name text not null check (length(btrim(name)) between 2 and 80),
  type text not null check (type in ('activo', 'pasivo', 'patrimonio', 'ingreso', 'egreso')),
  imputable boolean not null default true,
  active boolean not null default true,
  primary key (org_id, code)
);
alter table public.acc_accounts enable row level security;
create policy acc_accounts_select on public.acc_accounts for select to authenticated using (public.is_org_member(org_id));
create policy acc_accounts_write on public.acc_accounts for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

create table if not exists public.acc_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  entry_date date not null,
  description text not null,
  source text not null default 'manual',
  source_id text,
  auto boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists acc_entries_org_date on public.acc_entries (org_id, entry_date);
create unique index if not exists acc_entries_source on public.acc_entries (org_id, source, source_id) where auto;
alter table public.acc_entries enable row level security;
create policy acc_entries_select on public.acc_entries for select to authenticated using (public.is_org_member(org_id));
create policy acc_entries_write on public.acc_entries for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]) and not auto)
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]) and not auto);

create table if not exists public.acc_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.acc_entries(id) on delete cascade,
  org_id uuid not null,
  account_code text not null,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  foreign key (org_id, account_code) references public.acc_accounts(org_id, code) on update cascade,
  check (debit = 0 or credit = 0)
);
create index if not exists acc_lines_entry on public.acc_lines (entry_id);
create index if not exists acc_lines_account on public.acc_lines (org_id, account_code);
alter table public.acc_lines enable row level security;
create policy acc_lines_select on public.acc_lines for select to authenticated using (public.is_org_member(org_id));
create policy acc_lines_write on public.acc_lines for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[])
     and exists (select 1 from public.acc_entries e where e.id = entry_id and e.org_id = acc_lines.org_id and not e.auto))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[])
     and exists (select 1 from public.acc_entries e where e.id = entry_id and e.org_id = acc_lines.org_id and not e.auto));

-- Plan de cuentas base
create or replace function public.acc_seed_accounts(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.acc_accounts (org_id, code, name, type, imputable) values
    (p_org, '1', 'ACTIVO', 'activo', false),
    (p_org, '1.1', 'Activo corriente', 'activo', false),
    (p_org, '1.1.01', 'Caja', 'activo', true),
    (p_org, '1.1.02', 'Banco Ciudad cuenta corriente', 'activo', true),
    (p_org, '1.1.03', 'Deudores por ventas', 'activo', true),
    (p_org, '1.1.04', 'Valores a depositar y fondos en tránsito', 'activo', true),
    (p_org, '1.1.05', 'IVA crédito fiscal', 'activo', true),
    (p_org, '1.1.06', 'Percepciones sufridas', 'activo', true),
    (p_org, '1.1.07', 'Retenciones y SIRCREB de Ingresos Brutos', 'activo', true),
    (p_org, '1.1.08', 'Retenciones de Ganancias sufridas', 'activo', true),
    (p_org, '1.1.09', 'Retenciones de IVA sufridas', 'activo', true),
    (p_org, '1.1.10', 'Retenciones SUSS y otras', 'activo', true),
    (p_org, '1.1.11', 'Plazos fijos', 'activo', true),
    (p_org, '2', 'PASIVO', 'pasivo', false),
    (p_org, '2.1', 'Pasivo corriente', 'pasivo', false),
    (p_org, '2.1.01', 'Proveedores', 'pasivo', true),
    (p_org, '2.1.02', 'Cheques diferidos a pagar', 'pasivo', true),
    (p_org, '2.1.03', 'IVA débito fiscal', 'pasivo', true),
    (p_org, '2.1.04', 'Impuestos a pagar', 'pasivo', true),
    (p_org, '3', 'PATRIMONIO NETO', 'patrimonio', false),
    (p_org, '3.1', 'Capital y cuenta particular', 'patrimonio', false),
    (p_org, '3.1.01', 'Capital', 'patrimonio', true),
    (p_org, '3.1.02', 'Cuenta particular del titular', 'patrimonio', true),
    (p_org, '4', 'INGRESOS', 'ingreso', false),
    (p_org, '4.1', 'Ventas', 'ingreso', false),
    (p_org, '4.1.01', 'Ventas', 'ingreso', true),
    (p_org, '4.2', 'Otros ingresos', 'ingreso', false),
    (p_org, '4.2.01', 'Intereses ganados', 'ingreso', true),
    (p_org, '4.2.02', 'Otros ingresos', 'ingreso', true),
    (p_org, '5', 'EGRESOS', 'egreso', false),
    (p_org, '5.1', 'Costo de compras', 'egreso', false),
    (p_org, '5.1.01', 'Compras y gastos con factura', 'egreso', true),
    (p_org, '5.2', 'Gastos', 'egreso', false),
    (p_org, '5.2.01', 'Gastos y comisiones bancarias', 'egreso', true),
    (p_org, '5.2.02', 'Impuesto a los débitos y créditos', 'egreso', true),
    (p_org, '5.2.03', 'Intereses pagados', 'egreso', true),
    (p_org, '5.2.04', 'Gastos sin factura', 'egreso', true),
    (p_org, '5.2.05', 'Diferencias de caja', 'egreso', true),
    (p_org, '5.2.06', 'Ingresos Brutos', 'egreso', true),
    (p_org, '9', 'TRANSITORIAS', 'activo', false),
    (p_org, '9.9', 'A revisar', 'activo', false),
    (p_org, '9.9.01', 'Partidas a revisar', 'activo', true)
  on conflict do nothing;
$$;
revoke all on function public.acc_seed_accounts(uuid) from public, anon, authenticated;
select public.acc_seed_accounts(id) from public.organizations;

-- Registra un asiento automático: líneas [[cuenta, debe, haber], ...]; omite las líneas en cero y exige que balancee.
create or replace function public.acc_post(p_org uuid, p_date date, p_desc text, p_source text, p_source_id text, p_lines jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_d numeric := 0; v_c numeric := 0; l jsonb;
begin
  for l in select * from jsonb_array_elements(p_lines) loop
    v_d := v_d + round(coalesce((l->>1)::numeric, 0), 2);
    v_c := v_c + round(coalesce((l->>2)::numeric, 0), 2);
  end loop;
  if v_d = 0 and v_c = 0 then return; end if;
  if abs(v_d - v_c) > 0.01 then raise exception 'Asiento desbalanceado (%): debe % haber %', p_desc, v_d, v_c; end if;
  insert into public.acc_entries (org_id, entry_date, description, source, source_id, auto)
  values (p_org, p_date, left(p_desc, 300), p_source, p_source_id, true)
  on conflict (org_id, source, source_id) where auto do nothing
  returning id into v_id;
  if v_id is null then return; end if;
  insert into public.acc_lines (entry_id, org_id, account_code, debit, credit)
  select v_id, p_org, x->>0, round(coalesce((x->>1)::numeric, 0), 2), round(coalesce((x->>2)::numeric, 0), 2)
    from jsonb_array_elements(p_lines) x
   where round(coalesce((x->>1)::numeric, 0), 2) > 0 or round(coalesce((x->>2)::numeric, 0), 2) > 0;
end;
$$;
revoke all on function public.acc_post(uuid, date, text, text, text, jsonb) from public, anon, authenticated;

-- (Re)genera los asientos automáticos de un período. Los manuales no se tocan.
create or replace function public.acc_generate(p_org uuid, p_from date, p_to date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_n integer; v_cp text; v_tot numeric; v_net numeric; v_vat numeric; v_oth numeric; v_ri numeric; v_rg numeric; v_a numeric;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_to < p_from or p_to - p_from > 800 then raise exception 'Período inválido'; end if;
  perform public.acc_seed_accounts(p_org);
  delete from public.acc_entries where org_id = p_org and auto and entry_date between p_from and p_to;

  -- 1) Ventas y compras (comprobantes de ARCA)
  for r in select * from public.arca_vouchers where org_id = p_org and issue_date between p_from and p_to loop
    v_tot := round(abs(coalesce(r.total, 0)) * coalesce(nullif(r.exchange_rate, 0), 1), 2);
    v_vat := round(abs(coalesce(r.vat, 0)) * coalesce(nullif(r.exchange_rate, 0), 1), 2);
    v_oth := round(abs(coalesce(r.other_taxes, 0)) * coalesce(nullif(r.exchange_rate, 0), 1), 2);
    v_net := v_tot - v_vat - v_oth;
    if v_net < 0 then v_net := 0; v_oth := v_tot - v_vat; end if;
    if r.direction = 'emitido' then
      perform public.acc_post(p_org, r.issue_date,
        (case when r.credit_note then 'NC venta ' else 'Venta ' end) || coalesce(r.name, '') || ' ' || lpad(r.point_of_sale::text, 5, '0') || '-' || lpad(r.number::text, 8, '0'),
        'venta', r.id::text,
        case when not r.credit_note then jsonb_build_array(jsonb_build_array('1.1.03', v_tot, 0), jsonb_build_array('4.1.01', 0, v_net), jsonb_build_array('2.1.03', 0, v_vat), jsonb_build_array('2.1.04', 0, v_oth))
             else jsonb_build_array(jsonb_build_array('1.1.03', 0, v_tot), jsonb_build_array('4.1.01', v_net, 0), jsonb_build_array('2.1.03', v_vat, 0), jsonb_build_array('2.1.04', v_oth, 0)) end);
    elsif r.direction = 'recibido' then
      perform public.acc_post(p_org, r.issue_date,
        (case when r.credit_note then 'NC compra ' else 'Compra ' end) || coalesce(r.name, '') || ' ' || lpad(r.point_of_sale::text, 5, '0') || '-' || lpad(r.number::text, 8, '0'),
        'compra', r.id::text,
        case when not r.credit_note then jsonb_build_array(jsonb_build_array('5.1.01', v_net, 0), jsonb_build_array('1.1.05', v_vat, 0), jsonb_build_array('1.1.06', v_oth, 0), jsonb_build_array('2.1.01', 0, v_tot))
             else jsonb_build_array(jsonb_build_array('5.1.01', 0, v_net), jsonb_build_array('1.1.05', 0, v_vat), jsonb_build_array('1.1.06', 0, v_oth), jsonb_build_array('2.1.01', v_tot, 0)) end);
    end if;
  end loop;

  -- 2) Banco: cada movimiento contra su contrapartida (la conciliación manda si existe)
  for r in
    select b.*, rc.kind as rkind, fc.source as fsource,
      coalesce((select sum(m.ret_iibb) from public.bank_matches m where m.bank_movement_id = b.id), 0) as ri,
      coalesce((select sum(m.ret_ganancias) from public.bank_matches m where m.bank_movement_id = b.id), 0) as rg
    from public.bank_movements b
    left join public.bank_reconciliations rc on rc.bank_movement_id = b.id
    left join public.fixed_cost_bills fb on fb.id = rc.ref_id and rc.kind = 'gasto_fijo'
    left join public.fixed_costs fc on fc.id = fb.cost_id
    where b.org_id = p_org and b.mov_date between p_from and p_to and b.direction in ('in', 'out') and b.amount > 0
  loop
    v_a := round(r.amount, 2);
    v_cp := case
      when r.rkind = 'cobro' then '1.1.03'
      when r.rkind = 'pago_proveedor' then '2.1.01'
      when r.rkind = 'gasto_fijo' then case when r.fsource in ('arca', 'mail') then '2.1.01' else '5.2.04' end
      when r.rkind in ('cheque', 'caja') then case when r.direction = 'out' and r.rkind = 'cheque' then '2.1.02' else '1.1.04' end
      when r.rkind = 'impuesto' then '2.1.04'
      when r.rkind = 'banco' then case when r.direction = 'in' then '4.2.01' else '5.2.01' end
      when r.rkind = 'titular' then '3.1.02'
      when r.rkind = 'otro' then '9.9.01'
      when r.direction = 'in' then case r.kind
        when 'cheque_depositado' then '1.1.04' when 'interes_ganado' then '4.2.01' when 'plazo_fijo_acreditacion' then '1.1.11'
        when 'devolucion' then '2.1.01' else '1.1.03' end
      else case r.kind
        when 'cheque_pagado' then '2.1.02' when 'sircreb' then '1.1.07' when 'imp_cheque' then '5.2.02' when 'comision' then '5.2.01' when 'iva_banco' then '5.2.01'
        when 'interes_descubierto' then '5.2.03' when 'extraccion' then '1.1.04' when 'plazo_fijo_constitucion' then '1.1.11' when 'embargo' then '9.9.01'
        when 'cheque_rechazado' then '1.1.03' else '2.1.01' end
    end;
    if r.direction = 'in' then
      v_ri := case when v_cp = '1.1.03' then round(r.ri, 2) else 0 end;
      v_rg := case when v_cp = '1.1.03' then round(r.rg, 2) else 0 end;
      perform public.acc_post(p_org, r.mov_date, 'Banco: ' || coalesce(r.counterpart_name, r.detail), 'banco', r.id::text,
        jsonb_build_array(jsonb_build_array('1.1.02', v_a, 0), jsonb_build_array('1.1.07', v_ri, 0), jsonb_build_array('1.1.08', v_rg, 0), jsonb_build_array(v_cp, 0, v_a + v_ri + v_rg)));
    else
      perform public.acc_post(p_org, r.mov_date, 'Banco: ' || coalesce(r.counterpart_name, r.detail), 'banco', r.id::text,
        jsonb_build_array(jsonb_build_array(v_cp, v_a, 0), jsonb_build_array('1.1.02', 0, v_a)));
    end if;
  end loop;

  -- 3) Caja
  for r in select * from public.cash_movements where org_id = p_org and mov_date between p_from and p_to loop
    v_cp := case r.category when 'venta' then '1.1.03' when 'aporte' then '3.1.02' when 'retiro' then '3.1.02' when 'proveedor' then '2.1.01'
      when 'gasto' then '5.2.04' when 'banco' then '1.1.04' when 'arqueo' then '5.2.05' else '9.9.01' end;
    perform public.acc_post(p_org, r.mov_date, 'Caja: ' || r.concept, 'caja', r.id::text,
      case when r.direction = 'in' then jsonb_build_array(jsonb_build_array('1.1.01', r.amount, 0), jsonb_build_array(v_cp, 0, r.amount))
           else jsonb_build_array(jsonb_build_array(v_cp, r.amount, 0), jsonb_build_array('1.1.01', 0, r.amount)) end);
  end loop;

  -- 4) Cheques: recibido = valor a depositar contra el cliente; emitido = pago diferido al proveedor
  for r in select * from public.cheques where org_id = p_org and status <> 'anulado' and (created_at at time zone 'America/Argentina/Buenos_Aires')::date between p_from and p_to loop
    if r.direction = 'recibido' then
      perform public.acc_post(p_org, (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date, 'Cheque recibido ' || coalesce(r.number, '') || ' ' || coalesce(r.counterpart_name, ''), 'cheque', r.id::text,
        jsonb_build_array(jsonb_build_array('1.1.04', r.amount, 0), jsonb_build_array('1.1.03', 0, r.amount)));
    else
      perform public.acc_post(p_org, (r.created_at at time zone 'America/Argentina/Buenos_Aires')::date, 'Cheque emitido ' || coalesce(r.number, '') || ' ' || coalesce(r.counterpart_name, ''), 'cheque', r.id::text,
        jsonb_build_array(jsonb_build_array('2.1.01', r.amount, 0), jsonb_build_array('2.1.02', 0, r.amount)));
    end if;
  end loop;
  for r in select * from public.cheques where org_id = p_org and direction = 'recibido' and status_date between p_from and p_to
      and (status = 'endosado' or (status = 'rechazado' and bank_movement_id is null)) loop
    perform public.acc_post(p_org, r.status_date,
      case when r.status = 'endosado' then 'Cheque endosado a ' || coalesce(r.endorsed_to, '') else 'Cheque rechazado ' || coalesce(r.counterpart_name, '') end, 'cheque_estado', r.id::text,
      case when r.status = 'endosado' then jsonb_build_array(jsonb_build_array('2.1.01', r.amount, 0), jsonb_build_array('1.1.04', 0, r.amount))
           else jsonb_build_array(jsonb_build_array('1.1.03', r.amount, 0), jsonb_build_array('1.1.04', 0, r.amount)) end);
  end loop;

  -- 5) Ingresos Brutos presentado: impuesto del mes contra pagos a cuenta y lo que queda a pagar
  for r in select * from public.iibb_filings where org_id = p_org and status = 'presentada'
      and (to_date(month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date between p_from and p_to loop
    perform public.acc_post(p_org, (to_date(r.month || '-01', 'YYYY-MM-DD') + interval '1 month - 1 day')::date, 'Ingresos Brutos ' || r.month, 'iibb', r.id::text,
      jsonb_build_array(jsonb_build_array('5.2.06', r.total_tax, 0), jsonb_build_array('1.1.07', 0, greatest(0, r.total_tax - r.total_due)), jsonb_build_array('2.1.04', 0, r.total_due)));
  end loop;

  select count(*) into v_n from public.acc_entries where org_id = p_org and auto and entry_date between p_from and p_to;
  return v_n;
end;
$$;
revoke all on function public.acc_generate(uuid, date, date) from public, anon;
grant execute on function public.acc_generate(uuid, date, date) to authenticated;

-- Saldos por cuenta en un período (para el balance de sumas y saldos)
create or replace function public.acc_trial_balance(p_org uuid, p_from date, p_to date)
returns table (account_code text, debit numeric, credit numeric, opening numeric)
language sql stable security invoker set search_path = '' as $$
  select l.account_code,
    coalesce(sum(l.debit) filter (where e.entry_date between p_from and p_to), 0),
    coalesce(sum(l.credit) filter (where e.entry_date between p_from and p_to), 0),
    coalesce(sum(l.debit - l.credit) filter (where e.entry_date < p_from), 0)
  from public.acc_lines l join public.acc_entries e on e.id = l.entry_id
  where l.org_id = p_org and e.org_id = p_org and e.entry_date <= p_to
  group by l.account_code;
$$;
grant execute on function public.acc_trial_balance(uuid, date, date) to authenticated;
