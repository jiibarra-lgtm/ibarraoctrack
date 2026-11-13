import { parseArNumber } from "@/lib/money";

/**
 * Tarjeta de crédito Mercado Pago, leída de sus avisos:
 * - "Debitaremos el total de tu tarjeta el 10 de noviembre" (cierre del resumen: total y vencimiento)
 * - "Mañana debitaremos el total de tu tarjeta"
 * - "Hicimos el débito automático para pagar tu tarjeta" (pagado)
 * - "Solo pudimos debitar una parte para pagar tu tarjeta" (faltó plata)
 * - "Estás al día con tu tarjeta, no tenés nada que pagar"
 */
export type CardAlert = {
  message_id: string; at: string; card: string; kind: "resumen" | "pagado" | "parcial" | "sin_deuda";
  due_date: string | null; amount: string | null; debited: string | null; missing: string | null;
};

const CARD = "Tarjeta de Crédito Mercado Pago";
const MONTHS: Record<string, number> = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const AMT = "\\$\\s*([\\d.]+(?:,\\d{1,2})?)";

export const isCardAlertMail = (from: string, subject: string) =>
  /mercadopago\.com/i.test(from) && /pudimos debitar|no lograste cubrir|debitaremos el total|d[eé]bito autom[aá]tico para pagar tu tarjeta|nada que pagar/i.test(subject);

/** "10 de noviembre" → fecha, con el año del mail (o el siguiente si ya pasó el mes) */
function dueFrom(text: string, mailIso: string): string | null {
  const m = /(\d{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/i.exec(text);
  if (!m) return null;
  const mail = new Date(mailIso);
  const month = MONTHS[m[2].toLowerCase()];
  const year = month < mail.getUTCMonth() + 1 - 6 ? mail.getUTCFullYear() + 1 : mail.getUTCFullYear();
  return `${year}-${String(month).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function parseCardAlert(m: { id: string; from: string; subject: string; body: string; date: string }): CardAlert | null {
  if (!isCardAlertMail(m.from, m.subject)) return null;
  const t = `${m.subject} ${m.body}`.replace(/[|*#\r\n\t]+/g, " ").replace(/\s+/g, " ");
  const at = new Date(m.date).toISOString();
  const base = { message_id: m.id, at, card: CARD, due_date: null, amount: null, debited: null, missing: null };
  const num = (re: RegExp) => { const x = re.exec(t)?.[1]; return x ? parseArNumber(x) : null; };

  if (/pudimos debitar una parte|no lograste cubrir/i.test(t)) {
    const missing = num(new RegExp(`faltan\\s*${AMT}`, "i"));
    if (!missing) return null;
    return { ...base, kind: "parcial", debited: num(new RegExp(`Debitamos\\s*${AMT}`, "i")), missing };
  }
  if (/d[eé]bito autom[aá]tico para pagar tu tarjeta fue exitoso|Hicimos el d[eé]bito autom[aá]tico para pagar/i.test(t)) {
    const amount = num(new RegExp(`Debitamos de tu dinero disponible\\s*${AMT}`, "i")) ?? num(new RegExp(`Debitamos\\s*${AMT}`, "i"));
    return amount ? { ...base, kind: "pagado", amount, debited: amount } : null;
  }
  if (/nada que pagar/i.test(t)) return { ...base, kind: "sin_deuda", amount: "0" };
  if (/debitaremos el total/i.test(t)) {
    const amount = num(new RegExp(`d[eé]bito autom[aá]tico\\s*${AMT}`, "i")) ?? num(new RegExp(AMT));
    const due = dueFrom(/(?:el|Mañana,?)\s+(\d{1,2} de [a-z]+)/i.exec(t)?.[1] ?? t, at);
    return amount ? { ...base, kind: "resumen", amount, due_date: due } : null;
  }
  return null;
}
