import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { classifyMail, parseBacMail } from "@/lib/inbound/bac-mail";
import { isCiudadMovementsMail, parseCiudadMovements, type BankMovement } from "@/lib/inbound/bank-ciudad";
import { isMercadoLibreMail, parseMercadoLibreMail, type MlEvent } from "@/lib/inbound/mercadolibre";

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
  const movements: (BankMovement & { message_id: string })[] = [];
  const mlEvents: MlEvent[] = [];
  for (const m of body.messages) {
    const date = new Date(m.date);
    if (Number.isNaN(date.getTime())) continue;
    // Aviso de movimientos del banco: sólo se extraen pagos del GCBA y SIRCREB; el mail no se guarda
    if (isCiudadMovementsMail(m.from, m.subject)) {
      parseCiudadMovements(m.body, date.toISOString()).forEach((x) => movements.push({ ...x, message_id: m.id }));
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
    if (parsed) events.push({ message_id: parsed.message_id, kind: parsed.event.kind, received_at: parsed.received_at, subject: parsed.subject, data: parsed.event });
    const c = classifyMail(inbound, parsed);
    const from = nameEmail(m.from);
    const text = m.body.replace(/[\t\r]+/g, " ").replace(/[ ]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    mails.push({
      message_id: m.id, thread_id: m.threadId ?? null, from_email: from.email, from_name: from.name, to: m.to ?? null,
      subject: m.subject, received_at: inbound.date, snippet: text.replace(/\s+/g, " ").slice(0, 300), body: text,
      category: c.category, bac_number: c.bac_number, process_number: c.process_number, attachments: m.attachments ?? [],
    });
  }

  const [ev, ml, bk, me] = await Promise.all([
    events.length ? sb.rpc("ingest_bac_events", { p_token: body.token, p_events: events }) : Promise.resolve({ data: { nuevos: 0, aplicados: 0 }, error: null }),
    mails.length ? sb.rpc("ingest_mail_messages", { p_token: body.token, p_messages: mails }) : Promise.resolve({ data: 0, error: null }),
    movements.length ? sb.rpc("ingest_bank_movements", { p_token: body.token, p_movs: movements }) : Promise.resolve({ data: null, error: null }),
    mlEvents.length ? sb.rpc("ingest_ml_events", { p_token: body.token, p_events: mlEvents }) : Promise.resolve({ data: null, error: null }),
  ]);
  const err = ev.error ?? ml.error ?? bk.error ?? me.error;
  if (err) {
    const auth = /token/i.test(err.message);
    return NextResponse.json({ error: auth ? "Token inválido" : "No se pudo guardar" }, { status: auth ? 401 : 500 });
  }
  return NextResponse.json({ ok: true, correos: ml.data, avisos: ev.data, banco: bk.data, mercadolibre: me.data });
}
