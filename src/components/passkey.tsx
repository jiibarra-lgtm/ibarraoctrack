"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { Fingerprint, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

const DONE_KEY = "pk-registered";
const HIDE_KEY = "pk-prompt-hidden";
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

function deviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Windows/.test(ua)) return "Windows";
  if (/Mac/.test(ua)) return "Mac";
  return "Dispositivo";
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `Error ${r.status}`);
  return j as T;
}

/** Crea una llave de acceso en este dispositivo para el usuario con la sesión abierta. */
export async function createPasskey() {
  const options = await post<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/auth/passkey/register/options");
  const response = await startRegistration({ optionsJSON: options });
  await post("/auth/passkey/register/verify", { response, device: deviceName() });
  store.set(DONE_KEY, "1");
}

const cancelled = (e: unknown) => (e as Error)?.name === "NotAllowedError" || (e as Error)?.name === "AbortError";

/** Botón "Entrar con llave de acceso" de la pantalla de ingreso. */
export function PasskeyLogin({ next, enabled = true }: { next?: string; enabled?: boolean }) {
  const router = useRouter();
  const [ok, setOk] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { const t = window.setTimeout(() => setOk(browserSupportsWebAuthn()), 0); return () => window.clearTimeout(t); }, []);
  if (!ok || !enabled) return null;
  const go = async () => {
    setBusy(true); setErr(null);
    try {
      const options = await post<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/auth/passkey/login/options");
      const response = await startAuthentication({ optionsJSON: options });
      await post("/auth/passkey/login/verify", { response });
      store.set(DONE_KEY, "1");
      router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
      router.refresh();
    } catch (e) {
      if (!cancelled(e)) setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="mt-4">
      <Button type="button" variant="secondary" size="lg" className="w-full" loading={busy} onClick={go}>
        <Fingerprint className="size-4" /> Entrar con llave de acceso
      </Button>
      <p className="mt-1.5 text-center text-[11px] text-fg-subtle">Face ID, huella o Windows Hello</p>
      {err && <p className="mt-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
    </div>
  );
}

/** Aviso dentro del sistema para crear la llave en este dispositivo (una sola vez). */
export function PasskeyPrompt({ enabled }: { enabled: boolean }) {
  const [show, setShow] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    const t = window.setTimeout(() => setShow(browserSupportsWebAuthn() && !store.get(DONE_KEY) && !store.get(HIDE_KEY)), 1500);
    return () => window.clearTimeout(t);
  }, [enabled]);
  if (!show) return null;
  const hide = () => { store.set(HIDE_KEY, "1"); setShow(false); };
  const create = async () => {
    setBusy(true);
    try { await createPasskey(); toast.success("Listo: la próxima vez entrás con tu llave de acceso."); setShow(false); }
    catch (e) { if (!cancelled(e)) toast.error((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--bottom-nav)+0.75rem)] z-40 mx-auto max-w-md rounded-xl border border-border bg-surface-solid p-4 shadow-2xl lg:bottom-4 lg:left-auto lg:right-4">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white text-black"><Fingerprint className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Entrá más rápido</p>
          <p className="mt-0.5 text-xs text-fg-muted">Creá una llave de acceso en este dispositivo y entrás con Face ID, huella o Windows Hello, sin contraseña.</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" loading={busy} onClick={create}>Crear llave</Button>
            <Button size="sm" variant="ghost" onClick={hide}>Ahora no</Button>
          </div>
        </div>
        <button type="button" aria-label="Cerrar" onClick={hide} className="text-fg-subtle hover:text-fg"><X className="size-4" /></button>
      </div>
    </div>
  );
}
