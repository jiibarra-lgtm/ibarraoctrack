import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleDollarSign, FileCheck2, PackageCheck, Stamp, TrendingUp } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Card } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

type Stage = { gross: number; net: number; count: number; cash?: number; withheld?: number };
export type MonthStages = {
  month: string; vat_divisor: number;
  awarded: Stage; delivered: Stage; invoiced: Stage; collected: Stage;
  profit: { sales_net: number; sales_net_with_cost: number; cost: number; items: number; items_without_cost: number };
};

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function shiftMonth(ym: string, delta: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export async function loadMonthStages(sb: SupabaseClient, org: string, ym: string): Promise<MonthStages | null> {
  const { data, error } = await sb.rpc("month_stages", { p_org: org, p_month: `${ym}-01` });
  if (error || !data) return null;
  return data as MonthStages;
}

/** Resumen del mes por etapa: adjudicado → entregado → facturado → cobrado, con o sin IVA, y la ganancia estimada. */
export function MonthStagesCard({ data, ym, current, iva }: { data: MonthStages; ym: string; current: string; iva: "con" | "sin" }) {
  const v = (s: Stage) => (iva === "con" ? s.gross : s.net);
  const q = (p: Record<string, string>) => `/dashboard?${new URLSearchParams({ mes: ym, iva, ...p })}`;
  const awarded = v(data.awarded);
  const pct = (x: number) => (awarded > 0 ? Math.min(100, Math.round((x / awarded) * 100)) : 0);
  const p = data.profit;
  const profit = p.sales_net_with_cost - p.cost;
  const margin = p.sales_net_with_cost > 0 ? (profit / p.sales_net_with_cost) * 100 : null;
  const covered = p.sales_net > 0 ? Math.round((p.sales_net_with_cost / p.sales_net) * 100) : 0;

  const stages = [
    { key: "awarded", label: "Adjudicado", icon: Stamp, s: data.awarded, sub: `${data.awarded.count} OC por fecha de autorización`, href: "/ordenes" },
    { key: "delivered", label: "Entregado", icon: PackageCheck, s: data.delivered, sub: `${data.delivered.count} entregas`, href: "/entregas" },
    { key: "invoiced", label: "Facturado", icon: FileCheck2, s: data.invoiced, sub: `${data.invoiced.count} facturas`, href: "/facturacion" },
    { key: "collected", label: "Cobrado", icon: CircleDollarSign, s: data.collected, sub: data.collected.withheld ? `${formatMoney(data.collected.cash ?? 0)} en banco + ${formatMoney(data.collected.withheld)} retenciones` : `${data.collected.count} cobros`, href: "/cobranzas" },
  ];

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={q({ mes: shiftMonth(ym, -1) })} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label="Mes anterior"><ChevronLeft className="size-4" /></Link>
          <h2 className="min-w-36 text-center text-base font-semibold capitalize">{monthLabel(ym)}</h2>
          {ym < current
            ? <Link href={q({ mes: shiftMonth(ym, 1) })} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label="Mes siguiente"><ChevronRight className="size-4" /></Link>
            : <span className="size-8" />}
        </div>
        <div className="flex rounded-full border border-card-border bg-field p-0.5 text-xs font-medium">
          {(["con", "sin"] as const).map((k) => (
            <Link key={k} href={q({ iva: k })} className={cn("rounded-full px-3 py-1", iva === k ? "bg-brand text-white" : "text-fg-muted hover:text-fg")}>{k === "con" ? "Con IVA" : "Sin IVA"}</Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stages.map((x, i) => (
          <Link key={x.key} href={x.href} className="rounded-xl border border-card-border bg-field/50 p-3 transition-colors hover:bg-surface-2/60">
            <p className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle"><x.icon className="size-3.5" /> {x.label}</p>
            <p className="mt-1 truncate text-lg font-semibold tabular sm:text-xl">{formatMoney(v(x.s))}</p>
            {i > 0 && (
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2" title={`${pct(v(x.s))}% de lo adjudicado del mes`}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct(v(x.s))}%` }} />
              </div>
            )}
            <p className="mt-1 truncate text-[11px] text-fg-subtle">{x.sub}</p>
          </Link>
        ))}
      </div>

      <Link href={`/analitica/mes?mes=${ym}`} className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-card-border bg-field/50 p-3 transition-colors hover:bg-surface-2/60">
        <p className="flex items-center gap-1.5 text-xs font-medium text-fg-subtle"><TrendingUp className="size-3.5" /> Ganancia estimada de lo adjudicado (sin IVA)</p>
        {p.items === 0 ? <span className="text-sm text-fg-subtle">Sin órdenes este mes</span> : p.sales_net_with_cost === 0 ? (
          <span className="text-sm text-warn">Cargá tu costo en {p.items} renglones para ver cuánto ganás →</span>
        ) : (
          <>
            <span className={cn("text-lg font-semibold tabular", profit < 0 && "text-danger")}>{formatMoney(profit)}</span>
            {margin !== null && <span className="text-sm tabular text-fg-muted">margen {margin.toFixed(1)}%</span>}
            <span className={cn("text-xs", covered < 100 ? "text-warn" : "text-fg-subtle")}>
              {covered < 100 ? `Sobre el ${covered}% de lo vendido · faltan costos en ${p.items_without_cost} renglones →` : "Todos los renglones con costo"}
            </span>
          </>
        )}
      </Link>
    </Card>
  );
}
