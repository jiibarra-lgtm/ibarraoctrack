"use server";
import { requireOrg } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

export type LiveAlert = { id: string; kind: string; title: string; detail: string | null; url: string | null; at: string };

/** Avisos de Mercado Libre nuevos desde `since` (para mostrarlos mientras el sistema está abierto). */
export async function liveAlerts(since: string): Promise<{ now: string; alerts: LiveAlert[] }> {
  const s = await requireOrg();
  const sb = await createClient();
  const from = Number.isNaN(Date.parse(since)) ? new Date(Date.now() - 60_000).toISOString() : since;
  const { data } = await sb.from("ml_events").select("id, kind, title, detail, url, at")
    .eq("org_id", s.org.org_id).gt("at", from).in("kind", ["venta", "pregunta", "reclamo"]).order("at").limit(10);
  const alerts = (data ?? []) as LiveAlert[];
  return { now: alerts.length ? alerts[alerts.length - 1].at : from, alerts };
}
