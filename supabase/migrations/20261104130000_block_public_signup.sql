-- =====================================================================
-- OC SISTEMA · Acceso privado: se bloquea el auto-registro.
-- Las cuentas sólo se crean desde SQL/administración con app.allow_signup = 'on'.
-- (Además conviene desactivar "Allow new users to sign up" en Supabase Auth.)
-- =====================================================================
create or replace function public.block_public_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.allow_signup', true), '') <> 'on' then
    raise exception 'El registro público está deshabilitado' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function public.block_public_signup() from public, anon, authenticated;

create trigger trg_block_public_signup
  before insert on auth.users
  for each row execute function public.block_public_signup();
