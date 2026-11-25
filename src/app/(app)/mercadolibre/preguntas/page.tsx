import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { mlPage, nowMs } from "@/lib/ml/page";
import { matchAnswer, wordFreq, type AutoAnswer } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { AnswerBox, AutoAnswerEditor, BlockBuyerButton, MlSyncNowButton } from "../pro-ui";
import { NotConnected, ago } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Preguntas" };
export const dynamic = "force-dynamic";

const VIEWS = [["pendientes", "Sin responder"], ["respondidas", "Respondidas"], ["auto", "Respuestas automáticas"], ["reclamos", "Reclamos"], ["mensajes", "Mensajes"]] as const;
const CLAIM_ACTION: Record<string, string> = {
  send_message_to_complainant: "Responder al comprador", refund: "Devolver el dinero", open_dispute: "Pedir mediación", allow_return: "Aceptar devolución",
  send_potential_shipping: "Indicar envío", add_shipping_evidence: "Subir comprobante de envío",
};

export default async function MlQuestions({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const v = (await searchParams).v ?? "pendientes";
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Preguntas" /><NotConnected /></>);
  const [qQ, rulesQ, claimsQ, blockedQ, settingsQ] = await Promise.all([
    sb.from("ml_questions").select("*").eq("org_id", org).order("date_created", { ascending: false }).limit(300),
    sb.from("ml_auto_answers").select("*").eq("org_id", org).order("created_at"),
    sb.from("ml_claims").select("*").eq("org_id", org).order("date_created", { ascending: false }).limit(50),
    sb.from("ml_blocked_buyers").select("user_id").eq("org_id", org),
    sb.from("ml_settings").select("auto_answers").eq("org_id", org).maybeSingle(),
  ]);
  const qs = qQ.data ?? [];
  const rules = (rulesQ.data ?? []) as (AutoAnswer & { uses: number })[];
  const blocked = new Set((blockedQ.data ?? []).map((b) => b.user_id));
  const pending = qs.filter((q) => q.status === "UNANSWERED");
  const answered = qs.filter((q) => q.status === "ANSWERED");
  const claims = claimsQ.data ?? [];
  const openClaims = claims.filter((c) => c.status === "opened");
  const messages = v === "mensajes" ? await ml.get<{ results: { resource: string; count: number }[] }>(`/messages/unread?role=seller&tag=post_sale`) : null;
  const byBuyer = new Map<string, number>();
  for (const q of qs) if (q.from_id) byBuyer.set(q.from_id, (byBuyer.get(q.from_id) ?? 0) + 1);
  const freq = wordFreq(qs.map((q) => q.text), 18);
  const count: Record<string, number> = { pendientes: pending.length, respondidas: answered.length, auto: rules.length, reclamos: openClaims.length, mensajes: 0 };
  const autoCount = answered.filter((q) => q.answered_by?.startsWith("auto")).length;

  return (
    <>
      <PageHeader title="Preguntas, reclamos y mensajes" description="Respondé rápido (pesa en la reputación y en las ventas). Las respuestas automáticas contestan solas lo repetido." actions={<MlSyncNowButton />} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/mercadolibre/preguntas?v=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}{count[k] ? ` · ${count[k]}` : ""}</Link>)}
      </div>

      {v === "pendientes" && (
        <Card>
          {pending.length === 0 ? <CardBody className="py-10 text-center text-sm text-fg-muted">No hay preguntas sin responder.</CardBody> : (
            <ul className="divide-y divide-border">
              {pending.map((q) => {
                const m = matchAnswer(q.text, rules);
                const sugg = [...(m ? [m] : []), ...rules.filter((r) => r.active && r.id !== m?.id)].slice(0, 5);
                return (
                  <li key={q.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <Link href={`/mercadolibre/publicaciones/${q.item_id}`} className="text-xs text-fg-subtle hover:underline">{q.item_title ?? q.item_id}</Link>
                      <span className="text-xs text-fg-subtle">{ago(q.date_created)}{q.from_id && (byBuyer.get(q.from_id) ?? 0) > 1 ? ` · ya preguntó ${byBuyer.get(q.from_id)! - 1} veces` : ""}</span>
                    </div>
                    <p className="mt-1 font-medium">{q.text}</p>
                    <AnswerBox id={q.id} suggestions={sugg} canEdit={edit} />
                    {edit && q.from_id && <div className="mt-1"><BlockBuyerButton userId={q.from_id} blocked={blocked.has(q.from_id)} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {v === "respondidas" && (
        <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader title={`${answered.length} respondidas`} description={`${autoCount} contestadas automáticamente.`} />
            <ul className="divide-y divide-border">
              {answered.slice(0, 100).map((q) => (
                <li key={q.id} className="px-5 py-2.5 text-sm">
                  <p className="text-xs text-fg-subtle">{q.item_title ?? q.item_id} · {formatDateTime(q.date_created)}</p>
                  <p className="font-medium">{q.text}</p>
                  <p className="text-fg-muted">↳ {q.answer} {q.answered_by?.startsWith("auto") && <Badge tone="info">{q.answered_by.replace("auto:", "auto · ")}</Badge>}
                    {q.answered_at && <span className="text-xs text-fg-subtle"> · en {Math.max(1, Math.round((Date.parse(q.answered_at) - Date.parse(q.date_created)) / 60000))} min</span>}</p>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Lo que más te preguntan" description="Sumalo a la descripción o armá una respuesta automática." />
            <CardBody className="flex flex-wrap gap-1.5">{freq.map((w) => <Badge key={w.word} tone="neutral">{w.word} · {w.n}</Badge>)}</CardBody>
          </Card>
        </div>
      )}

      {v === "auto" && (
        <Card>
          <CardHeader title="Respuestas automáticas" description={settingsQ.data?.auto_answers ? "Activadas: se responden solas las preguntas que coinciden y, fuera de horario, el mensaje de ausencia." : "Están apagadas: activalas en Automatizaciones."}
            action={<Link href="/mercadolibre/automatizaciones" className="text-xs underline">Horario y activación</Link>} />
          <CardBody className="space-y-3">
            {rules.map((r) => <div key={r.id}><p className="mb-1 text-xs text-fg-subtle">Usada {r.uses} veces</p><AutoAnswerEditor row={r} /></div>)}
            {edit && <><p className="pt-2 text-sm font-medium">Nueva</p><AutoAnswerEditor /></>}
          </CardBody>
        </Card>
      )}

      {v === "reclamos" && (
        <Card>
          {claims.length === 0 ? <CardBody className="py-10 text-center text-sm text-fg-muted">No hay reclamos.</CardBody> : (
            <ul className="divide-y divide-border">
              {claims.map((c) => {
                const due = c.due_date ? (Date.parse(c.due_date) - nowMs()) / 3600e3 : null;
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                    <div>
                      <p className="font-medium">Reclamo {c.id} · {c.type} {c.stage === "dispute" && <Badge tone="danger">Mediación</Badge>}</p>
                      <p className="text-xs text-fg-subtle">Venta {c.resource_id} · motivo {c.reason} · abierto {ago(c.date_created)}</p>
                      {c.action_needed && <p className="text-xs">Tenés que: <b>{CLAIM_ACTION[c.action_needed] ?? c.action_needed}</b>{due !== null && <span className={due < 24 ? "text-danger" : ""}> · vence {due < 0 ? "¡ya venció!" : `en ${Math.round(due)} h`}</span>}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={c.status === "opened" ? "warn" : "neutral"}>{c.status === "opened" ? "Abierto" : "Cerrado"}</Badge>
                      <a href={`https://www.mercadolibre.com.ar/ventas/${c.resource_id}/detalle`} target="_blank" rel="noreferrer" className="text-xs underline">Abrir en ML</a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      {v === "mensajes" && (
        <Card>
          {!messages?.ok ? <CardBody className="text-sm text-fg-muted">No se pudieron leer los mensajes ({messages?.error}).</CardBody>
            : (messages.data.results ?? []).length === 0 ? <CardBody className="py-10 text-center text-sm text-fg-muted">No hay mensajes sin leer.</CardBody> : (
              <ul className="divide-y divide-border">
                {messages.data.results.map((m) => {
                  const pack = m.resource.split("/").pop();
                  return (
                    <li key={m.resource} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <span>Venta {pack} · <b>{m.count}</b> sin leer</span>
                      <a href={`https://www.mercadolibre.com.ar/ventas/${pack}/detalle`} target="_blank" rel="noreferrer" className="text-xs underline">Responder en ML</a>
                    </li>
                  );
                })}
              </ul>
            )}
          <CardBody className="border-t border-border text-xs text-fg-subtle">Para escribirle al comprador desde la app usá el botón “Mensaje” en Ventas.</CardBody>
        </Card>
      )}
    </>
  );
}
