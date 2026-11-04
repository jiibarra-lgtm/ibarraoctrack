-- =====================================================================
-- Correos del trabajo (organismos, BAC, SIGAF) visibles en la app + uso de espacio
-- =====================================================================
create table public.mail_messages (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  message_id      text not null,
  thread_id       text,
  from_email      text,
  from_name       text,
  to_emails       text,
  subject         text,
  received_at     timestamptz not null,
  snippet         text,
  body            text,
  category        text not null default 'organismo'
                  check (category in ('orden', 'perfeccionamiento', 'prd', 'pago', 'licitacion', 'organismo', 'otro')),
  bac_number      text,
  process_number  text,
  attachments     jsonb not null default '[]'::jsonb,
  is_read         boolean not null default false,
  starred         boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (org_id, message_id)
);
create index idx_mail_org_date on public.mail_messages(org_id, received_at desc);
create index idx_mail_bac on public.mail_messages(org_id, bac_number) where bac_number is not null;
create index idx_mail_search on public.mail_messages using gin (public.norm(coalesce(subject, '') || ' ' || coalesce(from_name, '') || ' ' || coalesce(snippet, '')) extensions.gin_trgm_ops);

alter table public.mail_messages enable row level security;
create policy mail_select on public.mail_messages for select to authenticated using (public.is_org_member(org_id));
create policy mail_update on public.mail_messages for update to authenticated
  using (public.is_org_member(org_id)) with check (public.is_org_member(org_id));

create or replace function public.ingest_mail_messages(p_token text, p_messages jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_m   jsonb;
  v_n   integer := 0;
  v_cat text;
begin
  if p_token is null or length(p_token) < 32 then raise exception 'Token inválido' using errcode = '28000'; end if;
  select org_id into v_org from public.inbound_tokens where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if v_org is null then raise exception 'Token inválido' using errcode = '28000'; end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 500 then
    raise exception 'Formato inválido' using errcode = '22023';
  end if;
  for v_m in select * from jsonb_array_elements(p_messages) loop
    continue when coalesce(v_m->>'message_id', '') = '';
    v_cat := coalesce(v_m->>'category', 'organismo');
    if v_cat not in ('orden', 'perfeccionamiento', 'prd', 'pago', 'licitacion', 'organismo', 'otro') then v_cat := 'otro'; end if;
    insert into public.mail_messages (org_id, message_id, thread_id, from_email, from_name, to_emails, subject, received_at, snippet, body,
                                      category, bac_number, process_number, attachments)
    values (v_org, left(v_m->>'message_id', 200), left(v_m->>'thread_id', 200), left(v_m->>'from_email', 300), left(v_m->>'from_name', 300),
            left(v_m->>'to', 1000), left(v_m->>'subject', 500), coalesce((v_m->>'received_at')::timestamptz, now()),
            left(v_m->>'snippet', 400), left(v_m->>'body', 20000), v_cat,
            nullif(upper(left(v_m->>'bac_number', 40)), ''), nullif(upper(left(v_m->>'process_number', 40)), ''),
            case when jsonb_typeof(v_m->'attachments') = 'array' then v_m->'attachments' else '[]'::jsonb end)
    on conflict (org_id, message_id) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.ingest_mail_messages(text, jsonb) from public;
grant execute on function public.ingest_mail_messages(text, jsonb) to anon, authenticated;

-- Uso de espacio (base completa y archivos de la empresa)
create or replace function public.storage_usage(p_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_org_member(p_org) then raise exception 'Sin acceso' using errcode = '42501'; end if;
  return jsonb_build_object(
    'db_bytes', pg_database_size(current_database()),
    'files_bytes', (select coalesce(sum((metadata->>'size')::bigint), 0) from storage.objects where bucket_id = 'documents' and name like p_org::text || '/%'),
    'files', (select count(*) from storage.objects where bucket_id = 'documents' and name like p_org::text || '/%'),
    'mails', (select count(*) from public.mail_messages where org_id = p_org),
    'mails_bytes', (select coalesce(sum(pg_column_size(m.*)), 0) from public.mail_messages m where org_id = p_org)
  );
end;
$$;
revoke all on function public.storage_usage(uuid) from public;
grant execute on function public.storage_usage(uuid) to authenticated;
