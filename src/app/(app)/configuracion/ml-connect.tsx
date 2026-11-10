"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ExternalLink, Link2, RefreshCw, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { formatDateTime } from "@/lib/format";
import { disconnectMl, saveMlApp, syncMlNow } from "../mercadolibre/ml-actions";

export type MlStatus = { has_app: boolean; client_id: string | null; connected: boolean; offline?: boolean; expires_at?: string | null; nickname: string | null; connected_at: string | null; last_sync_at: string | null; last_error: string | null };

export function MlConnect({ status, admin, redirectUri, flash }: { status: MlStatus; admin: boolean; redirectUri: string; flash?: { ok?: string; error?: string } }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(!status.has_app);
  const [id, setId] = React.useState(status.client_id ?? "");
  const [secret, setSecret] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (flash?.error) toast.error(`Mercado Libre: ${flash.error}`);
    else if (flash?.ok === "ok") toast.success("Mercado Libre conectado y sincronizado");
    else if (flash?.ok) toast.message("Mercado Libre conectado (la primera sincronización falló, probá Sincronizar)");
  }, [flash?.ok, flash?.error]);

  const save = async () => {
    setBusy("save");
    const r = await saveMlApp(id, secret);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Aplicación guardada. Ahora tocá Conectar.");
    setSecret(""); setEditing(false); router.refresh();
  };
  const sync = async () => {
    setBusy("sync");
    const r = await syncMlNow();
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(r.msg ?? "Sincronizado"); router.refresh();
  };
  const off = async () => {
    setBusy("off");
    const r = await disconnectMl();
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4 text-sm">
      {status.connected ? (
        <div className="flex items-start gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3 text-accent">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">Conectado como {status.nickname ?? "tu cuenta"}</p>
            <p className="text-xs opacity-80">{status.last_sync_at ? `Última sincronización ${formatDateTime(status.last_sync_at)}` : "Todavía no sincronizó"} · se actualiza sola cuando llegan mails de Mercado Libre</p>
          </div>
        </div>
      ) : (
        <p className="text-fg-muted">Conectá tu cuenta para traer solo los <b>precios de compras y ventas</b>, las comisiones y las operaciones que no llegaron por mail.</p>
      )}
      {status.connected && status.offline === false && (
        <p className="rounded-xl bg-warn-soft px-3 py-2 text-xs text-warn">
          La conexión dura sólo hasta {status.expires_at ? formatDateTime(status.expires_at) : "dentro de unas horas"}: tu aplicación de Mercado Libre no tiene <b>Acceso offline</b>.
          En developers.mercadolibre.com.ar → tu aplicación → Editar, tildá <b>offline_access</b>, guardá y tocá <b>Conectar</b> otra vez. Así queda conectada para siempre.
        </p>
      )}
      {status.last_error && <p className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">Último error: {status.last_error}</p>}

      {admin && editing && (
        <div className="grid gap-3 rounded-xl border border-card-border p-4">
          <p className="text-xs text-fg-subtle">Datos de tu aplicación en <a className="underline" href="https://developers.mercadolibre.com.ar/devcenter" target="_blank" rel="noreferrer">developers.mercadolibre.com.ar <ExternalLink className="inline size-3" /></a>. URI de redirect: <code className="select-all rounded bg-field px-1">{redirectUri}</code></p>
          <Field label="App ID" htmlFor="ml-id"><Input id="ml-id" inputMode="numeric" value={id} onChange={(e) => setId(e.target.value)} placeholder="1234567890123456" /></Field>
          <Field label="Secret Key" htmlFor="ml-secret" hint="Queda guardada en tu sistema y no se vuelve a mostrar"><Input id="ml-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} /></Field>
          <div className="flex gap-2">
            <Button onClick={save} loading={busy === "save"} disabled={!id.trim() || secret.trim().length < 16}>Guardar</Button>
            {status.has_app && <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>}
          </div>
        </div>
      )}

      {admin && !editing && (
        <div className="flex flex-wrap gap-2">
          {(!status.connected || status.offline === false) && <Button asChild variant={status.connected ? "secondary" : "default"}><a href="/api/ml/connect"><Link2 /> {status.connected ? "Reconectar" : "Conectar Mercado Libre"}</a></Button>}
          {status.connected && <Button onClick={sync} loading={busy === "sync"}><RefreshCw /> Sincronizar ahora</Button>}
          <Button variant="ghost" onClick={() => setEditing(true)}>Cambiar App ID / Secret</Button>
          {status.connected && <Button variant="ghost" onClick={off} loading={busy === "off"}><Unplug /> Desconectar</Button>}
        </div>
      )}
      {!admin && !status.connected && <p className="text-xs text-fg-subtle">Lo conecta un administrador.</p>}
    </div>
  );
}
