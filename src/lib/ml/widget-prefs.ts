/** Personalización del widget del iPhone (se guarda en el sistema; el widget la lee en cada actualización). */
export const WIDGET_THEMES = {
  negro: { label: "Negro", bg: "#0b0b0c", card: "#141416", fg: "#ffffff", muted: "#a1a1aa" },
  grafito: { label: "Grafito", bg: "#1c1c1e", card: "#2c2c2f", fg: "#ffffff", muted: "#a1a1aa" },
  claro: { label: "Claro", bg: "#ffffff", card: "#f1f1f4", fg: "#0b0b0c", muted: "#6b6b73" },
  amarillo: { label: "Amarillo ML", bg: "#ffe600", card: "#f5d800", fg: "#2d3277", muted: "#4b4f8a" },
} as const;
export type WidgetTheme = keyof typeof WIDGET_THEMES;
export const WIDGET_ACCENTS = ["#13a7c9", "#5fe3a1", "#3483fa", "#e879f9", "#f5c46b", "#ff8a8a"] as const;

export const WIDGET_BADGES = {
  yesterday: "Ayer", week: "7 días", month: "Mes", questions: "Preguntas", claims: "Reclamos", no_stock: "Sin stock",
} as const;
export type WidgetBadge = keyof typeof WIDGET_BADGES;

export const WIDGET_OPEN = { stats: "Stats", ventas: "Ventas", panel: "Resumen", preguntas: "Preguntas" } as const;

export type WidgetPrefs = {
  theme: WidgetTheme; accent: string; title: string;
  hero: "today" | "week" | "month";   // número grande
  chart: boolean;                       // gráfico de 7 días (mediano y grande)
  badges: WidgetBadge[];                // cajitas (hasta 3 en mediano, 6 en grande)
  lastSale: boolean;                    // última venta (grande)
  privacy: boolean;                     // ocultar los montos
  refresh: 15 | 30 | 60;                // cada cuántos minutos pide datos nuevos (el iPhone decide el momento exacto)
  open: keyof typeof WIDGET_OPEN;       // qué abre al tocarlo
};
export const WIDGET_DEFAULTS: WidgetPrefs = {
  theme: "negro", accent: "#13a7c9", title: "MERCADO LIBRE", hero: "today", chart: true,
  badges: ["yesterday", "week", "month", "questions", "claims", "no_stock"], lastSale: true, privacy: false, refresh: 15, open: "stats",
};

export function widgetPrefs(v: unknown): WidgetPrefs {
  const p = { ...WIDGET_DEFAULTS, ...(v && typeof v === "object" ? (v as Partial<WidgetPrefs>) : {}) };
  if (!(p.theme in WIDGET_THEMES)) p.theme = WIDGET_DEFAULTS.theme;
  if (!/^#[0-9a-fA-F]{6}$/.test(p.accent)) p.accent = WIDGET_DEFAULTS.accent;
  p.title = String(p.title ?? "").slice(0, 24);
  if (!["today", "week", "month"].includes(p.hero)) p.hero = "today";
  p.badges = (Array.isArray(p.badges) ? p.badges : []).filter((b, i, a) => b in WIDGET_BADGES && a.indexOf(b) === i).slice(0, 6) as WidgetBadge[];
  if (![15, 30, 60].includes(Number(p.refresh))) p.refresh = 15;
  if (!(p.open in WIDGET_OPEN)) p.open = "stats";
  p.chart = !!p.chart; p.lastSale = !!p.lastSale; p.privacy = !!p.privacy;
  return p;
}

/** Datos que devuelve el sistema para el widget. */
export type WidgetData = {
  today: { n: number; amount: number }; yesterday: { n: number; amount: number }; week: { n: number; amount: number }; month: { n: number; amount: number };
  prev_month_same: number; daily: { d: string; amount: number }[]; last_sale: { title: string; amount: number; at: string } | null;
  questions: number; claims: number; no_stock: number; active: number; updated_at: string;
};
