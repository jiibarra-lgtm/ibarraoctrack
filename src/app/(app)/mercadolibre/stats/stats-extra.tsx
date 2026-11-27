"use client";
import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ExternalLink, PackageX, Tag, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Heat, ItemAgg } from "@/lib/ml/stats";

export type TopRow = ItemAgg & { thumbnail: string | null; permalink: string | null; available: number | null; visits: number | null; hasCost: boolean };
type StockRow = { item_id: string; title: string; available: number; daysLeft: number | null; noCost: boolean };

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function Panel({ title, sub, icon: Icon, children, className }: { title: string; sub?: string; icon?: React.ElementType; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface", className)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        {Icon && <Icon className="size-4 text-fg-subtle" />}
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <span className="ml-auto text-xs text-fg-subtle">{sub}</span>}
      </header>
      {children}
    </section>
  );
}

type SortKey = "sales" | "units" | "profit" | "margin" | "visits" | "cvr";

export function StatsExtra({ top, heat, stock, month, currency, rate }: {
  top: TopRow[]; heat: Heat; stock: StockRow[];
  month: { mtd: number; projected: number; day: number; days: number; label: string };
  currency: "ARS" | "USD"; rate: number | null;
}) {
  const k = currency === "USD" && rate ? 1 / rate : 1;
  const money = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(v * k));
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);

  const [sort, setSort] = React.useState<SortKey>("sales");
  const [desc, setDesc] = React.useState(true);
  const rows = React.useMemo(() => top.map((r) => {
    const profit = r.sales - r.fees - r.cogs;
    return { ...r, profit, margin: r.sales ? (profit / r.sales) * 100 : null, cvr: r.visits ? (r.orders / r.visits) * 100 : null };
  }), [top]);
  const sorted = React.useMemo(() => [...rows].sort((a, b) => {
    const x = (a[sort] ?? -Infinity) as number, y = (b[sort] ?? -Infinity) as number;
    return desc ? y - x : x - y;
  }), [rows, sort, desc]);
  const totalSales = rows.reduce((a, r) => a + r.sales, 0) || 1;

  const maxHeat = Math.max(1, ...heat.flat());
  const best = (() => {
    let bd = 0, bh = 0;
    heat.forEach((row, d) => row.forEach((v, h) => { if (v > heat[bd][bh]) { bd = d; bh = h; } }));
    return heat[bd][bh] ? `${DAYS[bd]} de ${bh} a ${bh + 1} h` : null;
  })();

  const out = stock.filter((s) => s.available <= 0);
  const low = stock.filter((s) => s.available > 0 && s.daysLeft !== null && s.daysLeft < 10).sort((a, b) => (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  const noCost = stock.filter((s) => s.noCost);
  const progress = Math.min(100, (month.day / month.days) * 100);

  const th = (key: SortKey, label: string) => (
    <th key={key} className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
      <button type="button" onClick={() => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(true); } }} className={cn("inline-flex items-center gap-1 hover:text-fg", sort === key && "text-fg")}>
        {label}{sort === key && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      {/* proyección */}
      <Panel title="Proyección del mes" sub={month.label} icon={TrendingUp}>
        <div className="px-4 py-4">
          <p className="text-xs text-fg-muted">Facturado hasta hoy</p>
          <p className="text-2xl font-semibold tabular-nums">{money(month.mtd)}</p>
          <div className="mt-3 h-1.5 overflow-hidden rounded bg-white/[.07]"><div className="h-full bg-[#13a7c9]" style={{ width: `${progress}%` }} /></div>
          <p className="mt-1 text-[11px] text-fg-subtle">Día {month.day} de {month.days}</p>
          <p className="mt-4 text-xs text-fg-muted">Si seguís a este ritmo cerrás el mes en</p>
          <p className="text-xl font-semibold tabular-nums text-[#5fe3a1]">{money(month.projected)}</p>
        </div>
      </Panel>

      {/* para atender */}
      <Panel title="Para atender" icon={PackageX} sub={`${out.length + low.length + noCost.length} avisos`} className="xl:col-span-2">
        <div className="grid gap-px bg-border sm:grid-cols-3">
          {[
            { t: "Sin stock", list: out, f: () => "0 disponibles", tone: "text-[#ff8a8a]" },
            { t: "Se terminan pronto", list: low, f: (s: StockRow) => `${s.available} u. · ${Math.max(1, Math.round(s.daysLeft ?? 0))} días`, tone: "text-[#f5c46b]" },
            { t: "Sin costo cargado", list: noCost, f: () => "ganancia inexacta", tone: "text-fg-muted" },
          ].map((g) => (
            <div key={g.t} className="min-w-0 bg-surface px-4 py-3">
              <p className={cn("text-xs font-medium", g.tone)}>{g.t} <span className="text-fg-subtle">({g.list.length})</span></p>
              <ul className="mt-2 space-y-1.5">
                {g.list.slice(0, 5).map((s) => (
                  <li key={s.item_id} className="min-w-0 text-xs">
                    <Link href={`/mercadolibre/publicaciones/${s.item_id}`} className="block truncate hover:underline">{s.title}</Link>
                    <span className="text-fg-subtle">{g.f(s as StockRow)}</span>
                  </li>
                ))}
                {!g.list.length && <li className="text-xs text-fg-subtle">Nada por ahora.</li>}
                {g.list.length > 5 && <li><Link href={g.t === "Sin costo cargado" ? "/mercadolibre/precios" : "/mercadolibre/publicaciones"} className="text-xs text-fg-muted hover:text-fg">y {g.list.length - 5} más →</Link></li>}
              </ul>
            </div>
          ))}
        </div>
      </Panel>

      {/* publicaciones */}
      <Panel title="Publicaciones que más venden" sub={`${rows.length} con ventas en el período`} icon={Tag} className="xl:col-span-3">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs text-fg-subtle">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">Publicación</th>
                {th("sales", "Facturación")}{th("units", "Unidades")}{th("profit", "Ganancia")}{th("margin", "Margen")}{th("visits", "Visitas")}{th("cvr", "Conversión")}
                <th className="px-4 py-2.5 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 30).map((r) => (
                <tr key={r.item_id} className="border-b border-border/60 hover:bg-white/[.03]">
                  <td className="max-w-[340px] px-4 py-2">
                    <div className="flex items-center gap-2.5">
                      {r.thumbnail ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbnail.replace(/^http:/, "https:")} alt="" className="size-9 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
                      ) : <span className="size-9 shrink-0 rounded-md bg-surface-2" />}
                      <div className="min-w-0">
                        <Link href={`/mercadolibre/publicaciones/${r.item_id}`} className="block truncate hover:underline">{r.title}</Link>
                        <div className="mt-0.5 h-1 w-full max-w-40 overflow-hidden rounded bg-white/[.07]"><div className="h-full bg-[#13a7c9]" style={{ width: `${(r.sales / totalSales) * 100}%` }} /></div>
                      </div>
                      {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" aria-label="Ver en Mercado Libre" className="ml-auto shrink-0 text-fg-subtle hover:text-fg"><ExternalLink className="size-3.5" /></a>}
                    </div>
                  </td>
                  <td className="px-3 text-right tabular-nums">{money(r.sales)}</td>
                  <td className="px-3 text-right tabular-nums">{r.units.toLocaleString("es-AR")}</td>
                  <td className={cn("px-3 text-right tabular-nums", r.profit < 0 && "text-[#ff8a8a]")}>{money(r.profit)}{!r.hasCost && <span title="Sin costo cargado" className="ml-1 text-[#f5c46b]">*</span>}</td>
                  <td className="px-3 text-right tabular-nums">{pct(r.margin)}</td>
                  <td className="px-3 text-right tabular-nums">{r.visits?.toLocaleString("es-AR") ?? "—"}</td>
                  <td className="px-3 text-right tabular-nums">{pct(r.cvr)}</td>
                  <td className={cn("px-4 text-right tabular-nums", r.available === 0 && "text-[#ff8a8a]")}>{r.available ?? "—"}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-fg-subtle">No hubo ventas en el período.</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.some((r) => !r.hasCost) && <p className="px-4 py-2 text-[11px] text-fg-subtle">* sin costo cargado: la ganancia sale más alta de lo real.</p>}
      </Panel>

      {/* mapa de calor */}
      <Panel title="Cuándo te compran" sub={best ? `Mejor momento: ${best}` : undefined} className="xl:col-span-3">
        <div className="overflow-x-auto px-4 py-4">
          <div className="grid min-w-[640px] grid-cols-[36px_repeat(24,minmax(0,1fr))] gap-[3px] text-[10px] text-fg-subtle">
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center">{h % 3 === 0 ? h : ""}</span>)}
            {[1, 2, 3, 4, 5, 6, 0].map((d) => (
              <React.Fragment key={d}>
                <span className="self-center">{DAYS[d]}</span>
                {heat[d].map((v, h) => (
                  <span key={h} title={`${DAYS[d]} ${h}:00 – ${v} ${v === 1 ? "venta" : "ventas"}`} className="h-5 rounded-[3px] sm:h-6"
                    style={{ background: v ? `rgb(19 167 201 / ${0.15 + 0.85 * (v / maxHeat)})` : "rgb(255 255 255 / 0.04)" }} />
                ))}
              </React.Fragment>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-fg-subtle">Cantidad de ventas por día y hora en el período elegido. Sirve para programar ofertas y publicidad.</p>
        </div>
      </Panel>
    </div>
  );
}
