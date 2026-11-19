-- Avisos más prolijos: de noche se guardan para las 8, se agrupan, y las licitaciones se filtran por rubro.
create or replace function public.notify(p_org uuid, p_key text, p_title text, p_notes text, p_link text,
                                         p_due timestamptz default now(), p_priority text default 'normal')
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_local timestamp := p_due at time zone 'America/Argentina/Buenos_Aires'; v_due timestamptz := p_due;
begin
  -- nada de notificaciones entre las 21 y las 8 (salvo urgentes)
  if p_priority <> 'alta' and (extract(hour from v_local) >= 21 or extract(hour from v_local) < 8) then
    v_due := ((case when extract(hour from v_local) >= 21 then v_local::date + 1 else v_local::date end)::timestamp + time '08:00') at time zone 'America/Argentina/Buenos_Aires';
  end if;
  insert into public.reminders (org_id, title, notes, due_at, link_path, link_label, priority, auto, auto_key, created_by)
  values (p_org, left(p_title, 200), left(p_notes, 2000), v_due,
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

-- Licitaciones: sólo palabras de tus rubros (no palabras sueltas de las descripciones)
create or replace function public.pub_keywords(p_org uuid) returns text
language sql stable set search_path = '' as $$
  select 'limpieza|higiene|residuo|bolsas? (de )?(residuo|consorcio|polietileno)|papel higi[eé]nico|toallas? (de papel|intercalad)|descartable|tocador|perfumer[ií]a|bazar|vajilla|lavandina|hipoclorito|detergente|jab[oó]n|desinfectante|contenedor|trapo|escoba|secador de piso|guantes? de (l[aá]tex|nitrilo|limpieza)|servilleta|aerosol|insumos de limpieza|art[ií]culos de limpieza'
$$;

-- ML: un aviso por día con todas las compras que llegan / llegaron
create or replace function public.auto_ml_shipments(p_org uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_day text := to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD'); v_n int; v_list text;
begin
  select count(*), string_agg(left(title, 60), ' · ') into v_n, v_list from (
    select title from public.ml_orders where org_id = p_org and kind = 'compra' and merged_into is null and status = 'en_camino' and eta ~* 'hoy'
       and updated_at > now() - interval '1 day' order by updated_at desc limit 6) x;
  if v_n > 0 then
    perform public.notify(p_org, 'ml-today:' || v_day || ':' || v_n, case when v_n = 1 then 'Hoy llega tu compra de Mercado Libre' else 'Hoy llegan ' || v_n || ' compras de Mercado Libre' end, v_list, '/mercadolibre/compras?v=envios');
  end if;
  select count(*), string_agg(left(title, 60), ' · ') into v_n, v_list from (
    select title from public.ml_orders where org_id = p_org and kind = 'compra' and merged_into is null and status = 'entregada'
       and delivered_at > now() - interval '1 day' order by delivered_at desc limit 6) x;
  if v_n > 0 then
    perform public.notify(p_org, 'ml-ok:' || v_day || ':' || v_n, case when v_n = 1 then 'Llegó tu compra de Mercado Libre' else 'Llegaron ' || v_n || ' compras de Mercado Libre' end, v_list, '/mercadolibre/compras?v=envios');
  end if;
end;
$$;
