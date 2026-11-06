"use client";
import * as React from "react";
import { ArrowLeft, Printer } from "lucide-react";
import { remitoAction } from "@/app/(app)/remitos/actions";

/** Barra superior (no sale impresa). Registra cada impresión en el historial del remito. */
export function PrintBar({ id, label }: { id: string; label: string }) {
  const print = React.useCallback(() => {
    void remitoAction(id, "impreso");
    window.print();
  }, [id]);
  const done = React.useRef(false);
  React.useEffect(() => {
    if (done.current) return;
    done.current = true;
    setTimeout(print, 600); // espera a que carguen logo y marca de agua
  }, [print]);
  return (
    <div className="no-print fixed inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur">
      <a href={`/remitos/${id}`} className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-black"><ArrowLeft className="size-4" /> Volver</a>
      <span className="font-mono text-sm font-semibold">Remito {label}</span>
      <button onClick={print} className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white"><Printer className="size-4" /> Imprimir / Guardar PDF</button>
    </div>
  );
}
