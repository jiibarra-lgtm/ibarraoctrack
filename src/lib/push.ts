import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDate, formatMoney } from "@/lib/format";

type Outbox = {
  public_key: string | null; private_key: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
  notifications: { id: string; type: "open" | "closing" | "oc_missing" | "weekly" | "reclamo" | "bank_in"; contract: string; name: string | null; ends_on: string; stock: boolean; data?: Weekly }[];
};

type Weekly = { due: number; late: number; receivable: number; overdue: number; new_orders: number; new_amount: number; missing: number };

/** Texto del resumen de los lunes: sólo lo que tiene algo para hacer. */
export function weeklyBody(w: Weekly): string {
  const parts: string[] = [];
  if (w.due) parts.push(`${w.due} entrega${w.due === 1 ? "" : "s"} vence${w.due === 1 ? "" : "n"} esta semana`);
  if (w.late) parts.push(`${w.late} atrasada${w.late === 1 ? "" : "s"}`);
  if (w.missing) parts.push(`${w.missing} OC sin cargar`);
  if (w.overdue) parts.push(`${formatMoney(w.overdue)} vencido por cobrar`);
  else if (w.receivable) parts.push(`${formatMoney(w.receivable)} por cobrar`);
  parts.push(w.new_orders ? `${w.new_orders} OC nueva${w.new_orders === 1 ? "" : "s"} la semana pasada (${formatMoney(w.new_amount)})` : "sin OC nuevas la semana pasada");
  return parts.join(" · ");
}

const SUBJECT = "https://ibarraoctrack.vercel.app";

function message(n: Outbox["notifications"][number]) {
  if (n.type === "weekly" && n.data) {
    return { title: "Tu semana en OC Track", body: weeklyBody(n.data), tag: `weekly-${n.ends_on}`, url: "/dashboard" };
  }
  if (n.type === "reclamo") {
    return { title: `Reclamo de un organismo${n.contract ? ` · OC ${n.contract}` : ""}`, body: `${n.name ?? "Llegó un reclamo"}. Respondelo hoy.`, tag: `reclamo-${n.id}`, url: "/correos?k=reclamo" };
  }
  if (n.type === "bank_in") {
    return { title: `Entró ${formatMoney(n.contract)} al banco`, body: n.name ?? "Movimiento acreditado", tag: `bank-in-${n.id}`, url: "/cobranzas" };
  }
  if (n.type === "oc_missing") {
    return { title: `OC sin cargar · ${n.contract}`, body: `${n.name ?? "BAC"}: perfeccionada el ${formatDate(n.ends_on)} y todavía no subiste el PDF. El plazo de entrega ya corre.`, tag: `oc-missing-${n.contract}`, url: "/ordenes/importar" };
  }
  const what = n.name ? `${n.name} (${n.contract})` : `convenio ${n.contract}`;
  return n.type === "open"
    ? { title: "Abrió la actualización de precios", body: `${what}: podés actualizar precios${n.stock ? " y stock" : ""} hasta el ${formatDate(n.ends_on)}.`, tag: `conv-open-${n.contract}`, url: "/precios-stock" }
    : { title: "Mañana cierra la actualización de precios", body: `${what}: último día el ${formatDate(n.ends_on)}. Si vas a cambiar precios, hacelo hoy.`, tag: `conv-close-${n.contract}`, url: "/precios-stock" };
}

/**
 * Manda los avisos pendientes (ventana de precios que abre hoy / cierra mañana, OC perfeccionada sin cargar) a todos los dispositivos suscriptos.
 * Corre en cada pasada del script de Gmail con su token. La primera vez genera las claves VAPID y las guarda en la base.
 */
export async function sendPendingPushes(sb: SupabaseClient, token: string) {
  let { data, error } = await sb.rpc("push_outbox", { p_token: token });
  if (error) return { error: error.message };
  let box = data as Outbox;
  if (!box.public_key) {
    const keys = webpush.generateVAPIDKeys();
    ({ data, error } = await sb.rpc("push_outbox", { p_token: token, p_new_public: keys.publicKey, p_new_private: keys.privateKey }));
    if (error) return { error: error.message };
    box = data as Outbox;
  }
  if (!box.notifications.length || !box.subscriptions.length || !box.public_key || !box.private_key) return { sent: 0 };
  webpush.setVapidDetails(SUBJECT, box.public_key, box.private_key);
  const ok = new Set<string>(), failed = new Set<string>(), gone = new Set<string>();
  const sent: { id: string; type: string }[] = [];
  for (const n of box.notifications) {
    const payload = JSON.stringify(message(n));
    let any = false;
    for (const s of box.subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "high" });
        ok.add(s.endpoint); any = true;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) gone.add(s.endpoint); else failed.add(s.endpoint);
      }
    }
    if (any) sent.push({ id: n.id, type: n.type });
  }
  await sb.rpc("push_mark", { p_token: token, p_sent: sent, p_ok: [...ok], p_failed: [...failed].filter((x) => !ok.has(x)), p_gone: [...gone] });
  return { sent: sent.length };
}
