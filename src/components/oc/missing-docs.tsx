import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FileWarning, Upload } from "lucide-react";
import { Badge, Card } from "@/components/ui/primitives";
import { CopyButton } from "@/components/copy-button";
import { formatDate } from "@/lib/format";

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
        <span className="min-w-0 flex-1"><b>Falta subir el documento de {all.length} OC</b>{recent.length ? ` · ${recent.length} avisadas por el BAC o por mail` : ""}</span>
        <span className="shrink-0 font-medium text-warn">Ver cuáles →</span>
      </Link>
    );
  }

  const shown = all.slice(0, limit);
  return (
    <Card className="mb-5 overflow-hidden border-warn/40">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warn/10 px-5 py-3">
        <p className="flex items-center gap-2 font-semibold"><FileWarning className="size-5 text-warn" /> Falta subir el documento de {all.length} OC</p>
        <Link href="/ordenes/importar" className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg"><Upload className="size-4" /> Subir OC</Link>
      </div>
      <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
        {shown.map((m) => (
          <li key={m.bac_number} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 font-mono font-semibold">OC {m.bac_number}<CopyButton text={m.bac_number} /></p>
              <p className="truncate text-xs text-fg-subtle">{m.unit_name ?? m.place ?? "—"} · desde {formatDate(m.first_seen)}</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {m.sources.map((s) => <Badge key={s} tone={s === "bac" ? "danger" : s === "mail" ? "warn" : "neutral"}>{SRC[s] ?? s}</Badge>)}
              {m.mail_thread && <a href={`https://mail.google.com/mail/u/0/#all/${m.mail_thread}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand hover:underline">Abrir mail</a>}
              {m.in_bac && <Link href={`/bac?f=todas&q=${encodeURIComponent(m.bac_number)}`} className="text-xs font-medium text-brand hover:underline">Ver en BAC</Link>}
            </div>
          </li>
        ))}
      </ul>
      {all.length > shown.length && <p className="border-t border-border px-5 py-2 text-xs text-fg-subtle"><Link href="/ordenes?faltan=1" className="text-brand hover:underline">Ver las {all.length}</Link></p>}
    </Card>
  );
}
