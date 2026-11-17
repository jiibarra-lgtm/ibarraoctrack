-- =====================================================================
-- Correos de organismos cruzados con OC, entregas y el BAC
--  · Contactos por persona: a qué organismo/OC pertenece, teléfono de la firma, cuánto tardás en responderle.
--  · OC que llegaron adjuntas por mail y no están cargadas.
--  · Mails que hablan de lugar/domicilio de entrega (para comparar con la OC).
-- =====================================================================

-- Mis casillas (a las que más me escriben)
create or replace view public.mail_own_addresses with (security_invoker = true) as
select org_id, lower(trim(e)) as email
  from (select org_id, unnest(string_to_array(to_emails, ',')) as e from public.mail_messages) z
 group by org_id, lower(trim(e))
having count(*) >= 50;

-- Cada mail de un organismo con la primera respuesta mía en el mismo hilo
create or replace view public.mail_replies with (security_invoker = true) as
select p.id, p.org_id, p.thread_id, lower(p.from_email) as from_email, p.from_name, p.subject, p.received_at, p.kind, p.oc_ref, p.purchase_order_id,
       (select min(r.received_at) from public.mail_messages r
         where r.org_id = p.org_id and r.thread_id = p.thread_id and r.received_at > p.received_at
           and exists (select 1 from public.mail_own_addresses o where o.org_id = r.org_id and o.email = lower(r.from_email))) as replied_at
  from public.mail_public_insights p;

-- Teléfono de la firma: "Tel", "Int.", "Cel" seguido de números
create or replace function public.mail_phone(p text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(substring(coalesce(p, '') from '(?i)(?:tel[eé]?f?o?n?o?s?|cel(?:ular)?|whatsapp|interno|int\.)\s*[:.]?\s*((?:\+?54\s*)?(?:\(?\d{2,4}\)?[\s.-]*)?\d{4}[\s.-]?\d{4}(?:\s*(?:int\.?|interno)\s*\d{1,5})?)')), '')
$$;

create or replace view public.mail_contacts with (security_invoker = true) as
with refs as (
  select m.org_id, lower(m.from_email) as email,
         unnest(public.oc_refs_from_text(coalesce(m.subject, '') || ' ' || coalesce(m.snippet, '') || ' ' ||
           coalesce((select string_agg(x->>'name', ' ') from jsonb_array_elements(coalesce(m.attachments, '[]')) x), ''))) as ref
    from public.mail_messages m
   where m.received_at >= now() - interval '365 days'
)
select r.org_id, r.from_email as email,
       (array_agg(r.from_name order by r.received_at desc) filter (where coalesce(r.from_name, '') <> ''))[1] as name,
       count(*) as mails,
       count(*) filter (where r.received_at >= now() - interval '7 days') as last_7d,
       max(r.received_at) as last_at,
       count(*) filter (where r.replied_at is null) as unanswered,
       count(*) filter (where r.replied_at is null and r.kind = 'cotizacion') as unanswered_quotes,
       count(*) filter (where r.kind = 'reclamo') as complaints,
       round((percentile_cont(0.5) within group (order by extract(epoch from (r.replied_at - r.received_at)) / 3600)
             filter (where r.replied_at is not null))::numeric, 1) as reply_hours,
       (select public.mail_phone(mm.body) from public.mail_messages mm
         where mm.org_id = r.org_id and lower(mm.from_email) = r.from_email and public.mail_phone(mm.body) is not null
         order by mm.received_at desc limit 1) as phone,
       coalesce((select array_agg(distinct f.ref) from refs f where f.org_id = r.org_id and f.email = r.from_email
                   and (exists (select 1 from public.bac_orders_inbox i where i.org_id = f.org_id and upper(i.bac_number) = f.ref)
                        or exists (select 1 from public.purchase_orders po where po.org_id = f.org_id and upper(po.bac_number) = f.ref))), '{}') as oc_refs
  from public.mail_replies r
 where r.from_email !~* '(sigaf|no-?reply|notifica|sistema|mesa ?de ?entradas)'
 group by r.org_id, r.from_email;

-- OC adjuntas en mails (de cualquier remitente) que no están cargadas en el sistema
create or replace view public.mail_oc_attachments with (security_invoker = true) as
with a as (
  select m.id, m.org_id, m.thread_id, m.message_id, m.from_email, m.from_name, m.subject, m.received_at, x->>'name' as file
    from public.mail_messages m, jsonb_array_elements(coalesce(m.attachments, '[]')) x
   where (x->>'name') ~* '\.pdf$' and ((x->>'name') ~* '(\d{2,5}-\d{3,6}-?\s*oc\s*\d{2}|orden.{0,4}de.{0,4}compra|^o\.?c\.?[ _-]?\d)' or (m.subject ~* '\yo\.?c\.?\y' and (x->>'name') ~ '\d{4,6}'))
     and coalesce(m.category, '') not in ('licitacion')
     and m.received_at >= now() - interval '240 days'
), r as (
  select a.*, coalesce(nullif(public.oc_refs_from_text(a.file), '{}'), public.oc_refs_from_text(a.subject)) as refs,
         substring(a.file from '(\d{4,6})') as num
    from a
)
select r.id, r.org_id, r.thread_id, r.message_id, r.from_email, r.from_name, r.subject, r.received_at, r.file,
       coalesce(
         (select ref from unnest(r.refs) ref where ref like '%-' || r.num || '-%' limit 1),
         r.refs[1],
         (select upper(i.bac_number) from public.bac_orders_inbox i where i.org_id = r.org_id and i.bac_number ~* ('-' || r.num || '-') limit 1)
       ) as oc_ref,
       r.num
  from r
 where not exists (
   select 1 from public.purchase_orders po where po.org_id = r.org_id and po.status <> 'anulada'
      and (upper(po.bac_number) = any(r.refs) or (r.num is not null and po.bac_number ~* ('-' || r.num || '-'))));

-- Mails que mencionan lugar o domicilio de entrega
create or replace view public.mail_address_mentions with (security_invoker = true) as
select m.id, m.org_id, m.thread_id, m.message_id, m.from_email, m.from_name, m.subject, m.received_at,
       btrim(regexp_replace(substring(m.body from '(?i)([^\n>]{0,60}(?:lugar de entrega|domicilio de entrega|direcci[oó]n de entrega|entregar en|nueva direcci[oó]n|cambio de domicilio|nuevo domicilio)[^\n]{0,200})'), '\s+', ' ', 'g')) as excerpt,
       p.oc_ref, p.purchase_order_id, po.delivery_place
  from public.mail_messages m
  join public.mail_public_insights p on p.id = m.id
  left join public.purchase_orders po on po.id = p.purchase_order_id
 where m.body ~* '(lugar de entrega|domicilio de entrega|direcci[oó]n de entrega|entregar en|nueva direcci[oó]n|cambio de domicilio|nuevo domicilio)';
