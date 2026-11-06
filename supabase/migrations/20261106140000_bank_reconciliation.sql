-- =====================================================================
-- Conciliación bancaria (Banco Ciudad): pagos del GCBA ↔ avisos de SIGAF ↔ cobros
-- Sólo se guardan movimientos del negocio (pagos del GCBA y retenciones SIRCREB).
-- =====================================================================
create table public.bank_movements (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  bank             text not null default 'ciudad',
  account          text not null,
  mov_date         date not null,
  detail           text not null,
  amount           numeric(18,2) not null check (amount > 0),
  occurrence       integer not null default 1,
  kind             text not null check (kind in ('gcba', 'sircreb')),
  counterpart_cuit text,
  message_id       text,
  status           text not null default 'pendiente' check (status in ('pendiente', 'sin_avisos', 'faltan_facturas', 'conciliado', 'revisar')),
  status_note      text,
  reconciled_at    timestamptz,
  created_at       timestamptz not null default now(),
  unique (org_id, bank, account, mov_date, detail, amount, occurrence)
);
create index idx_bank_mov_org on public.bank_movements(org_id, mov_date desc);
alter table public.bank_movements enable row level security;
create policy bank_mov_select on public.bank_movements for select to authenticated using (public.is_org_member(org_id));

alter table public.bac_payments add column bank_movement_id uuid references public.bank_movements(id) on delete set null;
create index idx_bac_payments_mov on public.bac_payments(bank_movement_id);

-- Reparte lo acreditado en banco entre los cobros del lote; la diferencia son retenciones
create or replace function public.settle_bank_movement(p_mov uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mov    public.bank_movements;
  v_n      integer;
  v_open   integer;
  v_total  numeric;
  v_acc    numeric := 0;
  v_share  numeric;
  v_i      integer := 0;
  v_c      record;
begin
  select * into v_mov from public.bank_movements where id = p_mov for update;
  if v_mov.id is null or v_mov.kind <> 'gcba' or v_mov.status = 'conciliado' then return v_mov.status; end if;
  select count(*), count(*) filter (where collection_id is null) into v_n, v_open from public.bac_payments where bank_movement_id = p_mov;
  if v_n = 0 then
    update public.bank_movements set status = 'sin_avisos', status_note = 'Sin avisos de "Pago Acreditado" de SIGAF en esas fechas' where id = p_mov;
    return 'sin_avisos';
  end if;
  if v_open > 0 then
    update public.bank_movements set status = 'faltan_facturas', status_note = v_open || ' de ' || v_n || ' facturas sin cargar' where id = p_mov;
    return 'faltan_facturas';
  end if;
  select sum(c.applied_amount) into v_total
    from public.collections c join public.bac_payments p on p.collection_id = c.id
   where p.bank_movement_id = p_mov and c.status = 'confirmado';
  if v_total is null or v_mov.amount > v_total or v_mov.amount < v_total * 0.7 then
    update public.bank_movements set status = 'revisar',
      status_note = 'El banco acreditó ' || v_mov.amount || ' y las facturas suman ' || coalesce(v_total, 0) where id = p_mov;
    return 'revisar';
  end if;
  for v_c in
    select c.id, c.applied_amount from public.collections c join public.bac_payments p on p.collection_id = c.id
     where p.bank_movement_id = p_mov and c.status = 'confirmado' order by c.applied_amount, c.id
  loop
    v_i := v_i + 1;
    v_share := case when v_i = v_n then v_mov.amount - v_acc else round(v_mov.amount * v_c.applied_amount / v_total, 2) end;
    v_acc := v_acc + v_share;
    update public.collections
       set amount_received = v_share, ret_iibb = 0, ret_ganancias = 0, ret_iva = 0, ret_suss = 0,
           ret_otras = v_c.applied_amount - v_share, reference = 'Aviso SIGAF + Banco Ciudad',
           notes = 'Conciliado con Banco Ciudad (' || to_char(v_mov.mov_date, 'DD/MM/YYYY') || '). Retenciones calculadas por diferencia: cargá el detalle si querés separarlas.'
     where id = v_c.id;
  end loop;
  update public.bank_movements set status = 'conciliado', reconciled_at = now(),
    status_note = v_n || ' facturas · retenciones ' || (v_total - v_mov.amount) where id = p_mov;
  return 'conciliado';
end;
$$;
revoke all on function public.settle_bank_movement(uuid) from public, anon, authenticated;

-- Vincula créditos del GCBA con los avisos de pago cercanos y concilia lo que se pueda
create or replace function public.reconcile_bank(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_m    record;
  v_next date;
  v_done integer := 0;
begin
  for v_m in select * from public.bank_movements where org_id = p_org and kind = 'gcba' and status <> 'conciliado' order by mov_date, amount loop
    if not exists (select 1 from public.bac_payments where bank_movement_id = v_m.id) then
      select min(mov_date) into v_next from public.bank_movements
       where org_id = p_org and kind = 'gcba' and mov_date > v_m.mov_date;
      update public.bac_payments set bank_movement_id = v_m.id
       where org_id = p_org and bank_movement_id is null
         and (notified_at at time zone 'America/Argentina/Buenos_Aires')::date
             between v_m.mov_date - 3 and least(v_m.mov_date + 10, coalesce(v_next + 2, v_m.mov_date + 10));
    end if;
    if public.settle_bank_movement(v_m.id) = 'conciliado' then v_done := v_done + 1; end if;
  end loop;
  return v_done;
end;
$$;
revoke all on function public.reconcile_bank(uuid) from public, anon, authenticated;

create or replace function public.ingest_bank_movements(p_token text, p_movs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_m   jsonb;
  v_n   integer := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_movs) <> 'array' or jsonb_array_length(p_movs) > 2000 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for v_m in select * from jsonb_array_elements(p_movs) loop
    continue when coalesce(v_m->>'kind', '') not in ('gcba', 'sircreb')
               or coalesce(v_m->>'mov_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
               or coalesce(v_m->>'amount', '') !~ '^\d{1,15}(\.\d{1,2})?$';
    insert into public.bank_movements (org_id, account, mov_date, detail, amount, occurrence, kind, counterpart_cuit, message_id)
    values (v_org, left(coalesce(v_m->>'account', 'desconocida'), 30), (v_m->>'mov_date')::date, left(v_m->>'detail', 200),
            (v_m->>'amount')::numeric, coalesce((v_m->>'occurrence')::int, 1), v_m->>'kind', left(v_m->>'counterpart_cuit', 20), left(v_m->>'message_id', 200))
    on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return jsonb_build_object('nuevos', v_n, 'conciliados', public.reconcile_bank(v_org));
end;
$$;
revoke all on function public.ingest_bank_movements(text, jsonb) from public;
grant execute on function public.ingest_bank_movements(text, jsonb) to anon, authenticated;

-- Cuando un aviso de pago encuentra su factura, reintenta la conciliación de su lote
create or replace function public.apply_bac_payment(p_payment uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p    public.bac_payments;
  v_inv  public.sales_invoices;
  v_bal  numeric;
  v_col  uuid;
begin
  select * into v_p from public.bac_payments where id = p_payment for update;
  if v_p.id is null or v_p.collection_id is not null then return v_p.collection_id; end if;
  select * into v_inv from public.sales_invoices
   where org_id = v_p.org_id and status = 'emitida' and invoice_type = v_p.invoice_type
     and point_of_sale = v_p.point_of_sale and number = v_p.number
   limit 1;
  if v_inv.id is null then return null; end if;
  select v_inv.total_amount - coalesce(sum(applied_amount), 0) into v_bal
    from public.collections where invoice_id = v_inv.id and status = 'confirmado';
  if v_bal > 0 then
    insert into public.collections (org_id, invoice_id, purchase_order_id, payment_date, amount_received, method, reference, notes)
    values (v_p.org_id, v_inv.id, v_inv.purchase_order_id,
            greatest((v_p.notified_at at time zone 'America/Argentina/Buenos_Aires')::date, v_inv.issue_date),
            v_bal, 'transferencia', 'Aviso SIGAF',
            'Pago acreditado según aviso de SIGAF. El aviso no trae importes: si hubo retenciones, anulá este cobro y cargalo con el detalle.')
    returning id into v_col;
  end if;
  update public.bac_payments set invoice_id = v_inv.id, collection_id = v_col where id = v_p.id;
  if v_p.bank_movement_id is not null and v_col is not null then
    perform public.settle_bank_movement(v_p.bank_movement_id);
  end if;
  return v_col;
end;
$$;
revoke all on function public.apply_bac_payment(uuid) from public, anon, authenticated;

create view public.bank_movements_overview with (security_invoker = true) as
select m.*,
  (select count(*) from public.bac_payments p where p.bank_movement_id = m.id) as payments_count,
  (select string_agg(p.invoice_type || ' ' || p.point_of_sale || '-' || p.number, ', ' order by p.number) from public.bac_payments p where p.bank_movement_id = m.id) as invoices
from public.bank_movements m;
grant select on public.bank_movements_overview to authenticated;
