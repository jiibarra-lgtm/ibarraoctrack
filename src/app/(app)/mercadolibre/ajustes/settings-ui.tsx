"use client";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { extraCost, type LabelPrefs, type ProfitRules } from "@/lib/ml/prefs";
import { saveLabelPrefs, saveProfitRules } from "./actions";

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex w-fit flex-wrap rounded-lg bg-field p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", value === v ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>{l}</button>
      ))}
    </div>
  );
}
function Check({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-white" />
      <span><span className="block text-sm">{label}</span>{hint && <span className="block text-xs text-fg-subtle">{hint}</span>}</span>
    </label>
  );
}
function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-t border-border py-3 first:border-0 first:pt-0 sm:grid-cols-[220px_1fr] sm:items-center">
      <div><p className="text-sm font-medium">{label}</p>{hint && <p className="text-xs text-fg-subtle">{hint}</p>}</div>
      <div>{children}</div>
    </div>
  );
}
function Num({ value, onChange, suffix, prefix }: { value: number; onChange: (v: number) => void; suffix?: string; prefix?: string }) {
  const [t, setT] = React.useState(String(value).replace(".", ","));
  return (
    <div className="relative w-40">
      {prefix && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{prefix}</span>}
      <Input value={t} inputMode="decimal" className={cn("h-9 tabular", prefix && "pl-6", suffix && "pr-8")}
        onChange={(e) => { setT(e.target.value); const n = Number(e.target.value.replace(/\./g, "").replace(",", ".")); onChange(Number.isFinite(n) && n >= 0 ? n : 0); }} />
      {suffix && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">{suffix}</span>}
    </div>
  );
}

export function LabelSettings({ initial, canEdit }: { initial: LabelPrefs; canEdit: boolean }) {
  const [p, setP] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof LabelPrefs>(k: K, v: LabelPrefs[K]) => setP({ ...p, [k]: v });
  const go = async () => { setBusy(true); const r = await saveLabelPrefs(p); setBusy(false); if (r.ok) toast.success("Etiquetas guardadas"); else toast.error(r.error); };
  return (
    <Card id="etiquetas">
      <CardHeader title="Etiquetas" description="Qué imprime el botón «Etiquetas» (Resumen y Stats) cuando lo tocás." />
      <CardBody>
        <Row label="Qué ventas" hint="Siempre sólo las listas para despachar (sin Full).">
          <Seg value={p.scope} onChange={(v) => set("scope", v)} options={[["pendientes", "Todo lo pendiente"], ["hoy", "Sólo ventas de hoy"]]} />
        </Row>
        <Row label="Tipos de envío">
          <div className="space-y-2">
            <Check checked={p.flex} onChange={(v) => set("flex", v)} label="Flex" hint="Envíos que entregás vos" />
            <Check checked={p.colecta} onChange={(v) => set("colecta", v)} label="Colecta y correo" hint="Los que retira Mercado Libre o llevás a un punto" />
          </div>
        </Row>
        <Row label="Reimpresiones">
          <Check checked={p.onlyNew} onChange={(v) => set("onlyNew", v)} label="Sólo las que todavía no imprimí" hint="Si lo destildás, vuelve a traer las ya impresas" />
        </Row>
        <Row label="Formato">
          <Seg value={p.format} onChange={(v) => set("format", v)} options={[["pdf", "PDF (impresora común)"], ["zpl", "Zebra (térmica)"]]} />
        </Row>
        {canEdit && <div className="pt-3"><Button onClick={go} loading={busy}>Guardar</Button></div>}
      </CardBody>
    </Card>
  );
}

const money = (n: number) => new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(n);

export function ProfitSettings({ initial, canEdit }: { initial: ProfitRules; canEdit: boolean }) {
  const [r, setR] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof ProfitRules>(k: K, v: ProfitRules[K]) => setR({ ...r, [k]: v });
  const go = async () => { setBusy(true); const x = await saveProfitRules(r); setBusy(false); if (x.ok) toast.success("Reglas guardadas: Stats ya calcula con estos números"); else toast.error(x.error); };
  // ejemplo: venta de $100.000, 2 unidades, comisión 14 %
  const ex = { total: 100000, units: 2, fee: 14000, cost: 50000, ship: r.shipMode === "ninguno" ? 0 : r.shipMode === "fijo" ? r.shipFixed : 6500 };
  const extra = extraCost(r, ex.total, ex.units);
  const gain = ex.total - ex.fee - ex.cost - ex.ship - extra;
  return (
    <Card id="rentabilidad">
      <CardHeader title="Reglas de rentabilidad" description="Cómo se calcula la ganancia real de cada venta y publicación en Stats: con tus costos, no con un promedio." />
      <CardBody>
        <Row label="Envío a tu cargo" hint="Lo que pagás vos cuando el envío es gratis para el comprador">
          <div className="flex flex-wrap items-center gap-3">
            <Seg value={r.shipMode} onChange={(v) => set("shipMode", v)} options={[["estimado", "Según la publicación"], ["fijo", "Monto fijo"], ["ninguno", "No descontar"]]} />
            {r.shipMode === "fijo" && <Num value={r.shipFixed} onChange={(v) => set("shipFixed", v)} prefix="$" />}
          </div>
        </Row>
        <Row label="Costo de cobro" hint="Si tenés un cargo aparte por cobrar (además de la comisión de ML)"><Num value={r.paymentPct} onChange={(v) => set("paymentPct", v)} suffix="%" /></Row>
        <Row label="Impuestos sobre la venta" hint="Ingresos brutos, débitos y créditos, retenciones…"><Num value={r.taxesPct} onChange={(v) => set("taxesPct", v)} suffix="%" /></Row>
        <Row label="Costo fijo por venta" hint="Embalaje, etiqueta, traslado…"><Num value={r.perSale} onChange={(v) => set("perSale", v)} prefix="$" /></Row>
        <Row label="Costo fijo por unidad" hint="Bolsa, caja o lo que lleve cada unidad"><Num value={r.perUnit} onChange={(v) => set("perUnit", v)} prefix="$" /></Row>
        <Row label="Publicidad">
          <Check checked={r.adsInProfit} onChange={(v) => set("adsInProfit", v)} label="Descontar la publicidad en la ganancia" hint="Product Ads del período" />
        </Row>
        <div className="mt-2 rounded-lg border border-border bg-field/40 px-4 py-3 text-xs">
          <p className="mb-1.5 font-medium text-fg-muted">Ejemplo: venta de {money(ex.total)} (2 unidades, costo {money(ex.cost)})</p>
          <div className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-0.5 tabular">
            <span className="text-fg-subtle">Comisión de ML (ej. 14 %)</span><span>−{money(ex.fee)}</span>
            <span className="text-fg-subtle">Costo de los productos</span><span>−{money(ex.cost)}</span>
            <span className="text-fg-subtle">Envío a tu cargo{r.shipMode === "estimado" ? " (ej.)" : ""}</span><span>−{money(ex.ship)}</span>
            <span className="text-fg-subtle">Costos adicionales</span><span>−{money(extra)}</span>
            <span className="border-t border-border pt-1 font-semibold">Ganancia</span><span className={cn("border-t border-border pt-1 font-semibold", gain < 0 ? "text-danger" : "text-accent")}>{money(gain)}</span>
          </div>
        </div>
        {canEdit && <div className="pt-4"><Button onClick={go} loading={busy}>Guardar reglas</Button></div>}
      </CardBody>
    </Card>
  );
}
