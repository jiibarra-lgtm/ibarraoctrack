-- Resumen semanal por push (lunes a la mañana): entregas de la semana, atrasadas, cobranzas, OC nuevas y sin cargar
alter table public.push_keys add column if not exists weekly_sent_on date;

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
        union all
        -- Resumen semanal: lunes desde las 8, una vez por semana
        select jsonb_build_object('id', v_org, 'type', 'weekly', 'contract', '', 'name', null, 'ends_on', v_today, 'stock', false,
          'data', jsonb_build_object(
            'due', (select count(*) from public.po_delivery_summary ds join public.purchase_orders po on po.id = ds.purchase_order_id
                     where ds.org_id = v_org and po.status not in ('anulada', 'borrador', 'completada', 'cerrada')
                       and coalesce(ds.delivered_pct, 0) < 100 and ds.due_date between v_today and v_today + 7),
            'late', (select count(*) from public.po_delivery_summary ds join public.purchase_orders po on po.id = ds.purchase_order_id
                      where ds.org_id = v_org and ds.is_late and po.status not in ('anulada', 'borrador', 'completada', 'cerrada')),
            'receivable', (select coalesce(sum(balance), 0) from public.invoice_balances where org_id = v_org and status = 'emitida' and balance > 0),
            'overdue', (select coalesce(sum(balance), 0) from public.invoice_balances where org_id = v_org and status = 'emitida' and balance > 0 and collection_status = 'vencida'),
            'new_orders', (select count(*) from public.purchase_orders where org_id = v_org and status not in ('anulada', 'borrador') and issue_date >= v_today - 7),
            'new_amount', (select coalesce(sum(total_amount), 0) from public.purchase_orders where org_id = v_org and status not in ('anulada', 'borrador') and issue_date >= v_today - 7),
            'missing', (select count(*) from public.bac_orders_inbox b where b.org_id = v_org and not b.dismissed and b.perfected_at is not null
                          and not exists (select 1 from public.purchase_orders po where po.org_id = b.org_id and upper(po.bac_number) = b.bac_number))))
        where extract(isodow from v_today) = 1 and coalesce(k.weekly_sent_on, '1900-01-01') < v_today
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
  if exists (select 1 from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'weekly') then
    update public.push_keys set weekly_sent_on = (now() at time zone 'America/Argentina/Buenos_Aires')::date where org_id = v_org;
  end if;
  update public.bac_orders_inbox b set missing_sent_at = now()
  where b.org_id = v_org and b.id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_sent, '[]')) x where x->>'type' = 'oc_missing');
  update public.push_subscriptions set last_ok_at = now(), failures = 0 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_ok, '[]')));
  update public.push_subscriptions set failures = failures + 1 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_failed, '[]')));
  delete from public.push_subscriptions where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_gone, '[]')));
end;
$$;
revoke all on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

