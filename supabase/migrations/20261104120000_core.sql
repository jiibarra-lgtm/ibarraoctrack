-- =====================================================================
-- OC SISTEMA · Fase 1 · 001 — Núcleo: organizaciones, perfiles, roles
-- =====================================================================

create extension if not exists pg_trgm  with schema extensions;
create extension if not exists unaccent with schema extensions;

-- Normalizador inmutable para índices y búsqueda (minúsculas + sin tildes)
create or replace function public.norm(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')))
$$;

-- Timestamps de actualización
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin', 'finanzas', 'compras', 'logistica', 'consulta');

-- ---------------------------------------------------------------------
-- Organizaciones (empresas / razones sociales)
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  legal_name  text,
  cuit        text check (cuit is null or cuit ~ '^\d{2}-?\d{8}-?\d$'),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_organizations_updated before update on public.organizations
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Perfiles (1:1 con auth.users)
-- ---------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.tg_set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Miembros de organización
-- ---------------------------------------------------------------------
create table public.organization_members (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        public.app_role not null default 'consulta',
  created_at  timestamptz not null default now(),
  unique (org_id, user_id)
);
create index idx_org_members_user on public.organization_members(user_id);

-- ---------------------------------------------------------------------
-- Helpers de autorización (security definer para evitar recursión RLS)
-- ---------------------------------------------------------------------
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org and m.user_id = (select auth.uid())
  )
$$;

create or replace function public.has_org_role(p_org uuid, p_roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.org_id = p_org
      and m.user_id = (select auth.uid())
      and m.role = any(p_roles)
  )
$$;

-- Crear organización: el creador queda como admin (atómico)
create or replace function public.create_organization(p_name text, p_legal_name text default null, p_cuit text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '28000';
  end if;
  insert into public.organizations (name, legal_name, cuit, created_by)
  values (trim(p_name), nullif(trim(p_legal_name), ''), nullif(trim(p_cuit), ''), v_uid)
  returning id into v_org;
  insert into public.organization_members (org_id, user_id, role) values (v_org, v_uid, 'admin');
  return v_org;
end;
$$;

revoke all on function public.create_organization(text, text, text) from public, anon;
grant execute on function public.create_organization(text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.organizations        enable row level security;
alter table public.profiles             enable row level security;
alter table public.organization_members enable row level security;

create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.has_org_role(id, array['admin']::public.app_role[]))
  with check (public.has_org_role(id, array['admin']::public.app_role[]));

create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members a
      join public.organization_members b on b.org_id = a.org_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy members_select on public.organization_members for select to authenticated
  using (public.is_org_member(org_id));
create policy members_insert on public.organization_members for insert to authenticated
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy members_update on public.organization_members for update to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]))
  with check (public.has_org_role(org_id, array['admin']::public.app_role[]));
create policy members_delete on public.organization_members for delete to authenticated
  using (public.has_org_role(org_id, array['admin']::public.app_role[]) and user_id <> (select auth.uid()));
