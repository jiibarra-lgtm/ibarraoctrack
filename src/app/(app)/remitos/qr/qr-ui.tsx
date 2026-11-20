"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { QR_MENU, QR_TARGETS, qrSvg, type QrMenuKey, type QrSettings, type QrTarget } from "@/lib/qr";
import { cn } from "@/lib/utils";
import { bulkQr, saveQrCode, saveQrSettings, setClaimStatus } from "./actions";

const SWATCHES = ["#0f3d2e", "#111111", "#1d4ed8", "#7c2d12", "#b8860b", "#334155"];

/** Vista previa del QR tal como sale en el remito. */
export function QrPreview({ url, color, logo, caption, size = 132 }: { url: string; color: string; logo: boolean; caption: string; size?: number }) {
  const [svg, setSvg] = React.useState("");
  React.useEffect(() => { qrSvg(url, { color, logo }).then(setSvg).catch(() => setSvg("")); }, [url, color, logo]);
  return (
    <div className="inline-flex flex-col items-start gap-1.5 rounded-xl border border-card-border bg-white p-3 text-[#111]">
      <div style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: svg }} />
      <span className="max-w-[160px] text-[11px] leading-tight">{caption}</span>
    </div>
  );
}

function MenuPicker({ value, onChange }: { value: QrMenuKey[]; onChange: (v: QrMenuKey[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(QR_MENU) as QrMenuKey[]).map((k) => {
        const on = value.includes(k);
        return (
          <button key={k} type="button" onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}
            className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium", on ? "border-primary bg-primary text-primary-fg" : "border-card-border bg-field text-fg-muted hover:text-fg")}>
            {on && <Check className="size-3" />}{QR_MENU[k]}
          </button>
        );
      })}
    </div>
  );
}

/** Plantilla general: diseño y qué muestra por defecto. */
export function QrSettingsForm({ initial, sampleUrl, canEdit }: { initial: QrSettings; sampleUrl: string; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof QrSettings>(k: K, x: QrSettings[K]) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setBusy(true);
    const r = await saveQrSettings({ ...v, custom_url: v.custom_url ?? "", whatsapp: v.whatsapp ?? "" });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Plantilla guardada: se aplica a todos los remitos");
    router.refresh();
  };
  return (
    <div className="grid gap-6 p-5 lg:grid-cols-[1fr_auto]">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Color del QR">
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => set("color", c)} disabled={!canEdit}
                className={cn("size-7 rounded-full border-2", v.color === c ? "border-fg" : "border-transparent")} style={{ background: c }} />
            ))}
            <input type="color" value={v.color} onChange={(e) => set("color", e.target.value)} disabled={!canEdit} className="size-7 cursor-pointer rounded border border-card-border bg-transparent" />
          </div>
        </Field>
        <Field label="Logo de Ibarra en el centro">
          <label className="flex h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={v.logo} onChange={(e) => set("logo", e.target.checked)} disabled={!canEdit} className="size-4" /> Mostrar el logo
          </label>
        </Field>
        <Field label="Texto abajo del QR" className="sm:col-span-2" hint="Sale impreso en cada remito, debajo del código">
          <Input value={v.caption} maxLength={60} onChange={(e) => set("caption", e.target.value)} disabled={!canEdit} />
        </Field>
        <Field label="Al escanear">
          <NativeSelect value={v.mode} onChange={(e) => set("mode", e.target.value as QrSettings["mode"])} disabled={!canEdit}>
            <option value="menu">Mostrar un menú con opciones</option>
            <option value="single">Ir directo a una sola cosa</option>
          </NativeSelect>
        </Field>
        {v.mode === "single" ? (
          <Field label="Va directo a">
            <NativeSelect value={v.target} onChange={(e) => set("target", e.target.value as QrTarget)} disabled={!canEdit}>
              {(Object.keys(QR_TARGETS) as QrTarget[]).map((k) => <option key={k} value={k}>{QR_TARGETS[k]}</option>)}
            </NativeSelect>
          </Field>
        ) : <div />}
        {v.mode === "menu" && (
          <Field label="Opciones del menú" className="sm:col-span-2" hint="Solo aparecen las que tienen sentido (por ejemplo, la factura cuando ya está cargada)">
            <MenuPicker value={v.menu} onChange={(m) => set("menu", m)} />
          </Field>
        )}
        {(v.mode === "single" && v.target === "url") && (
          <Field label="Link" className="sm:col-span-2"><Input value={v.custom_url ?? ""} placeholder="https://" onChange={(e) => set("custom_url", e.target.value)} disabled={!canEdit} /></Field>
        )}
        <Field label="WhatsApp para consultas" hint="Si lo dejás vacío, usa el del remito">
          <Input value={v.whatsapp ?? ""} placeholder="+54 9 11 …" onChange={(e) => set("whatsapp", e.target.value)} disabled={!canEdit} />
        </Field>
        {canEdit && <div className="flex items-end"><Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar plantilla"}</Button></div>}
      </div>
      <div className="flex flex-col items-center gap-2">
        <QrPreview url={sampleUrl} color={v.color} logo={v.logo} caption={v.caption} size={150} />
        <span className="text-xs text-fg-subtle">Así sale en el remito</span>
      </div>
    </div>
  );
}

export type QrRow = {
  id: string; code: string; label: string | null; mode: "single" | "menu" | null; target: QrTarget | null; menu: QrMenuKey[] | null;
  custom_url: string | null; active: boolean;
};

/** Editor de un QR puntual. */
export function QrCodeEditor({ row, defaults, link, canEdit, trigger }: { row: QrRow; defaults: QrSettings; link: string; canEdit: boolean; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"default" | "single" | "menu">(row.mode ?? "default");
  const [target, setTarget] = React.useState<QrTarget | "default">(row.target ?? "default");
  const [menu, setMenu] = React.useState<QrMenuKey[] | null>(row.menu);
  const [url, setUrl] = React.useState(row.custom_url ?? "");
  const [active, setActive] = React.useState(row.active);
  const [busy, setBusy] = React.useState(false);
  const effMode = mode === "default" ? defaults.mode : mode;
  const save = async () => {
    setBusy(true);
    const r = await saveQrCode({ id: row.id, mode, target: effMode === "single" ? target : "default", menu: effMode === "menu" ? menu : null, custom_url: url, active });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("QR actualizado: el papel impreso ya muestra lo nuevo");
    setOpen(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button variant="ghost" size="sm"><Pencil className="size-3.5" /> Cambiar</Button>}</DialogTrigger>
      <DialogContent title={`QR ${row.code}`} description={row.label ?? undefined}>
        <div className="grid gap-4">
          <p className="break-all rounded-lg bg-field px-3 py-2 font-mono text-xs">{link}</p>
          <Field label="Al escanear">
            <NativeSelect value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} disabled={!canEdit}>
              <option value="default">Como la plantilla ({defaults.mode === "menu" ? "menú" : QR_TARGETS[defaults.target].toLowerCase()})</option>
              <option value="menu">Mostrar un menú con opciones</option>
              <option value="single">Ir directo a una sola cosa</option>
            </NativeSelect>
          </Field>
          {effMode === "single" && (
            <Field label="Va directo a">
              <NativeSelect value={target} onChange={(e) => setTarget(e.target.value as typeof target)} disabled={!canEdit}>
                <option value="default">Como la plantilla ({QR_TARGETS[defaults.target].toLowerCase()})</option>
                {(Object.keys(QR_TARGETS) as QrTarget[]).map((k) => <option key={k} value={k}>{QR_TARGETS[k]}</option>)}
              </NativeSelect>
            </Field>
          )}
          {effMode === "single" && target === "url" && <Field label="Link"><Input value={url} placeholder="https://" onChange={(e) => setUrl(e.target.value)} disabled={!canEdit} /></Field>}
          {effMode === "menu" && (
            <Field label="Opciones del menú">
              <label className="mb-1 flex items-center gap-2 text-sm"><input type="checkbox" checked={menu === null} onChange={(e) => setMenu(e.target.checked ? null : defaults.menu)} disabled={!canEdit} /> Las de la plantilla</label>
              {menu !== null && <MenuPicker value={menu} onChange={setMenu} />}
            </Field>
          )}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={!canEdit} /> QR activo (si lo desactivás, al escanear dice que no está disponible)</label>
          {canEdit && <Button onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Cambio masivo de los QR seleccionados. */
export function QrBulk({ ids, canEdit }: { ids: string[]; canEdit: boolean }) {
  const router = useRouter();
  const [mode, setMode] = React.useState<"default" | "single" | "menu">("default");
  const [target, setTarget] = React.useState<QrTarget>("remito");
  const [busy, setBusy] = React.useState(false);
  if (!canEdit || !ids.length) return null;
  const run = async () => {
    setBusy(true);
    const r = await bulkQr({ ids, mode, target: mode === "single" ? target : "default" });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(`${r.n} QR actualizados`);
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-sm">
      <span className="text-fg-muted">Cambiar los {ids.length} de esta lista a:</span>
      <NativeSelect className="h-9 w-auto" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
        <option value="default">Lo de la plantilla</option>
        <option value="menu">Menú con opciones</option>
        <option value="single">Una sola cosa…</option>
      </NativeSelect>
      {mode === "single" && (
        <NativeSelect className="h-9 w-auto" value={target} onChange={(e) => setTarget(e.target.value as QrTarget)}>
          {(Object.keys(QR_TARGETS) as QrTarget[]).filter((k) => k !== "url").map((k) => <option key={k} value={k}>{QR_TARGETS[k]}</option>)}
        </NativeSelect>
      )}
      <Button size="sm" variant="secondary" onClick={run} disabled={busy}>{busy ? "Aplicando…" : "Aplicar a todos"}</Button>
    </div>
  );
}

export function ClaimButtons({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const go = async (s: "visto" | "resuelto" | "nuevo") => {
    const r = await setClaimStatus(id, s);
    if (!r.ok) toast.error(r.error); else router.refresh();
  };
  return status === "resuelto"
    ? <Button size="sm" variant="ghost" onClick={() => go("nuevo")}>Reabrir</Button>
    : <Button size="sm" variant="secondary" onClick={() => go("resuelto")}>Marcar resuelto</Button>;
}
