"use server";
import webpush from "web-push";
import { requireOrg } from "@/lib/session";

/** Clave pública para suscribirse (si todavía no existe, se genera y guarda). */
export async function getPushKey(): Promise<string | null> {
  const s = await requireOrg();
  const { data } = await s.supabase.rpc("push_public_key", { p_org: s.org.org_id });
  if (data) return data as string;
  const k = webpush.generateVAPIDKeys();
  const { data: pub } = await s.supabase.rpc("push_init_keys", { p_org: s.org.org_id, p_public: k.publicKey, p_private: k.privateKey });
  return (pub as string | null) ?? null;
}

export async function savePushSubscription(sub: { endpoint: string; keys: { p256dh: string; auth: string } }, ua: string): Promise<{ ok: boolean; error?: string }> {
  const s = await requireOrg();
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "Suscripción inválida" };
  const { error } = await s.supabase.rpc("push_subscribe", { p_org: s.org.org_id, p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth, p_ua: ua.slice(0, 200) });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const s = await requireOrg();
  await s.supabase.rpc("push_unsubscribe", { p_endpoint: endpoint });
  return { ok: true };
}
