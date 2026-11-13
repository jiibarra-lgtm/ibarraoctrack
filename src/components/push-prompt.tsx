"use client";
import * as React from "react";
import { BellRing, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPushKey, savePushSubscription } from "@/lib/push-actions";

const DISMISS = "oct-push-dismissed";
const b64ToBytes = (b64: string) => {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};
const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const ios = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

async function subscribe() {
  const key = await getPushKey();
  if (!key) throw new Error("No se pudo preparar los avisos");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const r = await savePushSubscription(sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }, navigator.userAgent);
  if (!r.ok) throw new Error(r.error);
}

/**
 * Pide activar las notificaciones cuando la app está instalada (o en compu con navegador compatible).
 * Si ya están permitidas, renueva la suscripción en silencio.
 */
export function PushPrompt() {
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!supported() || (ios() && !standalone())) return;
    if (Notification.permission === "granted") { subscribe().catch(() => {}); return; }
    if (Notification.permission === "denied") return;
    let dismissed = false;
    try { dismissed = Number(localStorage.getItem(DISMISS) ?? 0) > Date.now() - 7 * 864e5; } catch {}
    // en la PWA se pide siempre; en el navegador de la compu, una vez por semana
    if (standalone() || !dismissed) { const t = setTimeout(() => setShow(true), 1500); return () => clearTimeout(t); }
  }, []);

  if (!show) return null;
  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--bottom-nav)+0.75rem)] z-50 mx-auto max-w-md rounded-2xl border border-border bg-surface-solid p-4 shadow-xl lg:bottom-6">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 size-5 shrink-0 text-brand" />
        <div className="flex-1 text-sm">
          <p className="font-semibold">Activá las notificaciones</p>
          <p className="mt-0.5 text-fg-muted">Te aviso el día que abre la actualización de precios de tus convenios y el día antes de que cierre.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={async () => {
              setBusy(true);
              try {
                const p = await Notification.requestPermission();
                if (p === "granted") { await subscribe(); toast.success("Listo, vas a recibir los avisos en este dispositivo"); setShow(false); }
                else { toast.error("No se activaron: lo podés habilitar en los ajustes del navegador"); setShow(false); }
              } catch (e) { toast.error((e as Error).message); }
              setBusy(false);
            }}>Activar</Button>
            <Button size="sm" variant="ghost" onClick={() => { try { localStorage.setItem(DISMISS, String(Date.now())); } catch {} setShow(false); }}>Ahora no</Button>
          </div>
        </div>
        <button type="button" aria-label="Cerrar" className="text-fg-subtle" onClick={() => { try { localStorage.setItem(DISMISS, String(Date.now())); } catch {} setShow(false); }}><X className="size-4" /></button>
      </div>
    </div>
  );
}
