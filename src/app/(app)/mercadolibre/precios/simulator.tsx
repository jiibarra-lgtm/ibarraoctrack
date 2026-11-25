"use client";
import * as React from "react";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { netPerUnit, priceForMargin } from "@/lib/ml/logic";

const num = (s: string) => { const n = Number(parseArNumber(s) ?? NaN); return Number.isFinite(n) ? n : 0; };

/** Simulador de precio: qué te queda con Clásica vs Premium, envío, cuotas e IIBB, y qué precio poner para un margen. */
export function PriceSimulator({ iibb }: { iibb: number }) {
  const [price, setPrice] = React.useState("10000");
  const [cost, setCost] = React.useState("5000");
  const [ship, setShip] = React.useState("0");
  const [clasica, setClasica] = React.useState("14");
  const [premium, setPremium] = React.useState("28");
  const [ib, setIb] = React.useState(String(iibb));
  const [margin, setMargin] = React.useState("25");
  const p = num(price), c = num(cost), s = num(ship);
  const rows = [
    { name: "Clásica", fee: num(clasica) },
    { name: "Premium (cuotas sin interés)", fee: num(premium) },
  ].map((r) => ({ ...r, n: netPerUnit({ price: p, fee: (p * r.fee) / 100, ship: s, cost: c, iibbPct: num(ib) }), target: priceForMargin(c, num(margin), r.fee, s, num(ib)) }));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Precio final" htmlFor="s-p"><Input id="s-p" value={price} onChange={(e) => setPrice(e.target.value)} className="tabular" /></Field>
        <Field label="Costo (sin IVA)" htmlFor="s-c"><Input id="s-c" value={cost} onChange={(e) => setCost(e.target.value)} className="tabular" /></Field>
        <Field label="Envío gratis que pagás" htmlFor="s-s"><Input id="s-s" value={ship} onChange={(e) => setShip(e.target.value)} className="tabular" /></Field>
        <Field label="IIBB %" htmlFor="s-i"><Input id="s-i" value={ib} onChange={(e) => setIb(e.target.value)} className="tabular" /></Field>
        <Field label="Comisión Clásica %" htmlFor="s-cl"><Input id="s-cl" value={clasica} onChange={(e) => setClasica(e.target.value)} className="tabular" /></Field>
        <Field label="Comisión Premium %" htmlFor="s-pr"><Input id="s-pr" value={premium} onChange={(e) => setPremium(e.target.value)} className="tabular" /></Field>
        <Field label="Margen buscado %" htmlFor="s-m"><NativeSelect id="s-m" value={margin} onChange={(e) => setMargin(e.target.value)}>{[10, 15, 20, 25, 30, 40, 50].map((m) => <option key={m}>{m}</option>)}</NativeSelect></Field>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead className="text-left text-xs text-fg-subtle"><tr><th className="py-1">Tipo</th><th className="text-right">Comisión</th><th className="text-right">IIBB</th><th className="text-right">Te queda</th><th className="text-right">Margen</th><th className="text-right">Precio para {margin} %</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name} className="border-t border-border">
                <td className="py-1.5">{r.name}</td><td className="text-right tabular">{formatMoney(r.n.fee)}</td><td className="text-right tabular">{formatMoney(r.n.iibb)}</td>
                <td className={`text-right font-semibold tabular ${(r.n.net ?? 0) < 0 ? "text-danger" : ""}`}>{formatMoney(r.n.net)}</td><td className="text-right tabular">{r.n.margin ?? "—"} %</td>
                <td className="text-right tabular">{r.target ? formatMoney(Math.ceil(r.target)) : "imposible"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-fg-subtle">La comisión real depende de la categoría (la ves por publicación). Premium cobra más pero ofrece cuotas sin interés y suele vender más.</p>
    </div>
  );
}
