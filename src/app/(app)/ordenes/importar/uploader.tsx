"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, ImageIcon, Camera, Sparkles, ShieldCheck, Calculator, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/primitives";
import { sha256Hex, uploadPrivate, validateFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { checkDuplicate, registerImport } from "./actions";

type Dup = NonNullable<Awaited<ReturnType<typeof checkDuplicate>>>;

export function Uploader({ orgId, aiEnabled }: { orgId: string; aiEnabled: boolean }) {
  const router = useRouter();
  const fileInput = React.useRef<HTMLInputElement>(null);
  const camInput = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [stage, setStage] = React.useState<null | "hash" | "upload" | "register">(null);
  const [dup, setDup] = React.useState<Dup | null>(null);

  const handle = async (file: File | undefined) => {
    if (!file) return;
    setDup(null);
    const invalid = validateFile(file);
    if (invalid) return toast.error(invalid);
    try {
      setStage("hash");
      const hash = await sha256Hex(file);
      const existing = await checkDuplicate(hash);
      if (existing) {
        setDup(existing);
        setStage(null);
        return;
      }
      setStage("upload");
      const up = await uploadPrivate(file, orgId, "importaciones");
      setStage("register");
      const res = await registerImport({ storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!res.ok) throw new Error(res.error);
      router.push(`/ordenes/importar/${res.jobId}`);
    } catch (e) {
      toast.error((e as Error).message);
      setStage(null);
    }
  };

  const busy = stage !== null;
  const stageLabel = { hash: "Verificando duplicados…", upload: "Subiendo de forma privada…", register: "Preparando la lectura…" };

  return (
    <div className="flex flex-col gap-4">
      <Card
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); handle(e.dataTransfer.files?.[0]); }}
        className={cn("border-2 border-dashed transition-colors", drag ? "border-primary bg-info-soft/60" : "border-border-strong/70")}
      >
        <CardBody className="flex flex-col items-center px-6 py-12 text-center sm:py-16">
          <div className="mb-4 grid size-12 place-items-center rounded-xl bg-primary/10 text-primary"><FileUp className="size-6" /></div>
          <p className="text-base font-medium">{busy ? stageLabel[stage!] : "Arrastrá la captura o el PDF de la orden"}</p>
          <p className="mt-1 max-w-md text-sm text-fg-muted">
            PNG, JPG o PDF de la pantalla <span className="font-medium text-fg">“Ver documento contractual”</span> de BAC. Máximo 25 MB.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button onClick={() => fileInput.current?.click()} loading={busy}><ImageIcon /> Elegir archivo</Button>
            <Button variant="secondary" className="sm:hidden" onClick={() => camInput.current?.click()} disabled={busy}><Camera /> Sacar foto</Button>
          </div>
          <input ref={fileInput} type="file" hidden accept="application/pdf,image/png,image/jpeg,image/webp" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={camInput} type="file" hidden accept="image/*" capture="environment" onChange={(e) => { handle(e.target.files?.[0]); e.target.value = ""; }} />
        </CardBody>
      </Card>

      {dup && (
        <Card className="border-warn/50 bg-warn-soft/50">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-start gap-2 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
              <span>Este archivo ya se subió como <span className="font-medium">“{dup.title}”</span>. No se duplicó.</span>
            </p>
            <div className="flex gap-2">
              {dup.purchaseOrderId && <Button asChild size="sm"><Link href={`/ordenes/${dup.purchaseOrderId}`}>Ver orden</Link></Button>}
              {!dup.purchaseOrderId && dup.jobId && <Button asChild size="sm" variant="secondary"><Link href={`/ordenes/importar/${dup.jobId}`}>Ver importación</Link></Button>}
            </div>
          </CardBody>
        </Card>
      )}

      {!aiEnabled && (
        <Card className="border-border bg-surface-2/50">
          <CardBody className="flex items-start gap-3 text-sm">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-fg-muted" />
            <p className="text-fg-muted">
              Los PDF con texto se leen automáticamente. Para leer <span className="font-medium text-fg">capturas de pantalla y escaneos</span> configurá
              {" "}<code className="rounded bg-surface px-1 font-mono text-xs">ANTHROPIC_API_KEY</code> en Vercel. Sin eso podés subir la imagen igual y completar los datos mirándola al lado.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [ShieldCheck, "Privado y sin duplicados", "Se guarda el original, se calcula su huella SHA-256 y se detectan OC repetidas."],
          [Calculator, "Cuentas verificadas", "Cantidad × precio, suma de renglones y neto se controlan con decimales exactos."],
          [ScanIcon, "Vos confirmás", "Lo dudoso queda en amarillo. Nada se guarda sin tu revisión."],
        ].map(([Icon, t, d]) => {
          const I = Icon as React.ElementType;
          return (
            <div key={t as string} className="rounded-lg border border-border bg-surface p-4">
              <I className="size-4 text-primary" />
              <p className="mt-2 text-sm font-medium">{t as string}</p>
              <p className="mt-1 text-xs text-fg-muted">{d as string}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScanIcon(props: React.SVGProps<SVGSVGElement>) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2" /><path d="m8 12 3 3 5-6" /></svg>;
}
