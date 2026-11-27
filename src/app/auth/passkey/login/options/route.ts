import { NextResponse, type NextRequest } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { CHALLENGE_COOKIE, cookieOpts, passkeyAdmin, rpFrom } from "@/lib/passkeys";

/** Opciones para entrar con una llave de acceso (el dispositivo elige la llave guardada). */
export async function POST(req: NextRequest) {
  const admin = passkeyAdmin();
  if (!admin) return NextResponse.json({ error: "Las llaves de acceso no están activadas." }, { status: 503 });
  const { rpID } = rpFrom(req);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  await admin.from("passkey_challenges").delete().lt("expires_at", new Date().toISOString());
  const { data: ch, error } = await admin.from("passkey_challenges").insert({ challenge: options.challenge }).select("id").single();
  if (error) return NextResponse.json({ error: "No se pudo preparar el ingreso." }, { status: 500 });
  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, ch.id as string, cookieOpts);
  return res;
}
