"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Maximize2, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { PoForm } from "@/components/po/po-form";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader } from "@/components/ui/primitives";
import type { PurchaseOrderInput } from "@/lib/po/schema";
import type { ExtractionWarning } from "@/lib/bac/types";
import { confirmImport, discardImport, retryImport } from "../actions";

type Props = {
  jobId: string;
  order: PurchaseOrderInput;
  review: string[];
  warnings: ExtractionWarning[];
  extractor: string | null;
  method: string | null;
  documentUrl: string | null;
  mimeType: string;
  customers: { id: string; name: string }[];
};

const EXTRACTOR_LABEL: Record<string, string> = { heuristica: "Lectura de texto", ia: "Lectura con IA", combinado: "Texto + IA (doble verificación)" };

export function ImportReview(p: Props) {
  const router = useRouter();
  const [zoom, setZoom] = React.useState(1);
  const save = React.useCallback((v: PurchaseOrderInput) => confirmImport(p.jobId, v), [p.jobId]);

  const discard = async () => {
    if (!confirm("¿Descartar esta importación? El archivo queda guardado pero no se crea la orden.")) return;
    const r = await discardImport(p.jobId);
    if (!r.ok) return toast.error(r.error);
    router.push("/ordenes/importar");
  };
  const reprocess = async () => {
    const r = await retryImport(p.jobId);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  };

  const isImage = p.mimeType.startsWith("image/");
  const aside = (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader
        title="Documento original"
        description={p.extractor ? EXTRACTOR_LABEL[p.extractor] ?? p.extractor : undefined}
        action={
          <div className="flex items-center gap-1">
            {isImage && (
              <>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Alejar"><ZoomOut /></Button>
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Acercar"><ZoomIn /></Button>
              </>
            )}
            {p.documentUrl && <Button type="button" variant="ghost" size="icon-sm" asChild><a href={p.documentUrl} target="_blank" rel="noreferrer" aria-label="Abrir"><Maximize2 /></a></Button>}
          </div>
        }
      />
      <div className="max-h-[55vh] min-h-0 flex-1 overflow-auto bg-surface-2 xl:max-h-none">
        {!p.documentUrl ? (
          <p className="p-6 text-sm text-fg-muted">No se pudo cargar la vista previa.</p>
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={p.documentUrl} alt="Orden de compra original" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block" />
        ) : (
          <iframe src={p.documentUrl} title="PDF original" className="h-[55vh] w-full xl:h-full" />
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <Badge tone="info">{p.method === "ocr" ? "Imagen / escaneo" : "PDF con texto"}</Badge>
        <div className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={reprocess}><RotateCcw /> Releer</Button>
          <Button type="button" variant="ghost" size="sm" onClick={discard} className="hover:text-danger"><Trash2 /> Descartar</Button>
        </div>
      </div>
    </Card>
  );

  return (
    <PoForm
      defaultValues={p.order}
      review={p.review}
      warnings={p.warnings}
      onSave={save}
      customers={p.customers}
      aside={aside}
      submitLabel="Confirmar e importar"
      compact
      cancelHref="/ordenes/importar"
    />
  );
}
