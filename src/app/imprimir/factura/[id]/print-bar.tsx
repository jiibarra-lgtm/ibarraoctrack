"use client";
import { ArrowLeft, Printer } from "lucide-react";

export function InvoicePrintBar({ label }: { label: string }) {
  return (
    <div className="no-print fixed inset-x-0 top-0 z-10 flex items-center justify-between gap-3 border-b border-black/10 bg-white/90 px-4 py-3 backdrop-blur">
      <a href="/facturacion?t=electronicas" className="inline-flex items-center gap-1.5 text-sm text-neutral-600 hover:text-black"><ArrowLeft className="size-4" /> Volver</a>
      <span className="font-mono text-sm font-semibold">{label}</span>
      <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-sm font-medium text-white"><Printer className="size-4" /> Imprimir / Guardar PDF</button>
    </div>
  );
}
