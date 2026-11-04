-- =====================================================================
-- OC SISTEMA · Fase 1 · 004 — Documentos, importaciones, almacenamiento
-- =====================================================================

create type public.document_type as enum (
  'orden_compra', 'cotizacion', 'factura_proveedor', 'factura_emitida', 'remito',
  'constancia_recepcion', 'conformidad', 'comprobante_pago', 'nota_credito',
  'contrato', 'otro'
);

create table public.documents (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  purchase_order_id  uuid references public.purchase_orders(id) on delete set null,
  doc_type           public.document_type not null default 'otro',
  title              text not null,
  storage_path       text not null,
  mime_type          text not null,
  size_bytes         bigint not null check (size_bytes > 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  current_version    integer not null default 1,
  uploaded_by        uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (org_id, sha256),
  unique (storage_path)
);
create index idx_documents_po on public.documents(purchase_order_id);
create index idx_documents_title_trgm on public.documents using gin (public.norm(title) extensions.gin_trgm_ops);
create trigger trg_documents_updated before update on public.documents
  for each row execute function public.tg_set_updated_at();

create table public.document_versions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  document_id   uuid not null references public.documents(id) on delete cascade,
  version       integer not null,
  storage_path  text not null,
  size_bytes    bigint not null,
  sha256        text not null,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (document_id, version)
);

-- ---------------------------------------------------------------------
-- Trabajos de importación (procesamiento asíncrono con estados)
-- ---------------------------------------------------------------------
create type public.import_status as enum (
  'pendiente',    -- archivo subido, esperando procesamiento
  'procesando',   -- extracción en curso
  'revision',     -- datos extraídos, esperando revisión humana
  'confirmado',   -- convertido en orden
  'error',        -- falló (reintentable si attempts < max_attempts)
  'descartado'
);

create table public.import_jobs (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references public.organizations(id) on delete cascade,
  kind                   text not null default 'orden_bac' check (kind in ('orden_bac')),
  document_id            uuid not null references public.documents(id) on delete restrict,
  status                 public.import_status not null default 'pendiente',
  attempts               integer not null default 0,
  max_attempts           integer not null default 3,
  last_error             text,
  locked_at              timestamptz,
  started_at             timestamptz,
  finished_at            timestamptz,
  result_purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  created_by             uuid references auth.users(id) on delete set null,
  confirmed_by           uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_import_jobs_org_status on public.import_jobs(org_id, status, created_at desc);
create index idx_import_jobs_document on public.import_jobs(document_id);
create trigger trg_import_jobs_updated before update on public.import_jobs
  for each row execute function public.tg_set_updated_at();

-- Resultado de extracción (borrador; los datos confirmados viven en columnas tipadas)
create table public.extracted_document_data (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  import_job_id  uuid not null references public.import_jobs(id) on delete cascade,
  extractor      text not null check (extractor in ('heuristica', 'ia', 'combinado')),
  method         text not null check (method in ('texto', 'ocr')),
  raw_text       text,
  data           jsonb not null,
  warnings       jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now()
);
create index idx_extracted_job on public.extracted_document_data(import_job_id, created_at desc);

-- Tomar un trabajo de forma segura ante concurrencia (evita doble procesamiento)
create or replace function public.claim_import_job(p_job uuid)
returns public.import_jobs
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.import_jobs;
begin
  update public.import_jobs j
     set status = 'procesando',
         attempts = j.attempts + 1,
         locked_at = now(),
         started_at = coalesce(j.started_at, now()),
         last_error = null
   where j.id = p_job
     and (
       j.status = 'pendiente'
       or (j.status = 'error' and j.attempts < j.max_attempts)
       or (j.status = 'procesando' and j.locked_at < now() - interval '5 minutes')  -- lock vencido
     )
  returning j.* into v;
  return v;  -- null si no se pudo tomar
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.documents               enable row level security;
alter table public.document_versions       enable row level security;
alter table public.import_jobs             enable row level security;
alter table public.extracted_document_data enable row level security;

create policy documents_select on public.documents for select to authenticated
  using (public.is_org_member(org_id));
create policy documents_insert on public.documents for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));
create policy documents_update on public.documents for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));
create policy documents_delete on public.documents for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]));

create policy docver_select on public.document_versions for select to authenticated
  using (public.is_org_member(org_id));
create policy docver_insert on public.document_versions for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas','logistica']::public.app_role[]));

create policy jobs_select on public.import_jobs for select to authenticated
  using (public.is_org_member(org_id));
create policy jobs_insert on public.import_jobs for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));
create policy jobs_update on public.import_jobs for update to authenticated
  using (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));

create policy extracted_select on public.extracted_document_data for select to authenticated
  using (public.is_org_member(org_id));
create policy extracted_insert on public.extracted_document_data for insert to authenticated
  with check (public.has_org_role(org_id, array['admin','compras','finanzas']::public.app_role[]));

-- ---------------------------------------------------------------------
-- Storage privado: ruta = {org_id}/...
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 26214400,
        array['application/pdf','image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do update set public = false;

create policy storage_docs_select on storage.objects for select to authenticated
  using (bucket_id = 'documents' and public.is_org_member(((storage.foldername(name))[1])::uuid));
create policy storage_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and public.has_org_role(((storage.foldername(name))[1])::uuid,
                                      array['admin','compras','finanzas','logistica']::public.app_role[]));
create policy storage_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and public.has_org_role(((storage.foldername(name))[1])::uuid, array['admin']::public.app_role[]));
