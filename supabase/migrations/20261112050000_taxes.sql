-- =====================================================================
-- Impuestos: configuración (IIBB, Ganancias, vencimientos), comprobantes emitidos traídos de ARCA (WSFE),
-- accesos a otros servicios de ARCA (padrón) y foto del padrón propio para avisar cambios.
-- =====================================================================

-- Las facturas emitidas desde la app guardan el IVA por alícuota igual que Mis Comprobantes: {"21": {"neto": x, "iva": y}}
create or replace function public.arca_vat_detail(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_object_agg(
    case when (x->>'rate')::numeric = trunc((x->>'rate')::numeric) then trunc((x->>'rate')::numeric)::text else (x->>'rate')::numeric::text end,
    jsonb_build_object('neto', (x->>'base')::numeric, 'iva', (x->>'amount')::numeric)), '{}'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x
$$;
update public.arca_vouchers v set vat_detail = public.arca_vat_detail(e.vat_detail)
from public.arca_emissions e
where v.source = 'wsfe' and v.org_id = e.org_id and v.voucher_type = e.voucher_type and v.point_of_sale = e.point_of_sale and v.number = e.number;

create table public.tax_settings (
  org_id             uuid primary key references public.organizations(id) on delete cascade,
  iibb_rate          numeric(6,3) not null default 3.0 check (iibb_rate between 0 and 20),
  iibb_day           smallint not null default 15 check (iibb_day between 1 and 28),
  autonomos          boolean not null default false,
  autonomos_day      smallint not null default 5 check (autonomos_day between 1 and 28),
  gni                numeric(18,2) not null default 5151802.50,
  special_deduction  numeric(18,2) not null default 5151802.50,
  other_deductions   numeric(18,2) not null default 0,
  ganancias_paid     numeric(18,2) not null default 0,
  padron             jsonb,
  padron_previous    jsonb,
  padron_checked_at  timestamptz,
  padron_error       text,
  emitted_synced_at  timestamptz,
  emitted_sync_error text,
  updated_at         timestamptz not null default now()
);
alter table public.tax_settings enable row level security;
create policy tax_settings_read on public.tax_settings for select to authenticated using (public.is_org_member(org_id));
grant select on public.tax_settings to authenticated;

create or replace function public.tax_settings_save(p_org uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  insert into public.tax_settings (org_id) values (p_org) on conflict do nothing;
  update public.tax_settings set
    iibb_rate = coalesce((p->>'iibb_rate')::numeric, iibb_rate),
    iibb_day = coalesce((p->>'iibb_day')::smallint, iibb_day),
    autonomos = coalesce((p->>'autonomos')::boolean, autonomos),
    autonomos_day = coalesce((p->>'autonomos_day')::smallint, autonomos_day),
    gni = coalesce((p->>'gni')::numeric, gni),
    special_deduction = coalesce((p->>'special_deduction')::numeric, special_deduction),
    other_deductions = coalesce((p->>'other_deductions')::numeric, other_deductions),
    ganancias_paid = coalesce((p->>'ganancias_paid')::numeric, ganancias_paid),
    updated_at = now()
  where org_id = p_org;
end;
$$;
revoke all on function public.tax_settings_save(uuid, jsonb) from public, anon;
grant execute on function public.tax_settings_save(uuid, jsonb) to authenticated;

-- Estado de las tareas automáticas (sincronización de emitidos y padrón)
create or replace function public.tax_status_save(p_org uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  insert into public.tax_settings (org_id) values (p_org) on conflict do nothing;
  update public.tax_settings set
    emitted_synced_at = case when p ? 'emitted_synced' then now() else emitted_synced_at end,
    emitted_sync_error = case when p ? 'emitted_synced' then p->>'emitted_sync_error' else emitted_sync_error end,
    padron_previous = case when p ? 'padron' and padron is distinct from p->'padron' then padron else padron_previous end,
    padron = case when p ? 'padron' then p->'padron' else padron end,
    padron_checked_at = case when p ? 'padron' or p ? 'padron_error' then now() else padron_checked_at end,
    padron_error = case when p ? 'padron' then null when p ? 'padron_error' then p->>'padron_error' else padron_error end
  where org_id = p_org;
end;
$$;
revoke all on function public.tax_status_save(uuid, jsonb) from public, anon;
grant execute on function public.tax_status_save(uuid, jsonb) to authenticated;

-- Comprobantes emitidos traídos de ARCA por web service (los de cualquier sistema que use ese punto de venta)
create or replace function public.arca_ingest_wsfe(p_org uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_r jsonb; v_n integer := 0;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  for v_r in select x from jsonb_array_elements(p_rows) x limit 500 loop
    insert into public.arca_vouchers (org_id, direction, issue_date, voucher_type, point_of_sale, number, cae, doc_type, doc_number, name, currency,
      exchange_rate, net_taxed, net_untaxed, exempt, other_taxes, vat, total, vat_detail, credit_note, source)
    values (p_org, 'emitido', (v_r->>'issue_date')::date, (v_r->>'voucher_type')::int, (v_r->>'point_of_sale')::int, (v_r->>'number')::bigint, v_r->>'cae',
      v_r->>'doc_type', v_r->>'doc_number',
      coalesce((select e.receiver_name from public.arca_emissions e where e.org_id = p_org and e.voucher_type = (v_r->>'voucher_type')::int and e.point_of_sale = (v_r->>'point_of_sale')::int and e.number = (v_r->>'number')::bigint),
               (select c.name from public.customers c where c.org_id = p_org and regexp_replace(coalesce(c.cuit, ''), '\D', '', 'g') = v_r->>'doc_number' limit 1),
               (select v.name from public.arca_vouchers v where v.org_id = p_org and v.doc_number = v_r->>'doc_number' and v.name <> '' limit 1), ''),
      case when v_r->>'currency' = 'PES' then 'ARS' else coalesce(v_r->>'currency', 'ARS') end, coalesce((v_r->>'exchange_rate')::numeric, 1),
      (v_r->>'net')::numeric, coalesce((v_r->>'untaxed')::numeric, 0), coalesce((v_r->>'exempt')::numeric, 0), coalesce((v_r->>'other_taxes')::numeric, 0),
      (v_r->>'vat')::numeric, (v_r->>'total')::numeric, coalesce(v_r->'vat_detail', '{}'::jsonb), (v_r->>'voucher_type')::int in (3, 8, 13, 53, 203, 208, 213), 'wsfe')
    on conflict do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.arca_ingest_wsfe(uuid, jsonb) from public, anon;
grant execute on function public.arca_ingest_wsfe(uuid, jsonb) to authenticated;

-- Último número que ya tenemos por tipo en un punto de venta (para traer sólo lo que falta)
create or replace function public.arca_emitted_max(p_org uuid, p_pv integer)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(voucher_type::text, mx), '{}'::jsonb)
  from (select voucher_type, max(number) mx from public.arca_vouchers where org_id = p_org and direction = 'emitido' and point_of_sale = p_pv group by 1) t
  where public.is_org_member(p_org)
$$;
revoke all on function public.arca_emitted_max(uuid, integer) from public, anon;
grant execute on function public.arca_emitted_max(uuid, integer) to authenticated;

-- Accesos de WSAA para otros servicios de ARCA (padrón, etc.)
create table public.arca_tickets (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  service    text not null,
  token      text not null,
  sign       text not null,
  expires_at timestamptz not null,
  primary key (org_id, service)
);
alter table public.arca_tickets enable row level security; -- sin políticas: sólo por arca_ticket()

create or replace function public.arca_ticket(p_org uuid, p_service text, p_data jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v public.arca_tickets;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_service !~ '^[a-z_]{3,40}$' then raise exception 'Servicio inválido' using errcode = '22023'; end if;
  if p_data is not null then
    insert into public.arca_tickets (org_id, service, token, sign, expires_at)
    values (p_org, p_service, p_data->>'token', p_data->>'sign', (p_data->>'expires_at')::timestamptz)
    on conflict (org_id, service) do update set token = excluded.token, sign = excluded.sign, expires_at = excluded.expires_at;
    return jsonb_build_object('ok', true);
  end if;
  select * into v from public.arca_tickets where org_id = p_org and service = p_service and expires_at > now() + interval '5 minutes';
  return case when v.token is null then '{}'::jsonb else jsonb_build_object('token', v.token, 'sign', v.sign) end;
end;
$$;
revoke all on function public.arca_ticket(uuid, text, jsonb) from public, anon;
grant execute on function public.arca_ticket(uuid, text, jsonb) to authenticated;

-- Retenciones sufridas (cobros), SIRCREB (banco) y percepciones (comprobantes recibidos) por mes
create view public.tax_withholdings_monthly with (security_invoker = true) as
select org_id, month,
  sum(ret_iibb) ret_iibb, sum(ret_ganancias) ret_ganancias, sum(ret_iva) ret_iva, sum(ret_suss) ret_suss, sum(ret_otras) ret_otras,
  sum(sircreb) sircreb, sum(percepciones) percepciones
from (
  select org_id, to_char(payment_date, 'YYYY-MM') as month, ret_iibb, ret_ganancias, ret_iva, ret_suss, ret_otras, 0::numeric sircreb, 0::numeric percepciones
  from public.collections where status = 'confirmado'
  union all
  select org_id, to_char(mov_date, 'YYYY-MM'), 0, 0, 0, 0, 0, amount, 0 from public.bank_movements where kind = 'sircreb'
  union all
  select org_id, to_char(issue_date, 'YYYY-MM'), 0, 0, 0, 0, 0, 0, (case when credit_note then -1 else 1 end) * other_taxes * coalesce(exchange_rate, 1)
  from public.arca_vouchers where direction = 'recibido' and other_taxes <> 0
) t
group by org_id, month;
grant select on public.tax_withholdings_monthly to authenticated;

-- Factura emitida desde la app: el comprobante en Impuestos toma el IVA por alícuota del comprobante autorizado
create or replace function public.tg_arca_voucher_wsfe_detail()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source = 'wsfe' then
    new.vat_detail := coalesce((select public.arca_vat_detail(e.vat_detail) from public.arca_emissions e
      where e.org_id = new.org_id and e.voucher_type = new.voucher_type and e.point_of_sale = new.point_of_sale and e.number = new.number), new.vat_detail);
  end if;
  return new;
end;
$$;
create trigger trg_arca_voucher_wsfe_detail before insert on public.arca_vouchers for each row execute function public.tg_arca_voucher_wsfe_detail();
