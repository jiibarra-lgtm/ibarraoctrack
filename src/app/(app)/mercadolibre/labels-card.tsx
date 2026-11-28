import Link from "next/link";
import { Printer, Settings2 } from "lucide-react";
import type { LabelPrefs } from "@/lib/ml/prefs";

/** Acceso rápido: imprimir las etiquetas del día de una vez, según la configuración. */
export function LabelsCard({ prefs }: { prefs: LabelPrefs }) {
  const desc = [
    prefs.scope === "hoy" ? "ventas de hoy" : "todo lo listo para despachar",
    prefs.onlyNew ? "sólo las no impresas" : "incluye reimpresiones",
    [prefs.flex && "Flex", prefs.colecta && "Colecta/correo"].filter(Boolean).join(" + ") || "ningún tipo de envío",
    prefs.format === "zpl" ? "Zebra" : "PDF",
  ].join(" · ");
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-border bg-surface">
      <a href="/api/ml/etiquetas?auto=1" target="_blank" rel="noreferrer" className="flex min-w-0 flex-1 items-center gap-3.5 px-4 py-3.5 hover:bg-white/[.03]">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-[#5fe3a1]/12 text-[#5fe3a1]"><Printer className="size-5" /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold">Etiquetas</span>
          <span className="block text-sm text-fg-muted">Imprimí las etiquetas del día de una vez.</span>
          <span className="mt-0.5 block truncate text-[11px] text-fg-subtle">{desc}</span>
        </span>
      </a>
      <Link href="/mercadolibre/ajustes#etiquetas" aria-label="Configurar etiquetas" title="Configurar" className="grid w-12 shrink-0 place-items-center border-l border-border text-fg-subtle hover:bg-white/[.03] hover:text-fg">
        <Settings2 className="size-4" />
      </Link>
    </div>
  );
}
