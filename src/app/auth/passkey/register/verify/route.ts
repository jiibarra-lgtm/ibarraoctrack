import { NextResponse, type NextRequest } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { createClient } from "@/lib/supabase/server";
import { CHALLENGE_COOKIE, cookieOpts, passkeyAdmin, rpFrom } from "@/lib/passkeys";

export async function POST(req: NextRequest) {
  const admin = passkeyAdmin();
  if (!admin) return NextResponse.json({ error: "Las llaves de acceso no están activadas." }, { status: 503 });
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const chId = req.cookies.get(CHALLENGE_COOKIE)?.value;
  const { data: ch } = chId ? await admin.from("passkey_challenges").delete().eq("id", chId).eq("user_id", user.id).gt("expires_at", new Date().toISOString()).select("challenge").maybeSingle() : { data: null };
  if (!ch) return NextResponse.json({ error: "Se venció el tiempo. Probá de nuevo." }, { status: 400 });

  const body = (await req.json().catch(() => null)) as { response?: RegistrationResponseJSON; device?: string } | null;
  if (!body?.response) return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  const { rpID, origin } = rpFrom(req);
  try {
    const v = await verifyRegistrationResponse({ response: body.response, expectedChallenge: ch.challenge as string, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false });
    if (!v.verified || !v.registrationInfo) throw new Error("no verificada");
    const c = v.registrationInfo.credential;
    const { error } = await admin.from("user_passkeys").insert({
      user_id: user.id, credential_id: c.id, public_key: isoBase64URL.fromBuffer(c.publicKey), counter: c.counter,
      transports: c.transports ?? [], device: (body.device ?? "").slice(0, 80) || null,
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    return NextResponse.json({ error: `No se pudo guardar la llave (${(e as Error).message}).` }, { status: 400 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(CHALLENGE_COOKIE, "", { ...cookieOpts, maxAge: 0 });
  return res;
}
