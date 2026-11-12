-- =====================================================================
-- Banco completo: todos los movimientos del aviso diario (no sólo GCBA/SIRCREB), saldo de cada aviso,
-- entrada/salida (por tipo, por regla aprendida o deducida de la diferencia de saldo entre avisos),
-- cobros de privados cruzados con facturas emitidas y pagos cruzados con facturas de proveedores.
-- =====================================================================
alter table public.bank_movements drop constraint if exists bank_movements_kind_check;
alter table public.bank_movements add constraint bank_movements_kind_check check (kind in (
  'gcba', 'sircreb', 'pago_recibido', 'transferencia', 'deposito', 'cheque_depositado', 'cheque_pagado', 'cheque_rechazado',
  'compra', 'debito_automatico', 'extraccion', 'imp_cheque', 'comision', 'iva_banco', 'interes_descubierto', 'interes_ganado',
  'plazo_fijo_constitucion', 'plazo_fijo_acreditacion', 'devolucion', 'embargo', 'otro'));
alter table public.bank_movements add column if not exists direction text check (direction in ('in', 'out'));
alter table public.bank_movements add column if not exists direction_source text check (direction_source in ('tipo', 'regla', 'saldo', 'usuario'));
alter table public.bank_movements add column if not exists counterpart_name text;
alter table public.bank_movements add column if not exists cbu text;
alter table public.bank_movements add column if not exists first_seen_at timestamptz;
update public.bank_movements set direction = case when kind = 'gcba' then 'in' else 'out' end, direction_source = 'tipo' where direction is null;

create table public.bank_balances (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  bank       text not null default 'ciudad',
  account    text not null,
  message_id text not null,
  as_of      timestamptz not null,
  balance    numeric(18,2) not null,
  primary key (org_id, message_id)
);
create index idx_bank_balances_acc on public.bank_balances(org_id, account, as_of);
alter table public.bank_balances enable row level security;
create policy bank_balances_read on public.bank_balances for select to authenticated using (public.is_org_member(org_id));
grant select on public.bank_balances to authenticated;

-- Entrada/salida aprendida por contraparte (CUIT, CBU o nombre)
create table public.bank_direction_rules (
  org_id    uuid not null references public.organizations(id) on delete cascade,
  key       text not null,
  direction text not null check (direction in ('in', 'out')),
  created_at timestamptz not null default now(),
  primary key (org_id, key)
);
alter table public.bank_direction_rules enable row level security;
create policy bank_rules_read on public.bank_direction_rules for select to authenticated using (public.is_org_member(org_id));
grant select on public.bank_direction_rules to authenticated;

create table public.bank_supplier_matches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  bank_movement_id uuid not null references public.bank_movements(id) on delete cascade,
  arca_voucher_id  uuid not null references public.arca_vouchers(id) on delete cascade,
  method           text not null default 'monto',
  created_at       timestamptz not null default now(),
  unique (arca_voucher_id)
);
create index idx_bank_sup_mov on public.bank_supplier_matches(bank_movement_id);
alter table public.bank_supplier_matches enable row level security;
create policy bank_sup_read on public.bank_supplier_matches for select to authenticated using (public.is_org_member(org_id));
grant select on public.bank_supplier_matches to authenticated;

create or replace function public.bank_rule_key(m public.bank_movements)
returns text language sql immutable set search_path = '' as $$
  select coalesce(case when m.cbu is not null then 'cbu:' || m.cbu end, case when m.counterpart_cuit is not null then 'cuit:' || m.counterpart_cuit end,
                  case when m.counterpart_name is not null then 'name:' || lower(m.counterpart_name) end)
$$;

-- Deduce entradas/salidas: reglas aprendidas, y diferencia de saldo entre un aviso y el anterior
-- (sólo si hay una única combinación de signos que cierra al centavo).
create or replace function public.bank_solve_directions(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
  v_prev numeric;
  v_known numeric;
  v_ids uuid[];
  v_amts numeric[];
  v_n integer;
  v_mask integer;
  v_sum numeric;
  v_sol integer;
  v_cnt integer;
  v_fixed integer := 0;
begin
  update public.bank_movements m set direction = r.direction, direction_source = 'regla'
  from public.bank_direction_rules r
  where m.org_id = p_org and r.org_id = p_org and m.direction is null and r.key = public.bank_rule_key(m);
  get diagnostics v_fixed = row_count;

  for b in select * from public.bank_balances where org_id = p_org order by account, as_of loop
    select balance into v_prev from public.bank_balances
    where org_id = p_org and account = b.account and as_of < b.as_of order by as_of desc limit 1;
    continue when v_prev is null;
    select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_known
    from public.bank_movements where org_id = p_org and message_id = b.message_id and direction is not null;
    select array_agg(id order by amount desc), array_agg(amount order by amount desc) into v_ids, v_amts
    from public.bank_movements where org_id = p_org and message_id = b.message_id and direction is null;
    v_n := coalesce(array_length(v_ids, 1), 0);
    continue when v_n = 0 or v_n > 16;
    v_cnt := 0; v_sol := null;
    for v_mask in 0 .. (1 << v_n) - 1 loop
      v_sum := v_known;
      for i in 1 .. v_n loop
        v_sum := v_sum + case when (v_mask >> (i - 1)) & 1 = 1 then v_amts[i] else -v_amts[i] end;
      end loop;
      if abs(v_sum - (b.balance - v_prev)) <= 0.01 then
        v_cnt := v_cnt + 1; v_sol := v_mask;
        exit when v_cnt > 1;
      end if;
    end loop;
    if v_cnt = 1 then
      for i in 1 .. v_n loop
        update public.bank_movements set direction = case when (v_sol >> (i - 1)) & 1 = 1 then 'in' else 'out' end, direction_source = 'saldo'
        where id = v_ids[i];
      end loop;
      v_fixed := v_fixed + v_n;
    end if;
  end loop;
  return v_fixed;
end;
$$;
revoke all on function public.bank_solve_directions(uuid) from public, anon, authenticated;

-- Cobros que no son del GCBA (transferencias, depósitos, cheques) → factura emitida por el mismo total
create or replace function public.bank_match_others(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare d record; v uuid; c integer; n integer := 0;
begin
  for d in select * from public.bank_movements b where b.org_id = p_org and b.direction = 'in'
             and b.kind in ('transferencia', 'pago_recibido', 'deposito', 'cheque_depositado')
             and not exists (select 1 from public.bank_matches m where m.bank_movement_id = b.id)
             and coalesce(b.counterpart_cuit, '') <> coalesce((select cuit from public.arca_connection where org_id = p_org), '-')
  loop
    select count(*), min(x.id::text)::uuid into c, v from public.arca_vouchers x
    where x.org_id = p_org and x.direction = 'emitido' and not x.credit_note and abs(x.total - d.amount) <= 1
      and x.issue_date between d.mov_date - 180 and d.mov_date
      and (d.counterpart_cuit is null or x.doc_number = d.counterpart_cuit)
      and not exists (select 1 from public.bank_matches m where m.arca_voucher_id = x.id);
    if c = 1 then
      insert into public.bank_matches (org_id, bank_movement_id, arca_voucher_id, invoice_total, method)
      select p_org, d.id, x.id, x.total, 'monto' from public.arca_vouchers x where x.id = v on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  -- Pagos a proveedores: salida al CUIT del proveedor por el total de una factura recibida
  for d in select * from public.bank_movements b where b.org_id = p_org and b.direction = 'out' and b.counterpart_cuit is not null
             and b.kind in ('transferencia', 'cheque_pagado', 'debito_automatico')
             and not exists (select 1 from public.bank_supplier_matches m where m.bank_movement_id = b.id)
  loop
    select x.id into v from public.arca_vouchers x
    where x.org_id = p_org and x.direction = 'recibido' and not x.credit_note and x.doc_number = d.counterpart_cuit and abs(x.total - d.amount) <= 1
      and x.issue_date between d.mov_date - 120 and d.mov_date + 5
      and not exists (select 1 from public.bank_supplier_matches m where m.arca_voucher_id = x.id)
    order by x.issue_date limit 1;
    if v is not null then
      insert into public.bank_supplier_matches (org_id, bank_movement_id, arca_voucher_id) values (p_org, d.id, v) on conflict do nothing;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.bank_match_others(uuid) from public, anon, authenticated;

create or replace function public.tg_bank_match_gcba()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select distinct org_id from new_rows loop
    perform public.bank_match_gcba(o);
    perform public.bank_match_others(o);
  end loop;
  return null;
end;
$$;

-- Ingreso de movimientos v2: todos los tipos + saldo del aviso
drop function if exists public.ingest_bank_movements(text, jsonb);
create or replace function public.ingest_bank_movements(p_token text, p_movs jsonb, p_balances jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_m   jsonb;
  v_n   integer := 0;
  v_seen timestamptz;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_movs) <> 'array' or jsonb_array_length(p_movs) > 3000 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for v_m in select * from jsonb_array_elements(p_movs) loop
    continue when coalesce(v_m->>'mov_date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(v_m->>'amount', '') !~ '^\d{1,15}(\.\d{1,2})?$'
      or (v_m->>'amount')::numeric <= 0;
    v_seen := case when v_m->>'seen_at' ~ '^\d{4}-\d{2}-\d{2}' then (v_m->>'seen_at')::timestamptz else now() end;
    insert into public.bank_movements (org_id, account, mov_date, detail, amount, occurrence, kind, counterpart_cuit, message_id,
      direction, direction_source, counterpart_name, cbu, first_seen_at)
    values (v_org, left(coalesce(v_m->>'account', 'desconocida'), 30), (v_m->>'mov_date')::date, left(v_m->>'detail', 200),
      (v_m->>'amount')::numeric, coalesce((v_m->>'occurrence')::int, 1),
      case when v_m->>'kind' in ('gcba', 'sircreb', 'pago_recibido', 'transferencia', 'deposito', 'cheque_depositado', 'cheque_pagado', 'cheque_rechazado',
        'compra', 'debito_automatico', 'extraccion', 'imp_cheque', 'comision', 'iva_banco', 'interes_descubierto', 'interes_ganado',
        'plazo_fijo_constitucion', 'plazo_fijo_acreditacion', 'devolucion', 'embargo') then v_m->>'kind' else 'otro' end,
      left(v_m->>'counterpart_cuit', 20), left(v_m->>'message_id', 200),
      case when v_m->>'direction' in ('in', 'out') then v_m->>'direction' end, case when v_m->>'direction' in ('in', 'out') then 'tipo' end,
      left(v_m->>'counterpart_name', 80), left(v_m->>'cbu', 22), v_seen)
    on conflict (org_id, bank, account, mov_date, detail, amount, occurrence) do update set
      -- el movimiento queda asociado al primer aviso que lo trajo (para deducir con la diferencia de saldo)
      message_id = case when excluded.first_seen_at < coalesce(public.bank_movements.first_seen_at, 'infinity') then excluded.message_id else public.bank_movements.message_id end,
      first_seen_at = least(excluded.first_seen_at, coalesce(public.bank_movements.first_seen_at, 'infinity')),
      kind = case when public.bank_movements.kind in ('gcba', 'sircreb') then public.bank_movements.kind else excluded.kind end,
      counterpart_name = coalesce(public.bank_movements.counterpart_name, excluded.counterpart_name),
      cbu = coalesce(public.bank_movements.cbu, excluded.cbu),
      direction = coalesce(public.bank_movements.direction, excluded.direction),
      direction_source = coalesce(public.bank_movements.direction_source, excluded.direction_source);
    if found then v_n := v_n + 1; end if;
  end loop;
  insert into public.bank_balances (org_id, account, message_id, as_of, balance)
  select v_org, left(x->>'account', 30), left(x->>'message_id', 200), (x->>'as_of')::timestamptz, (x->>'balance')::numeric
  from jsonb_array_elements(coalesce(p_balances, '[]'::jsonb)) x
  where x->>'balance' ~ '^-?\d{1,15}(\.\d{1,2})?$' and x->>'as_of' ~ '^\d{4}-\d{2}-\d{2}'
  on conflict do nothing;
  perform public.bank_solve_directions(v_org);
  perform public.bank_match_others(v_org);
  return jsonb_build_object('nuevos', v_n, 'conciliados', public.reconcile_bank(v_org));
end;
$$;
revoke all on function public.ingest_bank_movements(text, jsonb, jsonb) from public;
grant execute on function public.ingest_bank_movements(text, jsonb, jsonb) to anon, authenticated;

-- El usuario marca entrada/salida (y queda la regla para esa contraparte)
create or replace function public.bank_set_direction(p_org uuid, p_movement uuid, p_direction text, p_learn boolean default true)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare m public.bank_movements; k text; n integer;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_direction not in ('in', 'out') then raise exception 'Dirección inválida'; end if;
  select * into m from public.bank_movements where id = p_movement and org_id = p_org;
  if m.id is null then raise exception 'Movimiento inexistente'; end if;
  update public.bank_movements set direction = p_direction, direction_source = 'usuario' where id = m.id;
  k := public.bank_rule_key(m);
  if p_learn and k is not null then
    insert into public.bank_direction_rules (org_id, key, direction) values (p_org, k, p_direction)
    on conflict (org_id, key) do update set direction = excluded.direction;
  end if;
  n := public.bank_solve_directions(p_org);
  perform public.bank_match_others(p_org);
  return n + 1;
end;
$$;
revoke all on function public.bank_set_direction(uuid, uuid, text, boolean) from public, anon;
grant execute on function public.bank_set_direction(uuid, uuid, text, boolean) to authenticated;

-- Movimientos con lo que explican (factura cobrada / factura de proveedor pagada)
drop view if exists public.bank_movements_overview;
create view public.bank_movements_overview with (security_invoker = true) as
select b.*,
  (select count(*) from public.bac_payments p where p.bank_movement_id = b.id) as payments_count,
  (select string_agg(p.invoice_type || ' ' || p.point_of_sale || '-' || p.number, ', ' order by p.number) from public.bac_payments p where p.bank_movement_id = b.id) as invoices,
  (select string_agg(coalesce(v.name, '') || ' ' || lpad(v.point_of_sale::text, 5, '0') || '-' || lpad(v.number::text, 8, '0'), ', ')
     from public.bank_matches m join public.arca_vouchers v on v.id = m.arca_voucher_id where m.bank_movement_id = b.id) as invoice_paid,
  (select string_agg(coalesce(v.name, '') || ' ' || lpad(v.point_of_sale::text, 5, '0') || '-' || lpad(v.number::text, 8, '0'), ', ')
     from public.bank_supplier_matches m join public.arca_vouchers v on v.id = m.arca_voucher_id where m.bank_movement_id = b.id) as supplier_invoice,
  (b.kind in ('compra', 'imp_cheque', 'comision', 'iva_banco', 'sircreb', 'interes_descubierto', 'interes_ganado', 'debito_automatico', 'extraccion',
              'plazo_fijo_constitucion', 'plazo_fijo_acreditacion')
   or exists (select 1 from public.bank_matches m where m.bank_movement_id = b.id)
   or exists (select 1 from public.bank_supplier_matches m where m.bank_movement_id = b.id)) as explained
from public.bank_movements b;
grant select on public.bank_movements_overview to authenticated;

-- Impuesto al cheque (Ley 25.413) por mes: lo de créditos es 33% computable a cuenta de Ganancias
create or replace view public.tax_withholdings_monthly with (security_invoker = true) as
select org_id, month,
  sum(ret_iibb) ret_iibb, sum(ret_ganancias) ret_ganancias, sum(ret_iva) ret_iva, sum(ret_suss) ret_suss, sum(ret_otras) ret_otras,
  sum(sircreb) sircreb, sum(percepciones) percepciones, sum(imp_cheque) imp_cheque, sum(imp_cheque_cred) imp_cheque_cred, sum(creditos) creditos
from (
  select org_id, to_char(payment_date, 'YYYY-MM') as month, ret_iibb, ret_ganancias, ret_iva, ret_suss, ret_otras, 0::numeric sircreb, 0::numeric percepciones,
    0::numeric imp_cheque, 0::numeric imp_cheque_cred, 0::numeric creditos
  from public.collections where status = 'confirmado'
  union all
  select m.org_id, to_char(b.mov_date, 'YYYY-MM'), m.ret_iibb, m.ret_ganancias, 0, 0, 0, 0, 0, 0, 0, 0
  from public.bank_matches m join public.bank_movements b on b.id = m.bank_movement_id
  union all
  select org_id, to_char(mov_date, 'YYYY-MM'), 0, 0, 0, 0, 0,
    case when kind = 'sircreb' then amount else 0 end, 0,
    case when kind = 'imp_cheque' then amount else 0 end,
    case when kind = 'imp_cheque' and detail ~* 'CRED|S/CR' then amount else 0 end,
    case when direction = 'in' then amount else 0 end
  from public.bank_movements where kind in ('sircreb', 'imp_cheque') or direction = 'in'
  union all
  select org_id, to_char(issue_date, 'YYYY-MM'), 0, 0, 0, 0, 0, 0, (case when credit_note then -1 else 1 end) * other_taxes * coalesce(exchange_rate, 1), 0, 0, 0
  from public.arca_vouchers where direction = 'recibido' and other_taxes <> 0
) t
group by org_id, month;
grant select on public.tax_withholdings_monthly to authenticated;

-- Configuración: inflación para proyecciones/alertas de gastos, alícuota SIRCREB del padrón
alter table public.tax_settings add column if not exists inflation_monthly numeric(6,3) not null default 2.5;
alter table public.tax_settings add column if not exists cost_alert_pct numeric(6,3) not null default 10;
alter table public.tax_settings add column if not exists sircreb_rate numeric(6,3);
create or replace function public.tax_settings_extra(p_org uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  insert into public.tax_settings (org_id) values (p_org) on conflict do nothing;
  update public.tax_settings set
    inflation_monthly = coalesce((p->>'inflation_monthly')::numeric, inflation_monthly),
    cost_alert_pct = coalesce((p->>'cost_alert_pct')::numeric, cost_alert_pct),
    sircreb_rate = case when p ? 'sircreb_rate' then nullif(p->>'sircreb_rate', '')::numeric else sircreb_rate end,
    updated_at = now()
  where org_id = p_org;
end;
$$;
revoke all on function public.tax_settings_extra(uuid, jsonb) from public, anon;
grant execute on function public.tax_settings_extra(uuid, jsonb) to authenticated;

-- Gastos fijos: personal / negocio
alter table public.fixed_costs add column if not exists is_personal boolean not null default false;

-- Intentos de factura rechazados por ARCA (para avisar)
create table public.einvoice_attempts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  kind       text not null,
  receiver   text,
  total      numeric(18,2),
  error      text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.einvoice_attempts enable row level security;
create policy einvoice_attempts_read on public.einvoice_attempts for select to authenticated using (public.is_org_member(org_id));
create policy einvoice_attempts_insert on public.einvoice_attempts for insert to authenticated with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));
grant select, insert on public.einvoice_attempts to authenticated;

select public.bank_solve_directions(id), public.bank_match_others(id) from public.organizations;

-- Débitos de tarjeta que no se cubrieron (Mercado Pago "Solo pudimos debitar una parte")
create table public.card_alerts (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  message_id text not null,
  at         timestamptz not null,
  card       text not null,
  debited    numeric(18,2),
  missing    numeric(18,2) not null,
  primary key (org_id, message_id)
);
alter table public.card_alerts enable row level security;
create policy card_alerts_read on public.card_alerts for select to authenticated using (public.is_org_member(org_id));
grant select on public.card_alerts to authenticated;

create or replace function public.ingest_card_alerts(p_token text, p_alerts jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; n integer;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_alerts) <> 'array' or jsonb_array_length(p_alerts) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.card_alerts (org_id, message_id, at, card, debited, missing)
  select v_org, left(x->>'message_id', 200), (x->>'at')::timestamptz, left(x->>'card', 80),
    case when x->>'debited' ~ '^\d{1,15}(\.\d{1,2})?$' then (x->>'debited')::numeric end, (x->>'missing')::numeric
  from jsonb_array_elements(p_alerts) x
  where x->>'missing' ~ '^\d{1,15}(\.\d{1,2})?$' and x->>'at' ~ '^\d{4}-\d{2}-\d{2}'
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.ingest_card_alerts(text, jsonb) from public;
grant execute on function public.ingest_card_alerts(text, jsonb) to anon, authenticated;
