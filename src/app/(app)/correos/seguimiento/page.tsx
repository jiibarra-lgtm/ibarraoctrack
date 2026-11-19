import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, FileWarning, MailQuestion, MapPin, Phone, Timer, TrendingUp } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import { RemindMeButton } from "@/components/reminders";

export const metadata: Metadata = { title: "Seguimiento de correos" };

type Contact = { email: string; name: string | null; mails: number; last_7d: number; last_at: string; unanswered: number; unanswered_quotes: number; complaints: number; reply_hours: number | null; phone: string | null; hours: string | null; oc_refs: string[] };
type Insight = { id: string; thread_id: string | null; message_id: string; from_email: string; from_name: string | null; subject: string | null; received_at: string; snippet: string | null; kind: string | null; oc_ref: string | null; purchase_order_id: string | null; unanswered: boolean };
type Att = { id: string; thread_id: string | null; message_id: string; from_email: string; from_name: string | null; subject: string | null; received_at: string; file: string; oc_ref: string | null; num: string | null };
type Addr = { id: string; thread_id: string | null; message_id: string; from_email: string; from_name: string | null; subject: string | null; received_at: string; excerpt: string | null; oc_ref: string | null; purchase_order_id: string | null; delivery_place: string | null };

const gmail = (x: { thread_id: string | null; message_id: string }) => `https://mail.google.com/mail/u/0/#all/${x.thread_id ?? x.message_id}`;
const nowMs = () => Date.now();
const ago = (iso: string, now: number) => { const h = Math.round((now - Date.parse(iso)) / 3600e3); return h < 48 ? `hace ${h} h` : `hace ${Math.round(h / 24)} días`; };
const hrs = (h: number | null) => (h == null ? "—" : h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toLocaleString("es-AR")} h` : `${Math.round(h / 24)} días`);

export default async function MailFollowUpPage() {
  const s = await requireOrg();
  const org = s.org.org_id;
  const now = nowMs();
  const [{ data: cData }, { data: iData }, { data: aData }, { data: adData }, { data: units }, { data: pos }, { data: board }, { data: sums }] = await Promise.all([
    s.supabase.from("mail_contacts").select("*").eq("org_id", org).order("last_at", { ascending: false }).limit(300),
    s.supabase.from("mail_public_insights").select("id, thread_id, message_id, from_email, from_name, subject, received_at, snippet, kind, oc_ref, purchase_order_id, unanswered").eq("org_id", org).order("received_at", { ascending: false }).limit(1500),
    s.supabase.from("mail_oc_attachments").select("*").eq("org_id", org).order("received_at", { ascending: false }).limit(100),
    s.supabase.from("mail_address_mentions").select("*").eq("org_id", org).order("received_at", { ascending: false }).limit(50),
    s.supabase.from("bac_units").select("code, name").eq("org_id", org).limit(2000),
    s.supabase.from("purchase_orders").select("id, bac_number, dependencia, delivery_place").eq("org_id", org).not("bac_number", "is", null).limit(3000),
    s.supabase.from("delivery_board").select("oc_refs, status, delivered_on, place").eq("org_id", org).limit(3000),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, delivered_pct").eq("org_id", org).limit(3000),
  ]);
  const contacts = (cData ?? []) as Contact[];
  const ins = (iData ?? []) as Insight[];
  const atts = (aData ?? []) as Att[];
  const addrs = ((adData ?? []) as Addr[]).filter((a) => a.excerpt && a.excerpt.length > 25);

  // Organismo de cada OC (unidad del BAC)
  const unitName = new Map(((units ?? []) as { code: string; name: string | null }[]).filter((u) => u.name).map((u) => [u.code, u.name!]));
  const poBy = new Map(((pos ?? []) as { id: string; bac_number: string; dependencia: string | null; delivery_place: string | null }[]).map((p) => [p.bac_number.toUpperCase(), p]));
  for (const p of poBy.values()) { const code = p.bac_number.split("-")[0]; if (!unitName.has(code) && p.dependencia) unitName.set(code, p.dependencia); }
  const orgOf = (refs: string[]) => [...new Set(refs.map((r) => unitName.get(r.split("-")[0]) ?? `Unidad ${r.split("-")[0]}`))];

  // Entregado por OC: % del sistema o tarjeta de la hoja de ruta marcada entregada
  const pctBy = new Map(((sums ?? []) as { purchase_order_id: string; delivered_pct: number | null }[]).map((x) => [x.purchase_order_id, Number(x.delivered_pct ?? 0)]));
  const boardDone = new Map<string, string>();
  for (const b of (board ?? []) as { oc_refs: string[]; status: string; delivered_on: string | null }[]) if (b.status === "entregado") b.oc_refs.forEach((r) => boardDone.set(r, b.delivered_on ?? ""));

  // 81) cotizaciones sin responder
  const quotes = ins.filter((x) => x.kind === "cotizacion" && x.unanswered).slice(0, 60);
  // 82) reclamos / pedidos de entrega de OC que ya entregaste
  const claims = ins.filter((x) => (x.kind === "reclamo" || x.kind === "entrega") && x.oc_ref).map((x) => {
    const po = poBy.get(x.oc_ref!);
    const pct = po ? pctBy.get(po.id) ?? 0 : 0;
    const boardOn = boardDone.get(x.oc_ref!);
    return { x, pct, boardOn, delivered: pct >= 100 || boardOn !== undefined };
  });
  const claimsDone = claims.filter((c) => c.delivered);
  // 83) los que escriben más de lo normal esta semana
  const spikes = contacts.filter((c) => c.last_7d >= 3 && c.last_7d >= (c.mails / (120 / 7)) * 2.5);
  // 80) tiempo de respuesta
  const answered = contacts.filter((c) => c.reply_hours != null);
  const medianReply = answered.length ? [...answered].sort((a, b) => a.reply_hours! - b.reply_hours!)[Math.floor(answered.length / 2)].reply_hours : null;
  const slow = answered.filter((c) => c.reply_hours! > 24).length;

  return (
    <>
      <PageHeader title="Seguimiento de correos" description="Los mails de los organismos cruzados con tus OC, las entregas y el BAC: a quién no le respondiste, quién te reclama algo ya entregado, qué OC te mandaron y no cargaste." />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={MailQuestion} label="Cotizaciones sin responder" value={String(quotes.length)} tone={quotes.length ? "warn" : undefined} sub="pedidos de precio de organismos" />
        <Stat icon={FileWarning} label="OC por mail sin cargar" value={String(atts.length)} tone={atts.length ? "danger" : undefined} sub="vinieron adjuntas" />
        <Stat icon={Timer} label="Tardás en responder" value={hrs(medianReply)} sub={slow ? `${slow} contactos esperan más de 1 día` : "mediana por contacto"} />
        <Stat icon={AlertTriangle} label="Reclaman algo ya entregado" value={String(claimsDone.length)} tone={claimsDone.length ? "warn" : undefined} sub="mandales el remito" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="OC que te mandaron por mail y no están cargadas" description="El PDF llegó adjunto pero la OC no está en el sistema. Bajalo del mail y subilo en Importar OC." action={<Link href="/ordenes/importar" className="text-sm font-medium text-brand hover:underline">Importar OC</Link>} />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {atts.map((a) => (
              <li key={`${a.id}-${a.file}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{a.oc_ref ? `OC ${a.oc_ref}` : `OC n° ${a.num ?? "?"}`} <span className="font-normal text-fg-subtle">· {a.file}</span></p>
                  <p className="truncate text-xs text-fg-subtle">{a.from_name || a.from_email} · {formatDate(a.received_at)}{a.oc_ref ? ` · ${orgOf([a.oc_ref])[0]}` : ""}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1">{a.oc_ref && <CopyButton text={a.oc_ref} />}<a href={gmail(a)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Abrir mail</a></span>
              </li>
            ))}
            {!atts.length && <li className="px-5 py-4 text-sm text-fg-muted">Todas las OC que llegaron por mail están cargadas.</li>}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Cotizaciones que no respondiste" description="Pedidos de precio de organismos sin respuesta tuya en el hilo." />
          <ul className="max-h-96 divide-y divide-border overflow-y-auto">
            {quotes.map((q) => (
              <li key={q.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{q.subject || "(sin asunto)"}</p>
                  <p className="truncate text-xs text-fg-subtle">{q.from_name || q.from_email} · {ago(q.received_at, now)}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1">
                  <RemindMeButton variant="ghost" label="" title={`Responder cotización: ${(q.subject ?? "").slice(0, 120)}`} link={{ link_path: "/correos/seguimiento", link_label: q.from_name || q.from_email }} />
                  <a href={gmail(q)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Responder</a>
                </span>
              </li>
            ))}
            {!quotes.length && <li className="px-5 py-4 text-sm text-fg-muted">Respondiste todas.</li>}
          </ul>
        </Card>

        {claims.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader title="Reclamos y pedidos de entrega, contra lo que ya llevaste" description="Si ya la entregaste, respondé con el remito firmado." />
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {claims.map(({ x, pct, boardOn, delivered }) => (
                <li key={x.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{x.kind === "reclamo" ? "Reclamo" : "Pedido de entrega"} · OC {x.oc_ref}</p>
                    <p className="truncate text-xs text-fg-subtle">{x.from_name || x.from_email} · {ago(x.received_at, now)}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge tone={delivered ? "accent" : "danger"}>{delivered ? (boardOn ? `Entregada ${formatDate(boardOn)}` : `${Math.round(pct)}% entregado`) : `${Math.round(pct)}% entregado`}</Badge>
                    <a href={gmail(x)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Abrir</a>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {addrs.length > 0 && (
          <Card className="overflow-hidden">
            <CardHeader title="Mails que hablan del lugar de entrega" description="Comparalo con la dirección de la OC antes de salir." />
            <ul className="max-h-96 divide-y divide-border overflow-y-auto">
              {addrs.map((a) => {
                const po = a.oc_ref ? poBy.get(a.oc_ref) : undefined;
                const place = a.delivery_place ?? po?.delivery_place ?? null;
                return (
                  <li key={a.id} className="px-5 py-2.5 text-sm">
                    <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-brand" /><span className="min-w-0">“{a.excerpt}”</span></p>
                    <p className="mt-0.5 pl-6 text-xs text-fg-subtle">{a.from_name || a.from_email} · {formatDate(a.received_at)}{a.oc_ref ? ` · OC ${a.oc_ref}` : ""}{place ? ` · en la OC dice: ${place}` : ""} · <a href={gmail(a)} target="_blank" rel="noreferrer" className="text-brand hover:underline">abrir</a></p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>

      {spikes.length > 0 && (
        <Card className="mt-5 border-warn/40">
          <CardHeader title="Te están escribiendo más de lo normal" description="Más del doble de mails que su promedio semanal: puede haber un problema." />
          <ul className="divide-y divide-border">
            {spikes.map((c) => (
              <li key={c.email} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate"><TrendingUp className="mr-1.5 inline size-4 text-warn" />{c.name || c.email}{c.oc_refs.length ? <span className="text-fg-subtle"> · {orgOf(c.oc_refs).join(", ")}</span> : null}</span>
                <span className="shrink-0 text-xs tabular">{c.last_7d} esta semana · promedio {(c.mails / (120 / 7)).toFixed(1)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5 overflow-hidden">
        <CardHeader title="Contactos de los organismos" description="Armado solo con los mails: a qué organismo pertenece cada uno (por las OC que te mandó), el teléfono de la firma y cuánto tardás en responderle." />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-fg-subtle">
              <tr><th className="px-5 py-2 font-medium">Contacto</th><th className="px-3 py-2 font-medium">Organismo / OC</th><th className="px-3 py-2 font-medium">Teléfono y horario</th>
                <th className="px-3 py-2 text-right font-medium">Mails</th><th className="px-3 py-2 text-right font-medium">Sin responder</th><th className="px-5 py-2 text-right font-medium">Le respondés en</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c) => (
                <tr key={c.email} className="align-top">
                  <td className="px-5 py-2"><p className="font-medium">{c.name || c.email.split("@")[0]}</p><p className="flex items-center gap-1 text-xs text-fg-subtle">{c.email}<CopyButton text={c.email} /></p></td>
                  <td className="px-3 py-2 text-xs">{c.oc_refs.length ? <><p className="font-medium">{orgOf(c.oc_refs).slice(0, 2).join(", ")}</p><p className="text-fg-subtle">{c.oc_refs.slice(0, 3).join(", ")}{c.oc_refs.length > 3 ? ` +${c.oc_refs.length - 3}` : ""}</p></> : <span className="text-fg-subtle">—</span>}</td>
                  <td className="px-3 py-2 text-xs">{c.phone ? <span className="inline-flex items-center gap-1"><Phone className="size-3" />{c.phone}<CopyButton text={c.phone} /></span> : <span className="text-fg-subtle">—</span>}{c.hours && <p className="mt-0.5 text-[11px] text-fg-subtle first-letter:uppercase">{c.hours}</p>}</td>
                  <td className="px-3 py-2 text-right tabular">{c.mails}<p className="text-[11px] text-fg-subtle">último {formatDate(c.last_at)}</p></td>
                  <td className={cn("px-3 py-2 text-right tabular", c.unanswered_quotes > 0 && "font-medium text-warn")}>{c.unanswered}{c.unanswered_quotes > 0 && <p className="text-[11px]">{c.unanswered_quotes} cotiz.</p>}</td>
                  <td className={cn("px-5 py-2 text-right tabular", c.reply_hours != null && c.reply_hours > 24 && "text-warn")}>{hrs(c.reply_hours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
