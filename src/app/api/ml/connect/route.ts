import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { ML_AUTH, mlRedirectUri, pkcePair } from "@/lib/ml-api";
import { sessionRpc } from "@/lib/ml-rpc";

/** Arranca la autorización con Mercado Libre (sólo administradores). */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const back = new URL("/configuracion#mercadolibre", req.nextUrl.origin);
  try {
    const p = pkcePair();
    const r = await sessionRpc(s.supabase, s.org.org_id)("begin", { state: p.state, verifier: p.verifier });
    const url = new URL(ML_AUTH);
    url.search = new URLSearchParams({
      response_type: "code", client_id: String(r.client_id), redirect_uri: mlRedirectUri(req.nextUrl.origin),
      state: p.state, code_challenge: p.challenge, code_challenge_method: "S256",
    }).toString();
    return NextResponse.redirect(url);
  } catch (e) {
    back.searchParams.set("ml_error", (e as Error).message);
    return NextResponse.redirect(back);
  }
}
