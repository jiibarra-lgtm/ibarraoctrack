-- Arranque operativo: la conciliación (órdenes avisadas por BAC, cobros) empieza en esta fecha.
-- Lo anterior se borra de la bandeja de órdenes BAC y lo que vuelva a llegar del historial de mails queda oculto.
alter table public.organizations add column if not exists ops_start_date date;
update public.organizations set ops_start_date = '2026-11-01' where ops_start_date is null;

create or replace function public.tg_bac_inbox_cutoff()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v date;
begin
  select ops_start_date into v from public.organizations where id = new.org_id;
  if v is not null and (coalesce(new.notified_at, new.perfected_at, new.prd_at, new.first_seen_at) at time zone 'America/Argentina/Buenos_Aires')::date < v then
    new.dismissed := true;
  end if;
  return new;
end;
$$;
create trigger trg_bac_inbox_cutoff before insert on public.bac_orders_inbox for each row execute function public.tg_bac_inbox_cutoff();

delete from public.bac_orders_inbox i using public.organizations o
where o.id = i.org_id and o.ops_start_date is not null
  and (coalesce(i.notified_at, i.perfected_at, i.prd_at, i.first_seen_at) at time zone 'America/Argentina/Buenos_Aires')::date < o.ops_start_date
  and not exists (select 1 from public.purchase_orders po where po.org_id = i.org_id and upper(po.bac_number) = i.bac_number);
