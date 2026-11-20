import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileWarning, Upload } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { CopyButton } from "@/components/copy-button";
import { formatDate } from "@/lib/format";
import { DismissMissingOc } from "./missing-docs-button";

type Missing = { bac_number: string; sources: string[]; first_seen: string; last_seen: string; place: string | null; mail_thread: string | null; unit_name: string | null; in_bac: boolean };
const SRC: Record<string, string> = { bac: "Aviso del BAC", entrega: "En la lista de entregas", mail: "PDF por mail" };

/**
 * OC que sabemos que existen (aviso del BAC, lista de entregas o PDF adjunto en un mail) y que todavía no se subieron.
 * compact: solo el aviso con el número; full: la lista con de dónde salió cada una.
 */
export async function MissingOcDocs({ sb, org, mode = "full", limit = 12 }: { sb: SupabaseClient; org: string; mode?: "full" | "compact"; limit?: number }) {
  const { data } = await sb.from("oc_missing_docs").select("bac_number, sources, first_seen, last_seen, place, mail_thread, unit_name, in_bac")
    .eq("org_id", org).order("in_bac", { ascending: false }).order("last_seen", { ascending: false }).limit(300);
  const all = (data ?? []) as Missing[];
  if (!all.length) return null;
  const recent = all.filter((x) => x.in_bac || x.sources.includes("mail"));

  if (mode === "compact") {
    return (
      <Link href="/ordenes?faltan=1" className="mb-4 flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm hover:bg-warn/15">
        <FileWarning className="size-5 shrink-0 text-warn" />
        <span className="min-w-0 flex-1"><b>Faltan cargar {all.length} OC</b>{recent.length ? ` · ${recent.length} te las avisó el BAC o llegaron por mail` : ""}</span>
        <span className="shrink-0 font-medium text-warn">Ver cuáles →</span>
      </Link>
    );
  }

  const shown = all.slice(0, limit);
  // Agrupadas por qué tan seguro es que haya que cargarlas
  const groups = [
    { key: "bac", title: "Te avisó el BAC", hint: "Están perfeccionadas: el plazo de entrega ya corre", rows: shown.filter((m) => m.in_bac) },
    { key: "mail", title: "Llegó el PDF por mail", hint: "Está el archivo en tu correo, falta subirlo", rows: shown.filter((m) => !m.in_bac && m.sources.includes("mail")) },
    { key: "entrega", title: "Aparecen en la lista de entregas", hint: "Las estás entregando, pero la OC no está en el sistema", rows: shown.filter((m) => !m.in_bac && !m.sources.includes("mail")) },
  ].filter((g) => g.rows.length);
  return (
    <Card className="mb-5 overflow-hidden border-warn/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warn/10 px-5 py-3">
        <div>
          <p className="flex items-center gap-2 font-semibold"><FileWarning className="size-5 text-warn" /> Faltan cargar {all.length} OC</p>
          <p className="mt-0.5 text-xs text-fg-muted">Solo las que tuvieron movimiento desde que usás el sistema. Si alguna no corresponde, ocultala.</p>
        </div>
        <Link href="/ordenes/importar" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg"><Upload className="size-4" /> Subir OC</Link>
      </div>
      <div className="max-h-[480px] overflow-y-auto">
        {groups.map((g) => (
          <section key={g.key}>
            <div className="flex items-baseline justify-between gap-2 bg-field/60 px-5 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">{g.title} · {g.rows.length}</p>
              <p className="hidden text-[11px] text-fg-subtle sm:block">{g.hint}</p>
            </div>
            <ul className="divide-y divide-border">
              {g.rows.map((m) => (
                <li key={m.bac_number} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 font-mono font-semibold">{m.bac_number}<CopyButton text={m.bac_number} /></p>
                    <p className="truncate text-xs text-fg-subtle">{m.unit_name ?? m.place ?? "Organismo sin identificar"} · {g.key === "bac" ? "aviso del" : g.key === "mail" ? "mail del" : "en la lista desde el"} {formatDate(m.first_seen)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {m.sources.filter((x) => x !== g.key).map((x) => <Badge key={x} tone="neutral">{SRC[x] ?? x}</Badge>)}
                    {m.mail_thread && <a href={`https://mail.google.com/mail/u/0/#all/${m.mail_thread}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Abrir mail</a>}
                    {m.in_bac && <Link href={`/bac?f=todas&q=${encodeURIComponent(m.bac_number)}`} className="text-xs font-medium text-brand hover:underline">Ver en BAC</Link>}
                    <DismissMissingOc bacNumber={m.bac_number} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      {all.length > shown.length && <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle"><Link href="/ordenes?faltan=1" className="text-brand hover:underline">Ver las {all.length}</Link></p>}
    </Card>
  );
}
