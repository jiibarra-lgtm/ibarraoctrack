-- Facturar varios remitos juntos: la factura recuerda qué remitos del sistema incluye y cada remito queda marcado como facturado.
alter table public.remitos add column if not exists invoice_emission_id uuid references public.arca_emissions(id) on delete set null;
create index if not exists remitos_invoice_emission_idx on public.remitos (invoice_emission_id);
alter table public.arca_emissions add column if not exists remito_ids uuid[] not null default '{}';

do $$
declare d text := pg_get_functiondef('public.einvoice_record(uuid,jsonb)'::regprocedure);
begin
  if position('remito_ids' in d) = 0 then
    d := replace(d, $a$    remitos = coalesce(case when jsonb_typeof(p_e->'remitos') = 'array' then p_e->'remitos' end, '[]'::jsonb)
  where id = v_id;$a$, $a$    remitos = coalesce(case when jsonb_typeof(p_e->'remitos') = 'array' then p_e->'remitos' end, '[]'::jsonb)
  where id = v_id;

  -- remitos del sistema incluidos en la factura (o liberados si es la nota de crédito que la anula)
  if v_kind = 'factura' and jsonb_typeof(p_e->'remito_ids') = 'array' then
    update public.arca_emissions set remito_ids = array(
      select r.id from public.remitos r where r.org_id = p_org and r.id::text in (select jsonb_array_elements_text(p_e->'remito_ids')))
    where id = v_id;
    update public.remitos set invoice_emission_id = v_id
     where org_id = p_org and invoice_emission_id is null and id::text in (select jsonb_array_elements_text(p_e->'remito_ids'));
  elsif v_kind = 'nota_credito' and v_asoc.id is not null and (p_e->>'total')::numeric >= v_asoc.total then
    update public.remitos set invoice_emission_id = null where org_id = p_org and invoice_emission_id = v_asoc.id;
  end if;$a$);
    if position('remito_ids' in d) = 0 then raise exception 'No se pudo actualizar einvoice_record'; end if;
    execute d;
  end if;
end $$;
