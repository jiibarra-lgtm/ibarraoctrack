-- =====================================================================
-- OC SISTEMA · Fase 1 · 006 — Endurecimiento de permisos de funciones
-- =====================================================================
-- Funciones de trigger: nunca invocables por API
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.tg_audit()        from public, anon, authenticated;
revoke execute on function public.tg_po_after()     from public, anon, authenticated;

-- Helpers de RLS: sólo usuarios autenticados (las políticas los evalúan como el invocador)
revoke execute on function public.is_org_member(uuid)                    from public, anon;
revoke execute on function public.has_org_role(uuid, public.app_role[])  from public, anon;
grant  execute on function public.is_org_member(uuid)                    to authenticated;
grant  execute on function public.has_org_role(uuid, public.app_role[])  to authenticated;
