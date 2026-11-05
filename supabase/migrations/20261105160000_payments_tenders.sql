-- =====================================================================
-- Pagos acreditados (SIGAF) aunque la factura no esté cargada + licitaciones BAC / COMPR.AR
-- =====================================================================

-- Pagos avisados por SIGAF: se toman como cobrados; si falta la factura queda pendiente de documento
create table public.bac_payments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  invoice_type   text not null check (invoice_type in ('A', 'B', 'C', 'M', 'E')),
  point_of_sale  text not null check (point_of_sale ~ '^\d{1,5}$'),
  number         text not null check (number ~ '^\d{1,8}$'),
  invoice_date   date,
  notified_at    timestamptz not null,
  invoice_id     uuid references public.sales_invoices(id) on delete set null,
  collection_id  uuid references public.collections(id) on delete set null,
  created_at     timestamptz not null default now(),
  unique (org_id, invoice_type, point_of_sale, number)
);
create index idx_bac_payments_org on public.bac_payments(org_id, notified_at desc);
alter table public.bac_payments enable row level security;
create policy bac_payments_select on public.bac_payments for select to authenticated using (public.is_org_member(org_id));

-- Registra el cobro de una factura según un aviso de pago (saldo completo). Devuelve el id del cobro o null.
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
  return v_col;
end;
$$;
revoke all on function public.apply_bac_payment(uuid) from public, anon, authenticated;

-- Al cargar una factura que ya figura como pagada, se registra el cobro solo
create or replace function public.tg_invoice_paid_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if new.status = 'emitida' and new.number is not null then
    select id into v_id from public.bac_payments
     where org_id = new.org_id and invoice_type = new.invoice_type and point_of_sale = coalesce(new.point_of_sale, '')
       and number = new.number and collection_id is null;
    if v_id is not null then perform public.apply_bac_payment(v_id); end if;
  end if;
  return null;
end;
$$;
revoke all on function public.tg_invoice_paid_notice() from public, anon, authenticated;
create trigger trg_invoice_paid_notice after insert on public.sales_invoices
  for each row execute function public.tg_invoice_paid_notice();

-- Pagos ya recibidos antes de este cambio
insert into public.bac_payments (org_id, invoice_type, point_of_sale, number, invoice_date, notified_at)
select org_id, upper(data->>'invoice_type'), data->>'point_of_sale', data->>'number', (data->>'invoice_date')::date, received_at
  from public.bac_mail_events where kind = 'pago'
on conflict do nothing;
update public.bac_payments p set invoice_id = c.invoice_id, collection_id = c.id
  from public.collections c join public.sales_invoices i on i.id = c.invoice_id
 where c.reference = 'Aviso SIGAF' and i.org_id = p.org_id and i.invoice_type = p.invoice_type
   and i.point_of_sale = p.point_of_sale and i.number = p.number and p.collection_id is null;

-- Licitaciones: origen (BAC = Ciudad, COMPR.AR = Nación)
alter table public.bac_publications add column source text not null default 'bac' check (source in ('bac', 'comprar'));
alter table public.bac_publications drop constraint bac_publications_org_id_process_number_key;
alter table public.bac_publications add constraint bac_publications_org_source_process_key unique (org_id, source, process_number);
create index idx_bac_pub_source on public.bac_publications(org_id, source, received_at desc);

-- Ingreso: pagos van a bac_payments y publicaciones guardan su origen
create or replace function public.ingest_bac_events(p_token text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org     uuid;
  v_e       jsonb;
  v_d       jsonb;
  v_kind    text;
  v_at      timestamptz;
  v_day     date;
  v_new     integer := 0;
  v_applied integer := 0;
  v_result  text;
  v_id      uuid;
  v_pay     uuid;
  v_col     uuid;
  v_oc      text;
  v_src     text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception 'Token inválido' using errcode = '28000';
  end if;
  select org_id into v_org from public.inbound_tokens
   where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 500 then
    raise exception 'Formato inválido' using errcode = '22023';
  end if;

  for v_e in select * from jsonb_array_elements(p_events) loop
    v_id := null;
    v_kind := v_e->>'kind';
    v_d := coalesce(v_e->'data', '{}'::jsonb);
    v_at := coalesce((v_e->>'received_at')::timestamptz, now());
    v_day := (v_at at time zone 'America/Argentina/Buenos_Aires')::date;
    v_result := null;
    if v_kind not in ('oc_generada', 'oc_perfeccionada', 'prd', 'pago', 'publicacion')
       or coalesce(v_e->>'message_id', '') = '' then
      continue;
    end if;

    insert into public.bac_mail_events (org_id, message_id, kind, received_at, subject, data)
    values (v_org, left(v_e->>'message_id', 200), v_kind, v_at, left(v_e->>'subject', 300), v_d)
    on conflict (org_id, message_id, kind) do nothing
    returning id into v_id;
    if v_id is null then continue; end if;
    v_new := v_new + 1;

    v_oc := upper(v_d->>'bac_number');
    if v_kind in ('oc_generada', 'oc_perfeccionada', 'prd') and (v_oc is null or v_oc !~ '^\d{2,5}-\d{3,7}-OC\d{2}$') then
      update public.bac_mail_events set result = 'número de OC inválido' where id = v_id;
      continue;
    end if;

    if v_kind = 'oc_generada' then
      insert into public.bac_orders_inbox (org_id, bac_number, convenio_number, convenio_name, notified_at)
      values (v_org, v_oc, left(v_d->>'convenio_number', 40), left(v_d->>'convenio_name', 300), v_at)
      on conflict (org_id, bac_number) do update set
        convenio_number = coalesce(excluded.convenio_number, public.bac_orders_inbox.convenio_number),
        convenio_name = coalesce(excluded.convenio_name, public.bac_orders_inbox.convenio_name),
        notified_at = least(coalesce(public.bac_orders_inbox.notified_at, excluded.notified_at), excluded.notified_at);
      v_result := 'orden avisada';

    elsif v_kind = 'oc_perfeccionada' then
      insert into public.bac_orders_inbox (org_id, bac_number, process_number, process_name, perfected_at)
      values (v_org, v_oc, left(v_d->>'process_number', 40), left(v_d->>'process_name', 300), v_at)
      on conflict (org_id, bac_number) do update set
        process_number = coalesce(excluded.process_number, public.bac_orders_inbox.process_number),
        process_name = coalesce(excluded.process_name, public.bac_orders_inbox.process_name),
        perfected_at = coalesce(public.bac_orders_inbox.perfected_at, excluded.perfected_at);
      perform set_config('app.status_reason', 'Aviso de BAC: perfeccionamiento', true);
      update public.purchase_orders
         set perfected_date = coalesce(perfected_date, v_day),
             status = case when status in ('borrador', 'recibida') then 'perfeccionada'::public.po_status else status end
       where org_id = v_org and upper(bac_number) = v_oc;
      v_result := case when found then 'orden perfeccionada' else 'perfeccionamiento guardado (orden sin cargar)' end;
      if found then v_applied := v_applied + 1; end if;

    elsif v_kind = 'prd' then
      insert into public.bac_orders_inbox (org_id, bac_number, prd_number, prd_at)
      values (v_org, v_oc, left(v_d->>'prd_number', 40), v_at)
      on conflict (org_id, bac_number) do update set
        prd_number = coalesce(public.bac_orders_inbox.prd_number, excluded.prd_number),
        prd_at = coalesce(public.bac_orders_inbox.prd_at, excluded.prd_at);
      v_result := 'PRD registrado';

    elsif v_kind = 'pago' then
      if coalesce(v_d->>'invoice_type', '') !~ '^[ABCME]$' or coalesce(v_d->>'point_of_sale', '') !~ '^\d{1,5}$' or coalesce(v_d->>'number', '') !~ '^\d{1,8}$' then
        v_result := 'factura inválida';
      else
        insert into public.bac_payments (org_id, invoice_type, point_of_sale, number, invoice_date, notified_at)
        values (v_org, v_d->>'invoice_type', v_d->>'point_of_sale', v_d->>'number', (v_d->>'invoice_date')::date, v_at)
        on conflict (org_id, invoice_type, point_of_sale, number) do update set notified_at = least(public.bac_payments.notified_at, excluded.notified_at)
        returning id into v_pay;
        v_col := public.apply_bac_payment(v_pay);
        if v_col is not null then
          v_result := 'cobro registrado';
          v_applied := v_applied + 1;
        elsif exists (select 1 from public.bac_payments where id = v_pay and invoice_id is not null) then
          v_result := 'factura ya cobrada';
        else
          v_result := 'cobrado · falta subir la factura';
        end if;
      end if;

    elsif v_kind = 'publicacion' then
      v_src := case when v_d->>'source' = 'comprar' then 'comprar' else 'bac' end;
      if v_src = 'bac' and coalesce(v_d->>'unit_code', '') ~ '^\d{2,5}$' and coalesce(v_d->>'unit_name', '') <> '' then
        insert into public.bac_units (org_id, code, name) values (v_org, v_d->>'unit_code', left(v_d->>'unit_name', 200))
        on conflict (org_id, code) do update set name = excluded.name, updated_at = now();
      end if;
      insert into public.bac_publications (org_id, source, process_number, unit_code, unit_name, title, opening_date, received_at)
      values (v_org, v_src, left(upper(v_d->>'process_number'), 40), left(v_d->>'unit_code', 20), left(v_d->>'unit_name', 200), left(v_d->>'title', 300),
              (v_d->>'opening_date')::date, v_at)
      on conflict (org_id, source, process_number) do update set
        title = coalesce(public.bac_publications.title, excluded.title),
        unit_name = coalesce(public.bac_publications.unit_name, excluded.unit_name);
      v_result := 'publicación';
    end if;

    update public.bac_mail_events set result = v_result where id = v_id;
  end loop;

  update public.inbound_tokens set last_used_at = now(), last_received = jsonb_array_length(p_events), total_events = total_events + v_new
   where org_id = v_org;
  return jsonb_build_object('recibidos', jsonb_array_length(p_events), 'nuevos', v_new, 'aplicados', v_applied);
end;
$$;
revoke all on function public.ingest_bac_events(text, jsonb) from public;
grant execute on function public.ingest_bac_events(text, jsonb) to anon, authenticated;

-- Vista de pagos con la factura y la orden vinculadas
create view public.bac_payments_overview with (security_invoker = true) as
select p.*, i.purchase_order_id, i.total_amount, (p.collection_id is not null or p.invoice_id is not null) as invoice_loaded
from public.bac_payments p
left join public.sales_invoices i on i.id = p.invoice_id;
grant select on public.bac_payments_overview to authenticated;
