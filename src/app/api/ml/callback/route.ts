import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { exchangeCode, getMe, mlRedirectUri, syncMercadoLibre } from "@/lib/ml-api";
import { sessionRpc } from "@/lib/ml-rpc";

export const maxDuration = 60;

/** Vuelta de Mercado Libre: canjea el código, guarda la conexión y hace la primera sincronización. */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const rpc = sessionRpc(s.supabase, s.org.org_id);
  const back = new URL("/configuracion", req.nextUrl.origin);
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state") ?? "";
  try {
    if (!code) throw new Error(req.nextUrl.searchParams.get("error_description") ?? "Mercado Libre no autorizó la conexión");
    const app = await rpc("finish", { state });
    const t = await exchangeCode({ client_id: String(app.client_id), client_secret: String(app.client_secret), code, redirect_uri: mlRedirectUri(req.nextUrl.origin), verifier: app.verifier as string | null });
    const me = await getMe(t.access_token);
    await rpc("save_tokens", { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), ml_user_id: me.id, nickname: me.nickname });
    const r = await syncMercadoLibre(rpc).catch((e) => ({ error: (e as Error).message }));
    back.searchParams.set("ml", "error" in r ? "conectado_sin_sync" : "ok");
  } catch (e) {
    back.searchParams.set("ml_error", (e as Error).message.slice(0, 200));
  }
  back.hash = "mercadolibre";
  return NextResponse.redirect(back);
}
