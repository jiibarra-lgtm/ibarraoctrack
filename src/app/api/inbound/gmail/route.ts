import { NextResponse, after, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { classifyMail, parseBacMail } from "@/lib/inbound/bac-mail";
import { isTaxNoticeMail, parseTaxNotice, type TaxNotice } from "@/lib/inbound/tax-notices";
import { isCardAlertMail, parseCardAlert, type CardAlert } from "@/lib/inbound/card-alerts";
import { isCiudadMovementsMail, parseCiudad, type BankBalance, type BankMovement } from "@/lib/inbound/bank-ciudad";
import { isMercadoLibreMail, parseMercadoLibreMail, type MlEvent } from "@/lib/inbound/mercadolibre";
import { runMlTasks } from "@/lib/ml-tasks";
import { isBillMail, parseBillMail, type BillEvent } from "@/lib/inbound/bills";
import { isPaymentMail, parsePaymentMail, type PaymentEvent } from "@/lib/inbound/payments";
import { tokenRpc, tokenStockRpc } from "@/lib/ml-rpc";

/**
 * Recibe los mails que manda el script de Google de la cuenta del usuario.
 * Autenticación: token por empresa (se valida en la base contra su hash). Sin sesión.
 */
export const maxDuration = 60;

// Tolerante: recorta en vez de rechazar (mails con cientos de destinatarios, adjuntos con nombres largos, etc.)
const cut = (n: number) => z.preprocess((v) => (v == null ? "" : String(v).slice(0, n)), z.string());
const Msg = z.object({
  id: z.string().min(1).max(200),
  threadId: cut(200).optional(),
  from: cut(500),
  to: cut(2000).optional(),
  subject: cut(1000),
  date: cut(60),
  body: cut(40000),
  refs: z.preprocess((v) => (Array.isArray(v) ? v.slice(0, 40).map((x) => String(x).slice(0, 300)) : []), z.array(z.string())).optional(),
  attachments: z.preprocess(
    (v) => (Array.isArray(v) ? v.slice(0, 30).map((a) => ({ name: String(a?.name ?? "").slice(0, 300), size: Number(a?.size) || undefined, type: a?.type ? String(a.type).slice(0, 120) : undefined })) : []),
    z.array(z.object({ name: z.string(), size: z.number().optional(), type: z.string().optional() })),
  ).optional(),
});
const Body = z.object({ token: z.string().min(32).max(200), messages: z.array(z.unknown()).max(500) });

const nameEmail = (s: string) => {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(s);
  return m ? { name: m[1].trim() || null, email: m[2].trim().toLowerCase() } : { name: null, email: s.trim().toLowerCase() };
};

export async function POST(req: NextRequest) {
  let raw: z.infer<typeof Body>;
  try {
    raw = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }
  // Un mail raro no frena el lote: se saltea y se sigue
  const messages = raw.messages.map((m) => Msg.safeParse(m)).filter((r) => r.success).map((r) => r.data!);
  const body = { token: raw.token, messages };
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const events: unknown[] = [];
  const mails: unknown[] = [];
  const movements: (BankMovement & { message_id: string; seen_at: string })[] = [];
  const cardAlerts: CardAlert[] = [];
  const taxNotices: TaxNotice[] = [];
  const acts: unknown[] = [];
  const balances: (BankBalance & { message_id: string })[] = [];
  const mlEvents: MlEvent[] = [];
  const bills: BillEvent[] = [];
  const payments: PaymentEvent[] = [];
  for (const m of body.messages) {
    const date = new Date(m.date);
    if (Number.isNaN(date.getTime())) continue;
    // Aviso de movimientos del banco: todos los movimientos y el saldo (entrada/salida se deduce con el saldo); el mail no se guarda
    if (isCiudadMovementsMail(m.from, m.subject)) {
      const r = parseCiudad(m.body, date.toISOString());
      r.movements.forEach((x) => movements.push({ ...x, message_id: m.id, seen_at: date.toISOString() }));
      if (r.balance) balances.push({ ...r.balance, message_id: m.id });
      continue;
    }
    // Avisos fiscales (e-Ventanilla de ARCA, AGIP): alerta en Impuestos; el mail sigue a Correos
    if (isTaxNoticeMail(m.from)) {
      const n = parseTaxNotice({ id: m.id, from: m.from, subject: m.subject, body: m.body, date: date.toISOString() });
      if (n) taxNotices.push(n);
    }
    // Tarjeta Mercado Pago: cierre, vencimiento, pagado o no se pudo debitar entera
    if (isCardAlertMail(m.from, m.subject)) {
      const a = parseCardAlert({ id: m.id, from: m.from, subject: m.subject, body: m.body, date: date.toISOString() });
      if (a) cardAlerts.push(a);
      continue;
    }
    // Pagos que salen (transferencias, tarjeta, débitos automáticos, resumen de tarjeta): van a Gastos
    if (isPaymentMail(m.from, m.subject)) {
      const pay = parsePaymentMail({ id: m.id, from: m.from, subject: m.subject, body: m.body, date: date.toISOString() });
      if (pay) payments.push(pay);
      continue;
    }
    // Facturas de servicios y débitos automáticos: van a Gastos fijos; el mail no se guarda
    if (isBillMail(m.from)) {
      const b = parseBillMail({ id: m.id, from: m.from, subject: m.subject, body: m.body, date: date.toISOString() });
      if (b) bills.push(b);
      continue;
    }
    // Mercado Libre: compras, envíos, entregas, facturas y ventas van a su sección; el mail no se guarda
    if (isMercadoLibreMail(m.from)) {
      const e = parseMercadoLibreMail({ id: m.id, from: m.from, subject: m.subject, body: m.body, date: date.toISOString(), refs: m.refs });
      if (e) mlEvents.push(e);
      continue;
    }
    const inbound = { id: m.id, from: m.from, subject: m.subject, date: date.toISOString(), body: m.body, to: m.to ?? "" };
    const parsed = parseBacMail(inbound);
    if (parsed?.event.kind === "acto") acts.push({ message_id: parsed.message_id, received_at: parsed.received_at, ...parsed.event });
    else if (parsed) events.push({ message_id: parsed.message_id, kind: parsed.event.kind, received_at: parsed.received_at, subject: parsed.subject, data: parsed.event });
    const c = classifyMail(inbound, parsed);
    const from = nameEmail(m.from);
    const text = m.body.replace(/[\t\r]+/g, " ").replace(/[ ]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    mails.push({
      message_id: m.id, thread_id: m.threadId ?? null, from_email: from.email, from_name: from.name, to: m.to ?? null,
      subject: m.subject, received_at: inbound.date, snippet: text.replace(/\s+/g, " ").slice(0, 300), body: text,
      category: c.category, bac_number: c.bac_number, process_number: c.process_number, attachments: m.attachments ?? [],
    });
  }

  const [ev, ml, bk, me, bl, py] = await Promise.all([
    events.length ? sb.rpc("ingest_bac_events", { p_token: body.token, p_events: events }) : Promise.resolve({ data: { nuevos: 0, aplicados: 0 }, error: null }),
    mails.length ? sb.rpc("ingest_mail_messages", { p_token: body.token, p_messages: mails }) : Promise.resolve({ data: 0, error: null }),
    movements.length || balances.length ? sb.rpc("ingest_bank_movements", { p_token: body.token, p_movs: movements, p_balances: balances }) : Promise.resolve({ data: null, error: null }),
    mlEvents.length ? sb.rpc("ingest_ml_events", { p_token: body.token, p_events: mlEvents }) : Promise.resolve({ data: null, error: null }),
    bills.length ? sb.rpc("ingest_bills", { p_token: body.token, p_bills: bills }) : Promise.resolve({ data: null, error: null }),
    payments.length ? sb.rpc("ingest_payments", { p_token: body.token, p_payments: payments }) : Promise.resolve({ data: null, error: null }),
  ]);
  const none = { data: 0, error: null };
  const [ca, tn, ac] = await Promise.all([
    cardAlerts.length ? sb.rpc("ingest_card_alerts", { p_token: body.token, p_alerts: cardAlerts }) : Promise.resolve(none),
    taxNotices.length ? sb.rpc("ingest_tax_notices", { p_token: body.token, p_notices: taxNotices }) : Promise.resolve(none),
    acts.length ? sb.rpc("ingest_bac_acts", { p_token: body.token, p_acts: acts }) : Promise.resolve(none),
  ]);
  const err = ca.error ?? tn.error ?? ac.error ?? ev.error ?? ml.error ?? bk.error ?? me.error ?? bl.error ?? py.error;
  if (err) {
    const auth = /token/i.test(err.message);
    return NextResponse.json({ error: auth ? "Token inválido" : "No se pudo guardar" }, { status: auth ? 401 : 500 });
  }
  // Con mails nuevos de Mercado Libre, se traen los precios por la API (si la cuenta está conectada), después de responder
  if (mlEvents.length) after(() => runMlTasks(tokenRpc(body.token), tokenStockRpc(body.token)).catch(() => null));
  return NextResponse.json({ ok: true, correos: ml.data, avisos: ev.data, banco: bk.data, mercadolibre: me.data, gastos: bl.data, pagos: py.data });
}
