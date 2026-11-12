import { parseArNumber } from "@/lib/money";

/** Mercado Pago "Solo pudimos debitar una parte para pagar tu tarjeta": cuánto se debitó y cuánto falta. */
export type CardAlert = { message_id: string; at: string; card: string; debited: string | null; missing: string };

export const isCardAlertMail = (from: string, subject: string) =>
  /mercadopago\.com/i.test(from) && /pudimos debitar|no pudimos debitar|no lograste cubrir/i.test(subject);

export function parseCardAlert(m: { id: string; from: string; subject: string; body: string; date: string }): CardAlert | null {
  if (!isCardAlertMail(m.from, m.subject)) return null;
  const t = m.body.replace(/[|*#\r\n\t]+/g, " ").replace(/\s+/g, " ");
  const missing = /faltan\s*\$\s*([\d.]+(?:,\d{1,2})?)/i.exec(t)?.[1];
  if (!missing) return null;
  const debited = /Debitamos\s*\$\s*([\d.]+(?:,\d{1,2})?)/i.exec(t)?.[1];
  return { message_id: m.id, at: new Date(m.date).toISOString(), card: "Tarjeta de Crédito Mercado Pago",
    debited: debited ? parseArNumber(debited) : null, missing: parseArNumber(missing)! };
}
