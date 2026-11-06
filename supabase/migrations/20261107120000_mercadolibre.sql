-- =====================================================================
-- Mercado Libre: compras, envíos, entregas, facturas y ventas leídas de los mails.
-- Cada operación se vincula sola al renglón de OC más parecido (o a mano).
-- =====================================================================
create table public.ml_orders (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  kind               text not null check (kind in ('compra', 'venta')),
  ml_id              text not null,
  title              text not null default '',
  extra_items        integer not null default 0,
  quantity           numeric(14,3),
  unit_price         numeric(16,2) check (unit_price is null or unit_price >= 0),
  total_amount       numeric(16,2) check (total_amount is null or total_amount >= 0),
  counterpart        text,
  shipping           text,
  eta                text,
  status             text not null default 'comprada' check (status in ('comprada', 'en_camino', 'entregada', 'vendida', 'cancelada')),
  ordered_at         timestamptz,
  shipped_at         timestamptz,
  delivered_at       timestamptz,
  invoice_available  boolean not null default false,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  po_item_id         uuid references public.purchase_order_items(id) on delete set null,
  link_source        text check (link_source in ('auto', 'manual')),
  link_score         numeric(4,3),
  no_link            boolean not null default false,
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, kind, ml_id)
);
create index idx_ml_orders_org on public.ml_orders(org_id, kind, ordered_at desc);
create index idx_ml_orders_po on public.ml_orders(purchase_order_id);
create index idx_ml_orders_item on public.ml_orders(po_item_id);
create trigger trg_ml_orders_updated before update on public.ml_orders for each row execute function public.tg_set_updated_at();

alter table public.ml_orders enable row level security;
create policy ml_orders_select on public.ml_orders for select to authenticated using (public.is_org_member(org_id));
create policy ml_orders_update on public.ml_orders for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));

-- Mails ya procesados (para no aplicar dos veces el mismo aviso)
create table public.ml_mail_seen (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  message_id  text not null,
  kind        text not null,
  ml_order_id uuid references public.ml_orders(id) on delete set null,
  seen_at     timestamptz not null default now(),
  primary key (org_id, message_id)
);
alter table public.ml_mail_seen enable row level security;
create policy ml_mail_seen_select on public.ml_mail_seen for select to authenticated using (public.is_org_member(org_id));

-- El renglón de OC más parecido a un producto de Mercado Libre (sólo órdenes vigentes y cercanas en fecha)
create or replace function public.ml_best_item(p_org uuid, p_title text, p_at timestamptz)
returns table (po_item_id uuid, purchase_order_id uuid, score numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.purchase_order_id,
         round(greatest(extensions.similarity(public.norm(p_title), public.norm(i.description_original)),
                        extensions.word_similarity(public.norm(i.description_original), public.norm(p_title)))::numeric, 3)
  from public.purchase_order_items i
  join public.purchase_orders po on po.id = i.purchase_order_id
  where i.org_id = p_org and po.status <> 'anulada'
    and coalesce(po.issue_date, po.created_at::date) between (coalesce(p_at, now()) - interval '150 days')::date and (coalesce(p_at, now()) + interval '60 days')::date
  order by 3 desc
  limit 1
$$;
revoke all on function public.ml_best_item(uuid, text, timestamptz) from public, anon, authenticated;

-- Vincula sola cada operación sin vincular cuyo parecido con un renglón de OC sea alto
create or replace function public.ml_autolink(p_org uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o   record;
  v_b   record;
  v_n   integer := 0;
begin
  for v_o in select id, title, coalesce(ordered_at, created_at) as at from public.ml_orders
             where org_id = p_org and po_item_id is null and not no_link and length(title) >= 8 loop
    select * into v_b from public.ml_best_item(p_org, v_o.title, v_o.at);
    if v_b.po_item_id is not null and v_b.score >= 0.45 then
      update public.ml_orders set po_item_id = v_b.po_item_id, purchase_order_id = v_b.purchase_order_id, link_source = 'auto', link_score = v_b.score
      where id = v_o.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ml_autolink(uuid) from public, anon, authenticated;

-- Recibe los avisos de Mercado Libre leídos de los mails (lo llama /api/inbound/gmail con el token de la empresa)
create or replace function public.ingest_ml_events(p_token text, p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org   uuid;
  v_e     jsonb;
  v_kind  text;
  v_id    text;
  v_at    timestamptz;
  v_title text;
  v_row   uuid;
  v_new   integer := 0;
  v_upd   integer := 0;
  v_skip  integer := 0;
  v_ins   boolean;
  rank_of constant jsonb := '{"comprada":1,"en_camino":2,"entregada":3,"cancelada":4,"vendida":1}';
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 2000 then raise exception 'Formato inválido' using errcode = '22023'; end if;

  for v_e in select x from jsonb_array_elements(p_events) x order by x->>'at' loop
    v_kind  := v_e->>'kind';
    v_id    := nullif(v_e->>'ml_id', '');
    v_title := left(coalesce(v_e->>'title', ''), 300);
    v_row   := null;
    continue when v_kind not in ('compra', 'en_camino', 'entrega', 'factura', 'venta') or coalesce(v_e->>'message_id', '') = '';
    begin
      v_at := (v_e->>'at')::timestamptz;
    exception when others then
      continue;
    end;
    -- Ya procesado
    insert into public.ml_mail_seen (org_id, message_id, kind) values (v_org, left(v_e->>'message_id', 200), v_kind) on conflict do nothing;
    if not found then v_skip := v_skip + 1; continue; end if;
    continue when v_id is not null and v_id !~ '^\d{6,24}$';

    if v_kind = 'venta' then
      continue when v_id is null;
      insert into public.ml_orders (org_id, kind, ml_id, title, extra_items, quantity, unit_price, total_amount, counterpart, shipping, status, ordered_at)
      values (v_org, 'venta', v_id, v_title, coalesce((v_e->>'extra_items')::int, 0), (v_e->>'quantity')::numeric, (v_e->>'unit_price')::numeric,
              (v_e->>'total_amount')::numeric, left(v_e->>'counterpart', 200), left(v_e->>'shipping', 60), 'vendida', v_at)
      on conflict (org_id, kind, ml_id) do nothing
      returning id into v_row;
      if v_row is not null then v_new := v_new + 1; end if;

    elsif v_kind = 'compra' then
      continue when v_id is null;
      insert into public.ml_orders (org_id, kind, ml_id, title, extra_items, quantity, eta, status, ordered_at)
      values (v_org, 'compra', v_id, v_title, coalesce((v_e->>'extra_items')::int, 0), (v_e->>'quantity')::numeric, left(v_e->>'eta', 60), 'comprada', v_at)
      on conflict (org_id, kind, ml_id) do update set
        title       = case when length(excluded.title) > length(public.ml_orders.title) then excluded.title else public.ml_orders.title end,
        extra_items = greatest(public.ml_orders.extra_items, excluded.extra_items),
        quantity    = coalesce(public.ml_orders.quantity, excluded.quantity),
        eta         = coalesce(public.ml_orders.eta, excluded.eta),
        ordered_at  = least(coalesce(public.ml_orders.ordered_at, excluded.ordered_at), excluded.ordered_at)
      returning id, (xmax = 0) into v_row, v_ins;
      if v_ins then v_new := v_new + 1; else v_upd := v_upd + 1; end if;

    else
      -- en_camino / entrega / factura: buscar la compra por número o por el comienzo del título
      if v_id is not null then
        select id into v_row from public.ml_orders where org_id = v_org and kind = 'compra' and ml_id = v_id;
        if v_row is null then
          insert into public.ml_orders (org_id, kind, ml_id, title, status)
          values (v_org, 'compra', v_id, v_title, 'comprada') returning id into v_row;
          v_new := v_new + 1;
        end if;
      elsif length(v_title) >= 8 then
        select id into v_row from public.ml_orders
        where org_id = v_org and kind = 'compra' and status <> 'entregada'
          and public.norm(title) like public.norm(v_title) || '%'
          and coalesce(ordered_at, created_at) <= v_at + interval '1 day'
        order by coalesce(ordered_at, created_at) desc limit 1;
      end if;
      if v_row is null then v_skip := v_skip + 1; continue; end if;

      update public.ml_orders o set
        status = case
          when v_kind = 'entrega' then 'entregada'
          when v_kind = 'en_camino' and (rank_of->>o.status)::int < 2 then 'en_camino'
          else o.status end,
        delivered_at      = case when v_kind = 'entrega' then coalesce(o.delivered_at, v_at) else o.delivered_at end,
        shipped_at        = case when v_kind = 'en_camino' then coalesce(o.shipped_at, v_at) else o.shipped_at end,
        eta               = case when v_kind = 'en_camino' then coalesce(nullif(v_e->>'eta', ''), o.eta) else o.eta end,
        invoice_available = o.invoice_available or v_kind = 'factura',
        title             = case when length(v_title) > length(o.title) and v_e->>'truncated' = 'false' then v_title else o.title end
      where o.id = v_row;
      v_upd := v_upd + 1;
    end if;
    update public.ml_mail_seen set ml_order_id = v_row where org_id = v_org and message_id = left(v_e->>'message_id', 200);
  end loop;

  return jsonb_build_object('nuevos', v_new, 'actualizados', v_upd, 'omitidos', v_skip, 'vinculados', public.ml_autolink(v_org));
end;
$$;
revoke all on function public.ingest_ml_events(text, jsonb) from public;
grant execute on function public.ingest_ml_events(text, jsonb) to anon, authenticated;

-- Sugerencias de renglones para vincular a mano (respeta RLS: corre como el usuario)
create or replace function public.ml_link_suggestions(p_ml uuid)
returns table (po_item_id uuid, purchase_order_id uuid, bac_number text, line_number integer, description text, quantity numeric, unit_price numeric, customer_name text, score numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select i.id, i.purchase_order_id, coalesce(po.bac_number, po.display_number), i.line_number, i.description_original, i.quantity, i.unit_price, po.customer_name,
         round(greatest(extensions.similarity(public.norm(o.title), public.norm(i.description_original)),
                        extensions.word_similarity(public.norm(i.description_original), public.norm(o.title)))::numeric, 3) as score
  from public.ml_orders o
  join public.purchase_order_items i on i.org_id = o.org_id
  join public.purchase_orders_overview po on po.id = i.purchase_order_id
  where o.id = p_ml and po.status <> 'anulada'
  order by score desc, po.issue_date desc nulls last
  limit 8
$$;
revoke all on function public.ml_link_suggestions(uuid) from public, anon;
grant execute on function public.ml_link_suggestions(uuid) to authenticated;

create view public.ml_orders_overview with (security_invoker = true) as
select o.*,
  coalesce(po.bac_number, po.display_number) as po_number, po.customer_name as po_customer,
  i.line_number as po_line, i.description_original as po_item_description, i.quantity as po_item_quantity, i.unit_price as po_item_unit_price,
  case when o.unit_price is not null then o.unit_price
       when o.total_amount is not null and o.quantity > 0 then round(o.total_amount / o.quantity, 2) end as unit_value
from public.ml_orders o
left join public.purchase_orders_overview po on po.id = o.purchase_order_id
left join public.purchase_order_items i on i.id = o.po_item_id;
grant select on public.ml_orders_overview to authenticated;
