-- Gastos fijos: rubro automático según quién factura (luz, teléfono, prepaga, peajes…)
-- y sugerencias de ARCA separando servicios de proveedores de mercadería.
create or replace function public.fixed_cost_category(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n ~ '\m(edesur|edenor|metrogas|naturgy|camuzzi|aysa|absa\M|aguas|gas natural|energia|electric|edelap|edea\M)' then 'servicios'
    when n ~ '\m(telefonica|movistar|claro\M|amx\M|personal\M|telecom|fibertel|iplan|telecentro|cablevision|flow\M|directv|starlink|internet)' then 'telefonia'
    when n ~ '\m(galeno|osde|swiss medical|medicus|omint|sancor salud|accord|prepaga|medicina)' then 'salud'
    when n ~ '\m(seguro|aseguradora|federacion patronal|la caja|zurich|mapfre|allianz|rivadavia|san cristobal|provincia art|art\M)' then 'seguros'
    when n ~ '\m(autopista|ausa\M|peaje|telepase|ypf|shell|axion|puma energy|combustible|estacionamiento|parking)' then 'vehiculos'
    when n ~ '\m(agip|arba|municipalidad|gobierno de la ciudad|abl\M|rentas\M)' then 'impuestos'
    when n ~ '\m(banco|bank|mercadopago|mercado pago|payway|prisma|fiserv|first data)' then 'bancos'
    when n ~ '\m(google|microsoft|contabilium|tango\M|xubio|colppy|adobe|amazon web|vercel|supabase|dropbox|zoom\M|godaddy|nic argentina|donweb|hostinger)' then 'software'
    when n ~ '\m(estudio contable|contador|abogad|escribania|honorario)' then 'honorarios'
    when n ~ '\m(alquiler|inmobiliaria|propiedades|consorcio|expensas)' then 'alquiler'
  end
  from (select lower(translate(coalesce(p_name, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')) as n) x;
$$;

-- Los que se agregaron desde ARCA con rubro "otros" toman el rubro que corresponde
update public.fixed_costs set category = public.fixed_cost_category(name)
where category = 'otros' and public.fixed_cost_category(name) is not null;

drop view public.arca_recurring_suppliers;
create view public.arca_recurring_suppliers with (security_invoker = true) as
select v.org_id, v.doc_number as cuit, max(v.name) as name,
  count(distinct to_char(v.issue_date, 'YYYY-MM')) as months,
  round(sum(v.sign * v.total) / count(distinct to_char(v.issue_date, 'YYYY-MM')), 2) as avg_month,
  max(v.issue_date) as last_date,
  public.fixed_cost_category(max(v.name)) as category,
  -- servicio = rubro conocido; si no, probablemente es un proveedor de mercadería
  public.fixed_cost_category(max(v.name)) is not null as is_service
from public.arca_vouchers_overview v
where v.direction = 'recibido' and v.issue_date >= (current_date - interval '6 months')
group by v.org_id, v.doc_number
having count(distinct to_char(v.issue_date, 'YYYY-MM')) >= 3
   and not exists (select 1 from public.fixed_costs f where f.org_id = v.org_id and f.supplier_cuit = v.doc_number);
grant select on public.arca_recurring_suppliers to authenticated;
