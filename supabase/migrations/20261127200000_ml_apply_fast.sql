-- La sincronización con la API de Mercado Libre buscaba vínculo con las OC para TODAS las órdenes en cada pasada
-- (más de 5 s) y la base la cortaba a los 3 s: desde el 25/11 no se aplicaba nada. Ahora sólo para las órdenes que tocó.
create or replace function public.ml_apply_api_orders(p_org uuid, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_o      jsonb;
  v_kind   text;
  v_ids    text[];
  v_row    uuid;
  v_title  text;
  v_at     timestamptz;
  v_items  jsonb;
  v_qty    numeric;
  v_total  numeric;
  v_upd    integer := 0;
  v_new    integer := 0;
  v_touched uuid[] := '{}';
begin
  for v_o in select x from jsonb_array_elements(p_orders) x loop
    v_kind  := v_o->>'kind';
    continue when v_kind not in ('compra', 'venta');
    v_ids   := array_remove(array[v_o->>'order_id', nullif(v_o->>'pack_id', '')], null);
    continue when coalesce(array_length(v_ids, 1), 0) = 0;
    v_items := coalesce(v_o->'items', '[]'::jsonb);
    v_title := left(coalesce(v_items->0->>'title', ''), 300);
    v_at    := (v_o->>'date')::timestamptz;
    v_qty   := (select sum((i->>'quantity')::numeric) from jsonb_array_elements(v_items) i);
    v_total := nullif(v_o->>'total', '')::numeric;
    v_row   := null;

    -- 1) por número (ya vinculado antes, o el número del mail coincide con orden o pack)
    select id into v_row from public.ml_orders
    where org_id = p_org and kind = v_kind and merged_into is null and (ml_id = any(v_ids) or api_ids && v_ids)
    limit 1;
    -- Los mails de compra traen el número de compra, que es el del carrito (pack) menos 2 (a veces menos 1..4)
    if v_row is null and v_kind = 'compra' and nullif(v_o->>'pack_id', '') ~ '^\d+$' then
      select id into v_row from public.ml_orders
      where org_id = p_org and kind = 'compra' and merged_into is null and cardinality(api_ids) = 0 and ml_id ~ '^\d+$'
        and (v_o->>'pack_id')::numeric - ml_id::numeric between 1 and 4
      order by (v_o->>'pack_id')::numeric - ml_id::numeric limit 1;
    end if;
    -- 2) por producto y fecha (los mails de compra traen otro número)
    if v_row is null and length(v_title) >= 6 then
      select id into v_row from public.ml_orders
      where org_id = p_org and kind = v_kind and merged_into is null and cardinality(api_ids) = 0
        and coalesce(ordered_at, created_at) between v_at - interval '2 days' and v_at + interval '2 days'
        and (public.norm(title) like left(public.norm(v_title), 25) || '%' or public.norm(v_title) like left(public.norm(title), 25) || '%'
             or extensions.similarity(public.norm(title), public.norm(v_title)) > 0.5)
      order by abs(extract(epoch from (coalesce(ordered_at, created_at) - v_at))) limit 1;
    end if;

    if v_row is null then
      -- Operación que no llegó por mail: se agrega
      insert into public.ml_orders (org_id, kind, ml_id, title, extra_items, quantity, unit_price, total_amount, counterpart, status, ordered_at,
                                    api_ids, fees, api_synced_at, api_items)
      values (p_org, v_kind, v_ids[array_length(v_ids, 1)], v_title, greatest(jsonb_array_length(v_items) - 1, 0), v_qty,
              case when jsonb_array_length(v_items) = 1 then (v_items->0->>'unit_price')::numeric end, v_total,
              left(v_o->>'counterpart', 200),
              case when v_o->>'status' = 'cancelled' then 'cancelada' when v_kind = 'venta' then 'vendida' when v_o->>'delivered' = 'true' then 'entregada' else 'comprada' end,
              v_at, v_ids, nullif(v_o->>'fees', '')::numeric, now(), v_items)
      on conflict (org_id, kind, ml_id) do nothing
      returning id into v_row;
      if v_row is not null then v_new := v_new + 1; v_touched := array_append(v_touched, v_row); end if;
    else
      update public.ml_orders o set
        api_ids       = (select array_agg(distinct x) from unnest(o.api_ids || v_ids) x),
        unit_price    = coalesce(o.unit_price, case when jsonb_array_length(v_items) >= 1 then (v_items->0->>'unit_price')::numeric end),
        total_amount  = coalesce(v_total, o.total_amount),
        quantity      = coalesce(o.quantity, v_qty),
        fees          = coalesce(nullif(v_o->>'fees', '')::numeric, o.fees),
        counterpart   = coalesce(o.counterpart, left(v_o->>'counterpart', 200)),
        status        = case when v_o->>'status' = 'cancelled' then 'cancelada'
                             when o.kind = 'compra' and v_o->>'delivered' = 'true' then 'entregada' else o.status end,
        title         = case when length(o.title) < 8 and length(v_title) > length(o.title) then v_title else o.title end,
        api_items     = v_items,
        api_synced_at = now()
      where o.id = v_row;
      v_upd := v_upd + 1;
      v_touched := array_append(v_touched, v_row);
    end if;
  end loop;
  return jsonb_build_object('actualizadas', v_upd, 'nuevas', v_new, 'unidas', public.ml_merge_duplicates(p_org), 'vinculadas', case when cardinality(v_touched) > 0 then public.ml_autolink(p_org, v_touched) else 0 end);
end;
$$;
revoke all on function public.ml_apply_api_orders(uuid, jsonb) from public, anon, authenticated;
