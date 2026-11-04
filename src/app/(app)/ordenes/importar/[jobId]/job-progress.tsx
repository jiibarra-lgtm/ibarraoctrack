"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleAlert, Loader2, RotateCcw, Trash2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/primitives";
import { createClient } from "@/lib/supabase/client";
import { discardImport, retryImport } from "../actions";

const STEPS = ["Verificando el archivo", "Leyendo la orden (OCR)", "Controlando cuentas y duplicados", "Guardando la orden"];

/**
 * Dispara el procesamiento en una invocación separada y sigue el estado persistido.
 * Si el usuario cierra la pestaña, el trabajo queda pendiente y se retoma al volver.
 */
export function JobProgress({ jobId, status: initial, attempts, maxAttempts, error }: { jobId: string; status: string; attempts: number; maxAttempts: number; error: string | null }) {
  const router = useRouter();
  const [status, setStatus] = React.useState(initial === "pendiente" ? "procesando" : initial);
  const [lastError, setLastError] = React.useState(error);
  const [step, setStep] = React.useState(0);
  const started = React.useRef(false);

  const inFlight = React.useRef(false);
  const run = React.useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/import/${jobId}/process`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (body.status === "confirmado" && body.purchaseOrderId) {
        toast.success("Orden importada automáticamente");
        return router.replace(`/ordenes/${body.purchaseOrderId}`);
      }
      if (body.status === "revision") return router.refresh();
      if (body.status === "error") { setStatus("error"); setLastError(body.error ?? "Error al procesar"); return; }
    } catch {
      // Corte de red o timeout de la función: seguimos el estado por polling
    } finally {
      inFlight.current = false;
    }
  }, [jobId, router]);

  React.useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Dispara un proceso externo (fetch); los setState ocurren después de la respuesta.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initial === "pendiente" || initial === "procesando") run();
  }, [initial, run]);

  // Polling del estado persistido (cubre otra pestaña procesando o funciones que terminan después)
  React.useEffect(() => {
    if (status !== "procesando") return;
    const sb = createClient();
    const iv = setInterval(async () => {
      const { data } = await sb.from("import_jobs").select("status, last_error").eq("id", jobId).single();
      if (!data) return;
      if (data.status === "revision" || data.status === "confirmado") router.refresh();
      else if (data.status === "error") { setStatus("error"); setLastError(data.last_error); }
      else if (data.status === "pendiente") run();
    }, 3000);
    const st = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 2500);
    // Si un proceso anterior se cortó, el lock vence a los 5 min y este reintento lo retoma
    const retry = setInterval(run, 60_000);
    return () => { clearInterval(iv); clearInterval(st); clearInterval(retry); };
  }, [status, jobId, router, run]);

  const retry = async () => {
    const r = await retryImport(jobId);
    if (!r.ok) return toast.error(r.error);
    setLastError(null);
    setStatus("procesando");
    run();
  };
  const discard = async () => {
    const r = await discardImport(jobId);
    if (!r.ok) return toast.error(r.error);
    router.push("/ordenes/importar");
  };

  if (status === "descartado") {
    return <Card><CardBody className="flex items-center gap-2 py-10 text-sm text-fg-muted"><XCircle className="size-4" /> Importación descartada.</CardBody></Card>;
  }

  if (status === "error") {
    return (
      <Card className="border-danger/40">
        <CardBody className="flex flex-col gap-4 py-8">
          <p className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" /><span><span className="font-medium">No se pudo leer el documento.</span> {lastError}</span></p>
          <p className="text-xs text-fg-subtle">Intentos: {attempts} de {maxAttempts}</p>
          <div className="flex gap-2">
            <Button onClick={retry}><RotateCcw /> Reintentar</Button>
            <Button variant="ghost" onClick={discard}><Trash2 /> Descartar</Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-5 py-16 text-center">
        <Loader2 className="size-8 animate-spin text-primary" />
        <div>
          <p className="font-medium">Leyendo la orden…</p>
          <p className="mt-1 text-sm text-fg-muted">Tarda entre 10 y 40 segundos. Si todo cierra, la orden se guarda sola. Podés salir: queda en proceso.</p>
        </div>
        <ol className="flex flex-col gap-1.5 text-left text-sm">
          {STEPS.map((s, i) => (
            <li key={s} className={i <= step ? "text-fg" : "text-fg-subtle"}>{i < step ? "✓" : i === step ? "•" : "○"} {s}</li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
