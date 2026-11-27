"use client";
import * as React from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createWidgetScript } from "./actions";

export function WidgetSetup({ hasKey }: { hasKey: boolean }) {
  const [script, setScript] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);

  const gen = async () => {
    setBusy(true); setErr(null);
    const r = await createWidgetScript();
    setBusy(false);
    if (r.error) setErr(r.error); else setScript(r.script ?? null);
  };
  const copy = async () => {
    if (!script) return;
    try { await navigator.clipboard.writeText(script); }
    catch { ref.current?.select(); document.execCommand?.("copy"); }
    setCopied(true); window.setTimeout(() => setCopied(false), 2500);
  };

  if (!script) return (
    <div>
      <Button onClick={gen} loading={busy}><KeyRound className="size-4" /> {hasKey ? "Generar un script nuevo" : "Generar el script del widget"}</Button>
      {hasKey && <p className="mt-2 text-xs text-fg-subtle">Ya tenés un widget configurado. Si generás uno nuevo, el anterior deja de funcionar y hay que pegar el script nuevo.</p>}
      {err && <p className="mt-2 text-sm text-danger">{err}</p>}
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={copy}>{copied ? <Check className="size-4" /> : <Copy className="size-4" />} {copied ? "Copiado" : "Copiar script"}</Button>
        <span className="text-xs text-fg-subtle">Tiene tu clave adentro: no lo compartas.</span>
      </div>
      <textarea ref={ref} readOnly value={script} rows={10} className="w-full rounded-lg border border-border p-3 font-mono text-[11px] leading-relaxed" onFocus={(e) => e.currentTarget.select()} />
    </div>
  );
}
