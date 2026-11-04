"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Download, ExternalLink, FileText, ImageIcon, Loader2, Paperclip, Plus, Receipt, ScrollText, Truck, ClipboardCheck } from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { Card, CardHeader, EmptyState, NativeSelect } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatBytes, formatDateTime } from "@/lib/format";
import { uploadPrivate } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { attachDocument, getDocumentUrl, setDocumentType } from "../actions";

export type OrderDoc = {
  id: string; title: string; doc_type: string; mime_type: string; size_bytes: number | string; created_at: string; uploader?: string | null;
};

/** Documentos que toda orden debería tener, en el orden en que suelen aparecer. */
const REQUIRED = [
  { type: "remito_provisorio", label: "Remito provisorio", icon: Truck },
  { type: "remito_oficial", label: "Remito oficial", icon: ScrollText },
  { type: "prd", label: "PRD", hint: "Parte de recepción definitiva", icon: ClipboardCheck },
  { type: "factura_emitida", label: "Factura", icon: Receipt },
] as const;

export const DOC_TYPE_LABEL: Record<string, string> = {
  remito_provisorio: "Remito provisorio", remito_oficial: "Remito oficial", prd: "PRD · Parte de recepción definitiva",
  factura_emitida: "Factura", orden_compra: "Orden de compra", remito: "Remito", constancia_recepcion: "Constancia de recepción",
  conformidad: "Conformidad", comprobante_pago: "Comprobante de pago", nota_credito: "Nota de crédito",
  factura_proveedor: "Factura de proveedor", cotizacion: "Cotización", contrato: "Contrato", otro: "Otro",
};
const SELECTABLE = ["remito_provisorio", "remito_oficial", "prd", "factura_emitida", "orden_compra", "nota_credito", "comprobante_pago", "conformidad", "contrato", "cotizacion", "otro"];
const ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic";

export function OrderDocuments({ documents, poId, orgId, canWrite }: { documents: OrderDoc[]; poId: string; orgId: string; canWrite: boolean }) {
  const router = useRouter();
  const [busyType, setBusyType] = React.useState<string | null>(null);
  const [viewing, setViewing] = React.useState<OrderDoc | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);
  const inputs = React.useRef<Record<string, HTMLInputElement | null>>({});

  const upload = async (files: FileList | File[] | null, docType: string) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusyType(docType);
    for (const file of list) {
      try {
        const up = await uploadPrivate(file, orgId, `ordenes/${poId}`);
        const res = await attachDocument({ purchaseOrderId: poId, storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256, docType: docType as never });
        if (!res.ok) toast.error(`${file.name}: ${res.error}`);
        else toast.success(`${DOC_TYPE_LABEL[docType]} adjuntado`);
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    }
    setBusyType(null);
    router.refresh();
  };

  const pick = (docType: string) => inputs.current[docType]?.click();
  const dropProps = (docType: string) => canWrite ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOver(docType); },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragOver(null); upload(e.dataTransfer.files, docType); },
  } : {};

  const byType = (t: string) => documents.filter((d) => d.doc_type === t);
  const requiredTypes = new Set<string>(REQUIRED.map((r) => r.type));
  const others = documents.filter((d) => !requiredTypes.has(d.doc_type));
  const done = REQUIRED.filter((r) => byType(r.type).length > 0).length;

  return (
    <div className="flex flex-col gap-4">
      {[...REQUIRED.map((r) => r.type), "otro"].map((t) => (
        <input key={t} ref={(el) => { inputs.current[t] = el; }} type="file" multiple hidden accept={ACCEPT} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; upload(f, t); }} />
      ))}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">Documentación de entrega y cobro · <span className="font-medium text-fg tabular">{done} de {REQUIRED.length}</span></p>
        {canWrite && <Button size="sm" variant="secondary" onClick={() => pick("otro")} loading={busyType === "otro"}><Plus /> Otro documento</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {REQUIRED.map((r) => {
          const docs = byType(r.type);
          const Icon = r.icon;
          const has = docs.length > 0;
          return (
            <div key={r.type} {...dropProps(r.type)}
              className={cn("glass flex min-w-0 flex-col rounded-2xl p-3.5 transition-colors", dragOver === r.type && "ring-2 ring-brand")}>
              <div className="flex items-start justify-between gap-2">
                <span className={cn("grid size-8 place-items-center rounded-full border border-card-border shadow-xs", has ? "bg-accent text-white" : "bg-field text-fg-muted")}>
                  {has ? <Check className="size-4" /> : <Icon className="size-4" />}
                </span>
                {canWrite && (
                  <button type="button" onClick={() => pick(r.type)} disabled={busyType !== null}
                    className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg hover:bg-primary/90 disabled:opacity-50">
                    {busyType === r.type ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />} Subir
                  </button>
                )}
              </div>
              <p className="mt-2.5 text-sm font-semibold">{r.label}</p>
              {"hint" in r && <p className="truncate text-[11px] text-fg-subtle">{r.hint}</p>}
              <p className={cn("text-xs", has ? "text-fg-subtle" : "font-medium text-warn")}>{has ? `${docs.length} archivo${docs.length === 1 ? "" : "s"}` : "Falta"}</p>
              {has && (
                <ul className="mt-2 flex flex-col gap-1">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <button type="button" onClick={() => setViewing(d)} className="flex w-full items-center gap-1.5 rounded-lg bg-field px-2 py-1.5 text-left text-xs hover:bg-surface-solid">
                        {d.mime_type.startsWith("image/") ? <ImageIcon className="size-3.5 shrink-0 text-fg-muted" /> : <FileText className="size-3.5 shrink-0 text-fg-muted" />}
                        <span className="truncate">{d.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {!has && canWrite && <p className="mt-2 hidden text-[11px] text-fg-subtle sm:block">o arrastrá el PDF acá</p>}
            </div>
          );
        })}
      </div>

      <Card {...dropProps("otro")} className={cn(dragOver === "otro" && "ring-2 ring-brand")}>
        <CardHeader title="Otros documentos" description="Orden de compra original, notas de crédito, comprobantes de pago, contratos…" />
        {others.length === 0 ? (
          <EmptyState icon={<Paperclip />} title="Sin otros documentos" />
        ) : (
          <ul className="divide-y divide-border">
            {others.map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => setViewing(d)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 sm:px-5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full border border-card-border bg-field text-fg-muted">
                    {d.mime_type.startsWith("image/") ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{d.title}</span>
                    <span className="block truncate text-xs text-fg-subtle">{DOC_TYPE_LABEL[d.doc_type] ?? d.doc_type} · {formatBytes(Number(d.size_bytes))} · {formatDateTime(d.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <DocViewer doc={viewing} onClose={() => setViewing(null)} canWrite={canWrite} onChanged={() => router.refresh()} />
    </div>
  );
}

/** Visor de PDF / imagen dentro de la app, con cambio de tipo, abrir y descargar. */
function DocViewer({ doc, onClose, canWrite, onChanged }: { doc: OrderDoc | null; onClose: () => void; canWrite: boolean; onChanged: () => void }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [type, setType] = React.useState(doc?.doc_type ?? "otro");

  React.useEffect(() => {
    if (!doc) return;
    let alive = true;
    getDocumentUrl(doc.id, false, 1800).then((r) => {
      if (!alive) return;
      if (r.ok) { setUrl(r.url); setError(null); } else setError(r.error);
    });
    return () => { alive = false; setUrl(null); setError(null); };
  }, [doc]);

  // Sincroniza el selector con el documento abierto
  const [prevDoc, setPrevDoc] = React.useState(doc);
  if (doc !== prevDoc) { setPrevDoc(doc); setType(doc?.doc_type ?? "otro"); }

  const changeType = async (t: string) => {
    if (!doc) return;
    setType(t);
    const r = await setDocumentType(doc.id, t);
    if (!r.ok) { toast.error(r.error); setType(doc.doc_type); return; }
    toast.success(`Marcado como ${DOC_TYPE_LABEL[t]}`);
    onChanged();
  };
  const download = async () => {
    if (!doc) return;
    const r = await getDocumentUrl(doc.id, true);
    if (r.ok) window.location.href = r.url; else toast.error(r.error);
  };

  const isImage = doc?.mime_type.startsWith("image/");
  return (
    <DialogPrimitive.Root open={!!doc} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm" />
        <DialogPrimitive.Content className="fixed inset-2 z-50 flex flex-col overflow-hidden rounded-2xl border border-card-border bg-surface-solid shadow-2xl focus:outline-none sm:inset-6 lg:inset-x-[8vw]">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 sm:px-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold">{doc?.title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="truncate text-xs text-fg-subtle">
                {doc ? `${formatBytes(Number(doc.size_bytes))} · ${formatDateTime(doc.created_at)}${doc.uploader ? ` · ${doc.uploader}` : ""}` : ""}
              </DialogPrimitive.Description>
            </div>
            {canWrite ? (
              <NativeSelect value={type} onChange={(e) => changeType(e.target.value)} className="h-8 w-auto text-xs" aria-label="Tipo de documento">
                {SELECTABLE.map((t) => <option key={t} value={t}>{DOC_TYPE_LABEL[t]}</option>)}
                {!SELECTABLE.includes(type) && <option value={type}>{DOC_TYPE_LABEL[type] ?? type}</option>}
              </NativeSelect>
            ) : <span className="text-xs text-fg-muted">{DOC_TYPE_LABEL[type]}</span>}
            {url && <Button asChild variant="ghost" size="icon-sm" aria-label="Abrir en otra pestaña"><a href={url} target="_blank" rel="noreferrer"><ExternalLink /></a></Button>}
            <Button variant="ghost" size="icon-sm" onClick={download} aria-label="Descargar"><Download /></Button>
            <DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Cerrar"><X /></Button></DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto bg-[oklch(0.3_0.02_235)]">
            {error ? <p className="p-6 text-sm text-white/80">{error}</p>
              : !url ? <div className="grid h-full place-items-center"><Loader2 className="size-6 animate-spin text-white/70" /></div>
              : isImage
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={url} alt={doc?.title ?? ""} className="mx-auto block max-w-full" />
                : <iframe src={url} title={doc?.title ?? "Documento"} className="size-full border-0 bg-white" />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
