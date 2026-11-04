-- =====================================================================
-- OC SISTEMA · Fase 1 · 007 — Cambio de estado, miembros, agregados dashboard
-- =====================================================================

-- Cambio de estado con motivo (queda en el historial)
create or replace function public.set_po_status(p_id uuid, p_status public.po_status, p_reason text default null, p_version integer default null)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
  v_ver integer;
begin
  select org_id, version into v_org, v_ver from public.purchase_orders where id = p_id for update;
  if v_org is null then
    raise exception 'Orden inexistente' using errcode = 'P0002';
  end if;
  if not public.has_org_role(v_org, array['admin','compras','finanzas']::public.app_role[]) then
    raise exception 'Sin permisos' using errcode = '42501';
  end if;
  if p_version is not null and p_version <> v_ver then
    raise exception 'La orden fue modificada por otro usuario. Recargá.' using errcode = '40001';
  end if;
  if p_status = 'anulada' and coalesce(trim(p_reason), '') = '' then
    raise exception 'Indicá el motivo de la anulación' using errcode = '22023';
  end if;
  perform set_config('app.status_reason', coalesce(p_reason, ''), true);
  update public.purchase_orders set status = p_status where id = p_id returning version into v_ver;
  return v_ver;
end;
$$;
revoke all on function public.set_po_status(uuid, public.po_status, text, integer) from public, anon;
grant execute on function public.set_po_status(uuid, public.po_status, text, integer) to authenticated;

-- Sumar un usuario ya registrado a la organización (sólo admin)
create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role public.app_role)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_id uuid;
begin
  if not public.has_org_role(p_org, array['admin']::public.app_role[]) then
    raise exception 'Sólo un administrador puede sumar usuarios' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe un usuario registrado con ese email. Pedile que se registre primero.' using errcode = 'P0002';
  end if;
  insert into public.organization_members (org_id, user_id, role)
  values (p_org, v_user, p_role)
  on conflict (org_id, user_id) do update set role = excluded.role
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_member_by_email(uuid, text, public.app_role) from public, anon;
grant execute on function public.add_member_by_email(uuid, text, public.app_role) to authenticated;

-- Agregado mensual por fecha de autorización (nunca mezcla monedas)
create or replace function public.po_monthly(p_org uuid, p_from date)
returns table (month date, currency char(3), orders bigint, awarded numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select date_trunc('month', po.issue_date)::date as month, po.currency, count(*), coalesce(sum(po.total_amount), 0)
    from public.purchase_orders po
   where po.org_id = p_org and po.status <> 'anulada' and po.issue_date >= p_from
   group by 1, 2
   order by 1, 2
$$;
revoke all on function public.po_monthly(uuid, date) from public, anon;
grant execute on function public.po_monthly(uuid, date) to authenticated;

-- Totales por estado y moneda
create or replace function public.po_totals(p_org uuid)
returns table (status public.po_status, currency char(3), orders bigint, awarded numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select po.status, po.currency, count(*), coalesce(sum(po.total_amount), 0)
    from public.purchase_orders po
   where po.org_id = p_org
   group by 1, 2
$$;
revoke all on function public.po_totals(uuid) from public, anon;
grant execute on function public.po_totals(uuid) to authenticated;

-- Ranking de organismos por importe adjudicado
create or replace function public.top_customers(p_org uuid, p_limit integer default 6)
returns table (customer_id uuid, name text, currency char(3), orders bigint, awarded numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id, c.name, po.currency, count(*), coalesce(sum(po.total_amount), 0)
    from public.purchase_orders po
    join public.customers c on c.id = po.customer_id
   where po.org_id = p_org and po.status <> 'anulada'
   group by 1, 2, 3
   order by 5 desc
   limit least(greatest(p_limit, 1), 20)
$$;
revoke all on function public.top_customers(uuid, integer) from public, anon;
grant execute on function public.top_customers(uuid, integer) to authenticated;
