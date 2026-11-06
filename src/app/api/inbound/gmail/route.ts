import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { classifyMail, parseBacMail } from "@/lib/inbound/bac-mail";
import { isCiudadMovementsMail, parseCiudadMovements, type BankMovement } from "@/lib/inbound/bank-ciudad";

/**
 * Recibe los mails que manda el script de Google de la cuenta del usuario.
 * Autenticación: token por empresa (se valida en la base contra su hash). Sin sesión.
 */
export const maxDuration = 60;

const Msg = z.object({
  id: z.string().min(1).max(200),
  threadId: z.string().max(200).optional(),
  from: z.string().max(500).default(""),
  to: z.string().max(2000).optional(),
  subject: z.string().max(1000).default(""),
  date: z.string().max(60),
  body: z.string().max(40000).default(""),
  attachments: z.array(z.object({ name: z.string().max(300), size: z.number().optional(), type: z.string().max(120).optional() })).max(30).optional(),
});
const Body = z.object({ token: z.string().min(32).max(200), messages: z.array(Msg).max(300) });

const nameEmail = (s: string) => {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>/.exec(s);
  return m ? { name: m[1].trim() || null, email: m[2].trim().toLowerCase() } : { name: null, email: s.trim().toLowerCase() };
};

export async function POST(req: NextRequest) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const events: unknown[] = [];
  const mails: unknown[] = [];
  const movements: (BankMovement & { message_id: string })[] = [];
  for (const m of body.messages) {
    const date = new Date(m.date);
    if (Number.isNaN(date.getTime())) continue;
    // Aviso de movimientos del banco: sólo se extraen pagos del GCBA y SIRCREB; el mail no se guarda
    if (isCiudadMovementsMail(m.from, m.subject)) {
      parseCiudadMovements(m.body, date.toISOString()).forEach((x) => movements.push({ ...x, message_id: m.id }));
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

  const [ev, ml, bk] = await Promise.all([
    events.length ? sb.rpc("ingest_bac_events", { p_token: body.token, p_events: events }) : Promise.resolve({ data: { nuevos: 0, aplicados: 0 }, error: null }),
    mails.length ? sb.rpc("ingest_mail_messages", { p_token: body.token, p_messages: mails }) : Promise.resolve({ data: 0, error: null }),
    movements.length ? sb.rpc("ingest_bank_movements", { p_token: body.token, p_movs: movements }) : Promise.resolve({ data: null, error: null }),
  ]);
  const err = ev.error ?? ml.error ?? bk.error;
  if (err) {
    const auth = /token/i.test(err.message);
    return NextResponse.json({ error: auth ? "Token inválido" : "No se pudo guardar" }, { status: auth ? 401 : 500 });
  }
  return NextResponse.json({ ok: true, correos: ml.data, avisos: ev.data, banco: bk.data });
}
