-- =====================================================================
-- Triangulación BAC ↔ ARCA ↔ mail ↔ banco
--  · Comprobantes "emitidos" que en realidad son recibidos (archivo de ARCA subido en el lugar equivocado):
--    ya no cuentan como facturado ni bloquean la carga de facturas de proveedores.
--  · Factura emitida ↔ OC (vínculo automático), con PRD, aviso de pago del SIGAF y depósito del banco.
--  · Facturas de proveedores del mail ↔ "Mis Comprobantes Recibidos".
--  · IIBB por jurisdicción, límite anual de facturación, padrón de proveedores y base de apócrifos.
--  · Correos de organismos: reclamos, pedidos de entrega, conformidades y sin responder.
--  · Cambio de datos bancarios de proveedores.
--  · Facturas de servicios (ARCA) cargadas solas en Gastos fijos.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Emitido duplicado de un recibido = no es nuestro
-- ---------------------------------------------------------------------
create or replace function public.arca_is_misfiled(p_org uuid, p_type integer, p_pv integer, p_num bigint, p_doc text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.arca_vouchers r where r.org_id = p_org and r.direction = 'recibido'
                   and r.voucher_type = p_type and r.point_of_sale = p_pv and r.number = p_num and r.doc_number = p_doc)
$$;
revoke all on function public.arca_is_misfiled(uuid, integer, integer, bigint, text) from public, anon;
grant execute on function public.arca_is_misfiled(uuid, integer, integer, bigint, text) to authenticated;

do $$
declare d text;
begin
  -- Facturas de proveedores: "propia" sólo si el emitido no es la copia de un recibido
  d := pg_get_functiondef('public.store_supplier_invoice(uuid,jsonb,text,uuid)'::regprocedure);
  d := replace(d, $x$and (v_total is null or abs(v.total - v_total) <= 2)) then
    return 'salteada:propia';$x$, $x$and (v_total is null or abs(v.total - v_total) <= 2)
             and not public.arca_is_misfiled(p_org, v.voucher_type, v.point_of_sale, v.number, v.doc_number)) then
    return 'salteada:propia';$x$);
  if d not like '%arca_is_misfiled%' then raise exception 'store_supplier_invoice: no se pudo aplicar el cambio'; end if;
  execute d;

  -- Resumen del mes: el facturado de ARCA sin esos duplicados
  d := pg_get_functiondef('public.month_stages(uuid,date,text)'::regprocedure);
  d := replace(d, $x$where v.org_id = p_org and v.direction = 'emitido' and v.sales_invoice_id is null$x$,
                  $x$where v.org_id = p_org and v.direction = 'emitido' and v.sales_invoice_id is null
         and not public.arca_is_misfiled(v.org_id, v.voucher_type, v.point_of_sale, v.number, v.doc_number)$x$);
  if d not like '%arca_is_misfiled%' then raise exception 'month_stages: no se pudo aplicar el cambio'; end if;
  execute d;
end $$;

-- ---------------------------------------------------------------------
-- 1) Factura emitida ↔ OC
-- ---------------------------------------------------------------------
create table if not exists public.arca_po_links (
  arca_voucher_id   uuid primary key references public.arca_vouchers(id) on delete cascade,
  org_id            uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  source            text not null default 'auto' check (source in ('auto', 'manual')),
  created_at        timestamptz not null default now()
);
create index if not exists idx_arca_po_links_po on public.arca_po_links(purchase_order_id);
alter table public.arca_po_links enable row level security;
create policy arca_po_links_select on public.arca_po_links for select to authenticated using (public.is_org_member(org_id));

-- Une cada factura emitida (no vinculada) con la OC del mismo organismo cuyo total (o saldo sin facturar)
-- coincide, emitida después de la OC y dentro de los 6 meses. Sólo si hay una única candidata.
create or replace function public.arca_autolink(p_org uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v record; v_po uuid; v_n integer := 0; v_cnt integer;
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  for v in
    select a.id, a.issue_date, a.doc_number, a.total * a.exchange_rate as total
      from public.arca_vouchers a
     where a.org_id = p_org and a.direction = 'emitido' and not a.credit_note and a.issue_date >= current_date - 365
       and not exists (select 1 from public.arca_po_links l where l.arca_voucher_id = a.id)
       and not exists (select 1 from public.sales_invoices si where si.id = a.sales_invoice_id and si.purchase_order_id is not null)
       and not public.arca_is_misfiled(a.org_id, a.voucher_type, a.point_of_sale, a.number, a.doc_number)
  loop
    select count(*), min(po.id::text)::uuid into v_cnt, v_po
      from public.purchase_orders po
      left join public.customers c on c.id = po.customer_id
     where po.org_id = p_org and po.status not in ('anulada', 'borrador')
       and v.issue_date between coalesce(po.issue_date, po.created_at::date) and coalesce(po.issue_date, po.created_at::date) + 180
       and (regexp_replace(coalesce(c.cuit, ''), '\D', '', 'g') = v.doc_number
            or (coalesce(c.cuit, '') = '' and v.doc_number = '34999032089'))
       and (abs(coalesce(po.total_amount, 0) - v.total) <= 1
            or abs(coalesce(po.total_amount, 0) - coalesce((select sum(x.total * x.exchange_rate) from public.arca_po_links l
                                                              join public.arca_vouchers x on x.id = l.arca_voucher_id
                                                             where l.purchase_order_id = po.id), 0) - v.total) <= 1);
    if v_cnt = 1 then
      insert into public.arca_po_links (arca_voucher_id, org_id, purchase_order_id) values (v.id, p_org, v_po) on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.arca_autolink(uuid) from public, anon;
grant execute on function public.arca_autolink(uuid) to authenticated;

create or replace function public.arca_po_link_set(p_org uuid, p_voucher uuid, p_po uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_po is null then delete from public.arca_po_links where org_id = p_org and arca_voucher_id = p_voucher; return; end if;
  if not exists (select 1 from public.arca_vouchers where id = p_voucher and org_id = p_org and direction = 'emitido')
     or not exists (select 1 from public.purchase_orders where id = p_po and org_id = p_org) then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  insert into public.arca_po_links (arca_voucher_id, org_id, purchase_order_id, source) values (p_voucher, p_org, p_po, 'manual')
  on conflict (arca_voucher_id) do update set purchase_order_id = excluded.purchase_order_id, source = 'manual';
end;
$$;
revoke all on function public.arca_po_link_set(uuid, uuid, uuid) from public, anon;
grant execute on function public.arca_po_link_set(uuid, uuid, uuid) to authenticated;

-- Circuito de cada factura emitida: OC → PRD → aviso de pago del SIGAF → depósito en el banco
create or replace view public.invoice_circuit with (security_invoker = true) as
select v.id, v.org_id, v.issue_date, v.voucher_type, v.point_of_sale, v.number, v.name, v.doc_number, v.total,
  po.id as purchase_order_id, coalesce(po.bac_number, po.display_number) as po_number, po.total_amount as po_total,
  case when si.purchase_order_id is not null then 'factura' when l.source is not null then l.source end as link_source,
  ib.prd_number, ib.prd_at::date as prd_at, ib.perfected_at::date as perfected_at,
  ic.sigaf_notified, ic.paid_on, ic.deposit_amount, ic.ret_iibb, ic.ret_ganancias, ic.days_to_pay,
  case
    when ic.paid_on is not null then 'cobrada'
    when ic.sigaf_notified is not null then 'pago_avisado'
    when ib.prd_number is not null then 'con_prd'
    when po.id is not null then 'sin_prd'
    else 'sin_oc' end as stage
from public.arca_vouchers v
left join public.sales_invoices si on si.id = v.sales_invoice_id
left join public.arca_po_links l on l.arca_voucher_id = v.id
left join public.purchase_orders_overview po on po.id = coalesce(si.purchase_order_id, l.purchase_order_id)
left join public.bac_orders_inbox ib on ib.org_id = v.org_id and ib.bac_number = upper(po.bac_number)
left join public.invoice_collections ic on ic.id = v.id
where v.direction = 'emitido' and not v.credit_note
  and not public.arca_is_misfiled(v.org_id, v.voucher_type, v.point_of_sale, v.number, v.doc_number);
grant select on public.invoice_circuit to authenticated;

-- ---------------------------------------------------------------------
-- 2) Facturas de proveedores del mail ↔ Mis Comprobantes Recibidos
-- ---------------------------------------------------------------------
create or replace view public.purchase_arca_check with (security_invoker = true) as
select s.org_id, 'mail'::text as side, s.id, s.issue_date, s.supplier_cuit as cuit, s.supplier_name as name,
  s.point_of_sale, s.number, s.total, s.arca_voucher_id is not null as matched, s.mail_subject as detail
from public.supplier_invoices s
where not s.hidden and s.source = 'mail' and s.kind = 'factura'
union all
select v.org_id, 'arca', v.id, v.issue_date, v.doc_number, v.name, v.point_of_sale, v.number, v.total * v.exchange_rate, false,
  public.arca_letter(v.voucher_type)
from public.arca_vouchers v
where v.direction = 'recibido' and not v.credit_note and v.voucher_type in (1, 6, 11, 51, 201, 206, 211)
  and not exists (select 1 from public.supplier_invoices s where s.arca_voucher_id = v.id)
  -- sólo proveedores que ya mandaron alguna factura por mail (los demás suelen ser servicios, peajes, etc.)
  and exists (select 1 from public.supplier_invoices s where s.org_id = v.org_id and s.supplier_cuit = v.doc_number and s.source = 'mail');
grant select on public.purchase_arca_check to authenticated;

-- ---------------------------------------------------------------------
-- 3) IIBB por jurisdicción y límite anual
-- ---------------------------------------------------------------------
create table if not exists public.customer_jurisdictions (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  doc_number   text not null check (doc_number ~ '^\d{11}$'),
  jurisdiction text not null check (length(jurisdiction) between 2 and 60),
  updated_at   timestamptz not null default now(),
  primary key (org_id, doc_number)
);
alter table public.customer_jurisdictions enable row level security;
create policy customer_jurisdictions_select on public.customer_jurisdictions for select to authenticated using (public.is_org_member(org_id));
create policy customer_jurisdictions_write on public.customer_jurisdictions for all to authenticated
  using (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','finanzas']::public.app_role[]));

alter table public.tax_settings add column if not exists annual_limit numeric(18,2) check (annual_limit is null or annual_limit > 0);
alter table public.tax_settings add column if not exists annual_limit_label text check (annual_limit_label is null or length(annual_limit_label) <= 80);

-- ---------------------------------------------------------------------
-- 4) Padrón de proveedores y base de facturas apócrifas
-- ---------------------------------------------------------------------
create table if not exists public.supplier_padron (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  cuit       text not null check (cuit ~ '^\d{11}$'),
  name       text,
  status     text,
  iva        text,
  data       jsonb,
  error      text,
  checked_at timestamptz not null default now(),
  primary key (org_id, cuit)
);
alter table public.supplier_padron enable row level security;
create policy supplier_padron_select on public.supplier_padron for select to authenticated using (public.is_org_member(org_id));

create or replace function public.supplier_padron_save(p_org uuid, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.supplier_padron (org_id, cuit, name, status, iva, data, error, checked_at)
  select p_org, x->>'cuit', left(x->>'name', 200), left(x->>'status', 40), left(x->>'iva', 60), x->'data', left(x->>'error', 300), now()
    from jsonb_array_elements(p_rows) x where x->>'cuit' ~ '^\d{11}$'
  on conflict (org_id, cuit) do update set name = coalesce(excluded.name, public.supplier_padron.name),
    status = coalesce(excluded.status, public.supplier_padron.status), iva = coalesce(excluded.iva, public.supplier_padron.iva),
    data = coalesce(excluded.data, public.supplier_padron.data), error = excluded.error, checked_at = now();
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.supplier_padron_save(uuid, jsonb) from public, anon;
grant execute on function public.supplier_padron_save(uuid, jsonb) to authenticated;

-- Base pública de ARCA de "facturas apócrifas" (contribuyentes no confiables). Es la misma para todos.
create table if not exists public.arca_apocrifos (
  cuit        text primary key check (cuit ~ '^\d{11}$'),
  since       date,
  published   date,
  loaded_at   timestamptz not null default now()
);
alter table public.arca_apocrifos enable row level security;
create policy arca_apocrifos_select on public.arca_apocrifos for select to authenticated using (true);
create table if not exists public.arca_apocrifos_meta (
  id        integer primary key default 1 check (id = 1),
  loaded_at timestamptz,
  rows      integer,
  error     text,
  tried_at  timestamptz
);
alter table public.arca_apocrifos_meta enable row level security;
create policy arca_apocrifos_meta_select on public.arca_apocrifos_meta for select to authenticated using (true);

create or replace function public.arca_apocrifos_load(p_rows jsonb, p_first boolean, p_last boolean, p_error text default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare n integer := 0;
begin
  if not exists (select 1 from public.organization_members m where m.user_id = auth.uid() and m.role in ('admin', 'finanzas')) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  insert into public.arca_apocrifos_meta (id, tried_at) values (1, now()) on conflict (id) do update set tried_at = now();
  if p_error is not null then
    update public.arca_apocrifos_meta set error = left(p_error, 300) where id = 1;
    return 0;
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  insert into public.arca_apocrifos (cuit, since, published, loaded_at)
  select x->>'cuit', nullif(x->>'since', '')::date, nullif(x->>'published', '')::date, now()
    from jsonb_array_elements(p_rows) x where x->>'cuit' ~ '^\d{11}$'
  on conflict (cuit) do update set since = excluded.since, published = excluded.published, loaded_at = now();
  get diagnostics n = row_count;
  if p_last then
    update public.arca_apocrifos_meta set loaded_at = now(), error = null, rows = (select count(*) from public.arca_apocrifos) where id = 1;
  end if;
  return n;
end;
$$;
revoke all on function public.arca_apocrifos_load(jsonb, boolean, boolean, text) from public, anon;
grant execute on function public.arca_apocrifos_load(jsonb, boolean, boolean, text) to authenticated;

-- Proveedores con problema: apócrifos o con CUIT dado de baja / inactivo en el padrón
create or replace view public.supplier_risks with (security_invoker = true) as
with sup as (
  select org_id, doc_number as cuit, max(name) as name, max(issue_date) as last_date, sum(total * exchange_rate) as total
    from public.arca_vouchers where direction = 'recibido' and issue_date >= current_date - 365 and doc_number ~ '^\d{11}$'
   group by org_id, doc_number
  union
  select org_id, supplier_cuit, max(supplier_name), max(issue_date), sum(total)
    from public.supplier_invoices where supplier_cuit ~ '^\d{11}$' group by org_id, supplier_cuit
)
select s.org_id, s.cuit, max(s.name) as name, max(s.last_date) as last_date,
  a.since as apocrifo_since, p.status as padron_status, p.iva as padron_iva, p.checked_at as padron_checked_at,
  case when a.cuit is not null then 'apocrifo'
       when p.status is not null and upper(p.status) <> 'ACTIVO' then 'inactivo' end as risk
from sup s
left join public.arca_apocrifos a on a.cuit = s.cuit
left join public.supplier_padron p on p.org_id = s.org_id and p.cuit = s.cuit
group by s.org_id, s.cuit, a.since, a.cuit, p.status, p.iva, p.checked_at;
grant select on public.supplier_risks to authenticated;

-- ---------------------------------------------------------------------
-- 5) Correos de organismos: reclamos, pedidos de entrega, conformidades, sin responder
-- ---------------------------------------------------------------------
alter table public.mail_messages add column if not exists alert_sent_at timestamptz;

create or replace function public.mail_kind(p_subject text, p_body text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(reclam|urgent|no (nos )?(lleg|recibi|entreg)|faltante|falt[oa]n|demora|atras|incumpl|todav[ií]a no|a[uú]n no|sin entregar|intimaci|penalid|multa)' then 'reclamo'
    when t ~* '(recib[ií]mos conform|recepci[oó]n conform|conformidad|conforme|se recibi[oó]|fue recibid|remito firmado|firmado y sellado)' then 'conformidad'
    when t ~* '(coordinar (la )?entrega|horario de (entrega|recepci)|d[ií]a de entrega|entregar en|lugar de entrega|cu[aá]ndo (pueden|podr[ií]an) entregar|turno de entrega|pedido de entrega|solicitud de entrega)' then 'entrega'
    else null end
  from (select coalesce(p_subject, '') || ' ' || left(coalesce(p_body, ''), 3000) as t) x
$$;

create or replace view public.mail_public_insights with (security_invoker = true) as
with own as (
  select org_id, lower(trim(e)) as email
    from (select org_id, unnest(string_to_array(to_emails, ',')) as e from public.mail_messages) z
   group by org_id, lower(trim(e))
  having count(*) >= 50
),
pub as (
  select m.*, public.mail_kind(m.subject, m.body) as kind,
    upper(coalesce(m.bac_number, substring(m.subject || ' ' || coalesce(m.snippet, '') from '(\d{3,5}-\d{4,6}-OC\d{2})'))) as oc_ref
  from public.mail_messages m
  where m.from_email ~* '\.(gob|gov)\.ar$|\.gob\.ar>?$|bue\.edu\.ar$|jusbaires|\.gov\.ar'
    and coalesce(m.category, '') not in ('licitacion', 'orden', 'prd', 'perfeccionamiento', 'pago')
    and not exists (select 1 from own o where o.org_id = m.org_id and o.email = lower(m.from_email))
)
select p.id, p.org_id, p.message_id, p.thread_id, p.from_email, p.from_name, p.subject, p.received_at, p.snippet, p.kind, p.oc_ref,
  po.id as purchase_order_id,
  not exists (
    select 1 from public.mail_messages r
     where r.org_id = p.org_id and r.thread_id = p.thread_id and r.received_at > p.received_at
       and exists (select 1 from own o where o.org_id = r.org_id and o.email = lower(r.from_email))
  ) as unanswered,
  p.received_at < now() - interval '48 hours' as over_48h,
  p.alert_sent_at
from pub p
left join public.purchase_orders po on po.org_id = p.org_id and upper(po.bac_number) = p.oc_ref
where p.received_at >= now() - interval '120 days';
grant select on public.mail_public_insights to authenticated;

-- ---------------------------------------------------------------------
-- 6) Cambio de datos bancarios de proveedores (CBU distinto al que venía usando)
-- ---------------------------------------------------------------------
create or replace view public.supplier_bank_changes with (security_invoker = true) as
with seen as (
  select m.org_id, lower(split_part(m.from_email, '@', 2)) as domain, x[1] as cbu, min(m.received_at) as first_seen, max(m.received_at) as last_seen,
    (array_agg(m.subject order by m.received_at desc))[1] as subject, (array_agg(m.from_name order by m.received_at desc))[1] as from_name
  from public.mail_messages m, regexp_matches(coalesce(m.body, '') || ' ' || coalesce(m.snippet, ''), '\m(\d{22})\M', 'g') x
  where m.from_email !~* '(gob|gov)\.ar$' and m.from_email !~* '(bancociudad|mercadopago|bancoprovincia|galicia|santander|bbva|macro|icbc|hsbc|naranja|brubank|uala)'
    and m.received_at >= now() - interval '400 days'
  group by m.org_id, lower(split_part(m.from_email, '@', 2)), x[1]
)
select s.org_id, s.domain, s.cbu, s.first_seen, s.last_seen, s.subject, s.from_name,
  (select string_agg(o.cbu, ', ') from seen o where o.org_id = s.org_id and o.domain = s.domain and o.cbu <> s.cbu and o.first_seen < s.first_seen) as previous_cbu
from seen s
where s.domain not in ('gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'yahoo.com.ar', 'hotmail.com.ar')
  and exists (select 1 from seen o where o.org_id = s.org_id and o.domain = s.domain and o.cbu <> s.cbu and o.first_seen < s.first_seen)
  and s.first_seen >= now() - interval '90 days';
grant select on public.supplier_bank_changes to authenticated;

-- ---------------------------------------------------------------------
-- 7) Facturas de servicios de ARCA → Gastos fijos
-- ---------------------------------------------------------------------
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
  return n;
end;
$$;
revoke all on function public.fixed_bills_sync(uuid) from public, anon;
grant execute on function public.fixed_bills_sync(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Aviso push de reclamos de organismos
-- ---------------------------------------------------------------------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.push_outbox(text,text,text)'::regprocedure);
  d := replace(d, $x$select jsonb_build_object('id', v_org, 'type', 'weekly'$x$, $x$(select jsonb_build_object('id', m.id, 'type', 'reclamo', 'contract', coalesce(m.oc_ref, ''),
                 'name', left(coalesce(nullif(m.from_name, ''), m.from_email) || ': ' || coalesce(m.subject, ''), 200), 'ends_on', m.received_at::date, 'stock', false)
           from public.mail_public_insights m
          where m.org_id = v_org and m.kind = 'reclamo' and m.unanswered and m.alert_sent_at is null and m.received_at >= now() - interval '3 days'
          order by m.received_at limit 5)
        union all
        select jsonb_build_object('id', v_org, 'type', 'weekly'$x$);
  if d not like '%''reclamo''%' then raise exception 'push_outbox: no se pudo aplicar el cambio'; end if;
  execute d;

  d := pg_get_functiondef('public.push_mark(text,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  d := replace(d, $x$  update public.bac_orders_inbox b set missing_sent_at = now()$x$, $x$  update public.mail_messages m set alert_sent_at = now()
  where m.org_id = v_org and m.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'reclamo');
  update public.bac_orders_inbox b set missing_sent_at = now()$x$);
  if d not like '%alert_sent_at%' then raise exception 'push_mark: no se pudo aplicar el cambio'; end if;
  execute d;
end $$;
