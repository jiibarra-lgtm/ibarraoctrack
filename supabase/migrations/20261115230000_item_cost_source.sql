-- Costo de un renglón de OC tomado de un producto comprado (renglón de una factura de proveedor del mail)
alter table public.purchase_order_items add column if not exists cost_source_item_id uuid references public.supplier_invoice_items(id) on delete set null;
alter table public.purchase_order_items add column if not exists cost_source_divisor numeric(18,4) check (cost_source_divisor is null or cost_source_divisor > 0);
create index if not exists idx_poi_cost_source on public.purchase_order_items(cost_source_item_id) where cost_source_item_id is not null;
