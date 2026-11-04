"use client";
import * as React from "react";
import { Badge, Card, CardBody, CardHeader, Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { simulate } from "@/lib/simulate";
import { cn } from "@/lib/utils";

export type ProductCost = { id: string; name: string; cost: string; date: string };

export function Simulator({ includeVat, vatRate, minMargin, products }: { includeVat: boolean; vatRate: string; minMargin: string; products: ProductCost[] }) {
  const [qty, setQty] = React.useState("100");
  const [price, setPrice] = React.useState("");
  const [cost, setCost] = React.useState("");
  const [freight, setFreight] = React.useState("");
  const [pct, setPct] = React.useState("");
  const [target, setTarget] = React.useState(minMargin);
  const [withVat, setWithVat] = React.useState(includeVat);
  const [product, setProduct] = React.useState("");

  const r = simulate({ qty, price, cost, freight, pct, target, withVat, vatRate });
  const verdict = r.verdict;
  const neg = Number(r.profit) < 0;

  const pick = (id: string) => {
    setProduct(id);
    const pr = products.find((x) => x.id === id);
    if (pr) setCost(pr.cost);
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
      <Card className="self-start">
        <CardHeader title="Datos" />
        <CardBody className="grid grid-cols-2 gap-3">
          <Field label="Cantidad" htmlFor="s-q"><Input id="s-q" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} className="tabular" /></Field>
          <Field label="Precio unitario de venta" htmlFor="s-p"><Input id="s-p" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="tabular" placeholder="0,00" autoFocus /></Field>
          <Field label="El precio" className="col-span-2" htmlFor="s-vat">
            <NativeSelect id="s-vat" value={withVat ? "si" : "no"} onChange={(e) => setWithVat(e.target.value === "si")}>
              <option value="si">Incluye IVA {vatRate}% (como en BAC)</option><option value="no">Es neto de IVA</option>
            </NativeSelect>
          </Field>
          {products.length > 0 && (
            <Field label="Tomar costo de un producto" className="col-span-2" htmlFor="s-prod" hint="Último costo comprado, sin IVA">
              <NativeSelect id="s-prod" value={product} onChange={(e) => pick(e.target.value)}>
                <option value="">Elegí un producto…</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name} · {formatMoney(p.cost)} ({formatDate(p.date)})</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field label="Costo unitario (sin IVA)" className="col-span-2" htmlFor="s-c"><Input id="s-c" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} className="tabular" placeholder="0,00" /></Field>
          <Field label="Flete y gastos (total)" htmlFor="s-f"><Input id="s-f" inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} className="tabular" placeholder="0,00" /></Field>
          <Field label="% sobre venta" htmlFor="s-pct" hint="IIBB, comisiones…"><Input id="s-pct" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} className="tabular" placeholder="0" /></Field>
          <Field label="Margen objetivo %" className="col-span-2" htmlFor="s-t"><Input id="s-t" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} className="tabular" /></Field>
        </CardBody>
      </Card>

      <div className="flex min-w-0 flex-col gap-4">
        <div className={cn("glass flex flex-col gap-1 rounded-2xl p-5", verdict === "loss" && "ring-2 ring-danger/50", verdict === "ok" && "ring-2 ring-accent/40")}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-fg-muted">Ganancia</p>
            {verdict && <Badge tone={verdict === "ok" ? "accent" : verdict === "low" ? "warn" : "danger"}>{verdict === "ok" ? "Conviene" : verdict === "low" ? "Margen bajo" : "Perdés plata"}</Badge>}
          </div>
          <p className={cn("text-3xl font-semibold tracking-tight tabular", neg && "text-danger")}>{r.ready ? formatMoney(r.profit) : "—"}</p>
          <p className="text-sm text-fg-muted">Margen <b className="tabular text-fg">{r.margin ? `${Number(r.margin).toFixed(1)}%` : "—"}</b> · Markup <b className="tabular text-fg">{r.markup ? `${Number(r.markup).toFixed(1)}%` : "—"}</b></p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[
            ["Venta neta", formatMoney(r.sales), withVat ? `Bruto ${formatMoney(r.gross)}` : "Sin IVA"],
            ["Mercadería", formatMoney(r.goods), `${qty || 0} unidades`],
            ["Gastos", formatMoney(r.other), Number(pct) ? `incluye ${pct}% sobre venta` : "Flete y otros"],
            ["Precio mínimo", r.minPrice ? formatMoney(r.minPrice) : "—", `por unidad para ${target || 0}% de margen${withVat ? " (con IVA)" : ""}`],
            ["Precio de equilibrio", r.breakEven ? formatMoney(r.breakEven) : "—", "por unidad: ganancia cero"],
            ["Costo máximo", r.maxCost ? formatMoney(r.maxCost) : "—", `por unidad para ${target || 0}% de margen`],
          ].map(([l, v, sub]) => (
            <div key={l} className="glass min-w-0 rounded-2xl px-4 py-3.5">
              <p className="text-xs text-fg-muted">{l}</p>
              <p className="mt-1 truncate text-lg font-semibold tabular">{v}</p>
              <p className="truncate text-xs text-fg-subtle">{sub}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-fg-subtle">Cálculo exacto con decimales. Margen = ganancia ÷ venta neta. Markup = (venta neta − mercadería) ÷ mercadería, igual que en las órdenes.</p>
      </div>
    </div>
  );
}
