import { parseArNumber } from "@/lib/money";

/**
 * Facturas de servicios que llegan por mail todos los meses (gas, luz, agua, teléfono, internet, prepaga)
 * y débitos automáticos avisados por el banco. Se arma un "gasto fijo" por proveedor + número de cliente.
 */
export type BillEvent = {
  message_id: string; provider_key: string; provider_name: string; category: string; account_ref: string;
  amount: string | null; due_date: string | null; paid: boolean; received_at: string; subject: string;
};

type Provider = { key: string; name: string; category: string; from: RegExp; skip?: RegExp };
export const BILL_PROVIDERS: Provider[] = [
  { key: "metrogas", name: "Metrogas", category: "servicios", from: /metrogas\.com\.ar/i },
  { key: "edesur", name: "Edesur", category: "servicios", from: /edesur\.com\.ar/i, skip: /experiencia|suspensi[oó]n/i },
  { key: "edenor", name: "Edenor", category: "servicios", from: /edenor\.com/i },
  { key: "aysa", name: "AySA", category: "servicios", from: /aysa\.com\.ar/i },
  { key: "movistar", name: "Movistar", category: "telefonia", from: /factura\.sinpapel@movistar\.com\.ar|movistar\.com\.ar/i, skip: /suscripci[oó]n|te espera|experiencia|promo/i },
  { key: "claro", name: "Claro", category: "telefonia", from: /factura@email\.claro\.com\.ar/i },
  { key: "personal", name: "Personal", category: "telefonia", from: /personal\.com\.ar|telecom\.com\.ar/i },
  { key: "telecentro", name: "Telecentro", category: "telefonia", from: /telecentro\.com\.ar/i },
  { key: "flow", name: "Flow / Fibertel", category: "telefonia", from: /flow\.com\.ar|fibertel\.com\.ar/i },
  { key: "iplan", name: "iPlan", category: "telefonia", from: /iplan\.com\.ar/i },
  { key: "galeno", name: "Galeno", category: "salud", from: /galeno\.com\.ar/i },
  { key: "osde", name: "OSDE", category: "salud", from: /osde\.com\.ar/i },
  { key: "swiss", name: "Swiss Medical", category: "salud", from: /swissmedical\.com\.ar/i },
];

export const BILL_QUERY = "from:(metrogas.com.ar edesur.com.ar edenor.com aysa.com.ar factura.sinpapel@movistar.com.ar factura@email.claro.com.ar personal.com.ar telecentro.com.ar flow.com.ar fibertel.com.ar iplan.com.ar galeno.com.ar osde.com.ar swissmedical.com.ar mails.santander.com.ar)";

export const isBillMail = (from: string) => BILL_PROVIDERS.some((p) => p.from.test(from)) || /mails\.santander\.com\.ar/i.test(from);

const flat = (body: string) => body.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[|#*]/g, " ").replace(/\s+/g, " ");
const toIso = (d: string) => { const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(d); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const money = (s?: string) => (s ? parseArNumber(s.replace(/\.$/, "")) : null);

export function parseBillMail(m: { id: string; from: string; subject: string; body: string; date: string }): BillEvent | null {
  const text = flat(`${m.subject} ${m.body}`);
  const received_at = new Date(m.date).toISOString();

  // Débito automático avisado por Santander (AySA, etc.)
  if (/mails\.santander\.com\.ar/i.test(m.from)) {
    if (!/d[eé]bito autom[aá]tico/i.test(m.subject)) return null;
    const svc = /Servicio\s+(.+?)\s+(?:Importe|Medio de pago)/i.exec(text)?.[1]?.trim();
    const amount = money(/Importe\s*\$\s*([\d.,]+)/i.exec(text)?.[1]);
    const due = toIso(/Fecha\s+(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1] ?? "");
    if (!svc || !amount) return null;
    const key = svc.toLowerCase().replace(/\s+s\.?a\.?$/i, "").replace(/[^a-z0-9]+/g, "-");
    const p = BILL_PROVIDERS.find((x) => key.includes(x.key));
    return { message_id: m.id, provider_key: p?.key ?? key, provider_name: p?.name ?? svc, category: p?.category ?? "servicios", account_ref: "débito automático",
      amount, due_date: due, paid: /Debitamos/i.test(text), received_at, subject: m.subject };
  }

  const p = BILL_PROVIDERS.find((x) => x.from.test(m.from));
  if (!p || (p.skip && p.skip.test(`${m.subject} ${m.from}`))) return null;
  if (!/factura|vencimiento|vence|aviso de deuda|resumen|total a pagar|importe/i.test(text)) return null;

  const account = /(?:N[uú]mero de cliente|Cliente\s*N[º°o]?|N[uú]mero de cuenta|Socio\s*Nro\.?|Cuenta)\s*:?\s*(\d{5,})/i.exec(text)?.[1]
    ?? /(\d{8,})\s+(\d{8,})\s+\d{2}\/\d{2}\/\d{4}/.exec(text)?.[2] ?? /(\d{8,})/.exec(m.subject)?.[1] ?? "general";
  const amount = money(/(?:Total a pagar|por un importe de|Importe(?: total)?|Saldo)\s*:?\s*\$\s*([\d.,]+)/i.exec(text)?.[1]
    ?? /\d{2}\/\d{2}\/\d{4}\s+\$\s*([\d.,]+)/.exec(text)?.[1]);
  const due = toIso(/(?:vencimiento|vence)[^0-9]{0,40}(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1] ?? /\d{8,}\s+(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1] ?? "");
  if (!amount && !/factura/i.test(m.subject)) return null;
  return { message_id: m.id, provider_key: p.key, provider_name: p.name, category: p.category, account_ref: account,
    amount, due_date: due, paid: false, received_at, subject: m.subject };
}
