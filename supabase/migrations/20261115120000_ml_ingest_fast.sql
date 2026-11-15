-- El script de Gmail fallaba entero: ingest_ml_events tardaba más de 3 s (límite de la clave anónima) porque
-- en cada corrida volvía a buscar vínculo para todas las compras de Mercado Libre sin vincular (más de 700).
-- Ahora sólo busca vínculo para las operaciones que entraron o cambiaron en esa corrida (el resto ya se intentó).

create or replace function public.ml_autolink(p_org uuid, p_ids uuid[] default null)
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
             where org_id = p_org and po_item_id is null and not no_link and length(title) >= 8
               and (p_ids is null or id = any(p_ids)) loop
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
drop function if exists public.ml_autolink(uuid);
revoke all on function public.ml_autolink(uuid, uuid[]) from public, anon, authenticated;

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
  v_touched uuid[] := '{}';
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
    if v_row is not null then v_touched := array_append(v_touched, v_row); end if;
  end loop;

  return jsonb_build_object('nuevos', v_new, 'actualizados', v_upd, 'omitidos', v_skip,
    'vinculados', case when cardinality(v_touched) > 0 then public.ml_autolink(v_org, v_touched) else 0 end);
end;
$$;
revoke all on function public.ingest_ml_events(text, jsonb) from public;
grant execute on function public.ingest_ml_events(text, jsonb) to anon, authenticated;
