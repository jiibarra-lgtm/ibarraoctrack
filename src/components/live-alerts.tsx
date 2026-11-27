"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { liveAlerts } from "@/lib/live-alerts-actions";

const EVERY = 30_000;

/** Un "ding" corto (sin archivos): sólo suena si el navegador lo permite (después de haber tocado la página). */
function ding() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.setValueAtTime(880, ctx.currentTime); o.frequency.setValueAtTime(1320, ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.55);
    o.onended = () => ctx.close().catch(() => null);
  } catch { /* sin sonido */ }
}

/**
 * Mientras el sistema está abierto, revisa cada 30 s si entró una venta, pregunta o reclamo de Mercado Libre
 * y lo avisa en pantalla (con sonido). Si la pestaña está en segundo plano, además manda la notificación del sistema.
 */
export function LiveAlerts() {
  const router = useRouter();
  const since = React.useRef<string>(new Date().toISOString());
  const seen = React.useRef(new Set<string>());

  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await liveAlerts(since.current);
        if (!alive) return;
        since.current = r.now;
        const fresh = r.alerts.filter((a) => !seen.current.has(a.id));
        if (!fresh.length) return;
        fresh.forEach((a) => seen.current.add(a.id));
        ding();
        for (const a of fresh) {
          const url = a.url ?? "/mercadolibre/panel";
          toast(a.title, {
            description: a.detail ?? undefined, duration: 20_000,
            action: { label: "Ver", onClick: () => router.push(url) },
          });
          if (document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
            navigator.serviceWorker?.getRegistration().then((reg) => reg?.showNotification(a.title, { body: a.detail ?? "", tag: `ml-${a.id}`, data: { url }, icon: "/icons/icon-192.png" })).catch(() => null);
          }
        }
        router.refresh();
      } catch { /* sin conexión: reintenta en la próxima vuelta */ }
    };
    const id = window.setInterval(tick, EVERY);
    const onVisible = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; window.clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [router]);

  return null;
}
