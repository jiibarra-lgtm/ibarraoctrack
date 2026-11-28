/**
 * Script para la app Scriptable (iPhone): widget con el resumen de Mercado Libre. Tamaños chico, mediano y grande.
 * El diseño (tema, color, qué muestra) viene del sistema en cada actualización: se cambia desde
 * Mercado Libre → Widget iPhone sin volver a pegar el script.
 */
export function scriptableWidget(url: string, key: string) {
  const base = url.replace(/\/api\/widget\/ml$/, "");
  return `// Ibarra OC Track · Mercado Libre (widget para Scriptable)
// Pegalo en Scriptable y agregá un widget de Scriptable en la pantalla de inicio eligiendo este script.
// El diseño se cambia desde el sistema (Mercado Libre → Widget iPhone): no hace falta volver a pegarlo.
const URL = ${JSON.stringify(url)};
const KEY = ${JSON.stringify(key)};
const BASE = ${JSON.stringify(base)};

const THEMES = {
  negro: ["#0b0b0c", "#141416", "#ffffff", "#a1a1aa"], grafito: ["#1c1c1e", "#2c2c2f", "#ffffff", "#a1a1aa"],
  claro: ["#ffffff", "#f1f1f4", "#0b0b0c", "#6b6b73"], amarillo: ["#ffe600", "#f5d800", "#2d3277", "#4b4f8a"],
};
const OPEN = { stats: "/mercadolibre/stats", ventas: "/mercadolibre/ventas", panel: "/mercadolibre/panel", preguntas: "/mercadolibre/preguntas" };
const GREEN = new Color("#16a34a"), RED = new Color("#ef4444"), AMBER = new Color("#d97706");

let P = {};
function money(v) {
  if (P.privacy) return "$ •••";
  v = Number(v || 0);
  if (v >= 1e6) return "$" + (v / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " M";
  if (v >= 1e4) return "$" + Math.round(v / 1e3).toLocaleString("es-AR") + " mil";
  return "$" + Math.round(v).toLocaleString("es-AR");
}
function ago(iso) {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 60) return "hace " + m + " min";
  if (m < 1440) return "hace " + Math.round(m / 60) + " h";
  return "hace " + Math.round(m / 1440) + " d";
}

async function load() {
  const r = new Request(URL); r.headers = { "x-widget-key": KEY }; r.timeoutInterval = 20;
  return await r.loadJSON();
}

const size = config.widgetFamily || "medium";
const w = new ListWidget();
w.setPadding(12, 14, 12, 14);

try {
  const d = await load();
  if (d.error) throw new Error(d.error);
  P = d.prefs || {};
  const th = THEMES[P.theme] || THEMES.negro;
  const BG = new Color(th[0]), CARD = new Color(th[1]), FG = new Color(th[2]), MUTED = new Color(th[3]);
  const ACC = new Color(P.accent || "#13a7c9");
  w.backgroundColor = BG;
  w.url = BASE + (OPEN[P.open] || OPEN.stats);
  w.refreshAfterDate = new Date(Date.now() + (P.refresh || 15) * 60 * 1000);

  const text = (stack, s, sz, color, bold) => {
    const t = stack.addText(String(s));
    t.font = bold ? Font.boldSystemFont(sz) : Font.systemFont(sz);
    t.textColor = color || FG; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
    return t;
  };
  const spark = (values, wd, h) => {
    const ctx = new DrawContext(); ctx.size = new Size(wd, h); ctx.opaque = false; ctx.respectScreenScale = true;
    const max = Math.max(1, ...values), step = wd / Math.max(1, values.length - 1);
    const pts = values.map((v, i) => new Point(i * step, h - 4 - (v / max) * (h - 8)));
    const area = new Path(); area.move(new Point(0, h)); pts.forEach((p) => area.addLine(p)); area.addLine(new Point(wd, h)); area.closeSubpath();
    ctx.addPath(area); ctx.setFillColor(new Color(P.accent || "#13a7c9", 0.25)); ctx.fillPath();
    const line = new Path(); line.move(pts[0]); pts.slice(1).forEach((p) => line.addLine(p));
    ctx.addPath(line); ctx.setStrokeColor(ACC); ctx.setLineWidth(2.5); ctx.strokePath();
    return ctx.getImage();
  };
  const badge = (stack, label, value, color) => {
    const b = stack.addStack(); b.layoutVertically(); b.backgroundColor = CARD; b.cornerRadius = 8; b.setPadding(5, 8, 5, 8);
    text(b, label, 9, MUTED); text(b, value, 14, color || FG, true);
  };
  const vs = d.prev_month_same ? (d.month.amount - d.prev_month_same) / d.prev_month_same * 100 : null;
  const BADGES = {
    yesterday: () => ["Ayer", money(d.yesterday.amount)],
    week: () => ["7 días", money(d.week.amount)],
    month: () => ["Mes" + (vs === null || P.privacy ? "" : (vs >= 0 ? " ▲" : " ▼") + Math.abs(Math.round(vs)) + "%"), money(d.month.amount), vs === null || P.privacy ? null : vs >= 0 ? GREEN : RED],
    questions: () => ["Preguntas", String(d.questions), d.questions ? AMBER : null],
    claims: () => ["Reclamos", String(d.claims), d.claims ? RED : null],
    no_stock: () => ["Sin stock", d.no_stock + "/" + d.active, d.no_stock ? RED : null],
  };
  const HERO = { today: ["Hoy", d.today], week: ["Últimos 7 días", d.week], month: ["Este mes", d.month] };
  const badges = (P.badges || ["yesterday", "week", "month"]).filter((b) => BADGES[b]);

  const head = w.addStack(); head.centerAlignContent();
  text(head, P.title || "MERCADO LIBRE", 10, ACC, true); head.addSpacer();
  text(head, new Date(d.updated_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }), 9, MUTED);
  w.addSpacer(6);

  const hero = HERO[P.hero] || HERO.today;
  text(w, hero[0], 11, MUTED);
  const big = w.addStack(); big.bottomAlignContent();
  text(big, money(hero[1].amount), size === "small" ? 22 : 26, FG, true); big.addSpacer(6);
  text(big, hero[1].n + (hero[1].n === 1 ? " venta" : " ventas"), 11, hero[1].n ? GREEN : MUTED);

  const alerts = [];
  if (d.questions) alerts.push(d.questions + " preg.");
  if (d.claims) alerts.push(d.claims + " recl.");
  if (d.no_stock) alerts.push(d.no_stock + " sin stock");

  if (size === "small") {
    w.addSpacer(6);
    const b = badges.find((x) => x !== P.hero) || "month";
    const v = BADGES[b]();
    text(w, v[0] + " " + v[1], 12, FG, true);
    text(w, alerts.join(" · ") || "Todo al día", 10, alerts.length ? AMBER : MUTED);
  } else {
    if (P.chart !== false) {
      w.addSpacer(6);
      const img = w.addImage(spark(d.daily.map((x) => Number(x.amount)), 600, size === "large" ? 110 : 70));
      img.resizable = true; img.imageSize = new Size(size === "large" ? 300 : 290, size === "large" ? 55 : 32);
    }
    w.addSpacer(6);
    const max = size === "large" ? 6 : 3;
    const list = badges.slice(0, max);
    for (let i = 0; i < list.length; i += 3) {
      if (i) w.addSpacer(6);
      const row = w.addStack(); row.spacing = 6;
      for (const b of list.slice(i, i + 3)) { const v = BADGES[b](); badge(row, v[0], v[1], v[2]); }
    }
    if (size === "large" && P.lastSale !== false && d.last_sale) {
      w.addSpacer(8);
      text(w, "Última venta · " + ago(d.last_sale.at), 10, MUTED);
      text(w, d.last_sale.title, 12, FG, true);
      text(w, money(d.last_sale.amount), 12, GREEN);
    } else if (size !== "large" && P.chart === false && !list.some((b) => ["questions", "claims", "no_stock"].includes(b))) {
      w.addSpacer(4);
      text(w, alerts.join(" · ") || (d.last_sale ? "Última venta " + ago(d.last_sale.at) : "Todo al día"), 10, alerts.length ? AMBER : MUTED);
    }
  }
} catch (e) {
  w.backgroundColor = new Color("#0b0b0c");
  const t1 = w.addText("Mercado Libre"); t1.font = Font.boldSystemFont(12); t1.textColor = new Color("#a1a1aa");
  w.addSpacer(4);
  const t2 = w.addText("No se pudo actualizar"); t2.font = Font.boldSystemFont(13); t2.textColor = Color.white();
  const t3 = w.addText(String(e.message || e)); t3.font = Font.systemFont(10); t3.textColor = new Color("#ff8a8a");
}

if (config.runsInWidget) Script.setWidget(w);
else if (size === "small") await w.presentSmall(); else if (size === "large") await w.presentLarge(); else await w.presentMedium();
Script.complete();
`;
}
