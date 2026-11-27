/** Script para la app Scriptable (iPhone): widget con el resumen de Mercado Libre. Tamaños chico, mediano y grande. */
export function scriptableWidget(url: string, key: string) {
  return `// Ibarra OC Track · Mercado Libre (widget para Scriptable)
// Pegalo en Scriptable y agregá un widget de Scriptable en la pantalla de inicio eligiendo este script.
const URL = ${JSON.stringify(url)};
const KEY = ${JSON.stringify(key)};
const APP = ${JSON.stringify(url.replace(/\/api\/widget\/ml$/, "/mercadolibre/stats"))};

const BG = new Color("#0b0b0c"), CARD = new Color("#141416"), FG = Color.white(), MUTED = new Color("#a1a1aa"),
      CYAN = new Color("#13a7c9"), GREEN = new Color("#5fe3a1"), RED = new Color("#ff8a8a"), AMBER = new Color("#f5c46b");

function money(v) {
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
function text(stack, s, size, color, bold) {
  const t = stack.addText(String(s));
  t.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || FG; t.lineLimit = 1; t.minimumScaleFactor = 0.6;
  return t;
}
function spark(values, w, h) {
  const ctx = new DrawContext(); ctx.size = new Size(w, h); ctx.opaque = false; ctx.respectScreenScale = true;
  const max = Math.max(1, ...values), step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => new Point(i * step, h - 4 - (v / max) * (h - 8)));
  const area = new Path(); area.move(new Point(0, h)); pts.forEach((p) => area.addLine(p)); area.addLine(new Point(w, h)); area.closeSubpath();
  ctx.addPath(area); ctx.setFillColor(new Color("#13a7c9", 0.25)); ctx.fillPath();
  const line = new Path(); line.move(pts[0]); pts.slice(1).forEach((p) => line.addLine(p));
  ctx.addPath(line); ctx.setStrokeColor(CYAN); ctx.setLineWidth(2.5); ctx.strokePath();
  return ctx.getImage();
}
function badge(stack, label, value, color) {
  const b = stack.addStack(); b.layoutVertically(); b.backgroundColor = CARD; b.cornerRadius = 8; b.setPadding(5, 8, 5, 8);
  text(b, label, 9, MUTED); text(b, value, 14, color || FG, true);
  return b;
}

async function load() {
  const r = new Request(URL); r.headers = { "x-widget-key": KEY }; r.timeoutInterval = 20;
  return await r.loadJSON();
}

const w = new ListWidget();
w.backgroundColor = BG; w.url = APP; w.setPadding(12, 14, 12, 14);
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
const size = config.widgetFamily || "medium";

try {
  const d = await load();
  if (d.error) throw new Error(d.error);
  const head = w.addStack(); head.centerAlignContent();
  text(head, "MERCADO LIBRE", 10, MUTED, true); head.addSpacer();
  text(head, new Date(d.updated_at).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }), 9, MUTED);
  w.addSpacer(6);

  text(w, "Hoy", 11, MUTED);
  const big = w.addStack(); big.bottomAlignContent();
  text(big, money(d.today.amount), size === "small" ? 22 : 26, FG, true); big.addSpacer(6);
  text(big, d.today.n + (d.today.n === 1 ? " venta" : " ventas"), 11, d.today.n ? GREEN : MUTED);

  if (size === "small") {
    w.addSpacer(6);
    text(w, "Mes " + money(d.month.amount), 12, FG, true);
    const alerts = [];
    if (d.questions) alerts.push(d.questions + " preg.");
    if (d.claims) alerts.push(d.claims + " recl.");
    if (d.no_stock) alerts.push(d.no_stock + " sin stock");
    text(w, alerts.join(" · ") || "Todo al día", 10, alerts.length ? AMBER : MUTED);
  } else {
    w.addSpacer(6);
    const img = w.addImage(spark(d.daily.map((x) => Number(x.amount)), size === "large" ? 600 : 560, size === "large" ? 110 : 70));
    img.resizable = true; img.imageSize = new Size(size === "large" ? 300 : 290, size === "large" ? 55 : 32);
    w.addSpacer(6);
    const row = w.addStack(); row.spacing = 6;
    badge(row, "Ayer", money(d.yesterday.amount));
    badge(row, "7 días", money(d.week.amount));
    const vs = d.prev_month_same ? (d.month.amount - d.prev_month_same) / d.prev_month_same * 100 : null;
    badge(row, "Mes" + (vs === null ? "" : (vs >= 0 ? " ▲" : " ▼") + Math.abs(Math.round(vs)) + "%"), money(d.month.amount), vs === null ? FG : vs >= 0 ? GREEN : RED);
    if (size === "large") {
      w.addSpacer(8);
      const row2 = w.addStack(); row2.spacing = 6;
      badge(row2, "Preguntas", String(d.questions), d.questions ? AMBER : FG);
      badge(row2, "Reclamos", String(d.claims), d.claims ? RED : FG);
      badge(row2, "Sin stock", d.no_stock + "/" + d.active, d.no_stock ? RED : FG);
      if (d.last_sale) {
        w.addSpacer(8);
        text(w, "Última venta · " + ago(d.last_sale.at), 10, MUTED);
        text(w, d.last_sale.title, 12, FG, true);
        text(w, money(d.last_sale.amount), 12, GREEN);
      }
    } else {
      w.addSpacer(4);
      const alerts = [];
      if (d.questions) alerts.push(d.questions + " preguntas");
      if (d.claims) alerts.push(d.claims + " reclamos");
      if (d.no_stock) alerts.push(d.no_stock + " sin stock");
      text(w, alerts.join(" · ") || (d.last_sale ? "Última venta " + ago(d.last_sale.at) : "Todo al día"), 10, alerts.length ? AMBER : MUTED);
    }
  }
} catch (e) {
  text(w, "Mercado Libre", 12, MUTED, true); w.addSpacer(4);
  text(w, "No se pudo actualizar", 13, FG, true);
  text(w, String(e.message || e), 10, RED);
}

if (config.runsInWidget) Script.setWidget(w);
else if (size === "small") await w.presentSmall(); else if (size === "large") await w.presentLarge(); else await w.presentMedium();
Script.complete();
`;
}
