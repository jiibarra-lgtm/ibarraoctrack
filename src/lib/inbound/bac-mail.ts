/**
 * Lector de avisos automáticos del GCBA (BAC y SIGAF). Textos fijos, sin IA.
 * Devuelve un evento normalizado o null si el mail no es un aviso conocido.
 */
export type InboundMail = { id: string; from: string; subject: string; date: string; body: string; to?: string };

export type BacEvent =
  | { kind: "oc_generada"; bac_number: string; convenio_number: string | null; convenio_name: string | null }
  | { kind: "oc_perfeccionada"; bac_number: string; process_number: string | null; process_name: string | null }
  | { kind: "prd"; bac_number: string; prd_number: string }
  | { kind: "pago"; invoice_type: string; point_of_sale: string; number: string; invoice_date: string | null }
  | { kind: "acto"; act: BacAct; bac_number: string | null; contract_number: string | null; act_number: string | null; process_number: string | null; process_name: string | null }
  | { kind: "publicacion"; source: "bac" | "comprar"; process_number: string; unit_code: string | null; unit_name: string | null; title: string | null; opening_date: string | null };

export type BacAct = "ampliacion" | "prorroga" | "rescision" | "penalidad" | "disminucion" | "otro";
export type ParsedMail = { message_id: string; received_at: string; subject: string; event: BacEvent };

const OC = /\b(\d{2,5}-\d{3,7}-OC\d{2})\b/i;
const PROC = /\b(\d{2,5}-\d{1,7}-(?:LPU|LPR|CME|CDI|CM|COMP|LIC|CD|CP|SUB|CON|CPE|LP)\d{2})\b/i;
// COMPR.AR (Nación): 74/35-0592-LPR26, 16-0021-LPR26
const PROC_NAC = /\b(\d{1,4}(?:\/\d{1,4})?-\d{3,5}-[A-Z]{2,5}\d{2})\b/;
const clean = (s: string) => s.replace(/[\t\r]+/g, " ").replace(/ /g, " ").replace(/[ ]{2,}/g, " ").trim();
const arDate = (s: string | undefined) => {
  const m = s ? /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s) : null;
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
};
const tidyName = (s: string | undefined | null) => (s ? s.replace(/\s+/g, " ").replace(/[.,;:\s]+$/, "").trim() || null : null);

export function parseBacMail(m: InboundMail): ParsedMail | null {
  const from = m.from.toLowerCase();
  const subject = clean(m.subject);
  const body = clean(m.body);
  const text = `${subject}\n${body}`;
  const base = { message_id: m.id, received_at: m.date, subject };

  if (from.includes("sigaf")) {
    // PRD - CPO: "Parte de Recepcion ... Nro. 375477/2026, perteneciente a la Orden de Compra BAC nro. 449-17467-OC26."
    const prd = /Parte de Recepci[oó]n[\s\S]*?Nro\.?\s*([\d./-]+?)\s*,[\s\S]*?Orden de Compra BAC nro\.?\s*(\d{2,5}-\d{3,7}-OC\d{2})/i.exec(body);
    if (prd) return { ...base, event: { kind: "prd", bac_number: prd[2].toUpperCase(), prd_number: prd[1].replace(/[.,]$/, "") } };
    // Pago Acreditado: "transferido al banco el pago de la factura B 2-7049 del 06/10/2026"
    const pago = /pago de la factura\s+([ABCME])\s*(\d{1,5})\s*-\s*(\d{1,8})(?:\s+del\s+(\d{1,2}\/\d{1,2}\/\d{4}))?/i.exec(body);
    if (pago) return { ...base, event: { kind: "pago", invoice_type: pago[1].toUpperCase(), point_of_sale: String(Number(pago[2])), number: String(Number(pago[3])), invoice_date: arDate(pago[4]) } };
    return null;
  }

  if (from.includes("comprar.gob.ar")) {
    // "Oficina de compras: 74/35 - Parque Nacional Copo Proceso: 74/35-0592-LPR26 Adquisición de insumos ..."
    if (!/publicad/i.test(text)) return null;
    const flat = body.replace(/[|*]/g, " ").replace(/\s+/g, " ");
    const pr = /Proceso:\s*(\d{1,4}(?:\/\d{1,4})?-\d{3,5}-[A-Z]{2,5}\d{2})\s+(.+?)(?:\s*\[|$)/i.exec(flat);
    const num = pr?.[1] ?? PROC_NAC.exec(subject)?.[1] ?? PROC_NAC.exec(flat)?.[1];
    if (!num) return null;
    const unit = /Oficina de compras:\s*([\d/]+)\s*-\s*(.+?)\s+Proceso:/i.exec(flat);
    return { ...base, event: { kind: "publicacion", source: "comprar", process_number: num.toUpperCase(), unit_code: unit?.[1] ?? null, unit_name: tidyName(unit?.[2]),
      title: tidyName(pr?.[2])?.slice(0, 300) ?? null, opening_date: null } };
  }

  if (!from.includes("notificacionesbac") && !from.includes("buenosairescompras")) return null;

  // "Acto administrativo de ampliación - documento contractual original 455-7296-OC26", "Acto administrativo prórroga - convenio marco 623-38-CM26"
  if (/^acto administrativo/i.test(subject)) {
    const act: BacAct = /ampliaci[oó]n/i.test(subject) ? "ampliacion" : /pr[oó]rroga/i.test(subject) ? "prorroga" : /rescisi[oó]n/i.test(subject) ? "rescision"
      : /penalidad|multa|sanci[oó]n/i.test(subject) ? "penalidad" : /disminuci[oó]n|reducci[oó]n/i.test(subject) ? "disminucion" : "otro";
    const oc = OC.exec(subject) ?? OC.exec(body);
    const cm = /\b(\d{2,5}-\d{1,5}-CM\d{2})\b/i.exec(subject) ?? /\b(\d{2,5}-\d{1,5}-CM\d{2})\b/i.exec(body);
    const num = /acto administrativo N[º°o]?\s*([A-Z]{2,4}-\d{4}-\d{5,10}-[\s-]*-?[A-Z]{2,12})/i.exec(body);
    const proc = /(?:proceso de compra|convenio marco)\s+(\d{2,5}-\d{1,7}-[A-Z]{2,5}\d{2})\s+(.+?)(?:,\s*a fin de|\s+a fin de|$)/i.exec(body);
    return { ...base, event: { kind: "acto", act, bac_number: oc?.[1]?.toUpperCase() ?? null, contract_number: cm?.[1]?.toUpperCase() ?? null,
      act_number: num ? num[1].replace(/\s+/g, "").replace(/--+/g, "-") : null, process_number: proc?.[1]?.toUpperCase() ?? null, process_name: tidyName(proc?.[2])?.slice(0, 300) ?? null } };
  }

  if (/perfeccionamiento/i.test(subject) || /ha sido perfeccionado/i.test(body)) {
    const oc = /Documento n[uú]mero:\s*(\d{2,5}-\d{3,7}-OC\d{2})/i.exec(body) ?? OC.exec(text);
    if (!oc) return null;
    const proc = /Proceso de compra:\s*(\S+)\s+([^\n]+)/i.exec(body);
    return { ...base, event: { kind: "oc_perfeccionada", bac_number: oc[1].toUpperCase(), process_number: proc?.[1] ?? null, process_name: tidyName(proc?.[2]) } };
  }

  if (/generaci[oó]n de orden de compra|se le ha remitido la orden de compra|orden de compra .*emitid/i.test(text)) {
    const oc = /orden de compra N[º°o]?\s*(\d{2,5}-\d{3,7}-OC\d{2})/i.exec(body) ?? OC.exec(text);
    if (!oc) return null;
    const cm = /convenio marco N[º°o]?\s*(\d{2,5}-\d{1,5}-CM\d{2})\s+(.+?)(?:,\s*a fin de|\s+a fin de|$)/i.exec(body);
    return { ...base, event: { kind: "oc_generada", bac_number: oc[1].toUpperCase(), convenio_number: cm?.[1]?.toUpperCase() ?? null, convenio_name: tidyName(cm?.[2]) } };
  }

  if (/publicaci[oó]n/i.test(subject)) {
    const pr = PROC.exec(subject) ?? PROC.exec(body);
    if (!pr) return null;
    const unit = /Oficina de compras:\s*(\d{2,5})\s*-\s*(.+?)(?=\s*(?:Pliego|Compulsa|Proceso)\s*:|$)/i.exec(body);
    const title = new RegExp(`${pr[1].replace(/-/g, "\\-")}\\s+([^\\n]+)`, "i").exec(body);
    const open = /apertura[^.]*?(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(body);
    return { ...base, event: { kind: "publicacion", source: "bac", process_number: pr[1].toUpperCase(), unit_code: unit?.[1] ?? null, unit_name: tidyName(unit?.[2]), title: tidyName(title?.[1])?.slice(0, 300) ?? null, opening_date: arDate(open?.[1]) } };
  }
  return null;
}

export type MailCategory = "orden" | "perfeccionamiento" | "prd" | "pago" | "licitacion" | "organismo" | "otro";

const CAT_BY_KIND: Record<BacEvent["kind"], MailCategory> = {
  oc_generada: "orden", oc_perfeccionada: "perfeccionamiento", prd: "prd", pago: "pago", publicacion: "licitacion", acto: "orden",
};

/** Categoría y referencias (OC / proceso) de cualquier mail de trabajo. */
export function classifyMail(m: InboundMail, parsed: ParsedMail | null): { category: MailCategory; bac_number: string | null; process_number: string | null } {
  const text = `${m.subject}\n${m.body}`;
  const oc = parsed && "bac_number" in parsed.event ? parsed.event.bac_number : (OC.exec(text)?.[1]?.toUpperCase() ?? null);
  const proc = parsed?.event.kind === "publicacion" || parsed?.event.kind === "acto" ? parsed.event.process_number : (PROC.exec(text)?.[1]?.toUpperCase() ?? null);
  if (parsed) return { category: CAT_BY_KIND[parsed.event.kind], bac_number: oc, process_number: proc };
  const from = m.from.toLowerCase();
  const gov = /gob\.ar|gov\.ar|bue\.edu\.ar/.test(from) || /gob\.ar|gov\.ar|bue\.edu\.ar/.test(m.to ?? "");
  if (oc && /orden de compra|\bOC\b|adjunt/i.test(text)) return { category: "orden", bac_number: oc, process_number: proc };
  if (proc && /cotiz|pliego|apertura|proceso/i.test(text)) return { category: "licitacion", bac_number: oc, process_number: proc };
  return { category: gov ? "organismo" : "otro", bac_number: oc, process_number: proc };
}
