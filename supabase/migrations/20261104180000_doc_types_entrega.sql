-- Tipos de documento de la orden: remitos oficial/provisorio y Parte de Recepción Definitiva (PRD)
alter type public.document_type add value if not exists 'remito_oficial';
alter type public.document_type add value if not exists 'remito_provisorio';
alter type public.document_type add value if not exists 'prd';
