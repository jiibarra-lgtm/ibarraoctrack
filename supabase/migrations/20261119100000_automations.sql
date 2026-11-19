-- =====================================================================
-- Automatizaciones. Todo corre solo cada 10 minutos (pg_cron) y avisa por notificación
-- usando los recordatorios "automáticos" (auto = true): se mandan una vez y quedan como hechos.
-- =====================================================================

-- ---------- Avisos automáticos (canal único de notificaciones) ----------
alter table public.reminders add column if not exists auto boolean not null default false;
alter table public.reminders add column if not exists auto_key text;
create unique index if not exists uq_reminders_auto_key on public.reminders(org_id, auto_key) where auto_key is not null;

create or replace function public.notify(p_org uuid, p_key text, p_title text, p_notes text, p_link text,
                                         p_due timestamptz default now(), p_priority text default 'normal')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.reminders (org_id, title, notes, due_at, link_path, link_label, priority, auto, auto_key, created_by)
  values (p_org, left(p_title, 200), left(p_notes, 2000), p_due,
          case when p_link ~ '^/[^/\\]' then left(p_link, 500) end, null, case when p_priority = 'alta' then 'alta' else 'normal' end, true, left(p_key, 200), null)
  on conflict (org_id, auto_key) where auto_key is not null do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.reminder_events (reminder_id, org_id, kind, detail, source, by_user) values (v_id, p_org, 'creado', 'Aviso automático', 'sistema', null);
  end if;
  return v_id is not null;
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text, timestamptz, text) from public, anon, authenticated;

-- Los automáticos se dan por hechos apenas se avisan
create or replace function public.reminders_mark(p_key text, p_sent jsonb, p_ok jsonb, p_failed jsonb, p_gone jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare x jsonb; r public.reminders; nxt timestamptz; v_ok boolean;
begin
  if not public._reminders_key_ok(p_key) then raise exception 'Clave inválida' using errcode = '28000'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_sent, '[]')) loop
    select * into r from public.reminders where id = (x->>'id')::uuid for update;
    continue when r.id is null or r.status <> 'pendiente';
    v_ok := coalesce((x->>'ok')::boolean, false);
    if r.auto then
      update public.reminders set status = 'hecho', done_at = now(), notified_at = now(), notify_count = notify_count + 1, updated_at = now() where id = r.id;
    elsif r.repeat <> 'none' and r.nag_minutes is null then
      nxt := public.reminder_next(r.due_at, r.repeat, now());
      update public.reminders set due_at = nxt, notified_at = null, notify_count = notify_count + 1, updated_at = now() where id = r.id;
    else
      update public.reminders set notified_at = now(), notify_count = notify_count + 1, updated_at = now() where id = r.id;
    end if;
    insert into public.reminder_events (reminder_id, org_id, kind, detail, source, by_user)
    values (r.id, r.org_id, case when v_ok then 'notificado' else 'sin_dispositivo' end,
            case when v_ok then coalesce(x->>'devices', '0') || ' dispositivo(s)' else 'No hay celular ni compu con avisos activados' end, 'sistema', null);
  end loop;
  update public.push_subscriptions set last_ok_at = now(), failures = 0 where endpoint in (select jsonb_array_elements_text(coalesce(p_ok, '[]')));
  update public.push_subscriptions set failures = failures + 1 where endpoint in (select jsonb_array_elements_text(coalesce(p_failed, '[]')));
  delete from public.push_subscriptions where endpoint in (select jsonb_array_elements_text(coalesce(p_gone, '[]')));
end;
$$;
revoke all on function public.reminders_mark(text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.reminders_mark(text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- ---------- 98) Vigía de la sincronización de Gmail ----------
create table if not exists public.inbound_errors (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  at timestamptz not null default now(),
  message text check (length(message) <= 500)
);
create index if not exists idx_inbound_errors on public.inbound_errors(org_id, at desc);
alter table public.inbound_errors enable row level security;
create policy inbound_errors_select on public.inbound_errors for select to authenticated using (public.is_org_member(org_id));

create or replace function public.inbound_log_error(p_token text, p_message text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_token is null or length(p_token) < 32 then return; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then return; end if;
  insert into public.inbound_errors (org_id, message) values (v_org, left(p_message, 500));
  delete from public.inbound_errors where org_id = v_org and at < now() - interval '30 days';
end;
$$;
revoke all on function public.inbound_log_error(text, text) from public;
grant execute on function public.inbound_log_error(text, text) to anon, authenticated;

create or replace function public.auto_gmail_watchdog(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz; v_err integer; v_hour integer := extract(hour from now() at time zone 'America/Argentina/Buenos_Aires');
begin
  select max(last_used_at) into v_last from public.inbound_tokens where org_id = p_org;
  if v_last is null or v_hour < 7 then return; end if;
  select count(*) into v_err from public.inbound_errors where org_id = p_org and at > now() - interval '40 minutes';
  if exists (select 1 from public.reminders where org_id = p_org and auto_key like 'gmail-watch:%' and created_at > now() - interval '3 hours') then return; end if;
  if v_err >= 2 then
    perform public.notify(p_org, 'gmail-watch:' || to_char(now(), 'YYYYMMDDHH24'), 'La sincronización de Gmail está fallando',
      v_err || ' envíos rechazados en los últimos 40 minutos. Los mails nuevos no están entrando al sistema.', '/configuracion', now(), 'alta');
  elsif v_last < now() - interval '50 minutes' then
    perform public.notify(p_org, 'gmail-watch:' || to_char(now(), 'YYYYMMDDHH24'), 'La sincronización de Gmail se cortó',
      'El script de Gmail no corre desde hace ' || round(extract(epoch from now() - v_last) / 60) || ' minutos. Revisá que el activador siga activo.', '/configuracion', now(), 'alta');
  end if;
end;
$$;

-- ---------- 19) Cierre automático de OC entregadas, facturadas y cobradas ----------
create or replace function public.auto_po_close(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_profit numeric;
begin
  for r in
    select po.id, coalesce(po.bac_number, po.internal_number::text) as num, b.order_total, b.currency
      from public.purchase_orders po
      join public.po_billing b on b.purchase_order_id = po.id
      join public.po_delivery_summary d on d.purchase_order_id = po.id
     where po.org_id = p_org and po.status in ('recibida', 'perfeccionada', 'en_ejecucion', 'completada')
       and d.delivered_pct >= 100 and b.order_total > 0 and b.to_invoice <= 0.01 and b.to_collect <= 0.01
  loop
    perform set_config('app.status_reason', 'Cierre automático: entregada, facturada y cobrada', true);
    update public.purchase_orders set status = 'cerrada' where id = r.id;
    select operating_profit_realized into v_profit from public.po_profitability where purchase_order_id = r.id;
    perform public.notify(p_org, 'po-close:' || r.id, 'OC ' || r.num || ' cerrada',
      'Entregada, facturada y cobrada.' || coalesce(' Ganaste $ ' || to_char(round(v_profit), 'FM999G999G999G990') || '.', ''), '/ordenes/' || r.id);
  end loop;
end;
$$;

-- ---------- 21) Prórrogas de plazo leídas de los mails ----------
create table if not exists public.po_due_changes (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  mail_id uuid not null references public.mail_messages(id) on delete cascade,
  old_due date, new_due date not null, excerpt text, at timestamptz not null default now(),
  unique (mail_id, purchase_order_id)
);
alter table public.po_due_changes enable row level security;
create policy po_due_changes_select on public.po_due_changes for select to authenticated using (public.is_org_member(org_id));

create or replace function public.ar_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(p, '(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})');
  if m is null then return null; end if;
  return make_date(case when length(m[3]) = 2 then 2000 + m[3]::int else m[3]::int end, m[2]::int, m[1]::int);
exception when others then return null;
end;
$$;

create or replace function public.auto_po_extensions(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_txt text; v_new date; v_ex text;
begin
  for r in
    select m.id as mail_id, m.subject, m.body, po.id as po_id, po.due_date, coalesce(po.bac_number, po.internal_number::text) as num
      from public.mail_messages m
      join lateral unnest(public.oc_refs_from_text(coalesce(m.subject, '') || ' ' || left(coalesce(m.body, ''), 4000))) ref on true
      join public.purchase_orders po on po.org_id = m.org_id and upper(po.bac_number) = ref and po.status not in ('cerrada', 'anulada')
     where m.org_id = p_org and m.received_at > now() - interval '120 days'
       and (coalesce(m.subject, '') || ' ' || left(coalesce(m.body, ''), 4000)) ~* 'pr[oó]rroga'
       and not exists (select 1 from public.po_due_changes c where c.mail_id = m.id and c.purchase_order_id = po.id)
  loop
    v_txt := coalesce(r.subject, '') || ' ' || left(coalesce(r.body, ''), 4000);
    v_ex := substring(v_txt from '(?i)([^.\n]{0,80}pr[oó]rroga[^.\n]{0,160})');
    v_new := public.ar_date(substring(v_txt from '(?i)pr[oó]rroga[^\n]{0,160}?(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})'));
    if v_new is null then
      v_new := public.ar_date(substring(v_txt from '(?i)(?:hasta el|nueva fecha|nuevo plazo|plazo de entrega)[^\d]{0,30}(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})'));
    end if;
    -- sin fecha clara o una fecha que no extiende: se registra para no volver a mirarlo, pero no se toca la OC
    insert into public.po_due_changes (org_id, purchase_order_id, mail_id, old_due, new_due, excerpt)
    values (p_org, r.po_id, r.mail_id, r.due_date, coalesce(v_new, r.due_date, current_date), left(btrim(regexp_replace(coalesce(v_ex, ''), '\s+', ' ', 'g')), 300))
    on conflict do nothing;
    if v_new is not null and v_new > coalesce(r.due_date, '1900-01-01') and v_new < current_date + 365 then
      update public.purchase_orders set due_date = v_new where id = r.po_id;
      perform public.notify(p_org, 'po-ext:' || r.mail_id || ':' || r.po_id, 'Prórroga: la OC ' || r.num || ' vence el ' || to_char(v_new, 'DD/MM/YYYY'),
        'Lo leí de un mail' || coalesce(' («' || left(btrim(v_ex), 140) || '»)', '') || '. Antes vencía el ' || coalesce(to_char(r.due_date, 'DD/MM/YYYY'), '—') || '.', '/ordenes/' || r.po_id);
    end if;
  end loop;
end;
$$;

-- ---------- 23) PRD firmado → facturá lo entregado ----------
alter table public.bac_orders_inbox add column if not exists invoice_notified_at timestamptz;
create or replace function public.auto_prd_invoice(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in
    select i.bac_number, i.prd_number, po.id as po_id, b.to_invoice
      from public.bac_orders_inbox i
      join public.purchase_orders po on po.org_id = i.org_id and upper(po.bac_number) = upper(i.bac_number) and po.status <> 'anulada'
      join public.po_billing b on b.purchase_order_id = po.id
     where i.org_id = p_org and i.prd_at > now() - interval '30 days' and i.invoice_notified_at is null and b.to_invoice > 0.01
  loop
    perform public.notify(p_org, 'prd-inv:' || r.bac_number, 'Facturá la OC ' || r.bac_number,
      'Llegó el PRD' || coalesce(' n° ' || r.prd_number, '') || '. Falta facturar $ ' || to_char(round(r.to_invoice), 'FM999G999G999G990') || ': la factura ya tiene los renglones entregados.',
      '/ordenes/' || r.po_id || '?tab=facturacion');
    update public.bac_orders_inbox set invoice_notified_at = now() where org_id = p_org and bac_number = r.bac_number;
  end loop;
end;
$$;

-- ---------- 57 y 59) Licitaciones que tienen productos que vendés ----------
alter table public.bac_publications add column if not exists relevant boolean;
alter table public.bac_publications add column if not exists matched text;

create or replace function public.pub_keywords(p_org uuid) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(distinct w, '|') from (
    select unnest(array['limpieza','higiene','residuo','bolsa','papel','descartable','tocador','perfumer','bazar','lavandina','detergente',
                        'jab[oó]n','desinfect','contenedor','residuos','trapo','escoba','secador','guante','barbijo','toalla','servilleta','aerosol','cloro']) as w
    union all
    select lower(word) from public.convenio_lines l,
           regexp_split_to_table(split_part(coalesce(l.product_name, l.item_description, ''), '·', 1), '[^[:alpha:]áéíóúñ]+') word
     where l.org_id = p_org and l.is_mine and length(word) >= 6
       and lower(word) not in ('unidad','unidades','blanco','negro','color','litros','gramos','modelo','tamano','tamaño','medidas','material','plastico','plástico','personas','social')
  ) x
$$;

create or replace function public.auto_publications(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_re text := public.pub_keywords(p_org); r record; v_hit text;
begin
  if v_re is null then return; end if;
  for r in select * from public.bac_publications where org_id = p_org and relevant is null and received_at > now() - interval '60 days' loop
    v_hit := substring(lower(coalesce(r.title, '')) from '(' || v_re || ')');
    update public.bac_publications set relevant = v_hit is not null, matched = v_hit where id = r.id;
    continue when v_hit is null;
    if r.received_at > now() - interval '3 days' then
      perform public.notify(p_org, 'pub:' || r.id, 'Licitación para vos: ' || left(coalesce(r.title, r.process_number), 150),
        coalesce(r.unit_name, '') || coalesce(' · abre el ' || to_char(r.opening_date, 'DD/MM'), '') || ' · ' || upper(r.source) || ' ' || r.process_number,
        case when r.source = 'comprar' then '/licitaciones/comprar' else '/licitaciones' end);
    end if;
    if r.opening_date is not null and r.opening_date - 2 >= current_date then
      perform public.notify(p_org, 'pub-open:' || r.id, 'Abre en 2 días: ' || left(coalesce(r.title, r.process_number), 150),
        'Apertura el ' || to_char(r.opening_date, 'DD/MM') || '. Revisá precios, garantía y documentación. ' || upper(r.source) || ' ' || r.process_number,
        case when r.source = 'comprar' then '/licitaciones/comprar' else '/licitaciones' end,
        ((r.opening_date - 2)::timestamp + time '09:00') at time zone 'America/Argentina/Buenos_Aires', 'alta');
    end if;
  end loop;
end;
$$;

-- ---------- 78) Fijo o variable, solo (salvo que lo hayas marcado vos) ----------
alter table public.fixed_costs add column if not exists variable_manual boolean not null default false;
update public.fixed_costs set variable_manual = true where is_variable;
create or replace function public.fixed_classify(p_org uuid) returns void
language sql security definer set search_path = '' as $$
  update public.fixed_costs f set is_variable = true, updated_at = now()
   where f.org_id = p_org and not f.variable_manual and not f.is_variable
     and (select count(*)::numeric / greatest(count(distinct b.period), 1) from public.fixed_cost_bills b
           where b.cost_id = f.id and b.period >= to_char(current_date - 180, 'YYYY-MM')) > 2.5;
$$;

-- ---------- 63) Más clases de mail: pagos y publicidad ----------
create or replace function public.mail_kind(p_subject text, p_body text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(reclamo|no (nos )?(ha |han )?(lleg[oóa]|recib|entreg)|todav[ií]a no (lleg|recib|entreg)|a[uú]n no (lleg|recib|entreg)|faltante|faltan? (unidades|productos|art[ií]culos|renglones|cajas|bultos)|demora en (la )?entrega|sin entregar|incumplimiento|intimaci[oó]n|vencid[oa] el plazo|plazo de entrega vencido|penalidad)' then 'reclamo'
    when t ~* '(recib[ií]mos conforme|recepci[oó]n conforme|conformidad de (la )?recepci|remito firmado|firmado y sellado|fue recibid[oa] (la|el)? ?(mercader|pedido|material|entrega)|se recibi[oó] (la|el) (mercader|pedido|material|entrega))' then 'conformidad'
    when t ~* '(coordinar (la )?entrega|horario de (entrega|recepci)|d[ií]a de entrega|entregar en|lugar de entrega|cu[aá]ndo (pueden|podr[ií]an|van a) entregar|turno de entrega|pedido de entrega|solicitud de entrega|fecha de entrega)' then 'entrega'
    when t ~* '(cotiz|presupuesto|compulsa|solicitud de precio)' then 'cotizacion'
    when t ~* '(orden de pago|comprobante de (pago|transferencia)|transferencia realizada|pago acreditado|liquidaci[oó]n de pago|aviso de pago)' then 'pago'
    when t ~* '(newsletter|desuscrib|unsubscribe|cancelar suscripci|promoci[oó]n|oferta exclusiva|descuento especial|webinar|bolet[ií]n)' then 'publicidad'
    else null end
  from (select coalesce(p_subject, '') || ' ' || left(coalesce(p_body, ''), 3000) as t) x
$$;

-- ---------- 66) Horario de atención sacado de la firma ----------
create or replace function public.mail_hours(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(substring(coalesce(p, '') from '(?i)((?:horario(?: de atenci[oó]n| de recepci[oó]n| de entrega)?|atenci[oó]n)[^\n]{0,15}?(?:de )?\d{1,2}(?:[:.]\d{2})?\s*(?:a|-|hasta)\s*\d{1,2}(?:[:.]\d{2})?\s*(?:h|hs|horas)?)')), '')
$$;

create or replace view public.mail_contacts with (security_invoker = true) as
with refs as (
  select m.org_id, lower(m.from_email) as email,
         unnest(public.oc_refs_from_text(coalesce(m.subject, '') || ' ' || coalesce(m.snippet, '') || ' ' ||
           coalesce((select string_agg(x->>'name', ' ') from jsonb_array_elements(coalesce(m.attachments, '[]')) x), ''))) as ref
    from public.mail_messages m
   where m.received_at >= now() - interval '365 days'
)
select r.org_id, r.from_email as email,
       (array_agg(r.from_name order by r.received_at desc) filter (where coalesce(r.from_name, '') <> ''))[1] as name,
       count(*) as mails,
       count(*) filter (where r.received_at >= now() - interval '7 days') as last_7d,
       max(r.received_at) as last_at,
       count(*) filter (where r.replied_at is null) as unanswered,
       count(*) filter (where r.replied_at is null and r.kind = 'cotizacion') as unanswered_quotes,
       count(*) filter (where r.kind = 'reclamo') as complaints,
       round((percentile_cont(0.5) within group (order by extract(epoch from (r.replied_at - r.received_at)) / 3600)
             filter (where r.replied_at is not null))::numeric, 1) as reply_hours,
       (select public.mail_phone(mm.body) from public.mail_messages mm
         where mm.org_id = r.org_id and lower(mm.from_email) = r.from_email and public.mail_phone(mm.body) is not null
         order by mm.received_at desc limit 1) as phone,
       coalesce((select array_agg(distinct f.ref) from refs f where f.org_id = r.org_id and f.email = r.from_email
                   and (exists (select 1 from public.bac_orders_inbox i where i.org_id = f.org_id and upper(i.bac_number) = f.ref)
                        or exists (select 1 from public.purchase_orders po where po.org_id = f.org_id and upper(po.bac_number) = f.ref))), '{}') as oc_refs,
       (select public.mail_hours(mm.body) from public.mail_messages mm
         where mm.org_id = r.org_id and lower(mm.from_email) = r.from_email and public.mail_hours(mm.body) is not null
         order by mm.received_at desc limit 1) as hours
  from public.mail_replies r
 where r.from_email !~* '(sigaf|no-?reply|notifica|sistema|mesa ?de ?entradas)'
 group by r.org_id, r.from_email;

-- ---------- 84) Las compras cargadas a mano también suman stock ----------
create or replace view public.stock_raw with (security_invoker = true) as
SELECT i.org_id, 'factura'::text AS source, i.id AS ref_id, s.issue_date AS mov_date, public.norm(i.description) AS key, i.description,
       (i.quantity * (COALESCE(i.pack, 1))::numeric) AS qty,
       CASE WHEN i.unit_final IS NOT NULL THEN i.unit_final / (COALESCE(i.pack, 1))::numeric ELSE NULL::numeric END AS unit_cost,
       COALESCE(s.supplier_name, ''::text) AS party, s.id AS doc_id
  FROM public.supplier_invoice_items i JOIN public.supplier_invoices s ON s.id = i.invoice_id
 WHERE NOT s.hidden AND s.kind = 'factura'::text
UNION ALL
SELECT o.org_id, 'mercadolibre'::text, o.id, (COALESCE(o.ordered_at, o.created_at))::date, public.norm(o.title), o.title, COALESCE(o.quantity, 1::numeric),
       CASE WHEN o.unit_price IS NOT NULL THEN o.unit_price WHEN o.total_amount IS NOT NULL AND o.quantity > 0::numeric THEN o.total_amount / o.quantity ELSE NULL::numeric END,
       COALESCE(o.counterpart, 'Mercado Libre'::text), o.id
  FROM public.ml_orders o
 WHERE o.kind = 'compra'::text AND o.merged_into IS NULL AND o.status <> 'cancelada'::text AND length(o.title) >= 4
UNION ALL
SELECT pi.org_id, 'compra'::text, pi.id, p.invoice_date, public.norm(pi.description), pi.description, pi.quantity,
       pi.unit_price * (1 - coalesce(pi.discount_pct, 0) / 100), COALESCE(sp.name, ''::text), p.id
  FROM public.purchase_items pi
  JOIN public.purchases p ON p.id = pi.purchase_id
  LEFT JOIN public.suppliers sp ON sp.id = p.supplier_id
 WHERE p.status = 'confirmada' and pi.quantity > 0
   -- si la misma factura ya entró leída del mail, no se cuenta dos veces
   AND NOT EXISTS (SELECT 1 FROM public.supplier_invoices si WHERE si.org_id = p.org_id AND NOT si.hidden
                     AND si.point_of_sale::text = p.point_of_sale::text AND si.number::text = p.number::text
                     AND regexp_replace(coalesce(si.supplier_cuit, ''), '\D', '', 'g') = regexp_replace(coalesce(sp.cuit, ''), '\D', '', 'g'))
UNION ALL
SELECT ri.org_id, 'remito'::text, ri.id, (r.issued_at)::date, public.norm(ri.description), ri.description, (- ri.quantity), NULL::numeric, r.recipient_name, r.id
  FROM public.remito_items ri JOIN public.remitos r ON r.id = ri.remito_id
 WHERE r.status <> 'anulado'::text;

-- ---------- 40) Foto de la semana del banco (lunes 9 hs) ----------
create or replace function public.auto_weekly_bank(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamp := now() at time zone 'America/Argentina/Buenos_Aires';
        v_mon date := (date_trunc('week', v_now))::date; v_from date; v_in numeric; v_out numeric; v_bal numeric;
begin
  if extract(isodow from v_now) <> 1 or extract(hour from v_now) < 9 then return; end if;
  v_from := v_mon - 7;
  select coalesce(sum(amount) filter (where direction = 'in'), 0), coalesce(sum(amount) filter (where direction = 'out'), 0)
    into v_in, v_out from public.bank_movements where org_id = p_org and mov_date >= v_from and mov_date < v_mon;
  select balance into v_bal from public.bank_balances where org_id = p_org and as_of < (v_mon::timestamp + time '12:00') at time zone 'America/Argentina/Buenos_Aires' order by as_of desc limit 1;
  if v_in = 0 and v_out = 0 then return; end if;
  perform public.notify(p_org, 'week-bank:' || v_mon, 'Tu semana en el banco',
    'Entró $ ' || to_char(round(v_in), 'FM999G999G999G990') || ' · salió $ ' || to_char(round(v_out), 'FM999G999G999G990') ||
    coalesce(' · cerró en $ ' || to_char(round(v_bal), 'FM999G999G999G990'), '') || ' (del ' || to_char(v_from, 'DD/MM') || ' al ' || to_char(v_mon - 1, 'DD/MM') || ')', '/banco');
end;
$$;

-- ---------- 32 y 28) Primer día del mes: planilla de facturas y certificados para el contador ----------
create or replace function public.auto_monthly_accounting(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_now timestamp := now() at time zone 'America/Argentina/Buenos_Aires'; v_prev text := to_char(v_now - interval '1 month', 'YYYY-MM'); v_n integer; v_c integer;
begin
  if extract(day from v_now) <> 1 or extract(hour from v_now) < 9 then return; end if;
  select count(*) into v_n from public.arca_vouchers where org_id = p_org and direction = 'emitido' and to_char(issue_date, 'YYYY-MM') = v_prev;
  select count(*) into v_c from public.retention_certificates where org_id = p_org and to_char(received_at, 'YYYY-MM') = v_prev;
  perform public.notify(p_org, 'month-acc:' || v_prev, 'Planilla de ' || v_prev || ' para el contador',
    v_n || ' facturas emitidas con su estado de cobro' || case when v_c > 0 then ' · ' || v_c || ' certificados de retención' else '' end || '. Tocá para descargarla.',
    '/cobranzas?planilla=' || v_prev);
end;
$$;

-- Certificados de retención que llegaron por mail (adjuntos)
create or replace view public.retention_certificates with (security_invoker = true) as
select m.id, m.org_id, m.thread_id, m.message_id, m.from_email, m.from_name, m.subject, m.received_at, x->>'name' as file
  from public.mail_messages m, jsonb_array_elements(coalesce(m.attachments, '[]')) x
 where (coalesce(m.subject, '') || ' ' || coalesce(x->>'name', '')) ~* '(certificad[oa]s? de retenci|constancia de retenci|retenci[oó]n (de )?(ii\.?bb|ingresos brutos|ganancias|iva|suss)|comprobante de retenci|sircreb|certificado.*retenc)';

-- ---------- 13) Compras de ML: llega hoy / ya llegó ----------
create or replace function public.auto_ml_shipments(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id, title, eta, status, delivered_at from public.ml_orders
            where org_id = p_org and kind = 'compra' and merged_into is null and updated_at > now() - interval '2 days'
              and ((status = 'en_camino' and eta ~* 'hoy') or (status = 'entregada' and delivered_at > now() - interval '1 day'))
  loop
    if r.status = 'entregada' then
      perform public.notify(p_org, 'ml-ok:' || r.id, 'Llegó tu compra de Mercado Libre', left(r.title, 300), '/mercadolibre/compras');
    else
      perform public.notify(p_org, 'ml-today:' || r.id, 'Hoy llega tu compra de Mercado Libre', left(r.title, 300), '/mercadolibre/compras');
    end if;
  end loop;
end;
$$;

-- ---------- El tic: corre todo ----------
create or replace function public.automations_tick() returns void
language plpgsql security definer set search_path = '' as $$
declare o uuid;
begin
  for o in select id from public.organizations loop
    begin perform public.auto_gmail_watchdog(o); exception when others then null; end;
    begin perform public.auto_po_close(o); exception when others then null; end;
    begin perform public.auto_po_extensions(o); exception when others then null; end;
    begin perform public.auto_prd_invoice(o); exception when others then null; end;
    begin perform public.auto_publications(o); exception when others then null; end;
    begin perform public.fixed_classify(o); exception when others then null; end;
    begin perform public.auto_weekly_bank(o); exception when others then null; end;
    begin perform public.auto_monthly_accounting(o); exception when others then null; end;
    begin perform public.auto_ml_shipments(o); exception when others then null; end;
  end loop;
end;
$$;
revoke all on function public.automations_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'automations-tick';
select cron.schedule('automations-tick', '*/10 * * * *', 'select public.automations_tick()');
