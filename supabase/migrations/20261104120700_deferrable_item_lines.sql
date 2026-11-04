-- =====================================================================
-- OC SISTEMA · Fase 1 · 008 — Renumeración de renglones sin escrituras temporales
-- La unicidad (orden, renglón, opción) se verifica al final de la transacción,
-- así se pueden reordenar renglones sin ensuciar la auditoría.
-- =====================================================================
alter table public.purchase_order_items
  drop constraint purchase_order_items_purchase_order_id_line_number_option_n_key;
alter table public.purchase_order_items
  add constraint uq_poi_line_option unique (purchase_order_id, line_number, option_number)
  deferrable initially deferred;
