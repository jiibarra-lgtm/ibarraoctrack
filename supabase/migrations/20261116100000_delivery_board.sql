-- Hoja de ruta: pendientes de entrega y entregados (lo que antes se llevaba en otra app), vinculados a las OC por número
create table if not exists public.delivery_board (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  place text not null check (length(place) between 1 and 200),
  address text check (address is null or length(address) <= 300),
  note text check (note is null or length(note) <= 2000),
  oc_text text check (oc_text is null or length(oc_text) <= 300),
  oc_refs text[] not null default '{}',
  status text not null default 'pendiente' check (status in ('pendiente', 'entregado')),
  delivered_on date,
  position integer not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_delivery_board_org on public.delivery_board(org_id, status, delivered_on desc);
create index if not exists idx_delivery_board_refs on public.delivery_board using gin (oc_refs);
alter table public.delivery_board enable row level security;
create policy delivery_board_select on public.delivery_board for select to authenticated using (public.is_org_member(org_id));
create policy delivery_board_write on public.delivery_board for all to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));

-- Números de OC del BAC dentro de un texto libre ("o/c 7307-19129/19133-oc26" → 7307-19129-OC26, 7307-19133-OC26)
create or replace function public.oc_refs_from_text(p text)
returns text[] language plpgsql immutable set search_path = '' as $$
declare m text[]; acc text[] := '{}'; unit text; nums text[]; prev text; n text; yr text;
begin
  for m in select regexp_matches(coalesce(p, ''), '(\d{2,4})-(\d{3,6}(?:/\d{1,6})*)(?:-?\s*oc\s*(\d{2}))?', 'gi') loop
    unit := m[1]; nums := string_to_array(m[2], '/'); yr := coalesce(m[3], '26'); prev := null;
    foreach n in array nums loop
      if prev is not null and length(n) < length(prev) then n := left(prev, length(prev) - length(n)) || n; end if;
      acc := acc || (unit || '-' || n || '-OC' || yr); prev := n;
    end loop;
  end loop;
  return (select coalesce(array_agg(distinct x), '{}') from unnest(acc) x);
end;
$$;

create or replace function public.tg_delivery_board_refs() returns trigger language plpgsql set search_path = '' as $$
begin
  new.oc_refs := public.oc_refs_from_text(new.oc_text);
  new.updated_at := now();
  if new.status = 'entregado' and new.delivered_on is null then new.delivered_on := (now() at time zone 'America/Argentina/Buenos_Aires')::date; end if;
  if new.status = 'pendiente' then new.delivered_on := null; end if;
  return new;
end;
$$;
drop trigger if exists delivery_board_refs on public.delivery_board;
create trigger delivery_board_refs before insert or update on public.delivery_board for each row execute function public.tg_delivery_board_refs();

-- Cada tarjeta con sus OC encontradas en el sistema (las que todavía no se cargaron quedan como texto)
create or replace view public.delivery_board_overview with (security_invoker = true) as
select b.*,
  coalesce((select jsonb_agg(jsonb_build_object('id', po.id, 'number', po.bac_number, 'customer', po.customer_name,
              'delivered_pct', ds.delivered_pct, 'status', po.status, 'due_date', ds.due_date) order by po.bac_number)
            from public.purchase_orders_overview po
            left join public.po_delivery_summary ds on ds.purchase_order_id = po.id
           where po.org_id = b.org_id and upper(po.bac_number) = any(b.oc_refs)), '[]'::jsonb) as orders
from public.delivery_board b;
