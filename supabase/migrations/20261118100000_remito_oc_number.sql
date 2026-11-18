-- Número de OC en el remito: el de la OC vinculada o uno escrito a mano (OC que todavía no está cargada).
alter table public.remitos add column if not exists oc_number text check (oc_number is null or length(oc_number) <= 60);

do $$
declare d text;
begin
  d := pg_get_functiondef((select p.oid from pg_proc p where p.proname = 'emit_remito' and p.pronamespace = 'public'::regnamespace));
  if d not like '%oc_number%' then
    d := replace(d, 'recipient_iva, place_id, customer_id, purchase_order_id, notes, issuer, created_by)',
                    'recipient_iva, place_id, customer_id, purchase_order_id, notes, issuer, created_by, oc_number)');
    d := replace(d, '''whatsapp'', v_set.whatsapp),
    auth.uid())',
                    '''whatsapp'', v_set.whatsapp),
    auth.uid(), nullif(upper(trim(left(p_payload->>''oc_number'', 60))), ''''))');
    if d not like '%created_by, oc_number)%' or d not like '%p_payload->>''oc_number''%' then raise exception 'emit_remito: no se pudo aplicar'; end if;
    execute d;
  end if;
end $$;

create or replace view public.remitos_overview with (security_invoker = true) as
SELECT r.id, r.org_id, r.point_of_sale, r.number, r.provisional, r.issued_at, r.recipient_name, r.recipient_address, r.recipient_cuit,
    r.recipient_iva, r.place_id, r.customer_id, r.purchase_order_id, r.delivery_id, r.notes, r.issuer, r.status, r.void_reason,
    r.voided_at, r.voided_by, r.signed_document_id, r.print_count, r.last_printed_at, r.created_by, r.created_at, r.updated_at,
    public.remito_label(r.point_of_sale, r.number) AS label,
    COALESCE(po.bac_number, po.display_number, r.oc_number) AS po_number,
    ( SELECT count(*) FROM public.remito_items i WHERE i.remito_id = r.id) AS items_count,
    ( SELECT COALESCE(sum(i.quantity), 0::numeric) FROM public.remito_items i WHERE i.remito_id = r.id) AS units,
    ( SELECT string_agg(i.description, ' · ' ORDER BY i.line_no) FROM public.remito_items i WHERE i.remito_id = r.id) AS items_text,
    COALESCE(p.full_name, p.email) AS created_by_name,
    r.oc_number
   FROM public.remitos r
     LEFT JOIN public.purchase_orders_overview po ON po.id = r.purchase_order_id
     LEFT JOIN public.profiles p ON p.id = r.created_by;
