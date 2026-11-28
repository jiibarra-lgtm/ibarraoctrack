"use client";
import * as React from "react";
import { toast } from "sonner";
import { Check, Eye, EyeOff, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { WIDGET_ACCENTS, WIDGET_BADGES, WIDGET_OPEN, WIDGET_THEMES, type WidgetBadge, type WidgetData, type WidgetPrefs } from "@/lib/ml/widget-prefs";
import { saveWidgetPrefs } from "./actions";

type Size = "small" | "medium" | "large";
const DIM: Record<Size, [number, number]> = { small: [170, 170], medium: [364, 170], large: [364, 382] };

function ago(iso: string) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return `hace ${m} min`;
  if (m < 1440) return `hace ${Math.round(m / 60)} h`;
  return `hace ${Math.round(m / 1440)} d`;
}

/** Vista previa fiel del widget de Scriptable (mismo diseño que dibuja el iPhone). */
export function WidgetPreview({ d, p, size }: { d: WidgetData; p: WidgetPrefs; size: Size }) {
  const th = WIDGET_THEMES[p.theme];
  const money = (v: number) => {
    if (p.privacy) return "$ •••";
    if (v >= 1e6) return `$${(v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 })} M`;
    if (v >= 1e4) return `$${Math.round(v / 1e3).toLocaleString("es-AR")} mil`;
    return `$${Math.round(v).toLocaleString("es-AR")}`;
  };
  const vs = d.prev_month_same ? ((d.month.amount - d.prev_month_same) / d.prev_month_same) * 100 : null;
  const badge = (b: WidgetBadge): [string, string, string | null] => {
    switch (b) {
      case "yesterday": return ["Ayer", money(d.yesterday.amount), null];
      case "week": return ["7 días", money(d.week.amount), null];
      case "month": return [`Mes${vs === null || p.privacy ? "" : ` ${vs >= 0 ? "▲" : "▼"}${Math.abs(Math.round(vs))}%`}`, money(d.month.amount), vs === null || p.privacy ? null : vs >= 0 ? "#16a34a" : "#ef4444"];
      case "questions": return ["Preguntas", String(d.questions), d.questions ? "#d97706" : null];
      case "claims": return ["Reclamos", String(d.claims), d.claims ? "#ef4444" : null];
      case "no_stock": return ["Sin stock", `${d.no_stock}/${d.active}`, d.no_stock ? "#ef4444" : null];
    }
  };
  const hero = { today: ["Hoy", d.today], week: ["Últimos 7 días", d.week], month: ["Este mes", d.month] }[p.hero] as [string, { n: number; amount: number }];
  const alerts = [d.questions && `${d.questions} preg.`, d.claims && `${d.claims} recl.`, d.no_stock && `${d.no_stock} sin stock`].filter(Boolean) as string[];
  const vals = d.daily.map((x) => Number(x.amount));
  const max = Math.max(1, ...vals);
  const W = 300, H = size === "large" ? 55 : 32;
  const pts = vals.map((v, i) => [i * (W / Math.max(1, vals.length - 1)), H - 2 - (v / max) * (H - 4)]);
  const line = pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" ");
  const list = p.badges.slice(0, size === "large" ? 6 : 3);
  const [w, h] = DIM[size];

  return (
    <div style={{ width: w, height: h, background: th.bg, color: th.fg, borderRadius: 22, padding: "12px 14px", fontFamily: "-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif", overflow: "hidden", boxShadow: "0 10px 30px rgba(0,0,0,.35)" }} className="flex shrink-0 flex-col">
      <div className="flex items-center" style={{ fontSize: 10 }}>
        <b className="truncate" style={{ color: p.accent }}>{p.title || "MERCADO LIBRE"}</b>
        <span className="ml-auto" style={{ color: th.muted, fontSize: 9 }}>{new Date(d.updated_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}</span>
      </div>
      <div style={{ fontSize: 11, color: th.muted, marginTop: 6 }}>{hero[0]}</div>
      <div className="flex items-baseline gap-1.5">
        <b style={{ fontSize: size === "small" ? 22 : 26, lineHeight: 1.1 }} className="truncate">{money(hero[1].amount)}</b>
        <span style={{ fontSize: 11, color: hero[1].n ? "#16a34a" : th.muted }} className="shrink-0">{hero[1].n} {hero[1].n === 1 ? "venta" : "ventas"}</span>
      </div>
      {size === "small" ? (() => {
        const b = badge(p.badges.find((x) => x !== p.hero) ?? "month");
        return (
          <div style={{ marginTop: 6 }}>
            <b style={{ fontSize: 12 }} className="block truncate">{b[0]} {b[1]}</b>
            <span style={{ fontSize: 10, color: alerts.length ? "#d97706" : th.muted }} className="block truncate">{alerts.join(" · ") || "Todo al día"}</span>
          </div>
        );
      })() : (
        <>
          {p.chart && (
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ marginTop: 6, width: "100%", height: H }} preserveAspectRatio="none">
              <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={p.accent} fillOpacity={0.25} />
              <path d={line} fill="none" stroke={p.accent} strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <div className="grid grid-cols-3 gap-1.5" style={{ marginTop: 6 }}>
            {list.map((b) => {
              const v = badge(b);
              return (
                <div key={b} style={{ background: th.card, borderRadius: 8, padding: "5px 8px" }} className="min-w-0">
                  <div style={{ fontSize: 9, color: th.muted }} className="truncate">{v[0]}</div>
                  <b style={{ fontSize: 14, color: v[2] ?? th.fg }} className="block truncate">{v[1]}</b>
                </div>
              );
            })}
          </div>
          {size === "large" && p.lastSale && d.last_sale && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 10, color: th.muted }}>Última venta · {ago(d.last_sale.at)}</div>
              <b style={{ fontSize: 12 }} className="block truncate">{d.last_sale.title}</b>
              <span style={{ fontSize: 12, color: "#16a34a" }}>{money(d.last_sale.amount)}</span>
            </div>
          )}
          {size !== "large" && !p.chart && !list.some((b) => ["questions", "claims", "no_stock"].includes(b)) && (
            <span style={{ fontSize: 10, color: alerts.length ? "#d97706" : th.muted, marginTop: 4 }} className="block truncate">{alerts.join(" · ") || (d.last_sale ? `Última venta ${ago(d.last_sale.at)}` : "Todo al día")}</span>
          )}
        </>
      )}
    </div>
  );
}

function Seg<T extends string | number>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="flex w-fit flex-wrap rounded-lg bg-field p-0.5">
      {options.map(([v, l]) => <button key={String(v)} type="button" onClick={() => onChange(v)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", value === v ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>{l}</button>)}
    </div>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{label}</p>{children}</div>;
}

export function WidgetDesigner({ data, initial, canEdit }: { data: WidgetData; initial: WidgetPrefs; canEdit: boolean }) {
  const [p, setP] = React.useState(initial);
  const [size, setSize] = React.useState<Size>("medium");
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof WidgetPrefs>(k: K, v: WidgetPrefs[K]) => setP((o) => ({ ...o, [k]: v }));
  const dirty = JSON.stringify(p) !== JSON.stringify(initial);
  const toggleBadge = (b: WidgetBadge) => set("badges", p.badges.includes(b) ? p.badges.filter((x) => x !== b) : [...p.badges, b].slice(0, 6));
  const move = (b: WidgetBadge, dir: -1 | 1) => {
    const i = p.badges.indexOf(b), j = i + dir;
    if (i < 0 || j < 0 || j >= p.badges.length) return;
    const n = [...p.badges]; [n[i], n[j]] = [n[j], n[i]]; set("badges", n);
  };

  return (
    <Card>
      <CardHeader title="Diseño del widget" description="Lo que cambies acá le llega al iPhone en la próxima actualización, sin volver a pegar el script." />
      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_400px]">
        <div className="space-y-5">
          <Row label="Tema">
            <div className="flex flex-wrap gap-2">
              {(Object.keys(WIDGET_THEMES) as (keyof typeof WIDGET_THEMES)[]).map((t) => (
                <button key={t} type="button" onClick={() => set("theme", t)} className={cn("flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", p.theme === t ? "border-fg" : "border-border text-fg-muted hover:text-fg")}>
                  <span className="size-4 rounded border border-white/20" style={{ background: WIDGET_THEMES[t].bg }} />{WIDGET_THEMES[t].label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Color">
            <div className="flex flex-wrap gap-2">
              {WIDGET_ACCENTS.map((c) => (
                <button key={c} type="button" aria-label={c} onClick={() => set("accent", c)} className="grid size-8 place-items-center rounded-full" style={{ background: c, boxShadow: p.accent === c ? "0 0 0 2px var(--bg), 0 0 0 4px var(--fg)" : undefined }}>
                  {p.accent === c && <Check className="size-4 text-black" />}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Título">
            <Input value={p.title} maxLength={24} onChange={(e) => set("title", e.target.value.toUpperCase())} className="max-w-64" placeholder="MERCADO LIBRE" />
          </Row>
          <Row label="Número grande">
            <Seg value={p.hero} onChange={(v) => set("hero", v)} options={[["today", "Hoy"], ["week", "7 días"], ["month", "Mes"]]} />
          </Row>
          <Row label="Cajitas (en orden; mediano muestra 3, grande 6)">
            <div className="space-y-1.5">
              {[...p.badges, ...(Object.keys(WIDGET_BADGES) as WidgetBadge[]).filter((b) => !p.badges.includes(b))].map((b) => {
                const on = p.badges.includes(b), i = p.badges.indexOf(b);
                return (
                  <div key={b} className={cn("flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 text-sm", !on && "opacity-60")}>
                    <GripVertical className="size-3.5 text-fg-subtle" />
                    <button type="button" onClick={() => toggleBadge(b)} className={cn("grid size-4 place-items-center rounded border", on ? "border-fg bg-fg text-bg" : "border-border")}>{on && <Check className="size-3" />}</button>
                    <span className="flex-1">{WIDGET_BADGES[b]}</span>
                    {on && <span className="text-[11px] text-fg-subtle">{i < 3 ? "mediano y grande" : "sólo grande"}</span>}
                    {on && <><button type="button" onClick={() => move(b, -1)} disabled={i === 0} className="px-1 text-fg-subtle hover:text-fg disabled:opacity-30">↑</button><button type="button" onClick={() => move(b, 1)} disabled={i === p.badges.length - 1} className="px-1 text-fg-subtle hover:text-fg disabled:opacity-30">↓</button></>}
                  </div>
                );
              })}
            </div>
          </Row>
          <Row label="Más">
            <div className="space-y-2 text-sm">
              <label className="flex items-center gap-2.5"><input type="checkbox" checked={p.chart} onChange={(e) => set("chart", e.target.checked)} className="size-4 accent-white" />Gráfico de los últimos 7 días</label>
              <label className="flex items-center gap-2.5"><input type="checkbox" checked={p.lastSale} onChange={(e) => set("lastSale", e.target.checked)} className="size-4 accent-white" />Última venta (grande)</label>
              <label className="flex items-center gap-2.5"><input type="checkbox" checked={p.privacy} onChange={(e) => set("privacy", e.target.checked)} className="size-4 accent-white" />{p.privacy ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />} Ocultar los montos (modo privado)</label>
            </div>
          </Row>
          <div className="grid gap-5 sm:grid-cols-2">
            <Row label="Actualizar cada">
              <Seg value={p.refresh} onChange={(v) => set("refresh", v)} options={[[15, "15 min"], [30, "30 min"], [60, "1 hora"]]} />
            </Row>
            <Row label="Al tocarlo abre">
              <Seg value={p.open} onChange={(v) => set("open", v)} options={(Object.keys(WIDGET_OPEN) as (keyof typeof WIDGET_OPEN)[]).map((k) => [k, WIDGET_OPEN[k]] as [keyof typeof WIDGET_OPEN, string])} />
            </Row>
          </div>
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button disabled={!dirty} loading={busy} onClick={async () => { setBusy(true); const r = await saveWidgetPrefs(p); setBusy(false); if (r.ok) toast.success("Diseño guardado: el widget lo toma en la próxima actualización"); else toast.error(r.error); }}>Guardar diseño</Button>
              {dirty && <button type="button" onClick={() => setP(initial)} className="text-sm text-fg-muted hover:text-fg">Descartar cambios</button>}
            </div>
          )}
        </div>

        <div className="space-y-3 lg:sticky lg:top-24 lg:self-start">
          <Seg value={size} onChange={setSize} options={[["small", "Chico"], ["medium", "Mediano"], ["large", "Grande"]]} />
          <div className="grid min-h-[440px] place-items-center overflow-x-auto rounded-2xl p-4" style={{ background: "linear-gradient(160deg,#3b4a6b,#1d2333 55%,#3a2a4a)" }}>
            <WidgetPreview d={data} p={p} size={size} />
          </div>
          <p className="text-center text-[11px] text-fg-subtle">Vista previa con tus datos reales de ahora.</p>
        </div>
      </div>
    </Card>
  );
}
