-- Ajuste de permisos: helpers no invocables sin sesión
revoke execute on function public.storage_usage(uuid) from anon;
revoke execute on function public.tg_po_from_inbox() from anon, authenticated, public;
