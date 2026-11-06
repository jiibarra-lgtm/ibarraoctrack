"use client";
import * as React from "react";
import { toast } from "sonner";
import { Check, Copy, ExternalLink, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { generateInboundToken } from "./actions";
import { gmailScript } from "./gmail-script";

export function GmailConnect({ status, admin, appUrl }: { status: { last_used_at: string | null; total_events: number; created_at: string } | null; admin: boolean; appUrl: string }) {
  const [script, setScript] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const generate = async () => {
    if (status && !confirm("Ya hay una conexión. Generar una clave nueva desactiva el script anterior (vas a tener que pegar el nuevo). ¿Seguir?")) return;
    setBusy(true);
    const r = await generateInboundToken();
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    setScript(gmailScript(`${appUrl}/api/inbound/gmail`, r.token));
  };
  const copy = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={`size-2 rounded-full ${status?.last_used_at ? "bg-accent" : "bg-warn"}`} />
          {status?.last_used_at ? `Conectado · última lectura ${formatDateTime(status.last_used_at)}` : status ? "Clave creada · falta instalar el script" : "Sin conectar"}
        </span>
        {status && <span className="text-xs text-fg-subtle tabular">{status.total_events} avisos procesados</span>}
      </div>
      {admin && !script && <Button onClick={generate} loading={busy} variant={status ? "secondary" : "default"} className="self-start"><KeyRound /> {status ? "Generar clave nueva" : "Conectar Gmail"}</Button>}
      {script && (
        <div className="flex flex-col gap-3 rounded-xl border border-card-border bg-field p-3">
          <ol className="list-decimal space-y-1 pl-5 text-fg-muted">
            <li>Tocá <b className="text-fg">Copiar script</b>.</li>
            <li>Abrí <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" className="text-brand underline">script.google.com <ExternalLink className="inline size-3" /></a> con tu cuenta de Gmail, borrá lo que hay y pegalo.</li>
            <li>Guardá (ícono del disquete), elegí la función <b className="text-fg">instalar</b> arriba y tocá <b className="text-fg">Ejecutar</b>.</li>
            <li>Aceptá los permisos (Configuración avanzada → Ir al proyecto). Listo: carga los últimos 6 meses y después revisa cada 10 minutos.</li>
          </ol>
          <Button onClick={copy} className="self-start">{copied ? <Check /> : <Copy />} {copied ? "Copiado" : "Copiar script"}</Button>
          <p className="text-xs text-fg-subtle">La clave se muestra una sola vez y queda guardada sólo dentro del script. Lee únicamente mails de organismos públicos (.gob.ar, .gov.ar, bue.edu.ar) y el aviso de movimientos de Banco Ciudad, del que sólo toma los pagos del GCBA y las retenciones SIRCREB.</p>
        </div>
      )}
    </div>
  );
}
