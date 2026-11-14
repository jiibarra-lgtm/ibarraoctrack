"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleAlert, Clock, Copy, Eye, Loader2 } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { sha256Hex, uploadPrivate, validateFile } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { checkDuplicate, registerImport, retryImport } from "./actions";

type State = "cola" | "subiendo" | "leyendo" | "importada" | "revision" | "repetida" | "error";
export type BatchItem = { key: string; name: string; state: State; href?: string; note?: string };

const ACCEPT = /\.(pdf|png|jpe?g|webp)$/i;
const PARALLEL = 3;

/** Junta los archivos de una carpeta arrastrada (recorre subcarpetas). */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => (i.kind === "file" ? i.webkitGetAsEntry?.() : null)).filter(Boolean) as FileSystemEntry[];
  if (!entries.some((e) => e.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      out.push(await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej)));
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

export function onlyOrders(files: File[]) {
  return files.filter((f) => ACCEPT.test(f.name) && !f.name.startsWith("."));
}

/**
 * Importa varias OC seguidas: verifica duplicados por huella, sube, registra y lee cada una
 * (de a 3 en paralelo). Las que cierran se guardan solas; las dudosas quedan para revisar.
 */
export function useBatchImport(orgId: string) {
  const router = useRouter();
  const [items, setItems] = React.useState<BatchItem[]>([]);
  const [running, setRunning] = React.useState(false);
  const set = (key: string, patch: Partial<BatchItem>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  const processJob = async (key: string, jobId: string) => {
    set(key, { state: "leyendo", href: `/ordenes/importar/${jobId}` });
    try {
      const res = await fetch(`/api/import/${jobId}/process`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.status === "confirmado" && body.purchaseOrderId) set(key, { state: "importada", href: `/ordenes/${body.purchaseOrderId}` });
      else if (body.status === "revision") set(key, { state: "revision", note: "Tiene datos para revisar" });
      else if (body.status === "error") set(key, { state: "error", note: body.error ?? "No se pudo leer" });
      else set(key, { state: "revision", note: "Sigue procesando: abrila para ver el resultado" });
    } catch {
      set(key, { state: "revision", note: "Sigue procesando: abrila para ver el resultado" });
    }
  };

  const one = async (key: string, file: File) => {
    const invalid = validateFile(file);
    if (invalid) return set(key, { state: "error", note: invalid });
    try {
      set(key, { state: "subiendo" });
      const dup = await checkDuplicate(await sha256Hex(file));
      if (dup?.purchaseOrderId) return set(key, { state: "repetida", href: `/ordenes/${dup.purchaseOrderId}`, note: "Ya estaba cargada" });
      if (dup?.jobId) {
        // Subida antes pero descartada o con error: se vuelve a leer con el mismo archivo
        if (dup.jobStatus === "revision") return set(key, { state: "revision", href: `/ordenes/importar/${dup.jobId}`, note: "Ya estaba subida, falta revisarla" });
        if (dup.jobStatus === "descartado" || dup.jobStatus === "error") await retryImport(dup.jobId, true);
        return processJob(key, dup.jobId);
      }
      const up = await uploadPrivate(file, orgId, "importaciones");
      const reg = await registerImport({ storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!reg.ok) return set(key, { state: "error", note: reg.error });
      await processJob(key, reg.jobId);
    } catch (e) {
      set(key, { state: "error", note: (e as Error).message });
    }
  };

  const start = async (files: File[]) => {
    const list = onlyOrders(files);
    const queued = list.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.webkitRelativePath || f.name, state: "cola" as State }));
    setItems((xs) => [...queued, ...xs]);
    setRunning(true);
    let next = 0;
    const worker = async () => {
      while (next < list.length) {
        const i = next++;
        await one(queued[i].key, list[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, list.length) }, worker));
    setRunning(false);
    router.refresh();
    return list.length;
  };

  return { items, running, start };
}

const LABEL: Record<State, string> = {
  cola: "En cola", subiendo: "Subiendo…", leyendo: "Leyendo…", importada: "Importada", revision: "Para revisar", repetida: "Ya cargada", error: "Error",
};

export function BatchList({ items, running }: { items: BatchItem[]; running: boolean }) {
  if (!items.length) return null;
  const n = (s: State) => items.filter((x) => x.state === s).length;
  const done = items.length - n("cola") - n("subiendo") - n("leyendo");
  return (
    <Card>
      <CardHeader
        title={running ? `Importando ${done} de ${items.length}…` : `Listo: ${items.length} archivos`}
        description={`${n("importada")} importadas · ${n("revision")} para revisar · ${n("repetida")} ya cargadas${n("error") ? ` · ${n("error")} con error` : ""}`}
      />
      <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
        {items.map((x) => {
          const Icon = x.state === "importada" ? CheckCircle2 : x.state === "error" ? CircleAlert : x.state === "revision" ? Eye : x.state === "repetida" ? Copy : x.state === "cola" ? Clock : Loader2;
          const row = (
            <>
              <Icon className={cn("size-4 shrink-0", x.state === "importada" && "text-success", x.state === "error" && "text-danger", x.state === "revision" && "text-warn",
                (x.state === "subiendo" || x.state === "leyendo") && "animate-spin text-fg-subtle", (x.state === "cola" || x.state === "repetida") && "text-fg-subtle")} />
              <span className="min-w-0 flex-1 truncate">{x.name}</span>
              <span className="shrink-0 text-xs text-fg-subtle">{x.note ?? LABEL[x.state]}</span>
            </>
          );
          return (
            <li key={x.key}>
              {x.href && !["cola", "subiendo"].includes(x.state)
                ? <Link href={x.href} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-surface-2/60 sm:px-5">{row}</Link>
                : <div className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">{row}</div>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
