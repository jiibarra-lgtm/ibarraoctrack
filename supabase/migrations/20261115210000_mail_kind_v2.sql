-- Clasificación de correos de organismos más precisa: "urgente" en un pedido de cotización no es un reclamo,
-- y los avisos automáticos / boletines no cuentan.
create or replace function public.mail_kind(p_subject text, p_body text)
returns text language sql immutable set search_path = '' as $$
  select case
    when t ~* '(reclamo|no (nos )?(ha |han )?(lleg[oóa]|recib|entreg)|todav[ií]a no (lleg|recib|entreg)|a[uú]n no (lleg|recib|entreg)|faltante|faltan? (unidades|productos|art[ií]culos|renglones|cajas|bultos)|demora en (la )?entrega|sin entregar|incumplimiento|intimaci[oó]n|vencid[oa] el plazo|plazo de entrega vencido|penalidad)' then 'reclamo'
    when t ~* '(recib[ií]mos conforme|recepci[oó]n conforme|conformidad de (la )?recepci|remito firmado|firmado y sellado|fue recibid[oa] (la|el)? ?(mercader|pedido|material|entrega)|se recibi[oó] (la|el) (mercader|pedido|material|entrega))' then 'conformidad'
    when t ~* '(coordinar (la )?entrega|horario de (entrega|recepci)|d[ií]a de entrega|entregar en|lugar de entrega|cu[aá]ndo (pueden|podr[ií]an|van a) entregar|turno de entrega|pedido de entrega|solicitud de entrega|fecha de entrega)' then 'entrega'
    when t ~* '(cotiz|presupuesto|compulsa|solicitud de precio)' then 'cotizacion'
    else null end
  from (select coalesce(p_subject, '') || ' ' || left(coalesce(p_body, ''), 3000) as t) x
$$;

do $$
declare d text;
begin
  d := pg_get_viewdef('public.mail_public_insights'::regclass, true);
  if d not like '%bue.edu.ar%' then raise exception 'mail_public_insights: definición inesperada'; end if;
end $$;

create or replace view public.mail_public_insights with (security_invoker = true) as
with own as (
  select org_id, lower(trim(e)) as email
    from (select org_id, unnest(string_to_array(to_emails, ',')) as e from public.mail_messages) z
   group by org_id, lower(trim(e))
  having count(*) >= 50
),
pub as (
  select m.*, public.mail_kind(m.subject, m.body) as kind,
    upper(coalesce(m.bac_number, substring(m.subject || ' ' || coalesce(m.snippet, '') from '(\d{3,5}-\d{4,6}-OC\d{2})'))) as oc_ref
  from public.mail_messages m
  where m.from_email ~* '\.(gob|gov)\.ar$|\.gob\.ar>?$|bue\.edu\.ar$|jusbaires|\.gov\.ar'
    and m.from_email !~* '(no-?reply|notificacion|^info|newsletter|comunicaci|prensa|bolet[ií]n|vecinos|novedades|jorge\.macri|sistema|mesadeayuda|soporte)'
    and coalesce(m.category, '') not in ('licitacion', 'orden', 'prd', 'perfeccionamiento', 'pago')
    and not exists (select 1 from own o where o.org_id = m.org_id and o.email = lower(m.from_email))
)
select p.id, p.org_id, p.message_id, p.thread_id, p.from_email, p.from_name, p.subject, p.received_at, p.snippet, p.kind, p.oc_ref,
  po.id as purchase_order_id,
  not exists (
    select 1 from public.mail_messages r
     where r.org_id = p.org_id and r.thread_id = p.thread_id and r.received_at > p.received_at
       and exists (select 1 from own o where o.org_id = r.org_id and o.email = lower(r.from_email))
  ) as unanswered,
  p.received_at < now() - interval '48 hours' as over_48h,
  p.alert_sent_at
from pub p
left join public.purchase_orders po on po.org_id = p.org_id and upper(po.bac_number) = p.oc_ref
where p.received_at >= now() - interval '120 days';
grant select on public.mail_public_insights to authenticated;
