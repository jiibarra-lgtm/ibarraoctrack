import { NextResponse, type NextRequest } from "next/server";
import { verifyAuthenticationResponse, type AuthenticationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createClient } from "@/lib/supabase/server";
import { CHALLENGE_COOKIE, cookieOpts, passkeyAdmin, rpFrom } from "@/lib/passkeys";

/** Verifica la llave de acceso y abre la sesión. */
export async function POST(req: NextRequest) {
  const admin = passkeyAdmin();
  if (!admin) return NextResponse.json({ error: "Las llaves de acceso no están activadas." }, { status: 503 });
  const fail = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

  const chId = req.cookies.get(CHALLENGE_COOKIE)?.value;
  const { data: ch } = chId ? await admin.from("passkey_challenges").delete().eq("id", chId).is("user_id", null).gt("expires_at", new Date().toISOString()).select("challenge").maybeSingle() : { data: null };
  if (!ch) return fail("Se venció el tiempo. Probá de nuevo.");

  const body = (await req.json().catch(() => null)) as { response?: AuthenticationResponseJSON } | null;
  if (!body?.response?.id) return fail("Formato inválido");
  const { data: pk } = await admin.from("user_passkeys").select("id, user_id, credential_id, public_key, counter, transports").eq("credential_id", body.response.id).maybeSingle();
  if (!pk) return fail("Esta llave no está registrada. Entrá con la contraseña y creala de nuevo.", 404);

  const { rpID, origin } = rpFrom(req);
  try {
    const v = await verifyAuthenticationResponse({
      response: body.response, expectedChallenge: ch.challenge as string, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
      credential: { id: pk.credential_id as string, publicKey: isoBase64URL.toBuffer(pk.public_key as string), counter: Number(pk.counter), transports: (pk.transports ?? []) as AuthenticatorTransport[] },
    });
    if (!v.verified) return fail("No se pudo verificar la llave.", 401);
    await admin.from("user_passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", pk.id);
  } catch (e) {
    return fail(`No se pudo verificar la llave (${(e as Error).message}).`, 401);
  }

  // Abrir la sesión de ese usuario: enlace de un solo uso generado y canjeado en el servidor
  const { data: u } = await admin.auth.admin.getUserById(pk.user_id as string);
  const email = u.user?.email;
  if (!email) return fail("Usuario no encontrado.", 404);
  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le || !link.properties?.hashed_token) return fail("No se pudo abrir la sesión.", 500);
  const sb = await createClient();
  const { error: ve } = await sb.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (ve) return fail("No se pudo abrir la sesión.", 500);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHALLENGE_COOKIE, "", { ...cookieOpts, maxAge: 0 });
  return res;
}
