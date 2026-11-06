"use client";
import * as React from "react";
import { Calculator } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Calculadora rápida: ganancia supuesta = ventas netas (sin IVA) × porcentaje. */
export function ProfitCalc({ monthNet, yearNet, monthLabel, yearLabel }: { monthNet: number; yearNet: number; monthLabel: string; yearLabel: string }) {
  const [pct, setPct] = React.useState("15");
  const [base, setBase] = React.useState<"mes" | "anio">("mes");
  const p = Number(pct.replace(",", ".")) || 0;
  const net = base === "mes" ? monthNet : yearNet;
  const gain = (net * p) / 100;
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Calculator className="size-4" /> Calcular ganancia supuesta</span>} description="Sobre lo facturado sin IVA" />
      <div className="flex flex-col gap-3 px-4 pb-4 text-sm sm:px-5">
        <div className="flex rounded-full bg-field p-0.5 text-xs">
          {([["mes", monthLabel], ["anio", yearLabel]] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setBase(k)} className={cn("flex-1 rounded-full px-3 py-1 font-medium capitalize", base === k ? "bg-primary text-primary-fg" : "text-fg-muted")}>{l}</button>
          ))}
        </div>
        <p className="flex justify-between text-fg-muted"><span>Facturado neto</span><span className="tabular text-fg">{formatMoney(net)}</span></p>
        <label className="flex items-center justify-between gap-3">
          <span className="text-fg-muted">Porcentaje de ganancia</span>
          <span className="relative w-24">
            <input value={pct} onChange={(e) => setPct(e.target.value)} inputMode="decimal" aria-label="Porcentaje"
              className="h-9 w-full rounded-xl border border-card-border bg-field pl-3 pr-7 text-right text-sm tabular outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle">%</span>
          </span>
        </label>
        <div className="rounded-xl bg-accent-soft px-4 py-3 text-accent">
          <p className="text-xs">Ganancia supuesta</p>
          <p className="text-2xl font-semibold tabular">{formatMoney(gain)}</p>
        </div>
      </div>
    </Card>
  );
}
