-- Etiquetas configurables y reglas de rentabilidad de Mercado Libre
alter table public.ml_settings add column if not exists label_prefs jsonb not null default '{}'::jsonb;
alter table public.ml_settings add column if not exists profit_rules jsonb not null default '{}'::jsonb;
