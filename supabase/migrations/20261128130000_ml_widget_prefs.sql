-- Widget personalizable: preferencias guardadas en el sistema (el script las lee en cada actualización) y vista previa
alter table public.ml_settings add column if not exists widget_prefs jsonb not null default '{}'::jsonb;

create or replace function public.widget_ml_data(v_org uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'America/Argentina/Buenos_Aires')::date; v_res jsonb;
begin
  with s as (
    select (coalesce(ordered_at, created_at) at time zone 'America/Argentina/Buenos_Aires')::date d, coalesce(total_amount, unit_price * quantity, 0) amt, title, coalesce(ordered_at, created_at) at
      from public.ml_orders
     where org_id = v_org and kind = 'venta' and merged_into is null and status <> 'cancelada'
       and coalesce(ordered_at, created_at) >= (date_trunc('month', v_today) - interval '1 month')
  ), days as (
    select g::date d from generate_series(v_today - 6, v_today, interval '1 day') g
  )
  select jsonb_build_object(
    'today',     (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amt), 0)) from s where d = v_today),
    'yesterday', (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amt), 0)) from s where d = v_today - 1),
    'week',      (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amt), 0)) from s where d > v_today - 7),
    'month',     (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(amt), 0)) from s where d >= date_trunc('month', v_today)::date),
    'prev_month_same', (select coalesce(sum(amt), 0) from s where d >= (date_trunc('month', v_today) - interval '1 month')::date
                          and d <= ((date_trunc('month', v_today) - interval '1 month')::date + (v_today - date_trunc('month', v_today)::date))),
    'daily',     (select jsonb_agg(jsonb_build_object('d', days.d, 'amount', coalesce((select sum(amt) from s where s.d = days.d), 0)) order by days.d) from days),
    'last_sale', (select jsonb_build_object('title', title, 'amount', amt, 'at', at) from s order by at desc limit 1),
    'questions', (select count(*) from public.ml_questions where org_id = v_org and status = 'UNANSWERED'),
    'claims',    (select count(*) from public.ml_claims where org_id = v_org and coalesce(status, '') in ('opened', 'open')),
    'no_stock',  (select count(*) from public.ml_items where org_id = v_org and status = 'active' and coalesce(available, 0) <= 0),
    'active',    (select count(*) from public.ml_items where org_id = v_org and status = 'active'),
    'reputation',(select jsonb_build_object('level', level, 'power_seller', power_seller) from public.ml_reputation where org_id = v_org order by day desc limit 1),
    'updated_at', now()
  ) into v_res;
  return v_res || jsonb_build_object('prefs', coalesce((select widget_prefs from public.ml_settings where org_id = v_org), '{}'::jsonb));
end $$;
revoke all on function public.widget_ml_data(uuid) from public, anon, authenticated;

create or replace function public.widget_ml(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_token is null or length(p_token) < 20 then raise exception 'Clave inválida' using errcode = '28000'; end if;
  select org_id into v_org from public.widget_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Clave inválida' using errcode = '28000'; end if;
  update public.widget_tokens set last_used_at = now() where org_id = v_org;
  return public.widget_ml_data(v_org);
end $$;
revoke all on function public.widget_ml(text) from public;
grant execute on function public.widget_ml(text) to anon, authenticated;

-- para la vista previa dentro del sistema
create or replace function public.widget_ml_me(p_org uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_org_member(p_org) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  return public.widget_ml_data(p_org);
end $$;
revoke all on function public.widget_ml_me(uuid) from public, anon;
grant execute on function public.widget_ml_me(uuid) to authenticated;
