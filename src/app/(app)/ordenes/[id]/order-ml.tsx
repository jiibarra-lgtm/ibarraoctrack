import Link from "next/link";
import { ExternalLink, ShoppingBag } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { ML_STATUS, mlMargin, mlUrl, type MlRow } from "@/lib/mercadolibre";
import { cn } from "@/lib/utils";

/** Lo comprado / vendido en Mercado Libre vinculado a los renglones de esta orden. */
export function OrderMercadoLibre({ rows }: { rows: MlRow[] }) {
  const lines = [...new Set(rows.map((r) => r.po_line ?? 0))].sort((a, b) => a - b);
  return (
    <Card className="mt-5 overflow-hidden">
      <CardHeader title={<span className="flex items-center gap-2"><ShoppingBag className="size-4" /> Mercado Libre</span>}
        description="Compras y ventas de Mercado Libre de los productos de esta orden."
        action={<Link href="/mercadolibre" className="text-xs text-fg-muted hover:text-fg">Ver todo</Link>} />
      <ul className="divide-y divide-border">
        {lines.flatMap((ln) => rows.filter((r) => (r.po_line ?? 0) === ln).map((r) => {
          const m = mlMargin(r);
          return (
            <li key={r.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[60px_minmax(0,1fr)_auto] sm:items-center sm:px-5">
              <span className="font-mono text-xs text-fg-subtle">R{ln}</span>
              <span className="min-w-0">
                <span className="line-clamp-1">{r.kind === "venta" ? "Vendido" : "Comprado"} en ML: {r.title}</span>
                <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", ML_STATUS[r.status].tone)}>{ML_STATUS[r.status].label}</span>
                  {formatDate(r.ordered_at ?? r.created_at)} · {r.quantity ? `${formatQty(r.quantity)} u.` : "—"}
                  <a href={mlUrl(r)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">#{r.ml_id}<ExternalLink className="size-3" /></a>
                </span>
              </span>
              <span className="text-right text-xs tabular">
                {r.unit_value ? <span className="block text-sm font-medium">{formatMoney(r.unit_value)} c/u</span> : <Link href="/mercadolibre" className="text-warn">Falta el precio</Link>}
                {m && <span className={cn(m.unit >= 0 ? "text-accent" : "text-danger")}>{m.unit >= 0 ? "Ganás" : "Perdés"} {formatMoney(Math.abs(m.unit))} c/u ({m.pct.toFixed(0)}%)</span>}
              </span>
            </li>
          );
        }))}
      </ul>
    </Card>
  );
}
