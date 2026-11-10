-- =====================================================================
-- Facturas de proveedores leídas del mail (PDF adjunto) o subidas a mano:
-- productos con cantidad, precio neto y precio final (con IVA y percepciones), fecha y proveedor.
-- Se cruzan con los comprobantes recibidos de ARCA (Mis Comprobantes) para tomar proveedor y total exactos.
-- =====================================================================
create table public.supplier_invoices (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  source          text not null default 'mail' check (source in ('mail', 'manual')),
  mail_id         text,
  mail_from       text,
  mail_subject    text,
  mail_date       timestamptz,
  filename        text not null default '',
  kind            text not null default 'factura' check (kind in ('factura', 'nota_credito', 'nota_debito')),
  letter          text check (letter in ('A', 'B', 'C', 'M')),
  point_of_sale   integer,
  number          bigint,
  issue_date      date,
  supplier_cuit   text,
  supplier_name   text not null default '',
  cae             text,
  net             numeric(18,2),
  total           numeric(18,2),
  items_net       numeric(18,2),
  factor          numeric(10,4),
  quality         text not null default 'ok' check (quality in ('ok', 'revisar', 'sin_items')),
  arca_voucher_id uuid references public.arca_vouchers(id) on delete set null,
  hidden          boolean not null default false,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create unique index uq_supplier_invoices_mail on public.supplier_invoices(org_id, mail_id, filename) where mail_id is not null;
create index idx_supplier_invoices_org on public.supplier_invoices(org_id, issue_date desc);
create index idx_supplier_invoices_num on public.supplier_invoices(org_id, point_of_sale, number);

create table public.supplier_invoice_items (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  invoice_id    uuid not null references public.supplier_invoices(id) on delete cascade,
  line          integer not null,
  code          text,
  description   text not null,
  detail        text,
  quantity      numeric(18,4) not null,
  unit          text,
  list_price    numeric(18,4),
  discount_pct  numeric(7,3),
  pack          integer,
  line_net      numeric(18,2) not null,
  unit_net      numeric(18,4) not null,
  unit_final    numeric(18,2),
  vat_rate      numeric(5,2),
  unique (invoice_id, line)
);
create index idx_supplier_items_org on public.supplier_invoice_items(org_id);
create index idx_supplier_items_desc on public.supplier_invoice_items using gin (description extensions.gin_trgm_ops);

alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoice_items enable row level security;
create policy supplier_invoices_read on public.supplier_invoices for select to authenticated using (public.is_org_member(org_id));
create policy supplier_items_read on public.supplier_invoice_items for select to authenticated using (public.is_org_member(org_id));
grant select on public.supplier_invoices, public.supplier_invoice_items to authenticated;

-- Cruce con ARCA: mismo punto de venta y número, y mismo CUIT o mismo total
create or replace function public.supplier_invoice_match_arca(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  with m as (
    select distinct on (s.id) s.id, v.id as vid, v.name, v.doc_number, v.issue_date, v.total
    from public.supplier_invoices s
    join public.arca_vouchers v on v.org_id = s.org_id and v.direction = 'recibido'
      and v.point_of_sale = s.point_of_sale and v.number = s.number
      and (v.doc_number = s.supplier_cuit or (s.total is not null and abs(v.total - s.total) <= greatest(2, v.total * 0.01)))
    where s.org_id = p_org and s.arca_voucher_id is null and s.number is not null
    order by s.id, abs(v.total - coalesce(s.total, v.total))
  )
  update public.supplier_invoices s set
    arca_voucher_id = m.vid,
    supplier_name = case when m.name <> '' then m.name else s.supplier_name end,
    supplier_cuit = coalesce(nullif(m.doc_number, ''), s.supplier_cuit),
    issue_date = coalesce(m.issue_date, s.issue_date),
    total = coalesce(m.total, s.total),
    factor = case when s.items_net > 0 and m.total / s.items_net between 0.85 and 1.5 then round(m.total / s.items_net, 4) else s.factor end
  from m where s.id = m.id;
  get diagnostics v_n = row_count;
  -- si cambió el total, recalcula el precio final de cada renglón
  update public.supplier_invoice_items i set unit_final = round(i.line_net * s.factor / nullif(i.quantity, 0), 2)
  from public.supplier_invoices s
  where s.id = i.invoice_id and s.org_id = p_org and s.factor is not null
    and i.unit_final is distinct from round(i.line_net * s.factor / nullif(i.quantity, 0), 2);
  return v_n;
end;
$$;
revoke all on function public.supplier_invoice_match_arca(uuid) from public, anon, authenticated;

-- Guarda una factura leída. Devuelve 'nueva' | 'repetida' | 'salteada:<motivo>'
create or replace function public.store_supplier_invoice(p_org uuid, p_inv jsonb, p_source text, p_user uuid default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_own    text;
  v_cuits  text[];
  v_issuer text;
  v_pv     integer := case when p_inv->>'point_of_sale' ~ '^\d{1,5}$' then (p_inv->>'point_of_sale')::int end;
  v_num    bigint  := case when p_inv->>'number' ~ '^\d{1,9}$' then (p_inv->>'number')::bigint end;
  v_total  numeric := case when p_inv->>'total' ~ '^-?\d{1,15}(\.\d+)?$' then round((p_inv->>'total')::numeric, 2) end;
  v_arca   public.arca_vouchers;
  v_name   text;
  v_id     uuid;
  v_it     jsonb;
  v_from   text := left(p_inv->>'mail_from', 300);
begin
  select coalesce(nullif(a.cuit, ''), nullif(regexp_replace(coalesce(r.cuit, ''), '\D', '', 'g'), '')) into v_own
  from public.organizations o
  left join public.arca_connection a on a.org_id = o.id
  left join public.remito_settings r on r.org_id = o.id
  where o.id = p_org;

  if p_inv->>'mail_id' is not null and exists (select 1 from public.supplier_invoices where org_id = p_org and mail_id = p_inv->>'mail_id' and filename = coalesce(left(p_inv->>'filename', 200), '')) then
    return 'repetida';
  end if;

  v_cuits := array(select x from jsonb_array_elements_text(coalesce(p_inv->'cuits', '[]'::jsonb)) x where x ~ '^\d{11}$');
  -- emisor: el primer CUIT que no sea el de la empresa (el lector pone primero el del código de barras si lo hay)
  v_issuer := (select x from unnest(array_prepend(nullif(p_inv->>'issuer_cuit', ''), v_cuits)) x where x is not null and x is distinct from v_own limit 1);
  -- factura emitida por nosotros (está en ARCA como emitida)
  if exists (select 1 from public.arca_vouchers v where v.org_id = p_org and v.direction = 'emitido' and v.point_of_sale = v_pv and v.number = v_num
             and (v_total is null or abs(v.total - v_total) <= 2)) then
    return 'salteada:propia';
  end if;

  select * into v_arca from public.arca_vouchers v
  where v.org_id = p_org and v.direction = 'recibido' and v.point_of_sale = v_pv and v.number = v_num
    and (v.doc_number = v_issuer or (v_total is not null and abs(v.total - v_total) <= greatest(2, v.total * 0.01)))
  order by abs(v.total - coalesce(v_total, v.total)) limit 1;

  -- sin ARCA: tiene que estar a nombre de la empresa y con CAE (descarta tickets personales, presupuestos y órdenes de compra)
  if v_arca.id is null then
    if v_own is not null and not (v_own = any(v_cuits)) then return 'salteada:no_es_a_nombre_de_la_empresa'; end if;
    if coalesce(p_inv->>'cae', '') !~ '^\d{14}$' then return 'salteada:sin_cae'; end if;
  end if;
  -- misma factura que llegó en otro mail
  if v_num is not null and exists (
    select 1 from public.supplier_invoices s where s.org_id = p_org and s.point_of_sale = v_pv and s.number = v_num and not s.hidden
      and (s.supplier_cuit = coalesce(v_arca.doc_number, v_issuer) or (v_total is not null and abs(coalesce(s.total, 0) - v_total) <= 2))
  ) then return 'repetida'; end if;

  v_name := coalesce(nullif(v_arca.name, ''),
    (select s.name from public.suppliers s where s.org_id = p_org and regexp_replace(coalesce(s.cuit, ''), '\D', '', 'g') = coalesce(v_arca.doc_number, v_issuer) limit 1),
    (select s.supplier_name from public.supplier_invoices s where s.org_id = p_org and s.supplier_cuit = coalesce(v_arca.doc_number, v_issuer) and s.supplier_name <> '' order by s.created_at desc limit 1),
    nullif(left(p_inv->>'supplier_hint', 200), ''),
    nullif(trim(both ' "' from split_part(v_from, '<', 1)), ''), '');

  insert into public.supplier_invoices (org_id, source, mail_id, mail_from, mail_subject, mail_date, filename, kind, letter, point_of_sale, number,
    issue_date, supplier_cuit, supplier_name, cae, net, total, items_net, factor, quality, arca_voucher_id, created_by)
  values (p_org, p_source, left(p_inv->>'mail_id', 200), v_from, left(p_inv->>'mail_subject', 500),
    case when p_inv->>'mail_date' ~ '^\d{4}-\d{2}-\d{2}' then (p_inv->>'mail_date')::timestamptz end,
    coalesce(left(p_inv->>'filename', 200), ''),
    case when p_inv->>'kind' in ('factura', 'nota_credito', 'nota_debito') then p_inv->>'kind' else 'factura' end,
    case when p_inv->>'letter' in ('A', 'B', 'C', 'M') then p_inv->>'letter' end,
    v_pv, v_num,
    coalesce(v_arca.issue_date, case when p_inv->>'issue_date' ~ '^\d{4}-\d{2}-\d{2}$' then (p_inv->>'issue_date')::date end),
    coalesce(nullif(v_arca.doc_number, ''), v_issuer), left(v_name, 200),
    case when p_inv->>'cae' ~ '^\d{14}$' then p_inv->>'cae' end,
    case when p_inv->>'net' ~ '^\d{1,15}(\.\d+)?$' then round((p_inv->>'net')::numeric, 2) end,
    coalesce(v_arca.total, v_total),
    case when p_inv->>'items_net' ~ '^\d{1,15}(\.\d+)?$' then round((p_inv->>'items_net')::numeric, 2) end,
    case when p_inv->>'factor' ~ '^\d{1,3}(\.\d+)?$' then (p_inv->>'factor')::numeric end,
    case when p_inv->>'quality' in ('ok', 'revisar', 'sin_items') then p_inv->>'quality' else 'revisar' end,
    v_arca.id, p_user)
  returning id into v_id;

  for v_it in select x from jsonb_array_elements(coalesce(p_inv->'items', '[]'::jsonb)) x limit 400 loop
    continue when coalesce(v_it->>'description', '') = '' or coalesce(v_it->>'quantity', '') !~ '^\d{1,12}(\.\d+)?$' or coalesce(v_it->>'line_net', '') !~ '^-?\d{1,15}(\.\d+)?$';
    continue when (v_it->>'quantity')::numeric <= 0;
    insert into public.supplier_invoice_items (org_id, invoice_id, line, code, description, detail, quantity, unit, list_price, discount_pct, pack,
      line_net, unit_net, unit_final, vat_rate)
    values (p_org, v_id, coalesce((v_it->>'line')::int, 1), left(v_it->>'code', 40), left(v_it->>'description', 300), left(v_it->>'detail', 400),
      (v_it->>'quantity')::numeric, left(v_it->>'unit', 20),
      case when v_it->>'list_price' ~ '^\d{1,15}(\.\d+)?$' then (v_it->>'list_price')::numeric end,
      case when v_it->>'discount_pct' ~ '^\d{1,3}(\.\d+)?$' then least((v_it->>'discount_pct')::numeric, 100) end,
      case when v_it->>'pack' ~ '^\d{1,4}$' then (v_it->>'pack')::int end,
      round((v_it->>'line_net')::numeric, 2), round((v_it->>'line_net')::numeric / (v_it->>'quantity')::numeric, 4),
      null,
      case when v_it->>'vat_rate' ~ '^\d{1,2}(\.\d+)?$' then (v_it->>'vat_rate')::numeric end)
    on conflict (invoice_id, line) do nothing;
  end loop;

  -- precio final: reparte el total (con IVA y percepciones) entre los renglones
  update public.supplier_invoices s set
    items_net = coalesce((select sum(line_net) from public.supplier_invoice_items where invoice_id = v_id), 0),
    quality = case when not exists (select 1 from public.supplier_invoice_items where invoice_id = v_id) then 'sin_items' else s.quality end
  where s.id = v_id;
  update public.supplier_invoices s set factor = case when s.items_net > 0 and s.total / s.items_net between 0.85 and 1.5 then round(s.total / s.items_net, 4) end
  where s.id = v_id and s.total is not null;
  update public.supplier_invoice_items i set unit_final = round(i.line_net * s.factor / i.quantity, 2)
  from public.supplier_invoices s where s.id = v_id and i.invoice_id = v_id and s.factor is not null;
  return 'nueva';
end;
$$;
revoke all on function public.store_supplier_invoice(uuid, jsonb, text, uuid) from public, anon, authenticated;

-- Desde el script de Gmail (token de la empresa)
create or replace function public.ingest_supplier_invoices(p_token text, p_invoices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_inv jsonb;
  v_r   text;
  v_new integer := 0; v_rep integer := 0; v_skip integer := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_invoices) <> 'array' or jsonb_array_length(p_invoices) > 50 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for v_inv in select x from jsonb_array_elements(p_invoices) x loop
    v_r := public.store_supplier_invoice(v_org, v_inv, 'mail');
    if v_r = 'nueva' then v_new := v_new + 1; elsif v_r = 'repetida' then v_rep := v_rep + 1; else v_skip := v_skip + 1; end if;
  end loop;
  if jsonb_array_length(p_invoices) > 0 then perform public.supplier_invoice_match_arca(v_org); end if;
  return jsonb_build_object('nuevas', v_new, 'repetidas', v_rep, 'salteadas', v_skip);
end;
$$;
revoke all on function public.ingest_supplier_invoices(text, jsonb) from public;
grant execute on function public.ingest_supplier_invoices(text, jsonb) to anon, authenticated;

-- Subida a mano desde la pantalla (sesión)
create or replace function public.upload_supplier_invoice(p_org uuid, p_inv jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_r text;
begin
  if not public.has_org_role(p_org, array['admin','compras','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  v_r := public.store_supplier_invoice(p_org, p_inv - 'mail_id', 'manual', auth.uid());
  perform public.supplier_invoice_match_arca(p_org);
  return v_r;
end;
$$;
revoke all on function public.upload_supplier_invoice(uuid, jsonb) from public, anon;
grant execute on function public.upload_supplier_invoice(uuid, jsonb) to authenticated;

-- Ocultar una factura mal leída (no se borra)
create or replace function public.hide_supplier_invoice(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.supplier_invoices where id = p_id;
  if v_org is null or not public.has_org_role(v_org, array['admin','compras','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  update public.supplier_invoices set hidden = p_hidden where id = p_id;
end;
$$;
revoke all on function public.hide_supplier_invoice(uuid, boolean) from public, anon;
grant execute on function public.hide_supplier_invoice(uuid, boolean) to authenticated;

-- Cada renglón con su factura y proveedor
create view public.supplier_items_overview with (security_invoker = true) as
select i.id, i.org_id, i.invoice_id, i.line, i.code, i.description, i.detail, i.quantity, i.unit, i.list_price, i.discount_pct, i.pack,
  i.line_net, i.unit_net, i.unit_final, i.vat_rate,
  s.issue_date, s.supplier_name, s.supplier_cuit, s.letter, s.kind, s.point_of_sale, s.number, s.mail_id, s.quality,
  public.norm(i.description) as product_key,
  coalesce(nullif(s.supplier_cuit, ''), lower(s.supplier_name)) as supplier_key
from public.supplier_invoice_items i
join public.supplier_invoices s on s.id = i.invoice_id
where not s.hidden;
grant select on public.supplier_items_overview to authenticated;

-- Último precio de cada producto por proveedor, con mínimo, máximo y cantidad de compras
create view public.supplier_product_prices with (security_invoker = true) as
with x as (
  select o.*,
    count(*) over w as times, min(o.unit_final) over w as min_final, max(o.unit_final) over w as max_final,
    sum(o.quantity) over w as total_qty,
    row_number() over (partition by o.org_id, o.supplier_key, o.product_key order by o.issue_date desc nulls last, o.number desc nulls last, o.line) as rn,
    lead(o.unit_final) over (partition by o.org_id, o.supplier_key, o.product_key order by o.issue_date desc nulls last, o.number desc nulls last, o.line) as prev_final
  from public.supplier_items_overview o
  window w as (partition by o.org_id, o.supplier_key, o.product_key)
)
select id, org_id, invoice_id, code, description, unit, pack, quantity, unit_net, unit_final, issue_date, supplier_name, supplier_cuit,
  supplier_key, product_key, point_of_sale, number, letter, mail_id, times, min_final, max_final, total_qty, prev_final
from x where rn = 1;
grant select on public.supplier_product_prices to authenticated;
