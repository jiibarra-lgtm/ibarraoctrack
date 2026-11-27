import "server-only";
import { createClient as createAdmin } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";

/**
 * Llaves de acceso (passkeys). Necesitan la clave secreta de Supabase en el servidor (SUPABASE_SECRET_KEY)
 * para guardar las llaves y abrir la sesión; sin ella la función queda apagada.
 */
export function passkeyAdmin() {
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const passkeysEnabled = () => Boolean(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

/** Dominio y origen esperados (el sitio donde se creó la llave). */
export function rpFrom(req: NextRequest) {
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  const rpID = host.replace(/:\d+$/, "");
  return { rpID, origin: `${proto}://${host}`, rpName: "Ibarra OC Track" };
}

export const CHALLENGE_COOKIE = "pk_ch";
export const cookieOpts = { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/auth/passkey", maxAge: 300 };
