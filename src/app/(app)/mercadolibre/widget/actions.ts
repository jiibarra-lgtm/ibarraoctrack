"use server";
import { headers } from "next/headers";
import { requireOrg } from "@/lib/session";
import { scriptableWidget } from "@/lib/ml/widget-script";

/** Crea (o cambia) la clave del widget y devuelve el script listo para pegar en Scriptable. */
export async function createWidgetScript(): Promise<{ script?: string; error?: string }> {
  const s = await requireOrg();
  if (s.org.role !== "admin") return { error: "Sólo un administrador puede crear la clave del widget." };
  const { data, error } = await s.supabase.rpc("widget_token_create", { p_org: s.org.org_id });
  if (error || !data) return { error: "No se pudo crear la clave." };
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "ibarraoctrack.vercel.app";
  return { script: scriptableWidget(`https://${host}/api/widget/ml`, data as string) };
}
