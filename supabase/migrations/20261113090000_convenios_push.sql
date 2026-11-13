-- =====================================================================
-- Convenios marco: renglones (del Excel "Líneas del Convenio Marco") con el costo que carga el usuario,
-- que se aplica solo a los renglones de las OC que entran; ventanas de actualización de precios / stock
-- leídas del mail del BAC; notificaciones push de la PWA.
-- =====================================================================

create table public.convenios (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contract_number text not null,            -- 623-38-CM26
  name            text,
  process_number  text,                      -- 623-1245-LPU24 (proceso de compra del convenio)
  updated_at      timestamptz not null default now(),
  primary key (org_id, contract_number)
);
alter table public.convenios enable row level security;
create policy convenios_read on public.convenios for select to authenticated using (public.is_org_member(org_id));
grant select on public.convenios to authenticated;

create table public.convenio_lines (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  contract_number  text not null,
  line_number      integer not null check (line_number > 0),
  option_number    integer not null default 1 check (option_number > 0),
  item_code        text,
  item_description text not null,
  unit             text,
  product_name     text not null,            -- descripción corta para mostrar
  my_spec          text,                     -- lo que ofertaste (marca, presentación)
  is_mine          boolean not null default false,
  my_offer_price   numeric(18,2),
  my_current_price numeric(18,2),
  my_stock_balance numeric(18,2),
  my_stock         numeric(18,2),
  best_other_price numeric(18,2),
  offers           integer not null default 0,
  cost             numeric(18,2) check (cost is null or cost >= 0),   -- tu costo sin IVA (lo cargás vos)
  cost_updated_at  timestamptz,
  updated_at       timestamptz not null default now(),
  unique (org_id, contract_number, line_number, option_number)
);
create index idx_convenio_lines_code on public.convenio_lines(org_id, item_code, line_number, option_number);
alter table public.convenio_lines enable row level security;
create policy convenio_lines_read on public.convenio_lines for select to authenticated using (public.is_org_member(org_id));
grant select on public.convenio_lines to authenticated;

alter table public.purchase_order_items add column if not exists convenio_line_id uuid references public.convenio_lines(id) on delete set null;

-- Renglón de OC → renglón del convenio (mismo número de línea, opción y código de ítem)
create or replace function public.convenio_line_for(p_org uuid, p_line integer, p_option integer, p_code text, p_process text)
returns public.convenio_lines language sql stable set search_path = '' as $$
  select l.* from public.convenio_lines l
  left join public.convenios c on c.org_id = l.org_id and c.contract_number = l.contract_number
  where l.org_id = p_org and l.line_number = p_line and l.option_number = coalesce(p_option, 1) and p_code is not null and l.item_code = p_code
  order by (c.process_number is not null and c.process_number = p_process) desc, l.is_mine desc, l.updated_at desc
  limit 1
$$;

create or replace function public.tg_po_item_convenio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare l public.convenio_lines; v_proc text;
begin
  if new.convenio_line_id is null and new.bac_code is not null then
    select process_number into v_proc from public.purchase_orders where id = new.purchase_order_id;
    l := public.convenio_line_for(new.org_id, new.line_number, new.option_number, new.bac_code, v_proc);
    if l.id is not null then
      new.convenio_line_id := l.id;
      if new.estimated_unit_cost is null and l.cost is not null then new.estimated_unit_cost := l.cost; end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_po_item_convenio before insert or update of bac_code, line_number, option_number on public.purchase_order_items
for each row execute function public.tg_po_item_convenio();

-- Si cambiás el costo del renglón del convenio, se actualizan las OC que todavía usan ese costo (o no tenían)
create or replace function public.tg_convenio_cost()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.cost is distinct from old.cost then
    update public.purchase_order_items set estimated_unit_cost = new.cost
    where convenio_line_id = new.id and (estimated_unit_cost is null or estimated_unit_cost = old.cost);
  end if;
  return new;
end;
$$;
create trigger trg_convenio_cost after update of cost on public.convenio_lines for each row execute function public.tg_convenio_cost();

-- Carga del Excel (filas ya agrupadas por renglón en el servidor)
create or replace function public.convenio_import(p_org uuid, p_contract text, p_name text, p_lines jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v jsonb; n integer := 0;
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if upper(coalesce(p_contract, '')) !~ '^\d{2,5}-\d{1,4}-CM\d{2}$' then raise exception 'Número de convenio inválido (ej. 623-38-CM26)'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 3000 then raise exception 'Formato inválido'; end if;
  insert into public.convenios (org_id, contract_number, name) values (p_org, upper(p_contract), nullif(left(p_name, 200), ''))
  on conflict (org_id, contract_number) do update set name = coalesce(excluded.name, public.convenios.name), updated_at = now();
  for v in select * from jsonb_array_elements(p_lines) loop
    insert into public.convenio_lines (org_id, contract_number, line_number, option_number, item_code, item_description, unit, product_name, my_spec,
      is_mine, my_offer_price, my_current_price, my_stock_balance, my_stock, best_other_price, offers)
    values (p_org, upper(p_contract), (v->>'line')::int, coalesce((v->>'option')::int, 1), left(v->>'code', 30), left(coalesce(v->>'description', ''), 4000),
      left(v->>'unit', 40), left(coalesce(nullif(v->>'name', ''), left(v->>'description', 120)), 300), left(v->>'spec', 4000),
      coalesce((v->>'mine')::boolean, false), (v->>'offer_price')::numeric, (v->>'current_price')::numeric, (v->>'stock_balance')::numeric,
      (v->>'stock')::numeric, (v->>'best_other')::numeric, coalesce((v->>'offers')::int, 0))
    on conflict (org_id, contract_number, line_number, option_number) do update set
      item_code = excluded.item_code, item_description = excluded.item_description, unit = excluded.unit, product_name = excluded.product_name,
      my_spec = excluded.my_spec, is_mine = excluded.is_mine, my_offer_price = excluded.my_offer_price, my_current_price = excluded.my_current_price,
      my_stock_balance = excluded.my_stock_balance, my_stock = excluded.my_stock, best_other_price = excluded.best_other_price, offers = excluded.offers,
      updated_at = now();
    n := n + 1;
  end loop;
  -- Renglones de OC ya cargadas que corresponden a este convenio
  update public.purchase_order_items i set convenio_line_id = l.id, estimated_unit_cost = coalesce(i.estimated_unit_cost, l.cost)
  from public.convenio_lines l
  where i.org_id = p_org and l.org_id = p_org and l.contract_number = upper(p_contract) and i.convenio_line_id is null
    and l.item_code = i.bac_code and l.line_number = i.line_number and l.option_number = i.option_number;
  return n;
end;
$$;
revoke all on function public.convenio_import(uuid, text, text, jsonb) from public, anon;
grant execute on function public.convenio_import(uuid, text, text, jsonb) to authenticated;

create or replace function public.convenio_set_cost(p_org uuid, p_line uuid, p_cost numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if p_cost is not null and (p_cost < 0 or p_cost > 1e12) then raise exception 'Costo inválido'; end if;
  update public.convenio_lines set cost = round(p_cost, 2), cost_updated_at = now() where id = p_line and org_id = p_org;
end;
$$;
revoke all on function public.convenio_set_cost(uuid, uuid, numeric) from public, anon;
grant execute on function public.convenio_set_cost(uuid, uuid, numeric) to authenticated;

-- Cuántas OC usaron cada renglón (para ordenar y mostrar)
create view public.convenio_lines_overview with (security_invoker = true) as
select l.*, c.name as contract_name, c.process_number,
  (select count(*) from public.purchase_order_items i where i.convenio_line_id = l.id) as oc_lines,
  (select coalesce(sum(i.quantity), 0) from public.purchase_order_items i where i.convenio_line_id = l.id) as oc_quantity
from public.convenio_lines l
left join public.convenios c on c.org_id = l.org_id and c.contract_number = l.contract_number;
grant select on public.convenio_lines_overview to authenticated;

-- ---------------------------------------------------------------------
-- Ventanas de actualización de precios / incremento de stock (mail del BAC)
-- ---------------------------------------------------------------------
create table public.convenio_windows (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  contract_number text not null,
  kind            text not null check (kind in ('precios', 'stock')),
  starts_on       date not null,
  ends_on         date not null,
  contract_name   text,
  process_number  text,
  message_id      text,
  open_sent_at    timestamptz,
  closing_sent_at timestamptz,
  created_at      timestamptz not null default now(),
  unique (org_id, contract_number, kind, starts_on)
);
alter table public.convenio_windows enable row level security;
create policy convenio_windows_read on public.convenio_windows for select to authenticated using (public.is_org_member(org_id));
grant select on public.convenio_windows to authenticated;

create or replace function public.ingest_convenio_windows(p_token text, p_windows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_org uuid; x jsonb; n integer := 0;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_windows) <> 'array' or jsonb_array_length(p_windows) > 500 then raise exception 'Formato inválido' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_windows) loop
    continue when coalesce(x->>'contract_number', '') !~ '^\d{2,5}-\d{1,4}-CM\d{2}$' or x->>'starts_on' !~ '^\d{4}-\d{2}-\d{2}$' or x->>'ends_on' !~ '^\d{4}-\d{2}-\d{2}$';
    insert into public.convenio_windows (org_id, contract_number, kind, starts_on, ends_on, contract_name, process_number, message_id)
    values (v_org, upper(x->>'contract_number'), case when x->>'kind' = 'stock' then 'stock' else 'precios' end, (x->>'starts_on')::date, (x->>'ends_on')::date,
      left(x->>'contract_name', 200), left(upper(x->>'process_number'), 40), left(x->>'message_id', 200))
    on conflict (org_id, contract_number, kind, starts_on) do update set ends_on = excluded.ends_on;
    insert into public.convenios (org_id, contract_number, name, process_number)
    values (v_org, upper(x->>'contract_number'), left(x->>'contract_name', 200), left(upper(x->>'process_number'), 40))
    on conflict (org_id, contract_number) do update set name = coalesce(public.convenios.name, excluded.name), process_number = coalesce(excluded.process_number, public.convenios.process_number);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.ingest_convenio_windows(text, jsonb) from public;
grant execute on function public.ingest_convenio_windows(text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Notificaciones push (PWA)
-- ---------------------------------------------------------------------
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  failures   integer not null default 0,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz
);
alter table public.push_subscriptions enable row level security;
create policy push_subs_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
grant select on public.push_subscriptions to authenticated;

-- Claves VAPID por organización: sólo las leen las funciones (sin políticas = nadie las ve por la API)
create table public.push_keys (
  org_id      uuid primary key references public.organizations(id) on delete cascade,
  public_key  text not null,
  private_key text not null,
  created_at  timestamptz not null default now()
);
alter table public.push_keys enable row level security;

create or replace function public.push_public_key(p_org uuid)
returns text language sql stable security definer set search_path = '' as $$
  select k.public_key from public.push_keys k where k.org_id = p_org and public.is_org_member(p_org)
$$;
revoke all on function public.push_public_key(uuid) from public, anon;
grant execute on function public.push_public_key(uuid) to authenticated;

create or replace function public.push_subscribe(p_org uuid, p_endpoint text, p_p256dh text, p_auth text, p_ua text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 1000 or length(coalesce(p_p256dh, '')) not between 20 and 200 or length(coalesce(p_auth, '')) not between 8 and 100 then
    raise exception 'Suscripción inválida';
  end if;
  insert into public.push_subscriptions (org_id, user_id, endpoint, p256dh, auth, user_agent)
  values (p_org, auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_ua, 200))
  on conflict (endpoint) do update set org_id = excluded.org_id, user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0;
end;
$$;
revoke all on function public.push_subscribe(uuid, text, text, text, text) from public, anon;
grant execute on function public.push_subscribe(uuid, text, text, text, text) to authenticated;

create or replace function public.push_unsubscribe(p_endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
revoke all on function public.push_unsubscribe(text) from public, anon;
grant execute on function public.push_unsubscribe(text) to authenticated;

-- Para el servidor (con el token del script): claves, suscripciones y avisos pendientes.
-- Avisos: el día que abre la ventana de precios y el día anterior al cierre, entre las 8 y las 22 (hora Argentina).
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
  update public.push_subscriptions set last_ok_at = now(), failures = 0 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_ok, '[]')));
  update public.push_subscriptions set failures = failures + 1 where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_failed, '[]')));
  delete from public.push_subscriptions where org_id = v_org and endpoint in (select jsonb_array_elements_text(coalesce(p_gone, '[]')));
end;
$$;
revoke all on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function public.push_mark(text, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;

-- Primera vez que alguien activa los avisos desde la app (antes de que corra el script): genera y guarda las claves
create or replace function public.push_init_keys(p_org uuid, p_public text, p_private text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  if length(coalesce(p_public, '')) not between 40 and 200 or length(coalesce(p_private, '')) not between 20 and 200 then raise exception 'Claves inválidas'; end if;
  insert into public.push_keys (org_id, public_key, private_key) values (p_org, p_public, p_private) on conflict do nothing;
  return (select public_key from public.push_keys where org_id = p_org);
end;
$$;
revoke all on function public.push_init_keys(uuid, text, text) from public, anon;
grant execute on function public.push_init_keys(uuid, text, text) to authenticated;
