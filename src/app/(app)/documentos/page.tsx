import type { Metadata } from "next";
import Link from "next/link";
import { FileText, FolderOpen, ImageIcon } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatBytes, formatDateTime } from "@/lib/format";
import { DocumentButton } from "@/app/(app)/ordenes/[id]/document-button";
import { cn } from "@/lib/utils";
import { VersionButton } from "./version-button";

export const metadata: Metadata = { title: "Documentos" };

const TYPES: Record<string, string> = {
  orden_compra: "Orden de compra", cotizacion: "Cotización", factura_proveedor: "Factura proveedor", factura_emitida: "Factura emitida",
  remito: "Remito", constancia_recepcion: "Constancia de recepción", conformidad: "Conformidad", comprobante_pago: "Comprobante de pago",
  nota_credito: "Nota de crédito", contrato: "Contrato", otro: "Otro",
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ tipo?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  let q = s.supabase.from("documents").select("id, title, doc_type, mime_type, size_bytes, created_at, current_version, purchase_order_id, purchase_id, delivery_id, purchase_orders(bac_number, internal_number)")
    .eq("org_id", s.org.org_id).order("created_at", { ascending: false }).limit(300);
  if (sp.tipo && sp.tipo in TYPES) q = q.eq("doc_type", sp.tipo);
  if (sp.q) q = q.ilike("title", `%${sp.q.replace(/[%_]/g, "").slice(0, 80)}%`);
  const { data: docs } = await q;
  const editable = canWrite(s.org.role) || s.org.role === "logistica";

  return (
    <>
      <PageHeader title="Documentos" description="Expediente digital: todo guardado en almacenamiento privado, con enlaces firmados que vencen a los 2 minutos." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/documentos" className={cn("rounded-full border px-3 py-1 text-xs", !sp.tipo ? "border-primary bg-info-soft text-primary" : "border-border text-fg-muted")}>Todos</Link>
        {Object.entries(TYPES).map(([k, v]) => (
          <Link key={k} href={`/documentos?tipo=${k}`} className={cn("rounded-full border px-3 py-1 text-xs", sp.tipo === k ? "border-primary bg-info-soft text-primary" : "border-border text-fg-muted hover:text-fg")}>{v}</Link>
        ))}
      </div>
      <Card className="overflow-hidden">
        {!docs?.length ? <EmptyState icon={<FolderOpen />} title="Sin documentos" /> : (
          <ul className="divide-y divide-border">
            {docs.map((d) => {
              const po = d.purchase_orders as unknown as { bac_number: string | null; internal_number: number } | null;
              const link = d.purchase_id ? `/compras/${d.purchase_id}` : d.purchase_order_id ? `/ordenes/${d.purchase_order_id}?tab=${d.delivery_id ? "entregas" : "documentos"}` : null;
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                  <div className="grid size-9 shrink-0 place-items-center rounded-md bg-surface-2 text-fg-muted">{d.mime_type.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{d.title} {d.current_version > 1 && <Badge className="ml-1">v{d.current_version}</Badge>}</p>
                    <p className="truncate text-xs text-fg-subtle">
                      {TYPES[d.doc_type] ?? d.doc_type} · {formatBytes(Number(d.size_bytes))} · {formatDateTime(d.created_at)}
                      {link && <> · <Link href={link} className="text-primary hover:underline">{po ? (po.bac_number ?? `OC-${String(po.internal_number).padStart(6, "0")}`) : "ver"}</Link></>}
                    </p>
                  </div>
                  <DocumentButton documentId={d.id} variant="ghost" size="icon-sm" />
                  <DocumentButton documentId={d.id} download variant="ghost" size="icon-sm" />
                  {editable && <VersionButton documentId={d.id} orgId={s.org.org_id} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
