-- =====================================================================
-- Mercado Libre: mantener stock mínimo en las publicaciones (repone sola la cantidad disponible)
-- y bajar las facturas de las compras (PDF que sube el vendedor) para Precios de proveedores y Stock.
-- =====================================================================
create table public.ml_stock_rules (
  org_id      uuid not null references public.organizations(id) on delete cascade,
  item_id     text not null,              -- '*' = regla general para todas las publicaciones
  enabled     boolean not null default true,
  min_qty     integer not null default 10 check (min_qty between 0 and 99999),
  target_qty  integer not null default 10 check (target_qty between 1 and 99999),
  updated_at  timestamptz not null default now(),
  primary key (org_id, item_id),
  check (target_qty >= min_qty)
);
create table public.ml_items (
  org_id       uuid not null references public.organizations(id) on delete cascade,
  item_id      text not null,
  title        text not null default '',
  available    integer,
  sold         integer,
  price        numeric(18,2),
  status       text,
  logistic     text,
  permalink    text,
  thumbnail    text,
  variations   integer not null default 0,
  last_restock_at timestamptz,
  last_restock_qty integer,
  last_error   text,
  seen_at      timestamptz not null default now(),
  primary key (org_id, item_id)
);
alter table public.ml_stock_rules enable row level security;
alter table public.ml_items enable row level security;
create policy ml_stock_rules_read on public.ml_stock_rules for select to authenticated using (public.is_org_member(org_id));
create policy ml_items_read on public.ml_items for select to authenticated using (public.is_org_member(org_id));
grant select on public.ml_stock_rules, public.ml_items to authenticated;

alter table public.ml_orders add column if not exists invoice_fetched_at timestamptz;
alter table public.supplier_invoices drop constraint if exists supplier_invoices_source_check;
alter table public.supplier_invoices add constraint supplier_invoices_source_check check (source in ('mail', 'manual', 'mercadolibre'));

-- Igual que ml_conn: con sesión (pantalla) o con el token del script de Gmail (automático)
create or replace function public.ml_stock(p_action text, p_org uuid default null, p_token text default null, p_data jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_i jsonb;
  v_r text;
begin
  if p_token is not null then
    if length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
    select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
    if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
    if p_action not in ('rules', 'snapshot', 'invoice_targets', 'invoice_done', 'store_invoice') then raise exception 'Acción no permitida' using errcode = '42501'; end if;
  else
    v_org := p_org;
    if v_org is null or not public.has_org_role(v_org, array['admin','compras','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  end if;

  if p_action = 'rules' then
    return jsonb_build_object(
      'default', (select jsonb_build_object('enabled', enabled, 'min', min_qty, 'target', target_qty) from public.ml_stock_rules where org_id = v_org and item_id = '*'),
      'items', coalesce((select jsonb_object_agg(item_id, jsonb_build_object('enabled', enabled, 'min', min_qty, 'target', target_qty)) from public.ml_stock_rules where org_id = v_org and item_id <> '*'), '{}'::jsonb));

  elsif p_action = 'set_rule' then
    if coalesce(p_data->>'item_id', '') !~ '^(\*|MLA\d{5,15})$' then raise exception 'Publicación inválida' using errcode = '22023'; end if;
    if (p_data->>'remove')::boolean then
      delete from public.ml_stock_rules where org_id = v_org and item_id = p_data->>'item_id';
    else
      insert into public.ml_stock_rules (org_id, item_id, enabled, min_qty, target_qty)
      values (v_org, p_data->>'item_id', coalesce((p_data->>'enabled')::boolean, true), (p_data->>'min')::int, greatest((p_data->>'target')::int, (p_data->>'min')::int))
      on conflict (org_id, item_id) do update set enabled = excluded.enabled, min_qty = excluded.min_qty, target_qty = excluded.target_qty, updated_at = now();
    end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'snapshot' then
    for v_i in select x from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) x limit 2000 loop
      insert into public.ml_items (org_id, item_id, title, available, sold, price, status, logistic, permalink, thumbnail, variations, last_restock_at, last_restock_qty, last_error, seen_at)
      values (v_org, v_i->>'id', left(coalesce(v_i->>'title', ''), 300), (v_i->>'available')::int, (v_i->>'sold')::int, (v_i->>'price')::numeric, v_i->>'status',
        v_i->>'logistic', left(v_i->>'permalink', 500), left(v_i->>'thumbnail', 500), coalesce((v_i->>'variations')::int, 0),
        case when v_i ? 'restocked' then now() end, (v_i->>'restocked')::int, left(v_i->>'error', 300), now())
      on conflict (org_id, item_id) do update set title = excluded.title, available = excluded.available, sold = excluded.sold, price = excluded.price,
        status = excluded.status, logistic = excluded.logistic, permalink = excluded.permalink, thumbnail = excluded.thumbnail, variations = excluded.variations,
        last_restock_at = coalesce(excluded.last_restock_at, public.ml_items.last_restock_at),
        last_restock_qty = coalesce(excluded.last_restock_qty, public.ml_items.last_restock_qty),
        last_error = excluded.last_error, seen_at = now();
    end loop;
    if (p_data->>'complete')::boolean then
      update public.ml_items set status = 'no_activa' where org_id = v_org and seen_at < now() - interval '5 minutes' and status = 'active';
    end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'invoice_targets' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'ids', o.api_ids, 'title', o.title, 'seller', o.counterpart, 'date', o.ordered_at))
      from (select * from public.ml_orders where org_id = v_org and kind = 'compra' and merged_into is null and cardinality(api_ids) > 0
              and invoice_fetched_at is null and status <> 'cancelada'
              and coalesce(ordered_at, created_at) between now() - interval '400 days' and now() - interval '1 day'
            order by coalesce(ordered_at, created_at) desc limit least(coalesce((p_data->>'limit')::int, 25), 60)) o), '[]'::jsonb);

  elsif p_action = 'invoice_done' then
    update public.ml_orders set invoice_fetched_at = now()
    where org_id = v_org and id in (select (x)::uuid from jsonb_array_elements_text(coalesce(p_data->'ids', '[]'::jsonb)) x);
    return jsonb_build_object('ok', true);

  elsif p_action = 'store_invoice' then
    v_r := public.store_supplier_invoice(v_org, p_data, 'mercadolibre');
    perform public.supplier_invoice_match_arca(v_org);
    return jsonb_build_object('result', v_r);
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end;
$$;
revoke all on function public.ml_stock(text, uuid, text, jsonb) from public;
grant execute on function public.ml_stock(text, uuid, text, jsonb) to anon, authenticated;
