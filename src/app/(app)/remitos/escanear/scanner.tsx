"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, CameraOff, CheckCircle2, Info, Keyboard, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import type { ScanSettings } from "@/lib/remito-barcode";
import { saveScanSettings, scanRemito, type ScanResult } from "./actions";

function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const c = new Ctx(), o = c.createOscillator(), g = c.createGain();
    o.frequency.value = ok ? 1200 : 300; g.gain.value = 0.2;
    o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + (ok ? 0.15 : 0.35));
    o.onended = () => c.close().catch(() => null);
  } catch { /* sin sonido */ }
  try { navigator.vibrate?.(ok ? 80 : [60, 60, 60]); } catch { /* sin vibración */ }
}

type Log = { at: number; text: string; res: ScanResult };

/** Escáner de códigos de barras de remitos con la cámara del celular (o un lector USB / Bluetooth). */
export function RemitoScanner() {
  const router = useRouter();
  const video = React.useRef<HTMLVideoElement>(null);
  const stop = React.useRef<(() => void) | null>(null);
  const last = React.useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const busy = React.useRef(false);
  const [on, setOn] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [log, setLog] = React.useState<Log[]>([]);
  const [pending, setPending] = React.useState<Extract<ScanResult, { ok: true }> | null>(null);
  const [manual, setManual] = React.useState("");

  const handle = React.useCallback(async (text: string, confirm = false) => {
    const now = Date.now();
    if (!confirm && (busy.current || (text === last.current.text && now - last.current.at < 4000))) return;
    busy.current = true; last.current = { text, at: now };
    const res = await scanRemito(text, confirm).catch(() => ({ ok: false as const, error: "Sin conexión" }));
    busy.current = false;
    if (res.ok && res.state === "confirmar") { setPending(res); beep(true); return; }
    setPending(null);
    beep(res.ok);
    setLog((l) => [{ at: now, text, res }, ...l].slice(0, 20));
    if (res.ok && res.state === "confirmado") { toast.success(`Remito ${res.label} confirmado`, { description: res.recipient }); router.refresh(); }
    else if (res.ok) toast(`El remito ${res.label} ya estaba confirmado`);
    else toast.error(res.error);
  }, [router]);

  const start = React.useCallback(async () => {
    setErr(null);
    try {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import("@zxing/browser"), import("@zxing/library")]);
      const hints = new Map(); hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]); hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
      const controls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } }, video.current!, (r) => { if (r) void handle(r.getText()); });
      stop.current = () => controls.stop();
      setOn(true);
    } catch (e) {
      setErr((e as Error)?.name === "NotAllowedError" ? "Diste que no al permiso de la cámara. Habilitalo en los ajustes del navegador para esta página." : "No se pudo abrir la cámara. Podés escribir el número abajo o usar un lector.");
      setOn(false);
    }
  }, [handle]);
  React.useEffect(() => () => stop.current?.(), []);

  // lector USB / Bluetooth: escribe los 14 dígitos y Enter
  React.useEffect(() => {
    let buf = "", t = 0;
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "Enter") { if (/^9[01]\d{12}$/.test(buf)) void handle(buf); buf = ""; return; }
      if (/^\d$/.test(e.key)) { if (Date.now() - t > 120) buf = ""; buf += e.key; t = Date.now(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [handle]);

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="relative aspect-[4/3] max-h-[60vh] w-full bg-black sm:aspect-video">
          <video ref={video} className={cn("absolute inset-0 size-full object-cover", !on && "opacity-0")} muted playsInline />
          {on && <div className="pointer-events-none absolute inset-x-[10%] top-1/2 h-24 -translate-y-1/2 rounded-lg border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,.35)]"><div className="absolute inset-x-2 top-1/2 h-px bg-[#ff4d4d]" /></div>}
          {!on && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div>
                <Camera className="mx-auto size-10 text-white/60" />
                <p className="mt-3 text-sm text-white/80">Apuntá al código de barras de abajo del remito.<br />Se confirma solo, sin sacar foto.</p>
                <Button className="mt-4" onClick={start}><Camera /> Abrir cámara</Button>
                {err && <p className="mx-auto mt-3 max-w-sm text-xs text-[#ff8a8a]">{err}</p>}
              </div>
            </div>
          )}
          {on && <button type="button" onClick={() => { stop.current?.(); setOn(false); }} className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg bg-black/60 px-2.5 py-1.5 text-xs text-white"><CameraOff className="size-3.5" /> Cerrar</button>}
        </div>
        {pending && (
          <div className="flex flex-wrap items-center gap-3 border-t border-border bg-warn-soft px-4 py-3">
            <div className="min-w-0 flex-1"><p className="text-sm font-medium">Remito {pending.label} · {pending.recipient}</p><p className="text-xs text-fg-muted">{pending.po ? `OC ${pending.po} · ` : ""}¿Confirmar como {pending.action === "firmado" ? "firmado" : "entregado"}?</p></div>
            <Button size="sm" onClick={() => handle(last.current.text, true)}>Confirmar</Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>Cancelar</Button>
          </div>
        )}
        <form className="flex items-center gap-2 border-t border-border px-4 py-3" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { void handle(manual.trim()); setManual(""); } }}>
          <Keyboard className="size-4 shrink-0 text-fg-subtle" />
          <Input value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" placeholder="O escribí el número del código" className="h-9" />
          <Button type="submit" variant="secondary" size="sm">Confirmar</Button>
        </form>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardHeader title="Escaneados ahora" />
          <ul className="divide-y divide-border">
            {log.map((l) => (
              <li key={l.at} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                {l.res.ok ? <CheckCircle2 className="size-4 shrink-0 text-accent" /> : <XCircle className="size-4 shrink-0 text-danger" />}
                {l.res.ok ? (
                  <Link href={`/remitos/${l.res.id}`} className="min-w-0 flex-1 truncate hover:underline">
                    <span className="font-mono">{l.res.label}</span> · {l.res.recipient}{l.res.po ? ` · OC ${l.res.po}` : ""}
                  </Link>
                ) : <span className="min-w-0 flex-1 truncate text-fg-muted">{l.res.error} <span className="font-mono text-xs text-fg-subtle">({l.text})</span></span>}
                <span className="shrink-0 text-xs text-fg-subtle">{l.res.ok ? (l.res.state === "ya_estaba" ? "ya estaba" : l.res.action === "firmado" ? "firmado" : "entregado") : ""}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 accent-white" />
      <span><span className="block text-sm">{label}</span>{hint && <span className="block text-xs text-fg-subtle">{hint}</span>}</span>
    </label>
  );
}

/** Ajustes del código de barras y del escaneo. */
export function ScanSettingsForm({ initial, canEdit }: { initial: ScanSettings; canEdit: boolean }) {
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof ScanSettings>(k: K, x: ScanSettings[K]) => setV({ ...v, [k]: x });
  return (
    <Card>
      <CardHeader title="Ajustes" description="Dónde sale el código de barras y qué pasa al escanearlo." />
      <CardBody className="space-y-4">
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Código de barras en el remito</p>
          <Toggle checked={v.barcode_provisional} onChange={(x) => set("barcode_provisional", x)} label="En los remitos provisorios" hint="Abajo del todo de la hoja" />
          <Toggle checked={v.barcode_official} onChange={(x) => set("barcode_official", x)} label="En los remitos oficiales" />
        </div>
        <div className="space-y-2.5">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">Al escanear</p>
          <div className="flex w-fit rounded-lg bg-field p-0.5">
            {([["entregado", "Marcar entregado"], ["firmado", "Marcar firmado (sin foto)"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set("scan_action", k)} className={cn("rounded-md px-3 py-1.5 text-xs font-medium", v.scan_action === k ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>{l}</button>
            ))}
          </div>
          <Toggle checked={v.scan_confirm} onChange={(x) => set("scan_confirm", x)} label="Pedir confirmación antes" hint="Si está apagado, se confirma apenas lee el código" />
        </div>
        <p className="flex gap-2 rounded-lg bg-field/60 px-3 py-2 text-xs text-fg-muted"><Info className="mt-0.5 size-3.5 shrink-0" />Los cambios del código salen en los remitos que imprimas de ahora en adelante (también al reimprimir uno viejo).</p>
        {canEdit && <Button loading={busy} onClick={async () => { setBusy(true); const r = await saveScanSettings(v); setBusy(false); if (r.ok) toast.success("Ajustes guardados"); else toast.error(r.error); }}>Guardar</Button>}
      </CardBody>
    </Card>
  );
}
