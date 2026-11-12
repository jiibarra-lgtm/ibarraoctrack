"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { syncMercadoLibre } from "@/lib/ml-api";
import { runMlTasks } from "@/lib/ml-tasks";
import { sessionRpc, sessionStockRpc } from "@/lib/ml-rpc";

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
    const t = await runMlTasks(sessionRpc(s.supabase, s.org.org_id), sessionStockRpc(s.supabase, s.org.org_id), { sync: false });
    revalidatePath("/mercadolibre");
    revalidatePath("/configuracion");
    const x = r as unknown as { actualizadas: number; nuevas: number; leidas: number };
    const rs = t.restock as { restocked?: number; error?: string }, iv = t.invoices as { saved?: number; error?: string };
    return { ok: true, msg: `${x.leidas} operaciones leídas · ${x.actualizadas} con precio actualizado · ${x.nuevas} nuevas`
      + (rs?.restocked ? ` · ${rs.restocked} publicaciones repuestas` : "") + (iv?.saved ? ` · ${iv.saved} facturas bajadas` : "") };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Regla de stock: general ('*') o de una publicación. */
export async function setMlStockRule(itemId: string, rule: { enabled: boolean; min: number; target: number } | null): Promise<R> {
  const s = await requireOrg();
  if (!/^(\*|MLA\d{5,15})$/.test(itemId)) return { ok: false, error: "Publicación inválida" };
  if (rule && (!Number.isInteger(rule.min) || !Number.isInteger(rule.target) || rule.min < 0 || rule.target < 1 || rule.target < rule.min)) return { ok: false, error: "El objetivo tiene que ser mayor o igual al mínimo" };
  try { await sessionStockRpc(s.supabase, s.org.org_id)("set_rule", rule ? { item_id: itemId, ...rule } : { item_id: itemId, remove: true }); } catch (e) { return { ok: false, error: (e as Error).message }; }
  revalidatePath("/mercadolibre");
  return { ok: true };
}

/** Revisa ya las publicaciones y repone las que bajaron del mínimo. */
export async function restockMlNow(): Promise<R> {
  const s = await requireOrg();
  try {
    const t = await runMlTasks(sessionRpc(s.supabase, s.org.org_id), sessionStockRpc(s.supabase, s.org.org_id), { sync: false });
    const rs = t.restock as { connected?: boolean; items?: number; restocked?: number; error?: string };
    if (rs?.error) return { ok: false, error: rs.error };
    if (rs?.connected === false) return { ok: false, error: "Mercado Libre no está conectado" };
    revalidatePath("/mercadolibre");
    return { ok: true, msg: `${rs.items ?? 0} publicaciones revisadas · ${rs.restocked ?? 0} repuestas` };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
