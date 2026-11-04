import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Mail, Paperclip, Search } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/format";
import { isUuid, cn } from "@/lib/utils";
import { MarkRead } from "./mark-read";

export const metadata: Metadata = { title: "Correos" };

const CATS = [
  ["todos", "Todos"], ["orden", "Órdenes"], ["perfeccionamiento", "Perfeccionamientos"], ["prd", "PRD"],
  ["pago", "Pagos"], ["licitacion", "Licitaciones"], ["organismo", "Organismos"],
] as const;
const CAT_STYLE: Record<string, string> = {
  orden: "bg-info-soft text-brand", perfeccionamiento: "bg-info-soft text-brand", prd: "bg-accent-soft text-accent",
  pago: "bg-accent-soft text-accent", licitacion: "bg-warn-soft text-warn", organismo: "bg-surface-2 text-fg-muted", otro: "bg-surface-2 text-fg-muted",
};
const CAT_LABEL = Object.fromEntries(CATS) as Record<string, string>;

type MailRow = {
  id: string; thread_id: string | null; message_id: string; from_email: string | null; from_name: string | null; to_emails: string | null;
  subject: string | null; received_at: string; snippet: string | null; body?: string | null; category: string; bac_number: string | null;
  process_number: string | null; attachments: { name: string; size?: number }[]; is_read: boolean;
};

export default async function MailPage({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; id?: string }> }) {
  const { c = "todos", q = "", id } = await searchParams;
  const s = await requireOrg();
  const sb = s.supabase;
  let list = sb.from("mail_messages").select("id, thread_id, message_id, from_email, from_name, subject, received_at, snippet, category, bac_number, process_number, attachments, is_read")
    .eq("org_id", s.org.org_id).order("received_at", { ascending: false }).limit(300);
  if (c !== "todos") list = list.eq("category", c);
  const term = q.trim().replace(/[%,()]/g, " ");
  if (term) list = list.or(`subject.ilike.%${term}%,from_name.ilike.%${term}%,from_email.ilike.%${term}%,snippet.ilike.%${term}%,bac_number.ilike.%${term}%`);
  const [{ data: rows }, { data: sel }, { count: unread }] = await Promise.all([
    list,
    id && isUuid(id) ? sb.from("mail_messages").select("*").eq("id", id).eq("org_id", s.org.org_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from("mail_messages").select("id", { count: "exact", head: true }).eq("org_id", s.org.org_id).eq("is_read", false),
  ]);
  const mails = (rows ?? []) as MailRow[];
  const m = sel as MailRow | null;
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ ...(c !== "todos" ? { c } : {}), ...(q ? { q } : {}), ...extra });
    return `/correos${p.toString() ? `?${p}` : ""}`;
  };
  const gmail = (x: MailRow) => `https://mail.google.com/mail/u/0/#all/${x.thread_id ?? x.message_id}`;

  return (
    <>
      <PageHeader title="Correos" description={`Tus mails de trabajo con organismos, BAC y SIGAF${unread ? ` · ${unread} sin leer` : ""}.`} />
      <div className="grid gap-4 lg:h-[calc(100dvh-230px)] lg:min-h-[520px] lg:grid-cols-[380px_minmax(0,1fr)]">
        {/* Lista */}
        <Card className={cn("flex min-h-0 flex-col overflow-hidden", m && "hidden lg:flex")}>
          <div className="flex flex-col gap-2 border-b border-border p-3">
            <form className="relative">
              {c !== "todos" && <input type="hidden" name="c" value={c} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input name="q" defaultValue={q} placeholder="Buscar asunto, remitente, OC…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            </form>
            <div className="flex gap-1.5 overflow-x-auto pb-0.5">
              {CATS.map(([k, l]) => (
                <Link key={k} href={`/correos?${new URLSearchParams({ ...(k !== "todos" ? { c: k } : {}), ...(q ? { q } : {}) })}`}
                  className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", c === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
              ))}
            </div>
          </div>
          {!mails.length ? (
            <EmptyState icon={<Mail />} title="Sin correos" description="Conectá tu Gmail en Configuración y en minutos aparecen acá." />
          ) : (
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {mails.map((x) => (
                <li key={x.id}>
                  <Link href={qs({ id: x.id })} className={cn("block px-3.5 py-3 hover:bg-surface-2/60", m?.id === x.id && "bg-surface-2")}>
                    <div className="flex items-center gap-2">
                      {!x.is_read && <span className="size-2 shrink-0 rounded-full bg-brand" />}
                      <span className={cn("min-w-0 flex-1 truncate text-sm", !x.is_read ? "font-semibold" : "font-medium")}>{x.from_name ?? x.from_email}</span>
                      <span className="shrink-0 text-[11px] text-fg-subtle tabular">{formatDate(x.received_at)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-sm">{x.subject || "(sin asunto)"}</p>
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-medium", CAT_STYLE[x.category])}>{CAT_LABEL[x.category] ?? "Otro"}</span>
                      {x.bac_number && <span className="truncate font-mono text-[11px] text-fg-subtle">{x.bac_number}</span>}
                      {x.attachments?.length > 0 && <Paperclip className="ml-auto size-3.5 shrink-0 text-fg-subtle" />}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Lectura */}
        <Card className={cn("flex min-h-0 flex-col overflow-hidden", !m && "hidden lg:flex")}>
          {!m ? (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div><Mail className="mx-auto size-8 text-fg-subtle" /><p className="mt-2 text-sm text-fg-muted">Elegí un correo para leerlo.</p></div>
            </div>
          ) : (
            <>
              <MarkRead id={m.id} unread={!m.is_read} />
              <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:px-6">
                <Link href={qs({})} className="inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg lg:hidden"><ArrowLeft className="size-3.5" /> Volver</Link>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold leading-snug">{m.subject || "(sin asunto)"}</h2>
                  <Button asChild variant="secondary" size="sm" className="shrink-0"><a href={gmail(m)} target="_blank" rel="noreferrer"><ExternalLink /> Gmail</a></Button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="grid size-8 place-items-center rounded-full bg-brand text-xs font-semibold text-brand-fg">{(m.from_name ?? m.from_email ?? "?").slice(0, 1).toUpperCase()}</span>
                  <span className="font-medium">{m.from_name ?? m.from_email}</span>
                  {m.from_name && <span className="text-xs text-fg-subtle">{m.from_email}</span>}
                  <span className="ml-auto text-xs text-fg-subtle tabular">{formatDateTime(m.received_at)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", CAT_STYLE[m.category])}>{CAT_LABEL[m.category] ?? "Otro"}</span>
                  {m.bac_number && <Link href={`/bac/${m.bac_number}`} className="rounded-md border border-card-border bg-field px-2 py-0.5 font-mono text-xs hover:border-brand">{m.bac_number} →</Link>}
                  {m.process_number && <span className="rounded-md border border-card-border bg-field px-2 py-0.5 font-mono text-xs">{m.process_number}</span>}
                </div>
                {m.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.attachments.map((a) => (
                      <a key={a.name} href={gmail(m)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-field px-2.5 py-1.5 text-xs hover:border-brand">
                        <Paperclip className="size-3.5 text-fg-subtle" />{a.name}{a.size ? <span className="text-fg-subtle">· {Math.ceil(a.size / 1024)} KB</span> : null}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg">{m.body || m.snippet}</p>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
