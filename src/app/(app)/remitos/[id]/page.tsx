import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, FileSignature, Printer, Ban, MessageSquare, FilePlus2 } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { RemitoSheet } from "@/components/remito/remito-sheet";
import { formatDateTime } from "@/lib/format";
import { EVENT_LABEL, REMITO_STATUS } from "@/lib/remitos";
import { loadRemito } from "@/lib/remito-load";
import { isUuid, cn } from "@/lib/utils";
import { DocumentButton } from "../../ordenes/[id]/document-button";
import { RemitoActions } from "./remito-actions";

export const metadata: Metadata = { title: "Remito" };

const ICON: Record<string, React.ElementType> = { emitido: FilePlus2, impreso: Printer, entregado: CheckCircle2, firmado: FileSignature, anulado: Ban, nota: MessageSquare };

export default async function RemitoPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nuevo?: string }> }) {
  const { id } = await params;
  const { nuevo } = await searchParams;
  if (!isUuid(id)) notFound();
  const s = await requireOrg();
  const data = await loadRemito(s.supabase, s.org.org_id, id);
  if (!data) notFound();
  const { row: r, sheet, qrSvg } = data;
  const { data: events } = await s.supabase.from("remito_events").select("id, kind, note, actor, at").eq("remito_id", id).order("at");
  const actors = [...new Set((events ?? []).map((e) => e.actor).filter(Boolean))] as string[];
  const { data: people } = actors.length ? await s.supabase.from("profiles").select("id, full_name, email").in("id", actors) : { data: [] };
  const name = Object.fromEntries((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  const st = REMITO_STATUS[r.status];
  const canEdit = canWrite(s.org.role) || s.org.role === "logistica";

  return (
    <>
      <PageHeader
        breadcrumb={<Link href="/remitos?v=historial" className="hover:text-fg">Remitos</Link>}
        title={<span className="flex flex-wrap items-center gap-3 font-mono">{r.label}<span className={cn("rounded-full px-2.5 py-1 font-sans text-xs font-medium", st.tone)}>{st.label}</span></span>}
        description={`${r.provisional ? "Remito provisorio" : "Remito"} para ${r.recipient_name}`}
        actions={<RemitoActions id={r.id} orgId={s.org.org_id} status={r.status} canEdit={canEdit} />}
      />
      {nuevo && <div className="mb-4 rounded-2xl border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-accent">Remito emitido con el número <b className="font-mono">{r.label}</b>. Imprimilo o guardalo en PDF con el botón de arriba.</div>}
      {r.status === "anulado" && <div className="mb-4 rounded-2xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">Anulado el {formatDateTime(r.voided_at)}: {r.void_reason}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="overflow-x-auto rounded-2xl border border-card-border bg-white shadow-sm">
          <div className="w-[816px] [zoom:0.42] sm:[zoom:0.75] lg:[zoom:1] xl:[zoom:0.9] 2xl:[zoom:1]">
            <RemitoSheet data={sheet} qrSvg={qrSvg} />
          </div>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Trazabilidad" />
            <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 px-5 pb-5 text-sm">
              <dt className="text-fg-subtle">Número</dt><dd className="font-mono">{r.label}</dd>
              <dt className="text-fg-subtle">Tipo</dt><dd>{r.provisional ? "Provisorio" : "Definitivo"}</dd>
              <dt className="text-fg-subtle">Fecha remito</dt><dd>{formatDateTime(r.issued_at)}</dd>
              <dt className="text-fg-subtle">Emitido por</dt><dd>{r.created_by_name ?? "—"} · {formatDateTime(r.created_at)}</dd>
              <dt className="text-fg-subtle">Orden</dt><dd>{r.purchase_order_id ? <Link className="font-mono hover:underline" href={`/ordenes/${r.purchase_order_id}?tab=entregas`}>OC {r.po_number}</Link> : "Sin OC (remito libre)"}</dd>
              <dt className="text-fg-subtle">Entrega</dt><dd>{r.delivery_id ? <Link className="hover:underline" href={`/ordenes/${r.purchase_order_id}?tab=entregas`}>Registrada en la orden</Link> : "—"}</dd>
              <dt className="text-fg-subtle">Impresiones</dt><dd>{r.print_count ? `${r.print_count} · última ${formatDateTime(r.last_printed_at)}` : "Todavía no se imprimió"}</dd>
              <dt className="text-fg-subtle">Copia firmada</dt><dd>{r.signed_document_id ? <DocumentButton documentId={r.signed_document_id} label="Ver firmada" size="sm" /> : "Pendiente"}</dd>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Historial" />
            <ol className="relative mx-5 mb-5 border-l border-border pl-5">
              {(events ?? []).map((e) => {
                const Icon = ICON[e.kind] ?? Clock;
                return (
                  <li key={e.id} className="mb-4 last:mb-0">
                    <span className={cn("absolute -left-3 grid size-6 place-items-center rounded-full border border-card-border bg-surface-solid", e.kind === "anulado" && "text-danger", e.kind === "firmado" && "text-accent")}><Icon className="size-3.5" /></span>
                    <p className="text-sm font-medium">{EVENT_LABEL[e.kind] ?? e.kind}</p>
                    <p className="text-xs text-fg-subtle">{formatDateTime(e.at)}{e.actor ? ` · ${name[e.actor] ?? ""}` : ""}</p>
                    {e.note && <p className="mt-0.5 text-xs text-fg-muted">{e.note}</p>}
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
