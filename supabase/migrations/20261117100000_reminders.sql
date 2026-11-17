-- Recordatorios personalizables: avisan al celu/compu a la hora exacta (push), se pueden repetir,
-- insistir hasta marcarlos, enlazar a una OC / entrega / cualquier pantalla, y dejan historial.
create extension if not exists pg_net;
create extension if not exists pg_cron;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (length(title) between 1 and 200),
  notes text check (notes is null or length(notes) <= 2000),
  due_at timestamptz not null,
  repeat text not null default 'none' check (repeat in ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
  nag_minutes integer check (nag_minutes is null or nag_minutes between 15 and 1440),
  priority text not null default 'normal' check (priority in ('normal', 'alta')),
  status text not null default 'pendiente' check (status in ('pendiente', 'hecho', 'cancelado')),
  order_id uuid references public.purchase_orders(id) on delete set null,
  board_id uuid references public.delivery_board(id) on delete set null,
  link_path text check (link_path is null or (link_path ~ '^/[^/\\]' and length(link_path) <= 500)),
  link_label text check (link_label is null or length(link_label) <= 200),
  notified_at timestamptz,
  notify_count integer not null default 0,
  done_at timestamptz,
  action_token uuid not null default gen_random_uuid(),
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_reminders_due on public.reminders(due_at) where status = 'pendiente';
create index if not exists idx_reminders_org on public.reminders(org_id, status, due_at);
create index if not exists idx_reminders_order on public.reminders(order_id) where order_id is not null;
create index if not exists idx_reminders_board on public.reminders(board_id) where board_id is not null;
alter table public.reminders enable row level security;
create policy reminders_select on public.reminders for select to authenticated using (public.is_org_member(org_id));
create policy reminders_write on public.reminders for all to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create table if not exists public.reminder_events (
  id bigint generated always as identity primary key,
  reminder_id uuid not null references public.reminders(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('creado', 'editado', 'notificado', 'hecho', 'pospuesto', 'reabierto', 'cancelado', 'sin_dispositivo')),
  detail text check (detail is null or length(detail) <= 300),
  source text not null default 'app' check (source in ('app', 'noti', 'sistema')),
  at timestamptz not null default now(),
  by_user uuid default auth.uid()
);
create index if not exists idx_reminder_events on public.reminder_events(reminder_id, at desc);
create index if not exists idx_reminder_events_org on public.reminder_events(org_id, at desc);
alter table public.reminder_events enable row level security;
create policy reminder_events_select on public.reminder_events for select to authenticated using (public.is_org_member(org_id));

-- Próxima repetición (en hora de Argentina) estrictamente después de p_after
create or replace function public.reminder_next(p_due timestamptz, p_repeat text, p_after timestamptz)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare t timestamp := p_due at time zone 'America/Argentina/Buenos_Aires';
        a timestamp := p_after at time zone 'America/Argentina/Buenos_Aires';
        step interval; base timestamp := t; i integer := 0;
begin
  if p_repeat = 'none' then return null; end if;
  step := case p_repeat when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' else interval '1 day' end;
  loop
    i := i + 1;
    -- Meses: siempre desde la fecha original (31 → 30/28 sin ir corriendo el día)
    t := case when p_repeat = 'monthly' then base + step * i else t + step end;
    if p_repeat = 'weekdays' then
      while extract(isodow from t) > 5 loop t := t + interval '1 day'; end loop;
    end if;
    exit when t > a or i > 4000;
  end loop;
  return t at time zone 'America/Argentina/Buenos_Aires';
end;
$$;

-- Aplica una acción (desde la app o desde el botón de la notificación)
create or replace function public._reminder_apply(p_id uuid, p_action text, p_minutes integer, p_source text)
returns public.reminders language plpgsql security definer set search_path = '' as $$
declare r public.reminders; nxt timestamptz;
begin
  select * into r from public.reminders where id = p_id for update;
  if r.id is null then raise exception 'No existe el recordatorio'; end if;
  if p_action = 'done' then
    if r.repeat <> 'none' and r.status = 'pendiente' then
      -- Si ya se avisó y pasó sola a la próxima, no salteamos otra
      nxt := case when r.due_at > now() then r.due_at else public.reminder_next(r.due_at, r.repeat, now()) end;
      update public.reminders set due_at = nxt, notified_at = null, updated_at = now() where id = p_id returning * into r;
      insert into public.reminder_events (reminder_id, org_id, kind, detail, source) values (p_id, r.org_id, 'hecho', 'Próximo: ' || to_char(nxt at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), p_source);
    else
      update public.reminders set status = 'hecho', done_at = now(), updated_at = now() where id = p_id returning * into r;
      insert into public.reminder_events (reminder_id, org_id, kind, source) values (p_id, r.org_id, 'hecho', p_source);
    end if;
  elsif p_action = 'snooze' then
    if p_minutes is null or p_minutes not between 5 and 60 * 24 * 31 then raise exception 'Tiempo inválido'; end if;
    update public.reminders set status = 'pendiente', done_at = null, due_at = now() + make_interval(mins => p_minutes), notified_at = null, updated_at = now()
     where id = p_id returning * into r;
    insert into public.reminder_events (reminder_id, org_id, kind, detail, source)
    values (p_id, r.org_id, 'pospuesto', 'Hasta ' || to_char(r.due_at at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), p_source);
  elsif p_action = 'reopen' then
    update public.reminders set status = 'pendiente', done_at = null, notified_at = null, updated_at = now() where id = p_id returning * into r;
    insert into public.reminder_events (reminder_id, org_id, kind, source) values (p_id, r.org_id, 'reabierto', p_source);
  elsif p_action = 'cancel' then
    update public.reminders set status = 'cancelado', updated_at = now() where id = p_id returning * into r;
    insert into public.reminder_events (reminder_id, org_id, kind, source) values (p_id, r.org_id, 'cancelado', p_source);
  else
    raise exception 'Acción inválida';
  end if;
  return r;
end;
$$;
revoke all on function public._reminder_apply(uuid, text, integer, text) from public, anon, authenticated;

create or replace function public.reminder_act(p_id uuid, p_action text, p_minutes integer default null)
returns public.reminders language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select org_id into v_org from public.reminders where id = p_id;
  if v_org is null or not public.is_org_member(v_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  return public._reminder_apply(p_id, p_action, p_minutes, 'app');
end;
$$;
revoke all on function public.reminder_act(uuid, text, integer) from public, anon;
grant execute on function public.reminder_act(uuid, text, integer) to authenticated;

-- Botones "Hecho" / "Posponer" de la notificación: sin sesión, con el token propio de cada recordatorio
create or replace function public.reminder_act_token(p_id uuid, p_token uuid, p_action text, p_minutes integer default null)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('done', 'snooze') then raise exception 'Acción inválida'; end if;
  if not exists (select 1 from public.reminders where id = p_id and action_token = p_token) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  perform public._reminder_apply(p_id, p_action, p_minutes, 'noti');
  return 'ok';
end;
$$;
revoke all on function public.reminder_act_token(uuid, uuid, text, integer) from public;
grant execute on function public.reminder_act_token(uuid, uuid, text, integer) to anon, authenticated;

-- Historial: creado / editado (lo escriben las acciones de la app)
create or replace function public.reminder_log(p_id uuid, p_kind text, p_detail text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_kind not in ('creado', 'editado') then raise exception 'Tipo inválido'; end if;
  select org_id into v_org from public.reminders where id = p_id;
  if v_org is null or not public.is_org_member(v_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  insert into public.reminder_events (reminder_id, org_id, kind, detail) values (p_id, v_org, p_kind, left(p_detail, 300));
end;
$$;
revoke all on function public.reminder_log(uuid, text, text) from public, anon;
grant execute on function public.reminder_log(uuid, text, text) to authenticated;

-- Clave del disparador: se genera acá adentro y queda sólo en el Vault (nadie la ve)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'reminders_cron_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'reminders_cron_key', 'Clave del disparador de recordatorios');
  end if;
end $$;

create or replace function public._reminders_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_key is not null and length(p_key) >= 32
     and exists (select 1 from vault.decrypted_secrets where name = 'reminders_cron_key' and decrypted_secret = p_key);
$$;
revoke all on function public._reminders_key_ok(text) from public, anon, authenticated;

-- Lo que hay que avisar ahora (todas las empresas), con sus dispositivos y claves VAPID
create or replace function public.reminders_due(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public._reminders_key_ok(p_key) then raise exception 'Clave inválida' using errcode = '28000'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'title', r.title, 'notes', r.notes, 'due_at', r.due_at, 'priority', r.priority, 'repeat', r.repeat,
      'link_path', coalesce(r.link_path, '/recordatorios'), 'link_label', r.link_label, 'token', r.action_token, 'count', r.notify_count,
      'public_key', k.public_key, 'private_key', k.private_key,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
          from public.push_subscriptions s
         where s.org_id = r.org_id and s.failures < 5
           and (s.user_id = r.created_by or not exists (select 1 from public.push_subscriptions s2 where s2.org_id = r.org_id and s2.user_id = r.created_by and s2.failures < 5))
      ), '[]'::jsonb)))
    from (
      select * from public.reminders r
       where r.status = 'pendiente' and r.due_at <= now() + interval '20 seconds'
         and (r.notified_at is null or (r.nag_minutes is not null and r.notified_at <= now() - make_interval(mins => r.nag_minutes) + interval '20 seconds'))
       order by r.due_at limit 50
    ) r
    join public.push_keys k on k.org_id = r.org_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.reminders_due(text) from public;
grant execute on function public.reminders_due(text) to anon, authenticated;

-- Marca lo avisado: repetición → pasa a la próxima; si no, queda "vencido" hasta que lo marques (o insiste)
create or replace function public.reminders_mark(p_key text, p_sent jsonb, p_ok jsonb, p_failed jsonb, p_gone jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare x jsonb; r public.reminders; nxt timestamptz; v_ok boolean;
begin
  if not public._reminders_key_ok(p_key) then raise exception 'Clave inválida' using errcode = '28000'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_sent, '[]')) loop
    select * into r from public.reminders where id = (x->>'id')::uuid for update;
    continue when r.id is null or r.status <> 'pendiente';
    v_ok := coalesce((x->>'ok')::boolean, false);
    if r.repeat <> 'none' and r.nag_minutes is null then
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

-- Disparador cada minuto: sólo pega a la app si hay algo para avisar
create or replace function public._reminders_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.reminders r
              where r.status = 'pendiente' and r.due_at <= now() + interval '20 seconds'
                and (r.notified_at is null or (r.nag_minutes is not null and r.notified_at <= now() - make_interval(mins => r.nag_minutes) + interval '20 seconds'))) then
    perform net.http_post(
      url := 'https://ibarraoctrack.vercel.app/api/cron/reminders',
      headers := jsonb_build_object('content-type', 'application/json',
                   'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'reminders_cron_key')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  end if;
end;
$$;
revoke all on function public._reminders_tick() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'reminders-tick';
select cron.schedule('reminders-tick', '* * * * *', 'select public._reminders_tick()');
