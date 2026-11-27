-- Llaves de acceso (passkeys): entrar con Face ID / huella / Windows Hello
create table if not exists public.user_passkeys (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  credential_id text not null unique,
  public_key    text not null,            -- base64url
  counter       bigint not null default 0,
  transports    text[] not null default '{}',
  device        text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);
create index if not exists user_passkeys_user on public.user_passkeys(user_id);
alter table public.user_passkeys enable row level security;
drop policy if exists user_passkeys_select on public.user_passkeys;
create policy user_passkeys_select on public.user_passkeys for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists user_passkeys_delete on public.user_passkeys;
create policy user_passkeys_delete on public.user_passkeys for delete to authenticated using (user_id = (select auth.uid()));
-- altas y uso: sólo el servidor (clave secreta)

create table if not exists public.passkey_challenges (
  id         uuid primary key default gen_random_uuid(),
  challenge  text not null,
  user_id    uuid references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '5 minutes'
);
alter table public.passkey_challenges enable row level security;
-- sin políticas: sólo el servidor
