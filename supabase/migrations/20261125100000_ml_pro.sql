-- Mercado Libre completo (estilo Nubimetrics / Virtual Seller / Real Trends): publicaciones con salud, visitas y neto,
-- preguntas con respuestas automáticas, reclamos, reputación diaria, competidores, reglas de precio y automatizaciones.

-- Publicaciones: más datos (categoría, tipo, salud, visitas, comisión, envío, costo propio)
alter table public.ml_items add column if not exists category_id text;
alter table public.ml_items add column if not exists listing_type text;
alter table public.ml_items add column if not exists catalog_listing boolean not null default false;
alter table public.ml_items add column if not exists health numeric;
alter table public.ml_items add column if not exists visits_30d integer;
alter table public.ml_items add column if not exists sold_30d integer;
alter table public.ml_items add column if not exists fee_unit numeric;
alter table public.ml_items add column if not exists ship_cost numeric;
alter table public.ml_items add column if not exists cost_unit numeric;
alter table public.ml_items add column if not exists warnings jsonb not null default '[]'::jsonb;
alter table public.ml_items add column if not exists sub_status text[];
alter table public.ml_items add column if not exists date_created timestamptz;
alter table public.ml_items add column if not exists price_to_win numeric;
alter table public.ml_items add column if not exists competition text;
alter table public.ml_items add column if not exists paused_by text;
alter table public.ml_items add column if not exists metrics_at timestamptz;

create table if not exists public.ml_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  auto_answers boolean not null default false,
  auto_pause_no_stock boolean not null default true,
  vacation boolean not null default false,
  vacation_items text[] not null default '{}',
  push_sales boolean not null default true,
  push_questions boolean not null default true,
  push_claims boolean not null default true,
  repricing boolean not null default false,
  desc_template text,
  purchases_keep integer not null default 100,
  -- horario de atención: fuera de horario contesta la respuesta automática de "fuera de horario"
  hours_from smallint not null default 8,
  hours_to smallint not null default 18,
  work_days smallint[] not null default '{1,2,3,4,5}',
  off_hours_answer text default 'Hola, ¡gracias por tu consulta! En este momento estamos fuera del horario de atención (lunes a viernes de 8 a 18 hs). Te respondemos apenas volvamos. Saludos, Ibarra Insumos.',
  goal_sales numeric,
  goal_units integer,
  goal_profit numeric,
  updated_at timestamptz not null default now()
);
insert into public.ml_settings (org_id, desc_template)
select id, E'{titulo}\n\nIBARRA INSUMOS — fabricante y distribuidor con más de 40 años en el mercado.\n\n• Factura A y B.\n• Envíos a todo el país.\n• Venta mayorista: consultanos por cantidades.\n\nCualquier duda, preguntanos antes de comprar.' from public.organizations
on conflict do nothing;

create table if not exists public.ml_questions (
  org_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  item_id text,
  item_title text,
  text text not null,
  status text not null,
  from_id text,
  date_created timestamptz not null,
  answer text,
  answered_at timestamptz,
  answered_by text,
  primary key (org_id, id)
);
create index if not exists ml_questions_status on public.ml_questions (org_id, status, date_created desc);

create table if not exists public.ml_auto_answers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  keywords text[] not null check (array_length(keywords, 1) between 1 and 20),
  answer text not null check (length(answer) between 5 and 2000),
  active boolean not null default true,
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
insert into public.ml_auto_answers (org_id, name, keywords, answer)
select o.id, x.n, x.k, x.a from public.organizations o cross join (values
  ('Factura', array['factura','factura a','facturan','cuit']::text[], 'Hola, ¡gracias por consultar! Sí, hacemos factura A y B. Al comprar, dejanos tus datos fiscales en el mensaje de la compra. Saludos, Ibarra Insumos.'),
  ('Stock', array['stock','disponible','tenes','tienen','hay']::text[], 'Hola, ¡gracias por consultar! Sí, tenemos stock disponible para entrega inmediata. Podés comprar directamente. Saludos, Ibarra Insumos.'),
  ('Mayorista', array['mayor','cantidad','bulto','por mayor','mayorista','caja']::text[], 'Hola, ¡gracias por consultar! Vendemos por mayor: somos fabricantes y distribuidores. Indicanos la cantidad que necesitás y te pasamos el mejor precio. Saludos, Ibarra Insumos.'),
  ('Envío', array['envio','envío','llega','demora','retiro']::text[], 'Hola, ¡gracias por consultar! Hacemos envíos a todo el país por Mercado Envíos; el plazo exacto te lo muestra la publicación según tu código postal. Saludos, Ibarra Insumos.')
) as x(n, k, a)
where not exists (select 1 from public.ml_auto_answers a where a.org_id = o.id);

create table if not exists public.ml_claims (
  org_id uuid not null references public.organizations(id) on delete cascade,
  id text not null,
  resource_id text,
  type text,
  stage text,
  status text,
  reason text,
  title text,
  date_created timestamptz,
  due_date timestamptz,
  action_needed text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);

create table if not exists public.ml_reputation (
  org_id uuid not null references public.organizations(id) on delete cascade,
  day date not null,
  level text,
  power_seller text,
  sales_60d integer,
  claims_rate numeric,
  delayed_rate numeric,
  cancel_rate numeric,
  positive_pct numeric,
  data jsonb not null default '{}'::jsonb,
  primary key (org_id, day)
);

create table if not exists public.ml_competitors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('item', 'seller')),
  ref text not null,
  label text,
  my_item_id text,
  last jsonb,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, kind, ref)
);

create table if not exists public.ml_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null,
  title text not null,
  detail text,
  ref text,
  url text,
  seen boolean not null default false,
  pushed boolean not null default false
);
create index if not exists ml_events_org_at on public.ml_events (org_id, at desc);

create table if not exists public.ml_price_rules (
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id text not null,
  strategy text not null default 'win_catalog' check (strategy in ('win_catalog', 'match_lowest', 'cost_plus')),
  min_price numeric not null check (min_price > 0),
  max_price numeric,
  margin_pct numeric,
  step numeric not null default 1,
  active boolean not null default true,
  last_run_at timestamptz,
  last_result text,
  primary key (org_id, item_id)
);


-- Historial de cada publicación (precio, título, stock, estado) para ver qué pasó con las ventas después de un cambio
create table if not exists public.ml_item_history (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id text not null,
  at timestamptz not null default now(),
  field text not null,
  old_value text,
  new_value text,
  source text not null default 'ml',
  by_user uuid default auth.uid()
);
create index if not exists ml_item_history_item on public.ml_item_history (org_id, item_id, at desc);

-- Foto diaria de cada publicación (visitas y ventas) para tendencias, estacionalidad y pruebas A/B
create table if not exists public.ml_item_daily (
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id text not null,
  day date not null,
  visits integer,
  sold_total integer,
  price numeric,
  available integer,
  primary key (org_id, item_id, day)
);

-- Pruebas A/B: alterna título o precio cada N días y compara visitas y ventas
create table if not exists public.ml_ab_tests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_id text not null,
  field text not null check (field in ('title', 'price')),
  variant_a text not null,
  variant_b text not null,
  days_each smallint not null default 3,
  current text not null default 'a' check (current in ('a', 'b')),
  switched_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'running' check (status in ('running', 'done', 'stopped')),
  results jsonb not null default '{"a":{"days":0,"visits":0,"sold":0},"b":{"days":0,"visits":0,"sold":0}}'::jsonb
);

-- Compradores bloqueados (lista negra para comprar y preguntar)
create table if not exists public.ml_blocked_buyers (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  nickname text,
  reason text,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['ml_settings','ml_questions','ml_auto_answers','ml_claims','ml_reputation','ml_competitors','ml_events','ml_price_rules','ml_item_history','ml_item_daily','ml_ab_tests','ml_blocked_buyers'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_org_member(org_id))', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[])) with check (public.has_org_role(org_id, array['admin','finanzas','compras']::public.app_role[]))$p$, t || '_write', t);
  end loop;
end $$;

-- Para las tareas automáticas (script de Gmail, sin sesión): leer y guardar en estas tablas con el token
create or replace function public.ml_pro(p_action text, p_org uuid default null, p_token text default null, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_t text := p_data->>'table'; v_cols text; v_upd text; v_pk text; v_res jsonb;
  v_ok text[] := array['ml_items','ml_questions','ml_claims','ml_reputation','ml_competitors','ml_events','ml_price_rules','ml_settings','ml_auto_answers','ml_item_history','ml_item_daily','ml_ab_tests','ml_blocked_buyers'];
begin
  if p_token is not null then
    if length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
    select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  elsif p_org is not null and public.has_org_role(p_org, array['admin','finanzas','compras']::public.app_role[]) then
    v_org := p_org;
  end if;
  if v_org is null then raise exception 'Sin permisos' using errcode = '42501'; end if;
  if v_t is not null and not (v_t = any(v_ok)) then raise exception 'Tabla no permitida'; end if;

  if p_action = 'org' then
    return jsonb_build_object('org_id', v_org);
  elsif p_action = 'select' then
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I where org_id = $1 limit 5000) x', v_t) into v_res using v_org;
    return jsonb_build_object('rows', v_res);
  elsif p_action = 'upsert' then
    if jsonb_typeof(p_data->'rows') <> 'array' or jsonb_array_length(p_data->'rows') = 0 then return jsonb_build_object('n', 0); end if;
    select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_pk
      from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
     where i.indrelid = ('public.' || v_t)::regclass and i.indisprimary;
    -- sólo las columnas que vienen en el primer registro (más org_id)
    select string_agg(quote_ident(c.column_name), ', '), string_agg(format('%1$I = excluded.%1$I', c.column_name), ', ') filter (where c.column_name not in ('org_id', 'id', 'item_id', 'day'))
      into v_cols, v_upd
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_t and (c.column_name = 'org_id' or (p_data->'rows'->0) ? c.column_name);
    execute format('insert into public.%I (%s) select %s from jsonb_populate_recordset(null::public.%I, (select jsonb_agg(r || jsonb_build_object(''org_id'', $1)) from jsonb_array_elements($2) r)) on conflict (%s) do %s',
      v_t, v_cols, v_cols, v_t, v_pk, case when v_upd is null then 'nothing' else 'update set ' || v_upd end)
      using v_org, p_data->'rows';
    return jsonb_build_object('n', jsonb_array_length(p_data->'rows'));
  elsif p_action = 'patch' then
    -- actualiza sólo las columnas que vienen, buscando por la clave primaria (no inserta)
    declare r jsonb; v_set text; v_where text; v_n int := 0;
    begin
      for r in select * from jsonb_array_elements(coalesce(p_data->'rows', '[]'::jsonb)) loop
        select string_agg(format('%1$I = (jsonb_populate_record(null::public.%2$I, $2)).%1$I', c.column_name, v_t), ', ')
          into v_set from information_schema.columns c
         where c.table_schema = 'public' and c.table_name = v_t and r ? c.column_name
           and c.column_name not in (select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey) where i.indrelid = ('public.' || v_t)::regclass and i.indisprimary);
        select string_agg(format('%1$I = (jsonb_populate_record(null::public.%2$I, $2)).%1$I', a.attname, v_t), ' and ')
          into v_where from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
         where i.indrelid = ('public.' || v_t)::regclass and i.indisprimary and a.attname <> 'org_id';
        if v_set is null then continue; end if;
        execute format('update public.%I set %s where org_id = $1 and %s', v_t, v_set, coalesce(v_where, 'true')) using v_org, r;
        v_n := v_n + 1;
      end loop;
      return jsonb_build_object('n', v_n);
    end;
  elsif p_action = 'event' then
    -- un mismo aviso (kind + ref) no se repite
    if p_data->>'ref' is not null and exists (select 1 from public.ml_events e where e.org_id = v_org and e.kind = p_data->>'kind' and e.ref = p_data->>'ref') then return '{}'::jsonb; end if;
    insert into public.ml_events (org_id, kind, title, detail, ref, url) values (v_org, p_data->>'kind', left(p_data->>'title', 200), left(p_data->>'detail', 1000), p_data->>'ref', p_data->>'url');
    return '{}'::jsonb;
  elsif p_action = 'events_to_push' then
    select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'title', e.title, 'detail', e.detail, 'url', e.url) order by e.at), '[]'::jsonb) into v_res
      from public.ml_events e join public.ml_settings st on st.org_id = e.org_id
     where e.org_id = v_org and not e.pushed and e.at > now() - interval '1 day'
       and ((e.kind = 'venta' and st.push_sales) or (e.kind = 'pregunta' and st.push_questions) or (e.kind = 'reclamo' and st.push_claims) or e.kind in ('competencia', 'baja', 'stock'));
    update public.ml_events set pushed = true where org_id = v_org and not pushed;
    return jsonb_build_object('rows', v_res);
  elsif p_action = 'answer_used' then
    update public.ml_auto_answers set uses = uses + 1 where org_id = v_org and id = (p_data->>'id')::uuid;
    return '{}'::jsonb;
  elsif p_action = 'trim_purchases' then
    -- compras: sólo se guardan los detalles de las últimas N (las viejas quedan, pero sin el detalle pesado)
    update public.ml_orders set api_items = null
     where org_id = v_org and kind = 'compra' and api_items is not null
       and id not in (select id from public.ml_orders where org_id = v_org and kind = 'compra' order by ordered_at desc nulls last limit coalesce((p_data->>'keep')::int, 100));
    return '{}'::jsonb;
  end if;
  raise exception 'Acción desconocida';
end;
$$;
revoke all on function public.ml_pro(text, uuid, text, jsonb) from public;
grant execute on function public.ml_pro(text, uuid, text, jsonb) to anon, authenticated;
