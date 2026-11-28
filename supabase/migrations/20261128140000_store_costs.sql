-- Costos de la tienda web (ibarrainsumos.com.ar): cada producto de la tienda elige uno de los costos manuales (o un costo propio).
-- La tienda los lee/guarda por /api/tienda/costos (verifica que quien llama sea admin de la tienda) con una clave del servidor.
create table if not exists public.store_link (
  org_id     uuid primary key references public.organizations(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
alter table public.store_link enable row level security;

create table if not exists public.store_costs (
  org_id         uuid not null references public.organizations(id) on delete cascade,
  slug           text not null check (length(slug) between 1 and 200),
  name           text,
  manual_cost_id uuid references public.manual_costs(id) on delete set null,
  cost_override  numeric(14,2) check (cost_override is null or cost_override >= 0),
  updated_at     timestamptz not null default now(),
  primary key (org_id, slug)
);
alter table public.store_costs enable row level security;
drop policy if exists store_costs_select on public.store_costs;
create policy store_costs_select on public.store_costs for select to authenticated using (public.is_org_member(org_id));

create or replace function public.store_costs_api(p_secret text, p_action text, p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_i jsonb; v_n integer := 0;
begin
  if p_secret is null or length(p_secret) < 32 then raise exception 'Clave inválida' using errcode = '28000'; end if;
  select org_id into v_org from public.store_link where token_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Clave inválida' using errcode = '28000'; end if;

  if p_action = 'list' then
    return jsonb_build_object(
      'costs', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'sku', sku, 'description', description, 'supplier', supplier, 'cost_net', cost_net,
                 'cost_gross', cost_gross, 'includes_vat', includes_vat, 'vat_pct', vat_pct, 'unit', unit) order by description)
                 from public.manual_costs where org_id = v_org and active), '[]'::jsonb),
      'links', coalesce((select jsonb_agg(jsonb_build_object('slug', slug, 'name', name, 'manual_cost_id', manual_cost_id, 'cost_override', cost_override))
                 from public.store_costs where org_id = v_org), '[]'::jsonb));
  elsif p_action = 'set' then
    for v_i in select x from jsonb_array_elements(coalesce(p_data->'items', '[]'::jsonb)) x loop
      continue when coalesce(v_i->>'slug', '') = '';
      if nullif(v_i->>'manual_cost_id', '') is null and nullif(v_i->>'cost_override', '') is null then
        delete from public.store_costs where org_id = v_org and slug = v_i->>'slug';
      else
        if nullif(v_i->>'manual_cost_id', '') is not null and not exists (select 1 from public.manual_costs where id = (v_i->>'manual_cost_id')::uuid and org_id = v_org) then
          raise exception 'Costo inexistente' using errcode = '22023';
        end if;
        insert into public.store_costs (org_id, slug, name, manual_cost_id, cost_override, updated_at)
        values (v_org, left(v_i->>'slug', 200), left(v_i->>'name', 300), nullif(v_i->>'manual_cost_id', '')::uuid, nullif(v_i->>'cost_override', '')::numeric, now())
        on conflict (org_id, slug) do update set name = excluded.name, manual_cost_id = excluded.manual_cost_id, cost_override = excluded.cost_override, updated_at = now();
      end if;
      v_n := v_n + 1;
    end loop;
    return jsonb_build_object('ok', true, 'n', v_n);
  end if;
  raise exception 'Acción inválida' using errcode = '22023';
end $$;
revoke all on function public.store_costs_api(text, text, jsonb) from public;
grant execute on function public.store_costs_api(text, text, jsonb) to anon, authenticated;
