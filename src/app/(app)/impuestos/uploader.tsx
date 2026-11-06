"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileArchive, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readComprobantesFile } from "@/lib/arca-comprobantes";
import { cn } from "@/lib/utils";
import { importVouchers } from "./actions";

const CHUNK = 1000;

/** Arrastrás los ZIP de Mis Comprobantes (Emitidos y Recibidos, juntos o por separado) y se cargan solos. */
export function ComprobantesUploader({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const input = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const handle = async (list: FileList | File[] | null) => {
    const files = Array.from(list ?? []);
    if (!files.length || busy) return;
    let nuevos = 0, actualizados = 0, vinculados = 0;
    const resumen: string[] = [];
    try {
      for (const f of files) {
        setBusy(`Leyendo ${f.name}…`);
        const parsed = await readComprobantesFile(f);
        for (const p of parsed) {
          if (!p.rows.length) { toast.warning(`${f.name}: no tiene comprobantes`); continue; }
          for (let i = 0; i < p.rows.length; i += CHUNK) {
            setBusy(`Cargando ${p.direction === "emitido" ? "emitidos" : "recibidos"} ${Math.min(i + CHUNK, p.rows.length)}/${p.rows.length}…`);
            const r = await importVouchers(p.direction, p.rows.slice(i, i + CHUNK));
            if (!r.ok) throw new Error(r.error);
            nuevos += r.nuevos; actualizados += r.actualizados; vinculados += r.vinculados;
          }
          resumen.push(`${p.rows.length} ${p.direction === "emitido" ? "emitidos" : "recibidos"}`);
        }
      }
      if (resumen.length) {
        toast.success(`Cargado: ${resumen.join(" y ")}`, {
          description: `${nuevos} nuevos${actualizados ? `, ${actualizados} ya estaban` : ""}${vinculados ? `, ${vinculados} vinculados a facturas o compras` : ""}`,
        });
      }
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled) handle(e.dataTransfer.files); }}
      className={cn("glass flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-6 text-center sm:flex-row sm:text-left",
        drag ? "border-accent bg-accent-soft" : "border-card-border")}
    >
      <span className="grid size-10 shrink-0 place-items-center rounded-full border border-card-border bg-field text-fg-muted"><FileArchive className="size-5" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{busy ?? "Subí los ZIP de Mis Comprobantes de ARCA"}</p>
        <p className="text-xs text-fg-subtle">Emitidos y Recibidos, juntos o de a uno. Se detecta cuál es cada uno. Si subís el mismo período otra vez, no se duplica.</p>
      </div>
      <input ref={input} type="file" accept=".zip,.csv,.txt" multiple hidden onChange={(e) => handle(e.target.files)} />
      <Button disabled={disabled} loading={!!busy} onClick={() => input.current?.click()}><Upload /> Elegir archivos</Button>
    </div>
  );
}
