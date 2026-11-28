"use client";
import * as React from "react";
import Link from "next/link";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowDown, ArrowUp, Download, ExternalLink, Maximize2, PackageX, Receipt, Search, ShoppingCart, Tag, TrendingUp, Wallet, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Heat, ItemAgg, SaleRow } from "@/lib/ml/stats";

export type TopRow = ItemAgg & { thumbnail: string | null; permalink: string | null; available: number | null; visits: number | null; hasCost: boolean };
type StockRow = { item_id: string; title: string; available: number; daysLeft: number | null; noCost: boolean };
export type CostTotals = { sales: number; cogs: number; fees: number; ship: number; extra: number; ads: number; noCost: number };

const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const LINE_COLORS = ["#13a7c9", "#5fe3a1", "#e879f9", "#f5c46b", "#ff8a8a"];
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });

/** Descarga un CSV (se abre con Excel). */
function downloadCsv(name: string, rows: (string | number | null)[][]) {
  const esc = (v: string | number | null) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const blob = new Blob(["﻿" + rows.map((r) => r.map(esc).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function Panel({ title, sub, icon: Icon, children, className, actions }: { title: string; sub?: React.ReactNode; icon?: React.ElementType; children: React.ReactNode; className?: string; actions?: React.ReactNode }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface", className)}>
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {Icon && <Icon className="size-4 text-fg-subtle" />}
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <span className="text-xs text-fg-subtle">{sub}</span>}
        {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

const btn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-2.5 text-xs text-fg-muted hover:text-fg";

type SortKey = "sales" | "units" | "orders" | "cogs" | "profit" | "margin" | "visits" | "cvr" | "clients";
type Alert = "ok" | "sin_costo" | "perdida" | "cancelada";
const ALERT: Record<Alert, { label: string; tone: string }> = {
  ok: { label: "Todo bien", tone: "bg-[#5fe3a1]/15 text-[#5fe3a1]" },
  sin_costo: { label: "Sin costo", tone: "bg-[#f5c46b]/15 text-[#f5c46b]" },
  perdida: { label: "Pérdida", tone: "bg-[#ff8a8a]/15 text-[#ff8a8a]" },
  cancelada: { label: "Cancelada", tone: "bg-white/[.06] text-fg-muted" },
};
const saleProfit = (s: SaleRow) => (s.status === "cancelled" || s.cogs === null ? null : s.total - s.fees - s.cogs - s.ship - s.extra);
const saleAlerts = (s: SaleRow): Alert[] => {
  if (s.status === "cancelled") return ["cancelada"];
  const a: Alert[] = [];
  if (s.cogs === null) a.push("sin_costo");
  const p = saleProfit(s);
  if (p !== null && p < 0) a.push("perdida");
  return a.length ? a : ["ok"];
};

export function StatsExtra({ top, heat, stock, month, currency, rate, dates, sales, costs, costsPrev }: {
  top: TopRow[]; heat: Heat; stock: StockRow[];
  month: { mtd: number; projected: number; day: number; days: number; label: string };
  currency: "ARS" | "USD"; rate: number | null; dates: string[]; sales: SaleRow[]; costs: CostTotals; costsPrev: CostTotals | null;
}) {
  const k = currency === "USD" && rate ? 1 / rate : 1;
  const money = React.useCallback((v: number | null) => (v === null || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(v * k)), [currency, k]);
  const pct = (v: number | null) => (v === null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`);

  // ---------------- publicaciones ----------------
  const [sort, setSort] = React.useState<SortKey>("sales");
  const [desc, setDesc] = React.useState(true);
  const [pq, setPq] = React.useState("");
  const rows = React.useMemo(() => top.map((r) => {
    const profit = r.sales - r.fees - r.cogs - r.ship - r.extra;
    return { ...r, profit, margin: r.sales ? (profit / r.sales) * 100 : null, cvr: r.visits ? (r.orders / r.visits) * 100 : null };
  }), [top]);
  const sorted = React.useMemo(() => [...rows]
    .filter((r) => !pq || `${r.title} ${r.item_id}`.toLowerCase().includes(pq.toLowerCase()))
    .sort((a, b) => {
      const x = (a[sort] ?? -Infinity) as number, y = (b[sort] ?? -Infinity) as number;
      return desc ? y - x : x - y;
    }), [rows, sort, desc, pq]);
  const [picked, setPicked] = React.useState<string[] | null>(null);
  const sel = picked ?? rows.slice(0, 3).map((r) => r.item_id);
  const toggle = (id: string) => setPicked(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id].slice(-5));
  const [mode, setMode] = React.useState<"daily" | "total">("daily");
  const [measure, setMeasure] = React.useState<"sales" | "units">("sales");
  const chart = React.useMemo(() => {
    const chosen = rows.filter((r) => sel.includes(r.item_id));
    const acc = new Map(chosen.map((r) => [r.item_id, 0]));
    return dates.map((d, i) => {
      const point: Record<string, number | string> = { date: d };
      for (const r of chosen) {
        const v = r.daily[i]?.[measure] ?? 0;
        const val = measure === "sales" ? v * k : v;
        acc.set(r.item_id, (acc.get(r.item_id) ?? 0) + val);
        point[r.item_id] = mode === "total" ? acc.get(r.item_id)! : val;
      }
      return point;
    });
  }, [rows, sel, dates, measure, mode, k]);
  const chosenRows = rows.filter((r) => sel.includes(r.item_id));

  // ---------------- ventas ----------------
  const [sq, setSq] = React.useState("");
  const [alertF, setAlertF] = React.useState<Alert | "all">("all");
  const [open, setOpen] = React.useState<SaleRow | null>(null);
  const salesF = sales.filter((s) => (!sq || `${s.id} ${s.pack ?? ""} ${s.buyer ?? ""} ${s.items.map((i) => i.title).join(" ")}`.toLowerCase().includes(sq.toLowerCase()))
    && (alertF === "all" || saleAlerts(s).includes(alertF)));
  const alertCount = (a: Alert) => sales.filter((s) => saleAlerts(s).includes(a)).length;

  // ---------------- heat / stock / mes ----------------
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

  // ---------------- costos ----------------
  const profitT = costs.sales - costs.cogs - costs.fees - costs.ship - costs.extra - costs.ads;
  const profitP = costsPrev ? costsPrev.sales - costsPrev.cogs - costsPrev.fees - costsPrev.ship - costsPrev.extra - costsPrev.ads : null;
  const costCards = [
    { k: "cogs", label: "Costo de productos", v: costs.cogs, p: costsPrev?.cogs ?? null, color: "#e879f9", note: costs.noCost ? `${costs.noCost} u. sin costo cargado` : null },
    { k: "fees", label: "Comisiones de ML", v: costs.fees, p: costsPrev?.fees ?? null, color: "#f5c46b", note: null },
    { k: "ship", label: "Envíos a tu cargo", v: costs.ship, p: costsPrev?.ship ?? null, color: "#9b8cff", note: "estimado" },
    { k: "extra", label: "Costos adicionales", v: costs.extra, p: costsPrev?.extra ?? null, color: "#a1a1aa", note: "según tus reglas" },
    { k: "ads", label: "Publicidad", v: costs.ads, p: costsPrev?.ads ?? null, color: "#13a7c9", note: null },
  ];
  const base = Math.max(costs.sales, 1);

  const th = (key: SortKey, label: string) => (
    <th key={key} className="whitespace-nowrap px-3 py-2.5 text-right font-medium">
      <button type="button" onClick={() => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(true); } }} className={cn("inline-flex items-center gap-1 hover:text-fg", sort === key && "text-fg")}>
        {label}{sort === key && (desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />)}
      </button>
    </th>
  );
  const delta = (v: number, p: number | null, lowerBetter = true) => {
    if (p === null || !p) return null;
    const d = ((v - p) / Math.abs(p)) * 100;
    const good = lowerBetter ? d <= 0 : d >= 0;
    return <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", good ? "bg-[#1f3d2e] text-[#5fe3a1]" : "bg-[#3d1f22] text-[#ff8a8a]")}>{d >= 0 ? "▲" : "▼"} {Math.abs(d).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %</span>;
  };

  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-3">
      {/* costos */}
      <Panel title="Costos" icon={Wallet} sub="a dónde va cada peso que facturás" className="xl:col-span-3"
        actions={<Link href="/mercadolibre/ajustes" className={btn}>Configurar reglas</Link>}>
        <div className="grid grid-cols-2 gap-px bg-border lg:grid-cols-6">
          {costCards.map((c) => (
            <div key={c.k} className="min-w-0 bg-surface px-4 py-3">
              <p className="truncate text-xs text-fg-muted">{c.label}</p>
              <div className="mt-1 flex flex-wrap items-baseline gap-2"><span className="text-lg font-semibold tabular-nums">{money(c.v)}</span>{delta(c.v, c.p)}</div>
              <p className="mt-0.5 text-[11px] text-fg-subtle">{pct((c.v / base) * 100)} de la facturación{c.note ? ` · ${c.note}` : ""}</p>
            </div>
          ))}
          <div className="min-w-0 bg-surface px-4 py-3">
            <p className="text-xs text-fg-muted">Ganancia</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-2"><span className={cn("text-lg font-semibold tabular-nums", profitT < 0 ? "text-[#ff8a8a]" : "text-[#5fe3a1]")}>{money(profitT)}</span>{delta(profitT, profitP, false)}</div>
            <p className="mt-0.5 text-[11px] text-fg-subtle">{pct((profitT / base) * 100)} de margen</p>
          </div>
        </div>
        <div className="px-4 py-3">
          <div className="flex h-3 overflow-hidden rounded">
            {costCards.map((c) => <div key={c.k} title={`${c.label}: ${money(c.v)}`} style={{ width: `${Math.max(0, (c.v / base) * 100)}%`, background: c.color }} />)}
            {profitT > 0 && <div title={`Ganancia: ${money(profitT)}`} style={{ width: `${(profitT / base) * 100}%` }} className="bg-[#5fe3a1]" />}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-fg-subtle">
            {costCards.map((c) => <span key={c.k} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm" style={{ background: c.color }} />{c.label}</span>)}
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#5fe3a1]" />Ganancia</span>
          </div>
        </div>
      </Panel>

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

      {/* análisis de productos */}
      <Panel title="Análisis de productos" sub={`${rows.length} con ventas en el período`} icon={Tag} className="xl:col-span-3"
        actions={<>
          <div className="flex rounded-lg bg-white/[.06] p-0.5 text-xs">
            {([["sales", "Facturación"], ["units", "Unidades"]] as const).map(([m, l]) => <button key={m} type="button" onClick={() => setMeasure(m)} className={cn("rounded-md px-2.5 py-1", measure === m ? "bg-white text-black" : "text-fg-muted hover:text-fg")}>{l}</button>)}
          </div>
          <div className="flex rounded-lg bg-white/[.06] p-0.5 text-xs">
            {([["daily", "Diario"], ["total", "Acumulado"]] as const).map(([m, l]) => <button key={m} type="button" onClick={() => setMode(m)} className={cn("rounded-md px-2.5 py-1", mode === m ? "bg-white text-black" : "text-fg-muted hover:text-fg")}>{l}</button>)}
          </div>
        </>}>
        <div className="h-64 px-2 pt-4">
          {chosenRows.length ? (
            <ResponsiveContainer>
              <AreaChart data={chart} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
                <defs>{chosenRows.map((r, i) => (
                  <linearGradient key={r.item_id} id={`pa-${i}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LINE_COLORS[i]} stopOpacity={0.35} /><stop offset="100%" stopColor={LINE_COLORS[i]} stopOpacity={0} /></linearGradient>
                ))}</defs>
                <CartesianGrid stroke="rgba(255,255,255,.05)" vertical={false} />
                <XAxis dataKey="date" tickFormatter={fmtDay} tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
                <YAxis tick={{ fill: "#71717a", fontSize: 11 }} axisLine={false} tickLine={false} width={64}
                  tickFormatter={(v) => (measure === "sales" ? new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 }).format(Number(v)) : String(v))} />
                <Tooltip contentStyle={{ background: "#16191d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 12, color: "#fff" }}
                  labelFormatter={(l) => fmtDay(String(l))}
                  formatter={(v, name) => [measure === "sales" ? new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(v)) : `${v} u.`, rows.find((r) => r.item_id === name)?.title.slice(0, 40) ?? String(name)]} />
                {chosenRows.map((r, i) => <Area key={r.item_id} type="monotone" dataKey={r.item_id} stroke={LINE_COLORS[i]} strokeWidth={2} fill={`url(#pa-${i})`} isAnimationActive={false} />)}
              </AreaChart>
            </ResponsiveContainer>
          ) : <p className="grid h-full place-items-center text-sm text-fg-subtle">Marcá publicaciones en la tabla para compararlas.</p>}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 pb-3 pt-1 text-[11px] text-fg-muted">
          {chosenRows.map((r, i) => <span key={r.item_id} className="inline-flex max-w-xs items-center gap-1.5 truncate"><span className="size-2 shrink-0 rounded-sm" style={{ background: LINE_COLORS[i] }} />{r.title}</span>)}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2.5">
          <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/[.06] px-2.5 text-xs text-fg-subtle sm:max-w-72">
            <Search className="size-3.5 shrink-0" />
            <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="Buscar por nombre o ID" className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle" />
          </label>
          <button type="button" className={cn(btn, "ml-auto")} onClick={() => downloadCsv(`productos-ml.csv`, [
            ["ID", "Publicación", "Unidades", "Órdenes", "Facturación", "Costo producto", "Comisiones", "Envíos (est.)", "Ganancia", "Margen %", "Visitas", "Conversión %", "Clientes", "Stock"],
            ...sorted.map((r) => [r.item_id, r.title, r.units, r.orders, Math.round(r.sales), Math.round(r.cogs), Math.round(r.fees), Math.round(r.ship), Math.round(r.profit), r.margin === null ? null : Math.round(r.margin * 10) / 10, r.visits, r.cvr === null ? null : Math.round(r.cvr * 100) / 100, r.clients, r.available]),
          ])}><Download className="size-3.5" /> Exportar Excel</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="text-left text-xs text-fg-subtle">
              <tr className="border-y border-border">
                <th className="w-10 px-4 py-2.5" />
                <th className="px-1 py-2.5 font-medium">Publicación</th>
                {th("units", "Unidades")}{th("orders", "Órdenes")}{th("sales", "Facturación")}{th("cogs", "Costo producto")}{th("profit", "Ganancia")}{th("margin", "Margen")}{th("visits", "Visitas")}{th("cvr", "Conversión")}{th("clients", "Clientes")}
                <th className="px-4 py-2.5 text-right font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 50).map((r) => {
                const ci = sel.indexOf(r.item_id);
                return (
                  <tr key={r.item_id} className="border-b border-border/60 hover:bg-white/[.03]">
                    <td className="px-4">
                      <button type="button" aria-label="Comparar en el gráfico" onClick={() => toggle(r.item_id)}
                        className={cn("grid size-4 place-items-center rounded border", ci >= 0 ? "border-transparent" : "border-white/30")} style={ci >= 0 ? { background: LINE_COLORS[ci] } : undefined}>
                        {ci >= 0 && <span className="text-[10px] font-bold leading-none text-black">✓</span>}
                      </button>
                    </td>
                    <td className="max-w-[320px] px-1 py-2">
                      <div className="flex items-center gap-2.5">
                        {r.thumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.thumbnail.replace(/^http:/, "https:")} alt="" className="size-9 shrink-0 rounded-md bg-white object-contain" loading="lazy" />
                        ) : <span className="size-9 shrink-0 rounded-md bg-surface-2" />}
                        <div className="min-w-0">
                          <Link href={`/mercadolibre/publicaciones/${r.item_id}`} className="block truncate hover:underline">{r.title}</Link>
                          <span className="text-[11px] text-fg-subtle">{r.item_id}</span>
                        </div>
                        {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" aria-label="Ver en Mercado Libre" className="ml-auto shrink-0 text-fg-subtle hover:text-fg"><ExternalLink className="size-3.5" /></a>}
                      </div>
                    </td>
                    <td className="px-3 text-right tabular-nums">{r.units.toLocaleString("es-AR")}</td>
                    <td className="px-3 text-right tabular-nums">{r.orders.toLocaleString("es-AR")}</td>
                    <td className="px-3 text-right tabular-nums">{money(r.sales)}</td>
                    <td className="px-3 text-right tabular-nums">{r.hasCost ? money(r.cogs) : <span className="text-[#f5c46b]">sin costo</span>}</td>
                    <td className={cn("px-3 text-right tabular-nums", r.profit < 0 && "text-[#ff8a8a]")}>{money(r.profit)}{!r.hasCost && <span title="Sin costo cargado" className="ml-1 text-[#f5c46b]">*</span>}</td>
                    <td className="px-3 text-right tabular-nums">{pct(r.margin)}</td>
                    <td className="px-3 text-right tabular-nums">{r.visits?.toLocaleString("es-AR") ?? "—"}</td>
                    <td className="px-3 text-right tabular-nums">{pct(r.cvr)}</td>
                    <td className="px-3 text-right tabular-nums">{r.clients.toLocaleString("es-AR")}</td>
                    <td className={cn("px-4 text-right tabular-nums", r.available === 0 && "text-[#ff8a8a]")}>{r.available ?? "—"}</td>
                  </tr>
                );
              })}
              {!sorted.length && <tr><td colSpan={12} className="px-4 py-8 text-center text-sm text-fg-subtle">{rows.length ? "Nada coincide con la búsqueda." : "No hubo ventas en el período."}</td></tr>}
            </tbody>
          </table>
        </div>
        {rows.some((r) => !r.hasCost) && <p className="px-4 py-2 text-[11px] text-fg-subtle">* sin costo cargado: la ganancia sale más alta de lo real. La ganancia descuenta comisiones, costo y envíos estimados (la publicidad está en Costos).</p>}
      </Panel>

      {/* últimas ventas */}
      <Panel title="Últimas ventas" icon={ShoppingCart} sub={`${sales.length} en el período`} className="xl:col-span-3">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setAlertF("all")} className={cn("rounded-md px-2 py-1 text-[11px] font-medium", alertF === "all" ? "bg-white text-black" : "bg-white/[.06] text-fg-muted hover:text-fg")}>Todas · {sales.length}</button>
            {(Object.keys(ALERT) as Alert[]).map((a) => (
              <button key={a} type="button" onClick={() => setAlertF(a)} className={cn("rounded-md px-2 py-1 text-[11px] font-medium", ALERT[a].tone, alertF === a && "ring-1 ring-white/60")}>{ALERT[a].label} · {alertCount(a)}</button>
            ))}
          </div>
          <label className="ml-auto flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/[.06] px-2.5 text-xs text-fg-subtle sm:max-w-64">
            <Search className="size-3.5 shrink-0" />
            <input value={sq} onChange={(e) => setSq(e.target.value)} placeholder="N° de orden, comprador o producto" className="min-w-0 flex-1 bg-transparent text-fg outline-none placeholder:text-fg-subtle" />
          </label>
          <button type="button" className={btn} onClick={() => downloadCsv("ventas-ml.csv", [
            ["Orden", "Pack", "Fecha", "Estado", "Comprador", "Productos", "Total", "Comisión ML", "Envío (est.)", "Costo", "Ganancia", "Alertas"],
            ...salesF.map((s) => [String(s.id), s.pack ? String(s.pack) : null, fmtDateTime(s.date), s.status === "cancelled" ? "Cancelada" : "Pagada", s.buyer, s.items.map((i) => `${i.qty} x ${i.title}`).join(" | "), Math.round(s.total), Math.round(s.fees), Math.round(s.ship), s.cogs === null ? null : Math.round(s.cogs), saleProfit(s) === null ? null : Math.round(saleProfit(s)!), saleAlerts(s).map((a) => ALERT[a].label).join(", ")]),
          ])}><Download className="size-3.5" /> Exportar</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="text-left text-xs text-fg-subtle">
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 font-medium">Orden</th><th className="px-3 font-medium">Estado</th><th className="px-3 font-medium">Alertas</th><th className="px-3 font-medium">Productos</th>
                <th className="px-3 text-right font-medium">Total</th><th className="px-3 text-right font-medium">Neto</th><th className="px-4 text-right font-medium">Ganancia</th>
              </tr>
            </thead>
            <tbody>
              {salesF.slice(0, 100).map((s) => {
                const p = saleProfit(s);
                return (
                  <tr key={s.id} onClick={() => setOpen(s)} className="cursor-pointer border-b border-border/60 hover:bg-white/[.04]">
                    <td className="whitespace-nowrap px-4 py-2.5"><span className="inline-flex items-center gap-2"><Maximize2 className="size-3 text-fg-subtle" /><span className="font-medium tabular-nums">#{String(s.id).slice(-6)}</span></span><span className="block pl-5 text-[11px] text-fg-subtle">{fmtDateTime(s.date)}</span></td>
                    <td className="px-3"><span className="inline-flex items-center gap-1.5 text-xs"><span className={cn("size-1.5 rounded-full", s.status === "cancelled" ? "bg-[#ff8a8a]" : "bg-[#5fe3a1]")} />{s.status === "cancelled" ? "Cancelada" : "Pagada"}</span></td>
                    <td className="px-3"><span className="flex flex-wrap gap-1">{saleAlerts(s).map((a) => <span key={a} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", ALERT[a].tone)}>{ALERT[a].label}</span>)}</span></td>
                    <td className="max-w-[280px] truncate px-3 text-xs text-fg-muted">{s.items.map((i) => `${i.qty}× ${i.title}`).join(" · ")}</td>
                    <td className="px-3 text-right tabular-nums">{money(s.total)}</td>
                    <td className="px-3 text-right tabular-nums">{money(s.total - s.fees - s.ship - s.extra)}</td>
                    <td className={cn("px-4 text-right tabular-nums", p !== null && p < 0 && "text-[#ff8a8a]")}>{money(p)}</td>
                  </tr>
                );
              })}
              {!salesF.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-fg-subtle">No hay ventas con este filtro.</td></tr>}
            </tbody>
          </table>
        </div>
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

      {open && <SaleDrawer s={open} onClose={() => setOpen(null)} money={money} />}
    </div>
  );
}

/** Panel lateral con el detalle de una venta. */
function SaleDrawer({ s, onClose, money }: { s: SaleRow; onClose: () => void; money: (v: number | null) => string }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const p = saleProfit(s);
  const row = (l: string, v: React.ReactNode, tone?: string) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm"><span className="text-fg-muted">{l}</span><span className={cn("tabular-nums", tone)}>{v}</span></div>
  );
  return (
    <>
      <button type="button" aria-label="Cerrar" onClick={onClose} className="fixed inset-0 z-40 cursor-default bg-black/50" />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-border bg-surface pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl">
        <header className="sticky top-0 flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
          <Receipt className="size-4 text-fg-subtle" />
          <h3 className="text-sm font-semibold">Orden #{s.id}</h3>
          <a href={`https://www.mercadolibre.com.ar/ventas/${s.pack ?? s.id}/detalle`} target="_blank" rel="noreferrer" aria-label="Ver en Mercado Libre" className="ml-auto text-fg-subtle hover:text-fg"><ExternalLink className="size-4" /></a>
          <button type="button" aria-label="Cerrar" onClick={onClose} className="text-fg-subtle hover:text-fg"><X className="size-4" /></button>
        </header>
        <div className="space-y-5 px-4 py-4">
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Resumen</h4>
            {row("Estado", <span className={cn("rounded px-1.5 py-0.5 text-xs", s.status === "cancelled" ? "bg-[#ff8a8a]/15 text-[#ff8a8a]" : "bg-[#5fe3a1]/15 text-[#5fe3a1]")}>{s.status === "cancelled" ? "Cancelada" : "Pagada"}</span>)}
            {row("Fecha", fmtDateTime(s.date))}
            {s.buyer && row("Comprador", s.buyer)}
            {s.payment && row("Pago", `${s.payment.replace("_", " ")}${s.installments && s.installments > 1 ? ` · ${s.installments} cuotas` : ""}`)}
            {s.pack && row("Carrito", `#${s.pack}`)}
            {row("Alertas", <span className="flex flex-wrap justify-end gap-1">{saleAlerts(s).map((a) => <span key={a} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", ALERT[a].tone)}>{ALERT[a].label}</span>)}</span>)}
          </section>
          <section>
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Productos · {s.items.length}</h4>
            <div className="space-y-2">
              {s.items.map((i) => (
                <div key={i.item_id} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex items-start gap-2">
                    <Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">{i.title}</Link>
                    {i.cost === null && <span className="shrink-0 rounded bg-[#f5c46b]/15 px-1.5 py-0.5 text-[11px] text-[#f5c46b]">Sin costo</span>}
                  </div>
                  <p className="text-[11px] text-fg-subtle">{i.item_id}</p>
                  {row("Cantidad", i.qty)}
                  {row("Precio unitario", money(i.unit))}
                  {row("Costo unitario", i.cost === null ? <Link href="/mercadolibre/precios" className="text-[#f5c46b] hover:underline">cargar costo</Link> : money(i.cost))}
                  {row("Subtotal", money(i.unit * i.qty))}
                </div>
              ))}
            </div>
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-fg-subtle">Detalle de precio</h4>
            {row("Total", money(s.total))}
            {row("Comisión de ML", `−${money(s.fees)}`, "text-[#ff8a8a]")}
            {row("Envío a tu cargo", s.ship ? `−${money(s.ship)}` : money(0), s.ship ? "text-[#ff8a8a]" : undefined)}
            {s.extra > 0 && row("Costos adicionales", `−${money(s.extra)}`, "text-[#ff8a8a]")}
            {row("Neto", money(s.total - s.fees - s.ship - s.extra))}
            {row("Costo de los productos", s.cogs === null ? "falta cargar" : `−${money(s.cogs)}`, s.cogs === null ? "text-[#f5c46b]" : "text-[#ff8a8a]")}
            <div className="mt-1 border-t border-border pt-1">{row("Ganancia", money(p), cn("font-semibold", p === null ? "" : p < 0 ? "text-[#ff8a8a]" : "text-[#5fe3a1]"))}</div>
          </section>
        </div>
      </aside>
    </>
  );
}
