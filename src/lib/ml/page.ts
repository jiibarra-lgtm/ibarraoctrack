import "server-only";
import { requireOrg, canWrite } from "@/lib/session";
import { sessionProRpc, sessionRpc } from "@/lib/ml-rpc";
import { mlClient } from "@/lib/ml/client";

/** Lo que necesita cada pantalla de Mercado Libre: sesión, cliente de la API (si está conectado) y permisos. */
export async function mlPage() {
  const s = await requireOrg();
  const ml = await mlClient(sessionRpc(s.supabase, s.org.org_id)).catch(() => null);
  return { s, sb: s.supabase, org: s.org.org_id, ml, edit: canWrite(s.org.role), pro: sessionProRpc(s.supabase, s.org.org_id) };
}

export type ItemRow = {
  item_id: string; title: string; price: number | null; available: number | null; sold: number | null; status: string | null; logistic: string | null;
  permalink: string | null; thumbnail: string | null; variations: number; category_id: string | null; listing_type: string | null; catalog_listing: boolean;
  health: number | null; visits_30d: number | null; sold_30d: number | null; fee_unit: number | null; ship_cost: number | null; cost_unit: number | null;
  warnings: { title: string; score: number; link: string | null }[]; sub_status: string[] | null; date_created: string | null; price_to_win: number | null;
  competition: string | null; metrics_at: string | null; seen_at: string;
};
export const ITEM_COLS = "item_id, title, price, available, sold, status, logistic, permalink, thumbnail, variations, category_id, listing_type, catalog_listing, health, visits_30d, sold_30d, fee_unit, ship_cost, cost_unit, warnings, sub_status, date_created, price_to_win, competition, metrics_at, seen_at";

export const LISTING_TYPE: Record<string, string> = { gold_special: "Clásica", gold_pro: "Premium", gold_premium: "Premium", free: "Gratuita", bronze: "Bronce", silver: "Plata", gold: "Oro" };
export const ITEM_STATUS: Record<string, { label: string; tone: "accent" | "warn" | "danger" | "neutral" | "info" }> = {
  active: { label: "Activa", tone: "accent" }, paused: { label: "Pausada", tone: "warn" }, closed: { label: "Finalizada", tone: "neutral" },
  under_review: { label: "En revisión", tone: "danger" }, inactive: { label: "Inactiva", tone: "danger" },
};
export const LEVEL: Record<string, { label: string; color: string }> = {
  "5_green": { label: "Verde", color: "#3a9d4f" }, "4_light_green": { label: "Verde claro", color: "#8bc34a" }, "3_yellow": { label: "Amarillo", color: "#f2c94c" },
  "2_orange": { label: "Naranja", color: "#f2994a" }, "1_red": { label: "Rojo", color: "#e5484d" },
};
export const nowAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export const nowMs = () => Date.now();
