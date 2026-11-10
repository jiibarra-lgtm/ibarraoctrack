import { parseArNumber } from "@/lib/money";

/**
 * Pagos que salen de tus cuentas, leídos de los avisos del banco:
 * - Red Link "Transferencia Debitada" (destinatario, CBU, concepto: HAB sueldos, ALQ alquiler, SEG seguros…)
 * - Santander "Pagaste $…" (consumo con tarjeta de débito) y "Aviso de débito automático" (tarjeta)
 * - Santander "Tu resumen vence pronto" (resumen de la tarjeta de crédito)
 * Con esto se detectan solos los gastos fijos (lo que se paga todos los meses) y los gastos variables por rubro.
 */
export type PaymentKind = "transferencia" | "tarjeta" | "debito_automatico" | "resumen_tarjeta";
export type PaymentEvent = {
  message_id: string; kind: PaymentKind; paid_at: string; amount: string; payee: string; payee_key: string;
  cbu: string | null; concept: string | null; card: string | null; due_date: string | null; category: string;
};

export const PAYMENT_QUERY = "from:(avisos.redlink.com.ar mails.santander.com.ar) {subject:\"Transferencia Debitada\" subject:Pagaste subject:\"débito automático\" subject:\"resumen vence\"}";
export const isPaymentMail = (from: string, subject: string) =>
  (/avisos\.redlink\.com\.ar/i.test(from) && /Transferencia Debitada/i.test(subject)) ||
  (/mails\.santander\.com\.ar/i.test(from) && /^Pagaste|Aviso de d[eé]bito autom[aá]tico|D[eé]bito autom[aá]tico de tu adicional|resumen vence/i.test(subject));

/** Concepto de transferencia (BCRA) → rubro */
const CONCEPTS: Record<string, string> = { HAB: "sueldos", ALQ: "alquiler", SEG: "seguros", HON: "honorarios", EXP: "alquiler", CUO: "bancos", PRE: "bancos", FAC: "proveedores", VAR: "otros" };

/** Rubro por palabras del comercio / destinatario */
const RULES: [RegExp, string][] = [
  [/seguro|mercantil andina|la segunda|sancor|federaci[oó]n patronal|zurich|allianz|mapfre|rus\b|rivadavia seg/i, "seguros"],
  [/autopista|ausa|peaje|telepeaje|ypf|shell|axion|puma|estaci[oó]n|dellepiane|combustible|nafta|gnc/i, "vehiculos"],
  [/cesop|metrogas|naturgy|camuzzi|edesur|edenor|aysa|absa|gas\b|luz\b|agua\b/i, "servicios"],
  [/movistar|telef[oó]nica|claro|amx|personal|telecom|telecentro|fibertel|flow|iplan|tvc|cablevisi[oó]n|directv/i, "telefonia"],
  [/galeno|osde|swiss|medicus|omint|sancor salud|farmacia|fcia|farmacity/i, "salud"],
  [/suscripci|365|microsoft|google|apple|netflix|spotify|adobe|chatgpt|openai|anthropic|claude|vercel|supabase|github|dropbox|canva|aws/i, "software"],
  [/super|supermercado|carrefour|coto|d[ií]a\b|jumbo|disco|chango|despensa|almac[eé]n|verduler|carnicer|grido|helader/i, "comida"],
  [/easy|sodimac|ferreter|pinturer|corral[oó]n|roal/i, "ferreteria"],
  [/afip|arca|agip|arba|municip|abl|patente|vep\b/i, "impuestos"],
  [/mercado ?libre|merpago\*?ml|mlibre/i, "compras"],
];
export const categorize = (payee: string, concept?: string | null) =>
  RULES.find(([re]) => re.test(payee))?.[1] ?? (concept && CONCEPTS[concept.toUpperCase()]) ?? "otros";

/** Clave estable del destinatario: sin "MERPAGO*", números de sucursal, mayúsculas, espacios dobles */
export const payeeKey = (p: string) =>
  p.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/^(MERPAGO|MP|PVS|PAYU|DLO|SQ)[*\s]+/, "")
    .replace(/\b(S\.?A\.?|S\.?R\.?L\.?|SA|SRL|SAS)\b\.?/g, "").replace(/\d{3,}/g, "").replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);

const flat = (body: string) => body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[|#*]/g, " ").replace(/\s+/g, " ");
const toIso = (d?: string) => { const m = d ? /(\d{2})\/(\d{2})\/(\d{4})/.exec(d) : null; return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const money = (s?: string) => (s ? parseArNumber(s.trim().replace(/\.$/, "")) : null);

export function parsePaymentMail(m: { id: string; from: string; subject: string; body: string; date: string }): PaymentEvent | null {
  if (!isPaymentMail(m.from, m.subject)) return null;
  const t = flat(m.body);
  const received = new Date(m.date).toISOString();

  if (/avisos\.redlink/i.test(m.from)) {
    const amount = money(/Importe\s*\$\s*([\d.,]+)/i.exec(t)?.[1]);
    const payee = /Nombre del Destinatario\s+(.+?)\s+CBU Cr[eé]dito/i.exec(t)?.[1]?.trim();
    if (!amount || !payee) return null;
    const concept = /Concepto\s+([A-Z]{3})\b/.exec(t)?.[1] ?? null;
    const when = /generado el d[ií]a (\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1];
    return { message_id: m.id, kind: "transferencia", paid_at: toIso(when) ?? received.slice(0, 10), amount, payee, payee_key: payeeKey(payee),
      cbu: /CBU Cr[eé]dito\s+(\d{22})/i.exec(t)?.[1] ?? null, concept, card: null, due_date: null, category: categorize(payee, concept) };
  }

  if (/resumen vence/i.test(m.subject)) {
    const card = /terminada en (\d{4})/i.exec(t)?.[1] ?? null;
    const amount = money(/Monto en pesos\s*:?\s*\$\s*([\d.,]+)/i.exec(t)?.[1] ?? /\$\s*([\d.,]+)/.exec(t)?.[1]);
    const due = toIso(/vence el (\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1]);
    if (!amount) return null;
    const payee = `Tarjeta Santander Visa ${card ?? ""}`.trim();
    return { message_id: m.id, kind: "resumen_tarjeta", paid_at: due ?? received.slice(0, 10), amount, payee, payee_key: payeeKey(payee),
      cbu: null, concept: null, card, due_date: due, category: "bancos" };
  }

  // "Pagaste $…" y débitos automáticos con tarjeta: "Monto $X Comercio NOMBRE Fecha dd/mm/aaaa"
  const amount = money(/Monto\s*\$\s*([\d.,]+)/i.exec(t)?.[1]);
  const payee = /Comercio\s+(.+?)\s+Fecha\s/i.exec(t)?.[1]?.trim();
  if (!amount || !payee) return null;
  return { message_id: m.id, kind: /d[eé]bito autom[aá]tico/i.test(m.subject) ? "debito_automatico" : "tarjeta",
    paid_at: toIso(/Fecha\s+(\d{2}\/\d{2}\/\d{4})/i.exec(t)?.[1]) ?? received.slice(0, 10), amount, payee, payee_key: payeeKey(payee),
    cbu: null, concept: null, card: /terminada en (\d{4})/i.exec(t)?.[1] ?? null, due_date: null, category: categorize(payee) };
}
