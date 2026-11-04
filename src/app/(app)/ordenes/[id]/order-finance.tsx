"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, ShoppingCart, Upload, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, Input } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { setEstimatedCost } from "@/app/(app)/compras/actions";
import { CostDialog, type OrderOption } from "@/app/(app)/costos/cost-dialog";
import type { ProfitRow } from "@/lib/profitability";
import type { PoBilling } from "@/lib/billing";
import { cn } from "@/lib/utils";

export type ItemProfit = {
  purchase_order_item_id: string; line_number: number; option_number: number; description_original: string; quantity: string;
  unit_price: string; sales_gross: string; estimated_unit_cost: string | null; purchased_qty: string; purchased_cost: string;
  estimated_cost: string | null; fully_purchased: boolean; delivered_qty?: string;
};
export type AllocationRow = {
  id: string; quantity: string; unit_cost: string; amount: string; purchase_order_item_id: string;
  purchase_items: { description: string; purchases: { id: string; invoice_date: string; number: string | null; point_of_sale: string | null; status: string; suppliers: { name: string } } };
};
export type CostAllocRow = { id: string; amount: string; purchase_order_item_id: string | null; costs: { id: string; description: string; cost_date: string; status: string; allocation_method: string; cost_categories: { name: string; kind: string } } };

const pctTone = (m: string | null, min: number) => (m === null ? "neutral" : Number(m) < 0 ? "danger" : Number(m) < min ? "warn" : "accent");

function Kpi({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "danger" | "accent" | "warn" }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className={cn("mt-0.5 truncate text-base font-semibold tabular", tone === "danger" && "text-danger", tone === "accent" && "text-accent")}>{value}</p>
      {sub && <p className="truncate text-xs text-fg-subtle">{sub}</p>}
    </div>
  );
}

export function ProfitSummary({ p, cur, billing }: { p: ProfitRow | null; cur: string; billing?: PoBilling | null }) {
  if (!p) return null;
  const min = Number(p.min_margin_pct);
  const hasCost = p.direct_cost_estimated !== null;
  const realized = p.cost_delivered !== null && p.cost_delivered !== undefined && Number(p.sales_delivered_net ?? 0) > 0;
  return (
    <Card>
      <CardHeader title="Rentabilidad" description={`Ventas sin IVA ${formatMoney(p.sales_net, cur)} · ganancia contable, no es dinero cobrado`}
        action={hasCost && <Badge tone={pctTone(p.operating_margin_estimated, min)}>Margen {p.operating_margin_estimated}%{Number(p.operating_margin_estimated) < min ? ` (mínimo ${min}%)` : ""}</Badge>} />
      <CardBody className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Comprado" value={formatMoney(p.direct_cost_real, cur)} sub={`${Number(p.purchased_pct).toFixed(0)}% de las unidades`} />
        <Kpi label="Costo estimado" value={hasCost ? formatMoney(p.direct_cost_estimated, cur) : "—"} sub={hasCost ? (p.cost_estimate_complete && p.fully_purchased ? "100% real" : "real + estimado") : "cargá costos o compras"} />
        <Kpi label="Gastos" value={formatMoney(p.other_costs, cur)} sub={`Logística ${formatMoney(p.logistic_costs, cur)}`} />
        <Kpi label="Ganancia estimada" value={hasCost ? formatMoney(p.operating_profit_estimated, cur) : "—"} tone={hasCost ? (Number(p.operating_profit_estimated) < 0 ? "danger" : "accent") : undefined}
          sub={hasCost ? `Bruta ${formatMoney(p.gross_profit_estimated, cur)} · markup ${p.markup_estimated ?? "—"}%` : undefined} />
        <Kpi label="Entregado" value={`${Number(p.delivered_pct ?? 0).toFixed(0)}%`} sub={`Venta entregada ${formatMoney(p.sales_delivered_net ?? "0", cur)}`} />
        <Kpi label="Ganancia realizada" value={realized ? formatMoney(p.operating_profit_realized, cur) : "—"} tone={realized ? (Number(p.operating_profit_realized) < 0 ? "danger" : "accent") : undefined}
          sub={realized ? `Margen ${p.operating_margin_realized}% sobre lo entregado` : "sin entregas con costo"} />
      </CardBody>
      <Link href="?tab=facturacion" className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border px-4 py-2.5 text-xs text-fg-muted hover:text-fg sm:px-5">
        <span>Facturado <b className="tabular text-fg">{Number(billing?.invoiced_pct ?? 0).toFixed(0)}%</b></span>
        <span>Cobrado <b className="tabular text-fg">{Number(billing?.collected_pct ?? 0).toFixed(0)}%</b></span>
        <span>Saldo por cobrar <b className="tabular text-fg">{formatMoney(billing?.to_collect ?? 0, cur)}</b></span>
        {Number(billing?.overdue_amount ?? 0) > 0 && <span className="text-danger">Vencido {formatMoney(billing?.overdue_amount, cur)}</span>}
      </Link>
    </Card>
  );
}

export function PurchasesTab({ items, allocations, cur, canWrite }: { items: ItemProfit[]; allocations: AllocationRow[]; cur: string; canWrite: boolean }) {
  const byItem = new Map<string, AllocationRow[]>();
  allocations.forEach((a) => byItem.set(a.purchase_order_item_id, [...(byItem.get(a.purchase_order_item_id) ?? []), a]));
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader title="Costo por renglón" description="Real (compras vinculadas) y estimado para lo que falta comprar. El costo estimado lo cargás vos; se usa hasta que llegue la compra."
          action={canWrite && <div className="flex gap-2"><Button asChild size="sm" variant="secondary"><Link href="/compras/importar"><Upload /> Subir factura</Link></Button><Button asChild size="sm"><Link href="/compras/nueva"><Plus /> Compra</Link></Button></div>} />
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const allocs = byItem.get(it.purchase_order_item_id) ?? [];
            const realUnit = Number(it.purchased_qty) > 0 ? Number(it.purchased_cost) / Number(it.purchased_qty) : null;
            const unitSale = Number(it.unit_price);
            return (
              <li key={it.purchase_order_item_id} className="px-4 py-3 sm:px-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-sm"><span className="text-fg-subtle tabular">R{it.line_number}.{it.option_number}</span> {it.description_original}</p>
                    <p className="text-xs text-fg-subtle tabular">Venta {formatQty(it.quantity)} × {formatMoney(it.unit_price, cur)} · comprado {formatQty(it.purchased_qty)}{realUnit !== null ? ` a ${formatMoney(realUnit.toFixed(2), cur)} prom.` : ""}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <EstimatedCostInput id={it.purchase_order_item_id} value={it.estimated_unit_cost} disabled={!canWrite} />
                    <div className="w-32 text-right">
                      <p className="text-xs text-fg-subtle">Costo renglón</p>
                      <p className="text-sm font-medium tabular">{it.estimated_cost !== null ? formatMoney(it.estimated_cost, cur) : "—"}</p>
                    </div>
                  </div>
                </div>
                {allocs.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {allocs.map((a) => (
                      <Link key={a.id} href={`/compras/${a.purchase_items.purchases.id}`} className={cn("rounded-md border border-border bg-surface-2/60 px-2 py-1 text-xs hover:border-border-strong", a.purchase_items.purchases.status === "anulada" && "line-through opacity-60")}>
                        {a.purchase_items.purchases.suppliers.name} · {formatDate(a.purchase_items.purchases.invoice_date)} · {formatQty(a.quantity)} u × {formatMoney(Number(a.unit_cost).toFixed(2), cur)}
                      </Link>
                    ))}
                  </div>
                )}
                {realUnit !== null && unitSale > 0 && realUnit > unitSale / 1.21 && (
                  <p className="mt-1.5 text-xs text-danger">El costo comprado supera el precio de venta sin IVA.</p>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      {allocations.length === 0 && <Card><EmptyState icon={<ShoppingCart />} title="Sin compras vinculadas" description="Subí la factura del proveedor: sugerimos solos los renglones de esta orden." /></Card>}
    </div>
  );
}

function EstimatedCostInput({ id, value, disabled }: { id: string; value: string | null; disabled: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState(value ? String(Number(value)) : "");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if ((value ? String(Number(value)) : "") === v.trim()) return;
    setBusy(true);
    const r = await setEstimatedCost(id, v);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  };
  return (
    <label className="w-32">
      <span className="text-xs text-fg-subtle">Costo unit. estimado</span>
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
        disabled={disabled || busy} inputMode="decimal" placeholder="sin IVA" className="h-8 text-right tabular" />
    </label>
  );
}

export function CostsTab({ rows, cur, categories, order, canWrite }: { rows: CostAllocRow[]; cur: string; categories: { id: string; name: string; kind: string }[]; order: OrderOption; canWrite: boolean }) {
  const active = rows.filter((r) => r.costs.status === "confirmado");
  const total = active.reduce((a, r) => a + Number(r.amount), 0);
  return (
    <Card>
      <CardHeader title={`Gastos asignados · ${formatMoney(total.toFixed(2), cur)}`} description="Flete, embalaje, comisiones y otros. Los compartidos se reparten con criterio explícito."
        action={canWrite && <CostDialog categories={categories} orders={[order]} defaultOrderId={order.id} trigger={<Button size="sm"><Plus /> Gasto</Button>} />} />
      {!rows.length ? <EmptyState title="Sin gastos" description="Cargá el flete u otros costos para ver la ganancia operativa." /> : (
        <ul className="divide-y divide-border">
          {rows.map((r) => (
            <li key={r.id} className={cn("flex items-center justify-between gap-3 px-4 py-3 text-sm sm:px-5", r.costs.status !== "confirmado" && "opacity-50 line-through")}>
              <div className="min-w-0">
                <p className="truncate">{r.costs.description}</p>
                <p className="text-xs text-fg-subtle">{r.costs.cost_categories.name} · {formatDate(r.costs.cost_date)}{r.costs.allocation_method !== "manual" ? ` · prorrateado ${r.costs.allocation_method === "importe" ? "por importe" : "por unidades"}` : ""}</p>
              </div>
              <span className="shrink-0 font-medium tabular">{formatMoney(r.amount, cur)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="flex items-start gap-1.5 border-t border-border px-4 py-2.5 text-xs text-fg-subtle sm:px-5"><Info className="mt-0.5 size-3.5 shrink-0" />Con IVA recuperable, los gastos se imputan por su neto.</p>
    </Card>
  );
}
