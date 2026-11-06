-- =====================================================================
-- Impuestos · comprobantes de ARCA (Mis Comprobantes Emitidos / Recibidos)
-- Ya aplicada en la base como "arca_vouchers".
-- =====================================================================
create table public.arca_vouchers (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  direction       text not null check (direction in ('emitido', 'recibido')),
  issue_date      date not null,
  voucher_type    integer not null,
  point_of_sale   integer not null,
  number          bigint not null,
  cae             text,
  doc_type        text,
  doc_number      text,
  name            text not null default '',
  currency        text not null default 'ARS',
  exchange_rate   numeric(18,6) not null default 1,
  net_taxed       numeric(18,2) not null default 0,
  net_untaxed     numeric(18,2) not null default 0,
  exempt          numeric(18,2) not null default 0,
  other_taxes     numeric(18,2) not null default 0,
  vat             numeric(18,2) not null default 0,
  total           numeric(18,2) not null default 0,
  vat_detail      jsonb not null default '{}'::jsonb,
  credit_note     boolean not null default false,
  source          text not null default 'mis_comprobantes' check (source in ('mis_comprobantes', 'wsfe')),
  sales_invoice_id uuid references public.sales_invoices(id) on delete set null,
  supplier_id     uuid references public.suppliers(id) on delete set null,
  purchase_id     uuid references public.purchases(id) on delete set null,
  imported_at     timestamptz not null default now(),
  unique (org_id, direction, voucher_type, point_of_sale, number, doc_number)
);
create index idx_arca_vouchers_org on public.arca_vouchers(org_id, issue_date desc);
alter table public.arca_vouchers enable row level security;
create policy arca_vouchers_select on public.arca_vouchers for select to authenticated using (public.is_org_member(org_id));

create or replace function public.arca_letter(p_type integer)
returns text language sql immutable set search_path = '' as $$
  select case when p_type in (1,2,3,4,5,201,202,203) then 'A' when p_type in (6,7,8,9,10,206,207,208) then 'B'
              when p_type in (11,12,13,15,211,212,213) then 'C' when p_type in (51,52,53) then 'M' else null end
$$;

create or replace function public.arca_link(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer := 0;
  v_k integer;
begin
  update public.arca_vouchers v set sales_invoice_id = si.id
  from public.sales_invoices si
  where v.org_id = p_org and v.direction = 'emitido' and v.sales_invoice_id is null and not v.credit_note
    and si.org_id = p_org and si.status = 'emitida' and si.invoice_type = public.arca_letter(v.voucher_type)
    and ltrim(coalesce(si.point_of_sale, ''), '0') = v.point_of_sale::text and ltrim(coalesce(si.number, ''), '0') = v.number::text;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  update public.sales_invoices si set cae = coalesce(si.cae, v.cae),
    net_amount = case when si.net_amount = 0 then v.net_taxed + v.net_untaxed + v.exempt else si.net_amount end,
    vat_amount = case when si.vat_amount = 0 then v.vat else si.vat_amount end
  from public.arca_vouchers v
  where v.org_id = p_org and v.sales_invoice_id = si.id and (si.cae is null or si.net_amount = 0 or si.vat_amount = 0)
    and abs(si.total_amount - v.total) < 0.05;

  update public.suppliers s set cuit = v.doc_number
  from public.arca_vouchers v
  where s.org_id = p_org and coalesce(s.cuit, '') = '' and v.org_id = p_org and v.direction = 'recibido' and v.doc_number ~ '^\d{11}$'
    and public.norm(s.name) = public.norm(v.name);
  insert into public.suppliers (org_id, name, cuit)
  select distinct on (v.doc_number) p_org, v.name, v.doc_number from public.arca_vouchers v
  where v.org_id = p_org and v.direction = 'recibido' and v.doc_number ~ '^\d{11}$' and v.name <> ''
    and not exists (select 1 from public.suppliers s where s.org_id = p_org and regexp_replace(coalesce(s.cuit, ''), '\D', '', 'g') = v.doc_number)
  on conflict do nothing;
  update public.arca_vouchers v set supplier_id = s.id
  from public.suppliers s
  where v.org_id = p_org and v.direction = 'recibido' and v.supplier_id is null and s.org_id = p_org
    and regexp_replace(coalesce(s.cuit, ''), '\D', '', 'g') = v.doc_number;
  update public.arca_vouchers v set purchase_id = p.id
  from public.purchases p
  where v.org_id = p_org and v.direction = 'recibido' and v.purchase_id is null and p.org_id = p_org and p.supplier_id = v.supplier_id
    and ltrim(coalesce(p.number, ''), '0') = v.number::text and ltrim(coalesce(p.point_of_sale, ''), '0') in (v.point_of_sale::text, '');
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end;
$$;
revoke all on function public.arca_link(uuid) from public, anon, authenticated;

create or replace function public.import_arca_vouchers(p_org uuid, p_direction text, p_rows jsonb, p_source text default 'mis_comprobantes')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r   jsonb;
  v_new integer := 0;
  v_upd integer := 0;
  v_ins boolean;
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if p_direction not in ('emitido', 'recibido') then raise exception 'Archivo inválido' using errcode = '22023'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 20000 then raise exception 'Archivo inválido' using errcode = '22023'; end if;
  for v_r in select x from jsonb_array_elements(p_rows) x loop
    continue when coalesce(v_r->>'issue_date', '') !~ '^\d{4}-\d{2}-\d{2}$' or coalesce(v_r->>'number', '') !~ '^\d{1,12}$';
    insert into public.arca_vouchers (org_id, direction, issue_date, voucher_type, point_of_sale, number, cae, doc_type, doc_number, name,
      currency, exchange_rate, net_taxed, net_untaxed, exempt, other_taxes, vat, total, vat_detail, credit_note, source)
    values (p_org, p_direction, (v_r->>'issue_date')::date, (v_r->>'voucher_type')::int, (v_r->>'point_of_sale')::int, (v_r->>'number')::bigint,
      nullif(v_r->>'cae', ''), nullif(v_r->>'doc_type', ''), coalesce(nullif(v_r->>'doc_number', ''), ''), left(coalesce(v_r->>'name', ''), 300),
      coalesce(nullif(v_r->>'currency', ''), 'ARS'), coalesce(nullif(v_r->>'exchange_rate', '')::numeric, 1),
      coalesce((v_r->>'net_taxed')::numeric, 0), coalesce((v_r->>'net_untaxed')::numeric, 0), coalesce((v_r->>'exempt')::numeric, 0),
      coalesce((v_r->>'other_taxes')::numeric, 0), coalesce((v_r->>'vat')::numeric, 0), coalesce((v_r->>'total')::numeric, 0),
      coalesce(v_r->'vat_detail', '{}'::jsonb), (v_r->>'voucher_type')::int in (3, 8, 13, 53, 203, 208, 213), coalesce(p_source, 'mis_comprobantes'))
    on conflict (org_id, direction, voucher_type, point_of_sale, number, doc_number) do update set
      cae = coalesce(excluded.cae, public.arca_vouchers.cae), name = excluded.name, total = excluded.total, vat = excluded.vat,
      net_taxed = excluded.net_taxed, net_untaxed = excluded.net_untaxed, exempt = excluded.exempt, other_taxes = excluded.other_taxes,
      vat_detail = excluded.vat_detail, imported_at = now()
    returning (xmax = 0) into v_ins;
    if v_ins then v_new := v_new + 1; else v_upd := v_upd + 1; end if;
  end loop;
  return jsonb_build_object('nuevos', v_new, 'actualizados', v_upd, 'vinculados', public.arca_link(p_org));
end;
$$;
revoke all on function public.import_arca_vouchers(uuid, text, jsonb, text) from public, anon;
grant execute on function public.import_arca_vouchers(uuid, text, jsonb, text) to authenticated;

create view public.arca_vouchers_overview with (security_invoker = true) as
select v.*,
  public.arca_letter(v.voucher_type) as letter,
  case when v.credit_note then -1 else 1 end as sign,
  si.purchase_order_id, coalesce(po.bac_number, po.display_number) as po_number,
  s.name as supplier_name
from public.arca_vouchers v
left join public.sales_invoices si on si.id = v.sales_invoice_id
left join public.purchase_orders_overview po on po.id = si.purchase_order_id
left join public.suppliers s on s.id = v.supplier_id;
grant select on public.arca_vouchers_overview to authenticated;
