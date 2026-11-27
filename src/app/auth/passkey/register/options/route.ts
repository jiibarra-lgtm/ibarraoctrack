import { NextResponse, type NextRequest } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { createClient } from "@/lib/supabase/server";
import { CHALLENGE_COOKIE, cookieOpts, passkeyAdmin, rpFrom } from "@/lib/passkeys";

/** Opciones para crear una llave de acceso en este dispositivo (hay que estar con la sesión abierta). */
export async function POST(req: NextRequest) {
  const admin = passkeyAdmin();
  if (!admin) return NextResponse.json({ error: "Las llaves de acceso todavía no están activadas en el servidor." }, { status: 503 });
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Iniciá sesión primero." }, { status: 401 });

  const { rpID, rpName } = rpFrom(req);
  const { data: mine } = await admin.from("user_passkeys").select("credential_id, transports").eq("user_id", user.id);
  const options = await generateRegistrationOptions({
    rpName, rpID, userName: user.email ?? user.id, userDisplayName: (user.user_metadata?.full_name as string) ?? user.email ?? "",
    userID: new TextEncoder().encode(user.id), attestationType: "none",
    excludeCredentials: (mine ?? []).map((c) => ({ id: c.credential_id as string, transports: (c.transports ?? []) as AuthenticatorTransport[] })),
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const { data: ch, error } = await admin.from("passkey_challenges").insert({ challenge: options.challenge, user_id: user.id }).select("id").single();
  if (error) return NextResponse.json({ error: "No se pudo preparar la llave." }, { status: 500 });
  const res = NextResponse.json(options);
  res.cookies.set(CHALLENGE_COOKIE, ch.id as string, cookieOpts);
  return res;
}
