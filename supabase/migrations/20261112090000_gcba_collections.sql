-- =====================================================================
-- Cobros del GCBA: cada depósito del Banco Ciudad se cruza con la factura que paga.
-- El GCBA paga: total − IIBB (1,5% del total) − Ganancias (2% del neto que supera $224.000).
-- Con el aviso de SIGAF (qué factura paga) + esa fórmula, el cruce es exacto al centavo.
-- =====================================================================
alter table public.tax_settings add column if not exists gcba_iibb_rate numeric(6,3) not null default 1.5;
alter table public.tax_settings add column if not exists gcba_gan_rate numeric(6,3) not null default 2;
alter table public.tax_settings add column if not exists gcba_gan_min numeric(18,2) not null default 224000;

create table public.bank_matches (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  bank_movement_id uuid not null references public.bank_movements(id) on delete cascade,
  arca_voucher_id  uuid not null references public.arca_vouchers(id) on delete cascade,
  invoice_total    numeric(18,2) not null,
  ret_iibb         numeric(18,2) not null default 0,
  ret_ganancias    numeric(18,2) not null default 0,
  method           text not null check (method in ('sigaf', 'monto', 'manual')),
  created_at       timestamptz not null default now(),
  unique (arca_voucher_id)
);
create index idx_bank_matches_mov on public.bank_matches(bank_movement_id);
create index idx_bank_matches_org on public.bank_matches(org_id);
alter table public.bank_matches enable row level security;
create policy bank_matches_read on public.bank_matches for select to authenticated using (public.is_org_member(org_id));
grant select on public.bank_matches to authenticated;

-- Lo que deposita el GCBA por un conjunto de facturas (total y neto sumados)
create or replace function public.gcba_net_payment(p_total numeric, p_net numeric, p_iibb numeric, p_gan numeric, p_min numeric)
returns numeric language sql immutable set search_path = '' as $$
  select p_total - round(p_total * p_iibb / 100, 2) - round(greatest(0, p_net - p_min) * p_gan / 100, 2)
$$;

create or replace function public.bank_match_gcba(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  s record;
  d record;
  c record;
  v_n integer := 0;
  v_cnt integer;
begin
  select coalesce(t.gcba_iibb_rate, 1.5) iibb, coalesce(t.gcba_gan_rate, 2) gan, coalesce(t.gcba_gan_min, 224000) mn
    into s from (select 1) x left join public.tax_settings t on t.org_id = p_org;

  for d in select b.id, b.amount, b.mov_date from public.bank_movements b
           where b.org_id = p_org and b.kind = 'gcba' and b.amount > 0
             and not exists (select 1 from public.bank_matches m where m.bank_movement_id = b.id)
           order by b.mov_date
  loop
    -- 1) facturas que SIGAF avisó que se pagan (mismo día o hasta 45 días antes del depósito)
    select count(*) into v_cnt from (
      select v.id from public.bac_payments p
      join public.arca_vouchers v on v.org_id = p.org_id and v.direction = 'emitido' and not v.credit_note
        and v.point_of_sale = p.point_of_sale::int and v.number = p.number::bigint and v.voucher_type = case p.invoice_type when 'A' then 1 else 6 end
      where p.org_id = p_org and p.notified_at::date between d.mov_date - 45 and d.mov_date + 1
        and not exists (select 1 from public.bank_matches m where m.arca_voucher_id = v.id)
        and abs(d.amount - public.gcba_net_payment(v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)), s.iibb, s.gan, s.mn)) <= 1
    ) x;
    if v_cnt >= 1 then
      select v.id, v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)) net into c
      from public.bac_payments p
      join public.arca_vouchers v on v.org_id = p.org_id and v.direction = 'emitido' and not v.credit_note
        and v.point_of_sale = p.point_of_sale::int and v.number = p.number::bigint and v.voucher_type = case p.invoice_type when 'A' then 1 else 6 end
      where p.org_id = p_org and p.notified_at::date between d.mov_date - 45 and d.mov_date + 1
        and not exists (select 1 from public.bank_matches m where m.arca_voucher_id = v.id)
        and abs(d.amount - public.gcba_net_payment(v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)), s.iibb, s.gan, s.mn)) <= 1
      order by abs(d.mov_date - p.notified_at::date), v.issue_date limit 1;
      insert into public.bank_matches (org_id, bank_movement_id, arca_voucher_id, invoice_total, ret_iibb, ret_ganancias, method)
      values (p_org, d.id, c.id, c.total, round(c.total * s.iibb / 100, 2), round(greatest(0, c.net - s.mn) * s.gan / 100, 2), 'sigaf')
      on conflict do nothing;
      update public.bac_payments p set bank_movement_id = d.id
      from public.arca_vouchers v where v.id = c.id and p.org_id = p_org and p.point_of_sale::int = v.point_of_sale and p.number::bigint = v.number;
      v_n := v_n + 1;
      continue;
    end if;
    -- 2) sin aviso: por monto contra todas las facturas emitidas del último año, sólo si hay una sola posible
    select count(*) into v_cnt from public.arca_vouchers v
    where v.org_id = p_org and v.direction = 'emitido' and not v.credit_note and v.issue_date between d.mov_date - 365 and d.mov_date
      and not exists (select 1 from public.bank_matches m where m.arca_voucher_id = v.id)
      and abs(d.amount - public.gcba_net_payment(v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)), s.iibb, s.gan, s.mn)) <= 1;
    if v_cnt = 1 then
      select v.id, v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)) net into c from public.arca_vouchers v
      where v.org_id = p_org and v.direction = 'emitido' and not v.credit_note and v.issue_date between d.mov_date - 365 and d.mov_date
        and not exists (select 1 from public.bank_matches m where m.arca_voucher_id = v.id)
        and abs(d.amount - public.gcba_net_payment(v.total, coalesce(nullif(v.net_taxed, 0), round(v.total / 1.21, 2)), s.iibb, s.gan, s.mn)) <= 1;
      insert into public.bank_matches (org_id, bank_movement_id, arca_voucher_id, invoice_total, ret_iibb, ret_ganancias, method)
      values (p_org, d.id, c.id, c.total, round(c.total * s.iibb / 100, 2), round(greatest(0, c.net - s.mn) * s.gan / 100, 2), 'monto')
      on conflict do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.bank_match_gcba(uuid) from public, anon, authenticated;

-- Se cruza solo cada vez que entra un depósito, un aviso de SIGAF o una factura de ARCA
create or replace function public.tg_bank_match_gcba()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select distinct org_id from new_rows loop
    perform public.bank_match_gcba(o);
  end loop;
  return null;
end;
$$;
create trigger trg_bank_match_mov after insert on public.bank_movements referencing new table as new_rows for each statement execute function public.tg_bank_match_gcba();
create trigger trg_bank_match_bac after insert on public.bac_payments referencing new table as new_rows for each statement execute function public.tg_bank_match_gcba();
create trigger trg_bank_match_arca after insert on public.arca_vouchers referencing new table as new_rows for each statement execute function public.tg_bank_match_gcba();

-- Cruce manual de un depósito con una factura (los que no cierran solos)
create or replace function public.bank_match_manual(p_org uuid, p_movement uuid, p_vouchers uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v record; n integer := 0;
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if not exists (select 1 from public.bank_movements where id = p_movement and org_id = p_org) then raise exception 'Depósito inexistente'; end if;
  delete from public.bank_matches where org_id = p_org and bank_movement_id = p_movement;
  for v in select id, total from public.arca_vouchers where org_id = p_org and id = any(p_vouchers) and direction = 'emitido' loop
    insert into public.bank_matches (org_id, bank_movement_id, arca_voucher_id, invoice_total, method) values (p_org, p_movement, v.id, v.total, 'manual')
    on conflict (arca_voucher_id) do update set bank_movement_id = excluded.bank_movement_id, method = 'manual';
    n := n + 1;
  end loop;
  -- retenciones = lo que falta entre las facturas y el depósito, repartido por importe
  update public.bank_matches m set ret_iibb = round((m.invoice_total / t.tot) * greatest(0, t.tot - b.amount), 2), ret_ganancias = 0
  from (select sum(invoice_total) tot from public.bank_matches where bank_movement_id = p_movement) t, public.bank_movements b
  where m.bank_movement_id = p_movement and b.id = p_movement and t.tot > 0;
  return n;
end;
$$;
revoke all on function public.bank_match_manual(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.bank_match_manual(uuid, uuid, uuid[]) to authenticated;

-- Cada factura emitida con su cobro (o pendiente)
create view public.invoice_collections with (security_invoker = true) as
select v.id, v.org_id, v.issue_date, v.voucher_type, v.point_of_sale, v.number, v.name, v.doc_number, v.total,
  m.bank_movement_id, b.mov_date as paid_on, b.amount as deposit_amount, m.ret_iibb, m.ret_ganancias, m.method,
  case when b.mov_date is not null then b.mov_date - v.issue_date end as days_to_pay,
  (select max(p.notified_at)::date from public.bac_payments p where p.org_id = v.org_id and p.point_of_sale::int = v.point_of_sale and p.number::bigint = v.number) as sigaf_notified
from public.arca_vouchers v
left join public.bank_matches m on m.arca_voucher_id = v.id
left join public.bank_movements b on b.id = m.bank_movement_id
where v.direction = 'emitido' and not v.credit_note;
grant select on public.invoice_collections to authenticated;

-- Retenciones de los cobros del GCBA en Impuestos
create or replace view public.tax_withholdings_monthly with (security_invoker = true) as
select org_id, month,
  sum(ret_iibb) ret_iibb, sum(ret_ganancias) ret_ganancias, sum(ret_iva) ret_iva, sum(ret_suss) ret_suss, sum(ret_otras) ret_otras,
  sum(sircreb) sircreb, sum(percepciones) percepciones
from (
  select org_id, to_char(payment_date, 'YYYY-MM') as month, ret_iibb, ret_ganancias, ret_iva, ret_suss, ret_otras, 0::numeric sircreb, 0::numeric percepciones
  from public.collections where status = 'confirmado'
  union all
  select m.org_id, to_char(b.mov_date, 'YYYY-MM'), m.ret_iibb, m.ret_ganancias, 0, 0, 0, 0, 0
  from public.bank_matches m join public.bank_movements b on b.id = m.bank_movement_id
  union all
  select org_id, to_char(mov_date, 'YYYY-MM'), 0, 0, 0, 0, 0, amount, 0 from public.bank_movements where kind = 'sircreb'
  union all
  select org_id, to_char(issue_date, 'YYYY-MM'), 0, 0, 0, 0, 0, 0, (case when credit_note then -1 else 1 end) * other_taxes * coalesce(exchange_rate, 1)
  from public.arca_vouchers where direction = 'recibido' and other_taxes <> 0
) t
group by org_id, month;
grant select on public.tax_withholdings_monthly to authenticated;

-- Cruce inicial de lo que ya está cargado
select public.bank_match_gcba(id) from public.organizations;
