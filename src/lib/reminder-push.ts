import "server-only";
import webpush from "web-push";
import type { SupabaseClient } from "@supabase/supabase-js";

type Due = {
  id: string; title: string; notes: string | null; due_at: string; priority: "normal" | "alta"; repeat: string;
  link_path: string; link_label: string | null; token: string; count: number;
  public_key: string | null; private_key: string | null;
  subscriptions: { endpoint: string; p256dh: string; auth: string }[];
};

const SUBJECT = "https://ibarraoctrack.vercel.app";

/** Texto de la notificación: el título del recordatorio, la nota y a qué está enlazado. */
export function reminderPayload(r: Pick<Due, "id" | "title" | "notes" | "link_path" | "link_label" | "token" | "count" | "priority">) {
  const body = [r.notes?.trim(), r.link_label ? `→ ${r.link_label}` : null].filter(Boolean).join("\n") || "Tocá para abrirlo";
  return {
    title: `${r.priority === "alta" ? "‼️ " : "⏰ "}${r.title}${r.count > 0 ? " (otra vez)" : ""}`,
    body: body.slice(0, 400),
    tag: `reminder-${r.id}`,
    url: r.link_path || "/recordatorios",
    reminder: { id: r.id, token: r.token },
    requireInteraction: true,
  };
}

/** Manda por push todos los recordatorios que vencieron. Lo dispara la base cada minuto. */
export async function sendDueReminders(sb: SupabaseClient, key: string) {
  const { data, error } = await sb.rpc("reminders_due", { p_key: key });
  if (error) return { error: error.message };
  const due = (data ?? []) as Due[];
  const ok = new Set<string>(), failed = new Set<string>(), gone = new Set<string>();
  const sent: { id: string; ok: boolean; devices: number }[] = [];
  for (const r of due) {
    let devices = 0;
    if (r.public_key && r.private_key && r.subscriptions.length) {
      webpush.setVapidDetails(SUBJECT, r.public_key, r.private_key);
      const payload = JSON.stringify(reminderPayload(r));
      for (const s of r.subscriptions) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 12 * 3600, urgency: "high" });
          ok.add(s.endpoint); devices++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) gone.add(s.endpoint); else failed.add(s.endpoint);
        }
      }
    }
    sent.push({ id: r.id, ok: devices > 0, devices });
  }
  if (sent.length || gone.size || failed.size) {
    await sb.rpc("reminders_mark", { p_key: key, p_sent: sent, p_ok: [...ok], p_failed: [...failed].filter((x) => !ok.has(x)), p_gone: [...gone] });
  }
  return { sent: sent.filter((x) => x.ok).length, due: due.length };
}
