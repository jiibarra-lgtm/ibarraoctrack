import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

/** Resumen de Mercado Libre para el widget del iPhone (Scriptable). Se lee con la clave del widget; sólo lectura. */
export async function GET(req: NextRequest) {
  const key = req.headers.get("x-widget-key") ?? req.nextUrl.searchParams.get("key") ?? "";
  if (!/^wg_[0-9a-f]{48}$/.test(key)) return NextResponse.json({ error: "Clave inválida" }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await sb.rpc("widget_ml", { p_token: key });
  if (error) return NextResponse.json({ error: error.code === "28000" ? "Clave inválida" : "No disponible" }, { status: error.code === "28000" ? 401 : 500 });
  return NextResponse.json(data, { headers: { "cache-control": "no-store" } });
}
