"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { syncMercadoLibre } from "@/lib/ml-api";
import { sessionRpc } from "@/lib/ml-rpc";

type R = { ok: true; msg?: string } | { ok: false; error: string };

export async function saveMlApp(clientId: string, clientSecret: string): Promise<R> {
  const s = await requireOrg();
  try {
    await sessionRpc(s.supabase, s.org.org_id)("set_app", { client_id: clientId.trim(), client_secret: clientSecret.trim() });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  revalidatePath("/configuracion");
  return { ok: true };
}

export async function disconnectMl(): Promise<R> {
  const s = await requireOrg();
  try { await sessionRpc(s.supabase, s.org.org_id)("disconnect"); } catch (e) { return { ok: false, error: (e as Error).message }; }
  revalidatePath("/configuracion");
  return { ok: true };
}

/** Trae ya los precios y operaciones desde la API de Mercado Libre. */
export async function syncMlNow(): Promise<R> {
  const s = await requireOrg();
  try {
    const r = await syncMercadoLibre(sessionRpc(s.supabase, s.org.org_id));
    if (!r.connected) return { ok: false, error: "Mercado Libre no está conectado (Configuración → Mercado Libre)" };
    revalidatePath("/mercadolibre");
    revalidatePath("/configuracion");
    const x = r as unknown as { actualizadas: number; nuevas: number; leidas: number };
    return { ok: true, msg: `${x.leidas} operaciones leídas · ${x.actualizadas} con precio actualizado · ${x.nuevas} nuevas` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
