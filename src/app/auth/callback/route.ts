import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Confirmación de email (PKCE o token_hash). */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const nextParam = url.searchParams.get("next") ?? "/dashboard";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/dashboard";

  const supabase = await createClient();
  let error: string | null = null;
  if (code) {
    error = (await supabase.auth.exchangeCodeForSession(code)).error?.message ?? null;
  } else if (tokenHash && type) {
    error = (await supabase.auth.verifyOtp({ token_hash: tokenHash, type })).error?.message ?? null;
  } else {
    error = "Enlace inválido";
  }

  const dest = url.clone();
  dest.search = "";
  if (error) {
    dest.pathname = "/login";
    dest.searchParams.set("error", "No se pudo confirmar el email. Probá ingresar o pedí un nuevo enlace.");
  } else {
    dest.pathname = next;
  }
  return NextResponse.redirect(dest);
}
