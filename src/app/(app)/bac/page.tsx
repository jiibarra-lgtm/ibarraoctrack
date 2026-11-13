import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardCheck, FileCheck2, Inbox, MailWarning, Search, Upload } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { CopyButton } from "@/components/ui/copy-button";
import { formatDate, formatMoney } from "@/lib/format";
import type { InboxRow } from "@/lib/bac-track";
import { cn } from "@/lib/utils";
import { ContractActs } from "@/components/bac/contract-acts";

export const metadata: Metadata = { title: "Órdenes BAC" };

const FILTERS = [["pendientes", "Sin cargar"], ["todas", "Todas"], ["cargadas", "Cargadas"], ["prd", "Con PRD"]] as const;

export default async function BacInboxPage({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const { f = "pendientes", q = "" } = await searchParams;
  const s = await requireOrg();
  const [{ data }, { data: tok }] = await Promise.all([
    s.supabase.from("bac_inbox_overview").select("*").eq("org_id", s.org.org_id).order("first_seen_at", { ascending: false }).limit(2000),
    s.supabase.from("inbound_tokens").select("last_used_at").eq("org_id", s.org.org_id).maybeSingle(),
  ]);
  const all = ((data ?? []) as InboxRow[]).filter((r) => !r.dismissed);
  const pending = all.filter((r) => !r.loaded);
  const needle = q.trim().toLowerCase();
  const rows = all
    .filter((r) => (f === "pendientes" ? !r.loaded : f === "cargadas" ? r.loaded : f === "prd" ? !!r.prd_number : true))
    .filter((r) => !needle || [r.bac_number, r.unit_name, r.convenio_name, r.process_name, r.prd_number].some((x) => x?.toLowerCase().includes(needle)))
    .sort((a, b) => (b.notified_at ?? b.perfected_at ?? b.first_seen_at).localeCompare(a.notified_at ?? a.perfected_at ?? a.first_seen_at));

  return (
    <>
      <PageHeader title="Órdenes BAC" description="Todas las órdenes que BAC y SIGAF te avisaron por mail, y si ya están cargadas en el sistema."
        actions={<Button asChild><Link href="/ordenes/importar"><Upload /> Cargar orden</Link></Button>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Inbox} label="Avisadas" value={String(all.length)} sub={tok?.last_used_at ? `Última lectura ${formatDate(tok.last_used_at)}` : "Conectá tu Gmail en Configuración"} />
        <Stat icon={MailWarning} label="Sin cargar" value={String(pending.length)} tone={pending.length ? "warn" : "accent"} href="/bac?f=pendientes" />
        <Stat icon={FileCheck2} label="Perfeccionadas" value={String(all.filter((r) => r.perfected_at).length)} />
        <Stat icon={ClipboardCheck} label="Con PRD emitido" value={String(all.filter((r) => r.prd_number).length)} href="/bac?f=prd" />
      </div>

      <ContractActs sb={s.supabase} org={s.org.org_id} canEdit={["admin", "finanzas", "compras"].includes(s.org.role)} />

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map(([k, l]) => (
              <Link key={k} href={`/bac?f=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={cn("rounded-full px-3 py-1 text-xs font-medium", f === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>
                {l}{k === "pendientes" ? ` · ${pending.length}` : ""}
              </Link>
            ))}
          </div>
          <form className="relative w-full sm:w-72">
            <input type="hidden" name="f" value={f} />
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input name="q" defaultValue={q} placeholder="Buscar OC, organismo, convenio…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </form>
        </div>
        {!rows.length ? (
          <EmptyState icon={<Inbox />} title={all.length ? "Nada con este filtro" : "Todavía no hay avisos"}
            description={all.length ? undefined : "Cuando conectes tu Gmail, acá aparecen todas las órdenes que te avisa BAC."}
            action={!all.length && <Button asChild variant="secondary"><Link href="/configuracion#gmail">Conectar Gmail</Link></Button>} />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/bac/${r.bac_number}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-surface-2/60 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_150px_120px] sm:px-5">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1 font-mono text-sm font-semibold">{r.bac_number}<CopyButton value={r.bac_number} /></p>
                    <p className="truncate text-xs text-fg-subtle">{r.unit_name ?? `Unidad ${r.unit_code}`}</p>
                  </div>
                  <div className="col-span-2 min-w-0 text-xs text-fg-muted sm:col-span-1">
                    <p className="truncate">{r.convenio_name ?? r.process_name ?? "—"}</p>
                    <p className="truncate text-fg-subtle">{r.convenio_number ?? r.process_number ?? ""}{r.prd_number ? ` · PRD ${r.prd_number}` : ""}</p>
                  </div>
                  <div className="hidden text-xs text-fg-subtle sm:block">
                    <p>Avisada {formatDate(r.notified_at ?? r.first_seen_at)}</p>
                    <p>{r.perfected_at ? `Perfecc. ${formatDate(r.perfected_at)}` : "Sin perfeccionar"}</p>
                  </div>
                  <div className="col-start-2 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
                    {r.loaded ? (
                      <span className="inline-flex flex-col items-end">
                        <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent">Cargada</span>
                        {r.po_total && <span className="mt-0.5 text-[11px] tabular text-fg-subtle">{formatMoney(r.po_total, r.po_currency ?? "ARS")}</span>}
                      </span>
                    ) : (
                      <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn">No cargada</span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
