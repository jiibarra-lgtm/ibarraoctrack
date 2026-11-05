"use client";
import * as React from "react";
import { Download, Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";

type BIPEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registra el service worker (sólo en producción). */
export function ServiceWorker() {
  React.useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {});
  }, []);
  return null;
}

const subscribe = (cb: () => void) => {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Botón "Instalar app": usa el aviso nativo (Android/Chrome) o muestra los pasos en iPhone. */
export function InstallButton() {
  const standalone = React.useSyncExternalStore(subscribe, isStandalone, () => true);
  const [evt, setEvt] = React.useState<BIPEvent | null>(null);
  const [iosHelp, setIosHelp] = React.useState(false);
  const ios = React.useSyncExternalStore(() => () => {}, () => /iphone|ipad|ipod/i.test(navigator.userAgent), () => false);

  React.useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); setEvt(e as BIPEvent); };
    window.addEventListener("beforeinstallprompt", on);
    return () => window.removeEventListener("beforeinstallprompt", on);
  }, []);

  if (standalone || (!evt && !ios)) return null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={async () => {
        if (evt) { await evt.prompt(); await evt.userChoice; setEvt(null); } else setIosHelp(true);
      }}><Download /> <span className="hidden sm:inline">Instalar app</span></Button>
      <Dialog open={iosHelp} onOpenChange={setIosHelp}>
        <DialogContent title="Instalar en el iPhone" description="Queda como app, con ícono y pantalla completa.">
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>Abrí esta página en <b>Safari</b>.</li>
            <li>Tocá <Share className="inline size-4 align-text-bottom" /> <b>Compartir</b> (abajo).</li>
            <li>Elegí <b>Agregar a pantalla de inicio</b> y después <b>Agregar</b>.</li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** En el login: borra las páginas guardadas para uso sin conexión (privacidad al cerrar sesión). */
export function ClearPageCache() {
  React.useEffect(() => {
    if ("caches" in window) caches.keys().then((ks) => ks.filter((k) => k.startsWith("oct-pages-")).forEach((k) => caches.delete(k))).catch(() => {});
  }, []);
  return null;
}
