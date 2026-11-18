-- OC que sabemos que existen (aviso del BAC, hoja de entregas, PDF adjunto en un mail) y que no están cargadas.
create or replace view public.oc_missing_docs with (security_invoker = true) as
with known as (
  select org_id, upper(bac_number) as ref, 'bac'::text as src, coalesce(notified_at, perfected_at, prd_at, first_seen_at) as at, null::text as place, null::text as thread
    from public.bac_orders_inbox where not dismissed
  union all
  select org_id, unnest(oc_refs), 'entrega', coalesce(delivered_on::timestamptz, created_at), place, null from public.delivery_board
  union all
  select org_id, oc_ref, 'mail', received_at, null, coalesce(thread_id, message_id) from public.mail_oc_attachments where oc_ref is not null
)
select k.org_id, k.ref as bac_number,
       array_agg(distinct k.src) as sources,
       min(k.at) as first_seen, max(k.at) as last_seen,
       (array_agg(k.place) filter (where k.place is not null))[1] as place,
       (array_agg(k.thread order by k.at desc) filter (where k.thread is not null))[1] as mail_thread,
       (select u.name from public.bac_units u where u.org_id = k.org_id and u.code = split_part(k.ref, '-', 1)) as unit_name,
       bool_or(k.src = 'bac') as in_bac
  from known k
 where k.ref ~ '^\d{2,5}-\d{3,7}-OC\d{2}$'
   and not exists (select 1 from public.purchase_orders po where po.org_id = k.org_id and upper(po.bac_number) = k.ref and po.status <> 'anulada')
 group by k.org_id, k.ref;
grant select on public.oc_missing_docs to authenticated;
