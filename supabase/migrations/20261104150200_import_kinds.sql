-- =====================================================================
-- OC SISTEMA · Fase 2/3 — Tipos de importación: facturas de proveedor y remitos
-- =====================================================================
alter table public.import_jobs drop constraint import_jobs_kind_check;
alter table public.import_jobs add constraint import_jobs_kind_check check (kind in ('orden_bac', 'factura_proveedor', 'remito'));
