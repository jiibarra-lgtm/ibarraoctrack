"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, FileUp, ImageIcon, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/primitives";
import { sha256Hex, uploadPrivate, validateFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { checkDuplicate, registerImport } from "@/app/(app)/ordenes/importar/actions";

type Kind = "orden_bac" | "factura_proveedor" | "remito";

/**
 * Las fotos de cámara se reducen (máx. 2400 px, JPEG 85%) para subir rápido desde el celular
 * sin perder legibilidad. Capturas de pantalla (PNG) y PDF se suben tal cual.
 */
export async function compressPhoto(file: File): Promise<File> {
  if (file.type !== "image/jpeg" && file.type !== "image/heic" && file.type !== "image/webp") return file;
  if (file.size < 1.5 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo comprimir"))), "image/jpeg", 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  } catch {
    return file; // si el navegador no puede (p. ej. HEIC en escritorio), se sube el original
  }
}

export function DocUploader({
  orgId, kind, purchaseOrderId, title, hint, jobHref, folder,
}: {
  orgId: string; kind: Kind; purchaseOrderId?: string; title: string; hint: string;
  jobHref: (jobId: string) => string; folder: string;
}) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const camInput = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [dup, setDup] = React.useState<Awaited<ReturnType<typeof checkDuplicate>>>(null);

  const handle = async (raw: File | undefined) => {
    if (!raw) return;
    setDup(null);
    try {
      setBusy("Preparando…");
      const file = await compressPhoto(raw);
      const invalid = validateFile(file);
      if (invalid) throw new Error(invalid);
      const existing = await checkDuplicate(await sha256Hex(file));
      if (existing) { setDup(existing); setBusy(null); return; }
      setBusy("Subiendo de forma privada…");
      const up = await uploadPrivate(file, orgId, folder);
      setBusy("Leyendo…");
      const res = await registerImport({ kind, purchaseOrderId, storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!res.ok) throw new Error(res.error);
      router.push(jobHref(res.jobId));
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Card
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
        className={cn("border-2 border-dashed transition-colors", drag ? "border-primary bg-info-soft/60" : "border-border-strong/70")}
      >
        <CardBody className="flex flex-col items-center px-6 py-10 text-center sm:py-14">
          <div className="mb-3 grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><FileUp className="size-5" /></div>
          <p className="font-medium">{busy ?? title}</p>
          <p className="mt-1 max-w-md text-sm text-fg-muted">{hint}</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button onClick={() => camInput.current?.click()} loading={!!busy} className="sm:order-2" variant="secondary"><Camera /> Sacar foto</Button>
            <Button onClick={() => fileInput.current?.click()} disabled={!!busy}><ImageIcon /> Elegir archivo</Button>
          </div>
          <input ref={fileInput} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp,image/heic" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={camInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
        </CardBody>
      </Card>
      {dup && (
        <Card className="border-warn/50 bg-warn-soft/50">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" /> Este archivo ya se subió como “{dup.title}”. No se duplicó.</p>
            {dup.jobId && <Button asChild size="sm" variant="secondary"><Link href={jobHref(dup.jobId)}>Ver</Link></Button>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
