"use client";
import { createBrowserClient } from "@supabase/ssr";

let client: ReturnType<typeof createBrowserClient> | undefined;

/** Cliente Supabase del navegador: sólo clave publicable, RLS obligatoria. */
export function createClient() {
  client ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    // La sesión la renueva siempre el servidor (cookie de 400 días). Si la renovara el navegador,
    // Safari/iPhone corta esas cookies a los 7 días y la sesión "se cierra sola".
    { auth: { autoRefreshToken: false } },
  );
  return client;
}

/** Cliente con la sesión vigente: si el acceso venció (página abierta hace más de una hora), la renueva antes de usarlo. */
export async function freshClient() {
  const c = createClient();
  const { data } = await c.auth.getSession();
  const exp = data.session?.expires_at ?? 0;
  if (data.session && exp * 1000 - Date.now() < 60_000) await c.auth.refreshSession().catch(() => null);
  return c;
}
