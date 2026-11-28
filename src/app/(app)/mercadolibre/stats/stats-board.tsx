"use client";
import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { CalendarDays, Check, ChevronDown, Info, LineChart, Megaphone, RefreshCw, Search, SlidersHorizontal, Store, Table2, Eye, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DayBase } from "@/lib/ml/stats";

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
type Kind = "money" | "int" | "pct" | "x";
type Src = "ventas" | "ads" | "visitas";
type Metric = { key: string; label: string; info: string; kind: Kind; src: Src; lowerIsBetter?: boolean; f: (b: DayBase) => number | null };

const div = (a: number, b: number) => (b ? a / b : null);
const profit = (b: DayBase) => b.sales - b.fees - b.cogs - b.ship - b.extra - b.adProfit;

const METRICS: Metric[] = [
  { key: "adCost", label: "Inversión publicitaria", src: "ads", kind: "money", info: "Lo que gastaste en Product Ads (publicidad de Mercado Libre) en el período.", f: (b) => b.adCost },
  { key: "sales", label: "Facturación", src: "ventas", kind: "money", info: "Total de las ventas no canceladas, con envío incluido si lo pagó el comprador.", f: (b) => b.sales },
  { key: "profit", label: "Ganancia", src: "ventas", kind: "money", info: "Facturación − comisiones de ML − costo de la mercadería − envíos a tu cargo − costos adicionales (cobro, impuestos, embalaje) − publicidad. Las reglas se configuran en Ajustes.", f: profit },
  { key: "roas", label: "ROAS", src: "ads", kind: "x", info: "Ventas atribuidas a la publicidad ÷ inversión publicitaria. Cuántos pesos vendés por cada peso de publicidad.", f: (b) => div(b.adRevenue, b.adCost) },
  { key: "troas", label: "True ROAS", src: "ads", kind: "x", info: "Facturación total ÷ inversión publicitaria. Incluye también las ventas orgánicas.", f: (b) => div(b.sales, b.adCost) },
  { key: "cpa", label: "CPA", src: "ads", kind: "money", lowerIsBetter: true, info: "Costo por venta: inversión publicitaria ÷ cantidad de órdenes.", f: (b) => div(b.adCost, b.orders) },
  { key: "orders", label: "Órdenes", src: "ventas", kind: "int", info: "Ventas concretadas (sin canceladas).", f: (b) => b.orders },
  { key: "units", label: "Unidades vendidas", src: "ventas", kind: "int", info: "Unidades de producto vendidas.", f: (b) => b.units },
  { key: "ticket", label: "Ticket promedio", src: "ventas", kind: "money", info: "Facturación ÷ órdenes.", f: (b) => div(b.sales, b.orders) },
  { key: "margin", label: "Margen", src: "ventas", kind: "pct", info: "Ganancia ÷ facturación.", f: (b) => { const v = div(profit(b), b.sales); return v === null ? null : v * 100; } },
  { key: "fees", label: "Comisiones ML", src: "ventas", kind: "money", lowerIsBetter: true, info: "Cargo por venta que cobra Mercado Libre.", f: (b) => b.fees },
  { key: "ship", label: "Envíos a tu cargo", src: "ventas", kind: "money", lowerIsBetter: true, info: "Estimado: el costo de envío gratis de cada publicación, una vez por venta.", f: (b) => b.ship },
  { key: "extra", label: "Costos adicionales", src: "ventas", kind: "money", lowerIsBetter: true, info: "Costo de cobro, impuestos sobre la venta y costos fijos por venta o unidad, según tus reglas de Ajustes.", f: (b) => b.extra },
  { key: "cogs", label: "Costo de mercadería", src: "ventas", kind: "money", lowerIsBetter: true, info: "Costo unitario cargado en Precios × unidades vendidas.", f: (b) => b.cogs },
  { key: "acos", label: "ACOS", src: "ads", kind: "pct", lowerIsBetter: true, info: "Inversión ÷ ventas por publicidad. Qué parte de lo vendido con publicidad se fue en publicidad.", f: (b) => { const v = div(b.adCost, b.adRevenue); return v === null ? null : v * 100; } },
  { key: "tacos", label: "TACOS", src: "ads", kind: "pct", lowerIsBetter: true, info: "Inversión ÷ facturación total.", f: (b) => { const v = div(b.adCost, b.sales); return v === null ? null : v * 100; } },
  { key: "adRevenue", label: "Ventas por publicidad", src: "ads", kind: "money", info: "Ventas que Mercado Libre atribuye a los anuncios (directas e indirectas).", f: (b) => b.adRevenue },
  { key: "clicks", label: "Clics", src: "ads", kind: "int", info: "Clics en los anuncios.", f: (b) => b.clicks },
  { key: "cpc", label: "CPC", src: "ads", kind: "money", lowerIsBetter: true, info: "Costo por clic.", f: (b) => div(b.adCost, b.clicks) },
  { key: "ctr", label: "CTR", src: "ads", kind: "pct", info: "Clics ÷ impresiones de los anuncios.", f: (b) => { const v = div(b.clicks, b.prints); return v === null ? null : v * 100; } },
  { key: "visits", label: "Visitas", src: "visitas", kind: "int", info: "Visitas a todas tus publicaciones.", f: (b) => b.visits },
  { key: "cvr", label: "Conversión", src: "visitas", kind: "pct", info: "Órdenes ÷ visitas.", f: (b) => { const v = div(b.orders, b.visits); return v === null ? null : v * 100; } },
  { key: "cancelled", label: "Canceladas", src: "ventas", kind: "int", lowerIsBetter: true, info: "Órdenes canceladas.", f: (b) => b.cancelled },
];
const DEFAULT = ["adCost", "sales", "profit", "roas", "troas", "cpa", "orders", "ticket", "margin", "acos", "visits", "cvr"];
const MONEY_KEYS: (keyof DayBase)[] = ["sales", "fees", "cogs", "ship", "extra", "adProfit", "adCost", "adRevenue"];

const sum = (days: DayBase[]): DayBase => days.reduce((a, d) => {
  for (const k of Object.keys(d) as (keyof DayBase)[]) if (k !== "date") (a[k] as number) += d[k] as number;
  return a;
}, { date: "", sales: 0, orders: 0, units: 0, fees: 0, cogs: 0, noCost: 0, cancelled: 0, ship: 0, extra: 0, adProfit: 0, adCost: 0, adRevenue: 0, adUnits: 0, clicks: 0, prints: 0, visits: 0 });

// ---------------------------------------------------------------------------
// Preferencias del tablero (sólo en este navegador)
// ---------------------------------------------------------------------------
const PREF_KEY = "ml-stats-cards";
const listeners = new Set<() => void>();
function readPref() { try { return localStorage.getItem(PREF_KEY); } catch { return null; } }
function writePref(v: string[]) { try { localStorage.setItem(PREF_KEY, JSON.stringify(v)); } catch { /* sin almacenamiento */ } listeners.forEach((l) => l()); }
function usePrefs(): [string[], (v: string[]) => void] {
  const raw = React.useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, readPref, () => null);
  const list = React.useMemo(() => {
    try { const v = raw ? (JSON.parse(raw) as string[]).filter((k) => METRICS.some((m) => m.key === k)) : null; return v?.length ? v : DEFAULT; } catch { return DEFAULT; }
  }, [raw]);
  return [list, writePref];
}

// ---------------------------------------------------------------------------
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "UTC" }).replace(".", "");
const fmtRange = (a: string, b: string) => {
  const y = (d: string) => d.slice(0, 4);
  return `${fmtDay(a)}${y(a) !== y(b) ? ` ${y(a)}` : ""} – ${fmtDay(b)} ${y(b)}`;
};

export function StatsBoard({ start, end, today, prevLabel, days, prevDays, adsError, visitsOk, error, currency, rate }: {
  start: string; end: string; today: string; prevLabel: string; days: DayBase[]; prevDays: DayBase[];
  adsError: string | null; visitsOk: boolean; error: string | null; currency: "ARS" | "USD"; rate: number | null;
}) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start_] = React.useTransition();
  const [view, setView] = React.useState<"chart" | "table">("chart");
  const [q, setQ] = React.useState("");
  const [cards, setCards] = usePrefs();
  const [panel, setPanel] = React.useState<null | "date" | "cur" | "cfg">(null);

  const go = (p: { start?: string; end?: string; cur?: string }) => {
    const s = new URLSearchParams({ start: p.start ?? start, end: p.end ?? end, ...((p.cur ?? currency) !== "ARS" ? { cur: p.cur ?? currency } : {}) });
    setPanel(null);
    start_(() => router.push(`${path}?${s}`));
  };

  // pesos → moneda elegida
  const conv = React.useCallback((d: DayBase): DayBase => {
    if (currency !== "USD" || !rate) return d;
    const x = { ...d };
    for (const k of MONEY_KEYS) (x[k] as number) = (d[k] as number) / rate;
    return x;
  }, [currency, rate]);
  const cd = React.useMemo(() => days.map(conv), [days, conv]);
  const total = React.useMemo(() => sum(cd), [cd]);
  const prevTotal = React.useMemo(() => sum(prevDays.map(conv)), [prevDays, conv]);

  const fmt = React.useCallback((v: number | null, kind: Kind, compact = false) => {
    if (v === null || !Number.isFinite(v)) return "—";
    if (kind === "money") return new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: compact || Math.abs(v) >= 1000 ? 0 : 2, notation: compact && Math.abs(v) >= 1e6 ? "compact" : "standard" }).format(v);
    if (kind === "pct") return `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })} %`;
    if (kind === "x") return `${v.toLocaleString("es-AR", { maximumFractionDigits: 2 })}x`;
    return Math.round(v).toLocaleString("es-AR");
  }, [currency]);

  const shown = cards.map((k) => METRICS.find((m) => m.key === k)!).filter((m) => m && (!q || m.label.toLowerCase().includes(q.toLowerCase())));
  const missingCost = total.noCost > 0;

  return (
    <div className="-mx-1 sm:mx-0">
      <div className="overflow-hidden rounded-xl border border-white/[.08] bg-surface text-[#e9ecef] shadow-[0_20px_60px_-30px_rgba(0,0,0,.8)]">
        {/* barra superior */}
        <div className="flex flex-wrap items-center gap-3 border-b border-white/[.06] px-4 py-3 sm:px-5">
          <h1 className="text-[17px] font-semibold tracking-tight">Stats</h1>
          <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-white/[.06] px-3 text-sm text-white/50 sm:max-w-56">
            <Search className="size-4 shrink-0" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar métrica" className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-white/40" />
          </label>
          <button type="button" onClick={() => start_(() => router.refresh())} aria-label="Actualizar" className="ml-auto grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/[.06] hover:text-white">
            <RefreshCw className={cn("size-4", pending && "animate-spin")} />
          </button>
        </div>

        {/* controles */}
        <div className="relative flex flex-wrap items-center justify-end gap-2 px-4 py-3 sm:px-5">
          <div className="flex rounded-lg bg-white/[.06] p-0.5">
            {([["chart", LineChart, "Gráficos"], ["table", Table2, "Tabla"]] as const).map(([k, Icon, l]) => (
              <button key={k} type="button" aria-label={l} onClick={() => setView(k)} className={cn("grid size-8 place-items-center rounded-md", view === k ? "bg-white text-black" : "text-white/60 hover:text-white")}><Icon className="size-4" /></button>
            ))}
          </div>
          <button type="button" onClick={() => setPanel(panel === "date" ? null : "date")} className="flex h-9 items-center gap-2 rounded-lg bg-white/[.06] px-3 text-sm hover:bg-white/10">
            <CalendarDays className="size-4 text-white/70" /> {fmtRange(start, end)}
          </button>
          <button type="button" onClick={() => setPanel(panel === "cur" ? null : "cur")} className="flex h-9 items-center gap-2 rounded-lg bg-white/[.06] px-3 text-sm hover:bg-white/10">
            {currency} <ChevronDown className="size-4 text-white/60" />
          </button>
          <button type="button" aria-label="Elegir métricas" onClick={() => setPanel(panel === "cfg" ? null : "cfg")} className={cn("grid size-9 place-items-center rounded-lg bg-white/[.06] hover:bg-white/10", panel === "cfg" && "bg-white/15")}>
            <SlidersHorizontal className="size-4" />
          </button>

          {panel === "date" && <DatePanel start={start} end={end} today={today} onPick={(a, b) => go({ start: a, end: b })} onClose={() => setPanel(null)} />}
          {panel === "cur" && (
            <Pop onClose={() => setPanel(null)} className="w-56">
              {(["ARS", "USD"] as const).map((c) => (
                <button key={c} type="button" disabled={c === "USD" && !rate} onClick={() => go({ cur: c })} className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm hover:bg-white/[.06] disabled:opacity-40">
                  <span>{c === "ARS" ? "Pesos (ARS)" : "Dólares (USD)"}</span>{currency === c && <Check className="size-4" />}
                </button>
              ))}
              <p className="px-3 pb-1 pt-2 text-[11px] text-white/45">{rate ? `Dólar oficial venta: $${rate.toLocaleString("es-AR")}` : "No se pudo leer la cotización del dólar."}</p>
            </Pop>
          )}
          {panel === "cfg" && (
            <Pop onClose={() => setPanel(null)} className="max-h-[60vh] w-72 overflow-y-auto">
              <p className="px-3 pb-2 pt-1 text-xs text-white/50">Elegí qué tarjetas ver. Se guarda en este navegador.</p>
              {METRICS.map((m) => {
                const on = cards.includes(m.key);
                return (
                  <button key={m.key} type="button" onClick={() => setCards(on ? cards.filter((k) => k !== m.key) : [...cards, m.key])} className="flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm hover:bg-white/[.06]">
                    <span className={cn("grid size-4 place-items-center rounded border", on ? "border-white bg-white text-black" : "border-white/30")}>{on && <Check className="size-3" />}</span>
                    <span className="flex-1">{m.label}</span><SrcIcon src={m.src} />
                  </button>
                );
              })}
              <button type="button" onClick={() => setCards(DEFAULT)} className="mt-1 w-full rounded-md px-3 py-2 text-left text-xs text-white/60 hover:bg-white/[.06]">Volver a las de siempre</button>
            </Pop>
          )}
        </div>

        {(error || adsError || !visitsOk || missingCost) && (
          <div className="space-y-1 px-4 pb-3 text-xs sm:px-5">
            {error && <p className="text-[#ff8a8a]">No se pudieron leer las ventas: {error}</p>}
            {adsError && <p className="text-white/50">Publicidad: {adsError} Las métricas de Ads quedan en cero.</p>}
            {!visitsOk && <p className="text-white/50">No se pudieron leer las visitas.</p>}
            {missingCost && <p className="text-[#f5c46b]">{total.noCost} unidades vendidas no tienen costo cargado (Precios). La ganancia sale más alta de lo real.</p>}
          </div>
        )}

        {/* contenido */}
        <div className={cn("px-4 pb-4 sm:px-5 sm:pb-5 transition-opacity", pending && "opacity-50")}>
          {view === "chart" ? (
            <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/[.07] lg:grid-cols-3 [&>*]:border-b [&>*]:border-r [&>*]:border-white/[.07]">
              {shown.map((m) => {
                const v = m.f(total), p = prevDays.length ? m.f(prevTotal) : null;
                const delta = v !== null && p !== null && p !== 0 ? ((v - p) / Math.abs(p)) * 100 : null;
                const good = delta === null ? null : m.lowerIsBetter ? delta <= 0 : delta >= 0;
                return (
                  <div key={m.key} className="min-w-0 px-3 pb-2 pt-3 sm:px-4 sm:pb-3 sm:pt-4">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs text-white/60 sm:text-sm">{m.label}</span>
                      <span title={m.info} className="cursor-help text-white/40"><Info className="size-3.5" /></span>
                      <span className="ml-auto"><SrcIcon src={m.src} /></span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
                      <span className="text-lg font-semibold sm:text-[22px] tabular-nums tracking-tight text-white">{fmt(v, m.kind)}</span>
                      {delta !== null && Number.isFinite(delta) && (
                        <span title={`Período anterior (${prevLabel}): ${fmt(p, m.kind)}`} className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums", good ? "bg-[#1f3d2e] text-[#5fe3a1]" : "bg-[#3d1f22] text-[#ff8a8a]")}>
                          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toLocaleString("es-AR", { maximumFractionDigits: 1 })} %
                        </span>
                      )}
                    </div>
                    <Spark id={m.key} data={cd.map((d) => ({ date: d.date, v: m.f(d) }))} format={(n) => fmt(n, m.kind)} color="#0e9fc2" />
                  </div>
                );
              })}
              {!shown.length && <p className="col-span-full px-4 py-10 text-center text-sm text-white/50">No hay métricas que coincidan.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/[.07]">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="text-left text-xs text-white/50">
                  <tr className="border-b border-white/[.07]"><th className="sticky left-0 bg-surface px-4 py-2.5 font-medium">Día</th>{shown.map((m) => <th key={m.key} className="whitespace-nowrap px-3 text-right font-medium">{m.label}</th>)}</tr>
                </thead>
                <tbody>
                  {[...cd].reverse().map((d) => (
                    <tr key={d.date} className="border-b border-white/[.05] hover:bg-white/[.03]">
                      <td className="sticky left-0 whitespace-nowrap bg-surface px-4 py-2 text-white/70">{fmtDay(d.date)}</td>
                      {shown.map((m) => <td key={m.key} className="whitespace-nowrap px-3 text-right tabular-nums">{fmt(m.f(d), m.kind)}</td>)}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold"><td className="sticky left-0 bg-surface px-4 py-2.5">Total</td>{shown.map((m) => <td key={m.key} className="whitespace-nowrap px-3 text-right tabular-nums">{fmt(m.f(total), m.kind)}</td>)}</tr>
                  {prevDays.length > 0 && <tr className="text-white/50"><td className="sticky left-0 bg-surface px-4 pb-3 text-xs">Período anterior</td>{shown.map((m) => <td key={m.key} className="whitespace-nowrap px-3 pb-3 text-right text-xs tabular-nums">{fmt(m.f(prevTotal), m.kind)}</td>)}</tr>}
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 px-1 text-xs text-fg-subtle">Ventas y publicidad leídas en vivo de Mercado Libre. El % compara con el período anterior de la misma cantidad de días ({prevLabel}).</p>
    </div>
  );
}

function SrcIcon({ src }: { src: Src }) {
  const map = { ventas: [Store, "Ventas de Mercado Libre", "text-[#ffe14d]"], ads: [Megaphone, "Mercado Ads", "text-[#e2a93b]"], visitas: [Eye, "Visitas", "text-[#9b8cff]"] } as const;
  const [Icon, t, c] = map[src];
  return <span title={t}><Icon className={cn("size-4", c)} /></span>;
}

function Spark({ id, data, format, color }: { id: string; data: { date: string; v: number | null }[]; format: (n: number) => string; color: string }) {
  const gid = `g-${id}`;
  return (
    <div className="mt-3 h-16 w-full sm:h-[84px]" style={{ filter: `drop-shadow(0 6px 14px ${color}55)` }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.55} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin", "auto"]} />
          <Tooltip
            cursor={{ stroke: "rgba(255,255,255,.25)" }}
            contentStyle={{ background: "#16191d", border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, fontSize: 12, color: "#fff" }}
            labelFormatter={(_, p) => (p?.[0]?.payload?.date ? fmtDay(p[0].payload.date as string) : "")}
            formatter={(v) => [v === null || v === undefined ? "—" : format(Number(v)), ""]}
            separator=""
          />
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={2} fill={`url(#${gid})`} connectNulls isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Pop({ children, onClose, className }: { children: React.ReactNode; onClose: () => void; className?: string }) {
  React.useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <>
      <button type="button" aria-label="Cerrar" className="fixed inset-0 z-30 cursor-default" onClick={onClose} />
      <div className={cn("absolute right-4 top-full z-40 mt-1 rounded-xl border border-white/10 bg-[#16191d] p-1.5 text-white shadow-2xl sm:right-5", className)}>{children}</div>
    </>
  );
}

function DatePanel({ start, end, today, onPick, onClose }: { start: string; end: string; today: string; onPick: (a: string, b: string) => void; onClose: () => void }) {
  const [a, setA] = React.useState(start), [b, setB] = React.useState(end);
  const back = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);
  const m0 = `${today.slice(0, 7)}-01`;
  const pm = new Date(Date.parse(`${m0}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
  const presets: [string, string, string][] = [
    ["Hoy", today, today], ["Ayer", back(1), back(1)], ["Últimos 7 días", back(6), today], ["Últimos 14 días", back(13), today],
    ["Últimos 30 días", back(29), today], ["Últimos 90 días", back(89), today], ["Este mes", m0, today], ["Mes pasado", `${pm.slice(0, 7)}-01`, pm],
  ];
  return (
    <Pop onClose={onClose} className="w-[min(92vw,420px)]">
      <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
        <div className="flex flex-row flex-wrap gap-1 sm:flex-col">
          {presets.map(([l, x, y]) => (
            <button key={l} type="button" onClick={() => onPick(x, y)} className={cn("rounded-md px-3 py-1.5 text-left text-sm hover:bg-white/[.06]", x === start && y === end && "bg-white/10")}>{l}</button>
          ))}
        </div>
        <div className="space-y-2 p-2">
          <label className="block text-xs text-white/50">Desde<input type="date" value={a} max={today} onChange={(e) => setA(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-white/10 bg-white/[.06] px-2 text-sm text-white [color-scheme:dark]" /></label>
          <label className="block text-xs text-white/50">Hasta<input type="date" value={b} max={today} onChange={(e) => setB(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-white/10 bg-white/[.06] px-2 text-sm text-white [color-scheme:dark]" /></label>
          <div className="flex gap-2 pt-1">
            <button type="button" disabled={!a || !b} onClick={() => onPick(a, b)} className="h-9 flex-1 rounded-md bg-white text-sm font-medium text-black disabled:opacity-40">Aplicar</button>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="grid size-9 place-items-center rounded-md bg-white/[.06]"><X className="size-4" /></button>
          </div>
          <p className="text-[11px] text-white/40">Máximo 180 días.</p>
        </div>
      </div>
    </Pop>
  );
}
