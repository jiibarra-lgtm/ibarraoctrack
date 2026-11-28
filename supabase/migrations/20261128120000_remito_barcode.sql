-- Código de barras en el remito para confirmar la entrega escaneándolo desde la app
alter table public.qr_settings add column if not exists barcode_provisional boolean not null default true;
alter table public.qr_settings add column if not exists barcode_official boolean not null default false;
alter table public.qr_settings add column if not exists scan_action text not null default 'entregado' check (scan_action in ('entregado', 'firmado'));
alter table public.qr_settings add column if not exists scan_confirm boolean not null default false;
