"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/lib/format";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { importConvenio, setConvenioCost } from "./actions";

/** Campo de costo por renglón: se guarda al salir del campo o con Enter. */
const parseCost = (t: string) => { const x = t.trim().replace(/\$/g, "").replace(/\s/g, ""); if (!x) return null; const n = Number(x.includes(",") ? x.replace(/\./g, "").replace(",", ".") : x); return Number.isFinite(n) ? n : null; };

const VAT = 1.21;
/** Costo neto guardado → costo con IVA para mostrar (redondeo a centavos, mitad hacia arriba). */
const gross = (net: string | null) => (net === null ? null : String(Math.round(Number(net) * VAT * 100) / 100));

/**
 * Costo + ganancia del renglón. En esta pantalla el costo se carga CON IVA (como lo pagás);
 * se guarda sin IVA (÷ 1,21) para el resto del sistema. Ganancia = precio del BAC − tu costo, ambos con IVA,
 * y el % es sobre el costo. Se recalcula al escribir.
 */
export function CostMargin({ id, value, price, disabled, picker }: { id: string; value: string | null; price: number | null; disabled?: boolean; picker?: React.ReactNode }) {
  const [typed, setTyped] = React.useState<string | null>(null);
  const shown = gross(value);
  const cost = typed !== null ? parseCost(typed) : shown !== null ? Number(shown) : null;
  const gain = price !== null && cost !== null ? price - cost : null;
  const pct = gain !== null && cost ? (gain / cost) * 100 : null;
  return (
    <>
      <div className="flex flex-col items-end gap-1">
        <CostInput key={`${id}-${value}`} id={id} value={shown} disabled={disabled} onType={setTyped} vatIncluded />
        {picker}
      </div>
      <div className="text-right tabular" title={gain !== null ? `Precio ${price!.toFixed(2)} − costo ${cost!.toFixed(2)} (los dos con IVA) = ${gain.toFixed(2)} por unidad` : undefined}>
        <p className={cn("font-medium", pct === null ? "text-fg-subtle" : pct < 10 ? "text-danger" : pct < 20 ? "text-warn" : "text-accent")}>{pct !== null ? `${pct.toFixed(0)}%` : "—"}</p>
        {gain !== null && <p className="text-[11px] text-fg-subtle">{gain >= 0 ? "+" : ""}{formatMoney(gain)} c/u</p>}
      </div>
    </>
  );
}

export function CostInput({ id, value, disabled, onType, vatIncluded }: { id: string; value: string | null; disabled?: boolean; onType?: (v: string | null) => void; vatIncluded?: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState(value ?? "");
  const [saved, setSaved] = React.useState(value ?? "");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (v.trim() === saved.trim()) return;
    setBusy(true);
    const n = parseCost(v);
    const toSave = vatIncluded && n !== null ? String(Math.round((n / VAT) * 100) / 100) : v;
    const r = await safeAction(() => setConvenioCost(id, toSave));
    setBusy(false);
    if (!r.ok) { if (r.error) toast.error(r.error); setV(saved); onType?.(null); return; }
    setSaved(v); router.refresh();
  };
  return (
    <Input value={v} disabled={disabled || busy} inputMode="decimal" placeholder={vatIncluded ? "Costo c/IVA" : "Tu costo"} aria-label={vatIncluded ? "Tu costo con IVA" : "Tu costo sin IVA"}
      onChange={(e) => { setV(e.target.value); onType?.(e.target.value); }} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-8 w-28 text-right tabular" />
  );
}

export function ImportConvenio() {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <input ref={ref} type="file" accept=".xlsx" multiple hidden onChange={async (e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (!files.length) return;
        setBusy(true);
        for (const f of files) {
          const fd = new FormData(); fd.set("file", f);
          const r = await importConvenio(fd);
          if (r.ok) toast.success(`${r.contract}: ${r.n} renglones cargados`); else toast.error(`${f.name}: ${r.error}`);
        }
        setBusy(false); router.refresh();
      }} />
      <Button size="sm" variant="secondary" loading={busy} onClick={() => ref.current?.click()}>{!busy && <Upload />}Subir Excel del convenio</Button>
    </>
  );
}
