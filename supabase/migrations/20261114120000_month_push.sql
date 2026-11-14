-- =====================================================================
-- 1) Aviso push: OC perfeccionada en BAC sin el PDF cargado después de 24 h
-- 2) Resumen del mes por etapa (adjudicado / entregado / facturado / cobrado), con y sin IVA,
--    y ganancia estimada de lo adjudicado en el mes según el costo cargado
-- =====================================================================

alter table public.bac_orders_inbox add column if not exists missing_sent_at timestamptz;

create or replace function public.push_outbox(p_token text, p_new_public text default null, p_new_private text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_now timestamp := (now() at time zone 'America/Argentina/Buenos_Aires'); v_today date; k public.push_keys;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  v_today := v_now::date;
  if p_new_public is not null and p_new_private is not null then
    insert into public.push_keys (org_id, public_key, private_key) values (v_org, left(p_new_public, 200), left(p_new_private, 200)) on conflict do nothing;
  end if;
  select * into k from public.push_keys where org_id = v_org;
  return jsonb_build_object(
    'public_key', k.public_key, 'private_key', k.private_key,
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', endpoint, 'p256dh', p256dh, 'auth', auth))
                                from public.push_subscriptions where org_id = v_org and failures < 5), '[]'::jsonb),
    'notifications', case when extract(hour from v_now) between 8 and 21 then coalesce((
      select jsonb_agg(x) from (
        select jsonb_build_object('id', w.id, 'type', 'open', 'contract', w.contract_number, 'name', coalesce(w.contract_name, c.name),
                 'ends_on', w.ends_on, 'stock', exists (select 1 from public.convenio_windows s where s.org_id = w.org_id and s.contract_number = w.contract_number and s.kind = 'stock' and s.starts_on = w.starts_on)) x
        from public.convenio_windows w left join public.convenios c on c.org_id = w.org_id and c.contract_number = w.contract_number
        where w.org_id = v_org and w.kind = 'precios' and w.open_sent_at is null and v_today between w.starts_on and w.ends_on
        union all
        select jsonb_build_object('id', w.id, 'type', 'closing', 'contract', w.contract_number, 'name', coalesce(w.contract_name, c.name),
                 'ends_on', w.ends_on, 'stock', false)
        from public.convenio_windows w left join public.convenios c on c.org_id = w.org_id and c.contract_number = w.contract_number
        where w.org_id = v_org and w.kind = 'precios' and w.closing_sent_at is null and v_today = w.ends_on - 1 and w.ends_on > w.starts_on
        union all
        (select jsonb_build_object('id', b.id, 'type', 'oc_missing', 'contract', b.bac_number,
                 'name', coalesce(u.name, 'Unidad ' || b.unit_code), 'ends_on', b.perfected_at::date, 'stock', false)
           from public.bac_orders_inbox b
           left join public.bac_units u on u.org_id = b.org_id and u.code = b.unit_code
          where b.org_id = v_org and not b.dismissed and b.missing_sent_at is null
            and b.perfected_at is not null and b.perfected_at <= now() - interval '24 hours'
            and not exists (select 1 from public.purchase_orders po where po.org_id = b.org_id and upper(po.bac_number) = b.bac_number)
          order by b.perfected_at limit 10)
      ) t), '[]'::jsonb) else '[]'::jsonb end);
end;
$$;
revoke all on function public.push_outbox(text, text, text) from public;
grant execute on function public.push_outbox(text, text, text) to anon, authenticated;

create or replace function public.push_mark(p_token text, p_sent jsonb, p_ok jsonb, p_failed jsonb, p_gone jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  update public.convenio_windows w set open_sent_at = now()
  where w.org_id = v_org and w.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'open');
  update public.convenio_windows w set closing_sent_at = now()
  where w.org_id = v_org and w.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'closing');
  update public.bac_orders_inbox b set missing_sent_at = now()
  where b.org_id = v_org and b.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'oc_missing');
  update public.push_subscriptions set last_ok_at = now(), failures = 0 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_ok, '[]')));
  update public.push_subscriptions set failures = failures + 1 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_failed, '[]')));
  delete from public.push_subscriptions where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_gone, '[]')));
end;
$$;
revoke all on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Resumen del mes. Importes "con IVA" tal como figuran en OC / factura; "sin IVA" según la
-- configuración financiera (por defecto las OC del GCBA incluyen IVA 21%).
-- ---------------------------------------------------------------------
create or replace function public.month_stages(p_org uuid, p_month date, p_currency text default 'ARS')
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  v_from date := date_trunc('month', p_month)::date;
  v_to date := (date_trunc('month', p_month) + interval '1 month')::date;
  v_div numeric;
  r jsonb;
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  select case when coalesce(fs.sales_include_vat, true) then 1 + coalesce(fs.default_vat_rate, 21) / 100 else 1 end
    into v_div from public.financial_settings fs where fs.org_id = p_org;
  v_div := coalesce(v_div, 1.21);

  with pos as (
    select po.id, coalesce(po.total_amount, po.net_amount, 0) as gross
      from public.purchase_orders po
     where po.org_id = p_org and po.currency = p_currency and po.status not in ('anulada', 'borrador')
       and po.issue_date >= v_from and po.issue_date < v_to
  ),
  items as (
    select x.purchase_order_item_id, x.sales_gross, x.estimated_cost, x.quantity
      from public.po_item_profitability x join pos on pos.id = x.purchase_order_id
  ),
  deliv as (
    select coalesce(sum(di.quantity * i.unit_price), 0) as gross, count(distinct d.id) as n
      from public.delivery_items di
      join public.deliveries d on d.id = di.delivery_id
      join public.purchase_order_items i on i.id = di.purchase_order_item_id
      join public.purchase_orders po on po.id = d.purchase_order_id and po.currency = p_currency
     where d.org_id = p_org and d.status in ('entregada', 'recibida_provisional', 'conformada')
       and coalesce(d.actual_date, d.planned_date) >= v_from and coalesce(d.actual_date, d.planned_date) < v_to
  ),
  inv as (
    select coalesce(sum(si.total_amount), 0) as gross, coalesce(sum(si.net_amount), 0) as net, count(*) as n
      from public.sales_invoices si
     where si.org_id = p_org and si.currency = p_currency and si.status not in ('anulada', 'borrador')
       and si.issue_date >= v_from and si.issue_date < v_to
  ),
  col as (
    select coalesce(sum(c.applied_amount), 0) as gross, coalesce(sum(c.amount_received), 0) as cash, coalesce(sum(c.withholdings), 0) as withheld, count(*) as n
      from public.collections c
     where c.org_id = p_org and c.status <> 'anulado' and c.payment_date >= v_from and c.payment_date < v_to
  )
  select jsonb_build_object(
    'month', to_char(v_from, 'YYYY-MM'), 'vat_divisor', v_div,
    'awarded', jsonb_build_object('gross', (select coalesce(sum(gross), 0) from pos), 'net', round((select coalesce(sum(gross), 0) from pos) / v_div, 2), 'count', (select count(*) from pos)),
    'delivered', jsonb_build_object('gross', (select gross from deliv), 'net', round((select gross from deliv) / v_div, 2), 'count', (select n from deliv)),
    'invoiced', jsonb_build_object('gross', (select gross from inv), 'net', (select case when net > 0 then net else round(gross / v_div, 2) end from inv), 'count', (select n from inv)),
    'collected', jsonb_build_object('gross', (select gross from col), 'net', round((select gross from col) / v_div, 2), 'cash', (select cash from col), 'withheld', (select withheld from col), 'count', (select n from col)),
    'profit', jsonb_build_object(
      'sales_net', round((select coalesce(sum(sales_gross), 0) from items) / v_div, 2),
      'sales_net_with_cost', round((select coalesce(sum(sales_gross), 0) from items where estimated_cost is not null) / v_div, 2),
      'cost', (select coalesce(sum(estimated_cost), 0) from items where estimated_cost is not null),
      'items', (select count(*) from items),
      'items_without_cost', (select count(*) from items where estimated_cost is null))
  ) into r;
  return r;
end;
$$;
revoke all on function public.month_stages(uuid, date, text) from public, anon;
grant execute on function public.month_stages(uuid, date, text) to authenticated;
