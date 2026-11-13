/**
 * BAC: "Inicio período de actualización de precios - convenio marco 623-38-CM26" /
 * "Inicio período de incremento de stock - …". Trae desde y hasta qué día está abierta la ventana.
 */
export type ConvenioWindow = { message_id: string; contract_number: string; kind: "precios" | "stock"; starts_on: string; ends_on: string; contract_name: string | null; process_number: string | null };

const iso = (d: string) => { const [dd, mm, yy] = d.split("/"); return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`; };

export function parseConvenioWindow(m: { id: string; from: string; subject: string; body: string }): ConvenioWindow | null {
  if (!/notificacionesbac@buenosaires/i.test(m.from) || !/inicio per[ií]odo de (actualizaci[oó]n de precios|incremento de stock)/i.test(m.subject)) return null;
  const t = m.body.replace(/\s+/g, " ");
  const contract = /(\d{2,5}-\d{1,4}-CM\d{2})/i.exec(m.subject)?.[1] ?? /(\d{2,5}-\d{1,4}-CM\d{2})/i.exec(t)?.[1];
  const from = /a partir del d[ií]a (\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t)?.[1];
  const to = /hasta (?:el )?(?:d[ií]a )?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(t)?.[1];
  if (!contract || !from || !to) return null;
  const name = /convenio marco N[º°o]?\s*\d{2,5}-\d{1,4}-CM\d{2}\s+(.+?)\.?\s+en relaci[oó]n/i.exec(t)?.[1]?.trim() ?? null;
  const proc = /proceso de compra N[º°o]?\s*(\d{2,5}-\d{1,7}-[A-Z]{2,5}\d{2})/i.exec(t)?.[1]?.toUpperCase() ?? null;
  return { message_id: m.id, contract_number: contract.toUpperCase(), kind: /stock/i.test(m.subject) ? "stock" : "precios", starts_on: iso(from), ends_on: iso(to), contract_name: name, process_number: proc };
}
