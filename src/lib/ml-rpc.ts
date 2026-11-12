import "server-only";
import { createClient as createAnon } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MlRpc } from "@/lib/ml-api";

const unwrap = (r: { data: unknown; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message);
  return (r.data ?? {}) as Record<string, unknown>;
};

/** Con la sesión del usuario (pantallas). */
export const sessionRpc = (sb: SupabaseClient, orgId: string): MlRpc => async (action, data = {}) =>
  unwrap(await sb.rpc("ml_conn", { p_action: action, p_org: orgId, p_data: data }));

/** Con el token de la conexión de Gmail (corre sin sesión, desde el script). */
export const tokenRpc = (token: string): MlRpc => {
  const sb = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (action, data = {}) => unwrap(await sb.rpc("ml_conn", { p_action: action, p_token: token, p_data: data }));
};

/** Stock de publicaciones y facturas de compras (con sesión). */
export const sessionStockRpc = (sb: SupabaseClient, orgId: string): MlRpc => async (action, data = {}) =>
  unwrap(await sb.rpc("ml_stock", { p_action: action, p_org: orgId, p_data: data }));

/** Ídem con el token del script de Gmail. */
export const tokenStockRpc = (token: string): MlRpc => {
  const sb = createAnon(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  return async (action, data = {}) => unwrap(await sb.rpc("ml_stock", { p_action: action, p_token: token, p_data: data }));
};
