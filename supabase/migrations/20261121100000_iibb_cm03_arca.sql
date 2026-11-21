-- IIBB desde ARCA: las DDJJ presentadas (CM03 de SIFERE) se toman tal cual, con su pago (VEP).
alter table public.iibb_filings add column if not exists source text not null default 'sistema' check (source in ('sistema', 'arca'));
alter table public.iibb_filings add column if not exists verifier text;
alter table public.iibb_filings add column if not exists vep text;
alter table public.iibb_filings add column if not exists paid_amount numeric(16,2);

-- Guarda un CM03 leído del PDF (p_f: {month, verifier, presented_at, rows:[{code,tax,restan,suman,favor_contrib,favor_fisco,due}], total_tax, total_due, paid_at, paid_amount, vep})
create or replace function public.iibb_store_cm03(p_org uuid, p_f jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_month text := p_f->>'month'; v_detail jsonb;
begin
  if v_month is null or v_month !~ '^\d{4}-\d{2}$' or jsonb_typeof(p_f->'rows') <> 'array' or jsonb_array_length(p_f->'rows') = 0 then return 'invalido'; end if;
  select jsonb_agg(jsonb_build_object(
      'code', (r->>'code')::int,
      'coefficient', (select j.coefficient from public.iibb_jurisdictions j where j.org_id = p_org and j.code = (r->>'code')::int),
      'tax', (r->>'tax')::numeric, 'restan', (r->>'restan')::numeric, 'suman', coalesce((r->>'suman')::numeric, 0),
      'favor_next', coalesce((r->>'favor_contrib')::numeric, 0), 'favor_fisco', coalesce((r->>'favor_fisco')::numeric, 0), 'due', (r->>'due')::numeric,
      'retenciones', (r->>'restan')::numeric, 'percepciones', 0, 'sircreb', 0, 'favor_prev', 0) order by (r->>'code')::int)
    into v_detail from jsonb_array_elements(p_f->'rows') r;
  insert into public.iibb_filings (org_id, month, base, detail, total_tax, total_due, status, presented_at, source, verifier, vep, paid_at, paid_amount, notes, updated_at)
  values (p_org, v_month, 0, v_detail, (p_f->>'total_tax')::numeric, (p_f->>'total_due')::numeric, 'presentada', nullif(p_f->>'presented_at', '')::date,
    'arca', p_f->>'verifier', p_f->>'vep', nullif(p_f->>'paid_at', '')::date, nullif(p_f->>'paid_amount', '')::numeric, 'CM03 presentado (SIFERE / ARCA)', now())
  on conflict (org_id, month) do update set
    detail = excluded.detail, total_tax = excluded.total_tax, total_due = excluded.total_due, status = 'presentada',
    presented_at = coalesce(excluded.presented_at, public.iibb_filings.presented_at), source = 'arca',
    verifier = coalesce(excluded.verifier, public.iibb_filings.verifier), vep = coalesce(excluded.vep, public.iibb_filings.vep),
    paid_at = coalesce(excluded.paid_at, public.iibb_filings.paid_at), paid_amount = coalesce(excluded.paid_amount, public.iibb_filings.paid_amount),
    notes = excluded.notes, updated_at = now();
  return 'ok';
end;
$$;
revoke all on function public.iibb_store_cm03(uuid, jsonb) from public, anon, authenticated;

-- Desde el script de Gmail (token) y desde la pantalla (usuario de finanzas)
create or replace function public.ingest_iibb_cm03(p_token text, p_f jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  return public.iibb_store_cm03(v_org, p_f);
end;
$$;
grant execute on function public.ingest_iibb_cm03(text, jsonb) to anon, authenticated;

create or replace function public.iibb_import_cm03(p_org uuid, p_f jsonb) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_org_role(p_org, array['admin','finanzas']::public.app_role[]) then raise exception 'Sin permisos' using errcode = '42501'; end if;
  return public.iibb_store_cm03(p_org, p_f);
end;
$$;
revoke all on function public.iibb_import_cm03(uuid, jsonb) from public, anon;
grant execute on function public.iibb_import_cm03(uuid, jsonb) to authenticated;
