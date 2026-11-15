"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { linkVoucherToOrder, refreshSuppliersNow, saveAnnualLimit, searchOrders, setJurisdiction } from "./arca-actions";

/** Vincular a mano una factura emitida con su orden de compra (o quitar el vínculo). */
export function LinkOrderButton({ voucherId, linked, total, name }: { voucherId: string; linked: boolean; total: number; name: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [rows, setRows] = React.useState<{ id: string; label: string; total: number; date: string | null }[]>([]);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => { const r = await searchOrders(q); if (r.ok) setRows(r.rows); }, 250);
    return () => clearTimeout(t);
  }, [q, open]);
  const save = async (po: string | null) => {
    setBusy(true);
    const r = await linkVoucherToOrder(voucherId, po);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(po ? "Factura vinculada a la OC" : "Vínculo quitado");
    setOpen(false); router.refresh();
  };
  if (linked) return <Button size="sm" variant="ghost" loading={busy} onClick={() => save(null)} title="Quitar vínculo">{!busy && <Unlink />}</Button>;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="secondary"><Link2 /> Vincular OC</Button></DialogTrigger>
      <DialogContent title="Vincular factura con una OC" description={`${name} · ${formatMoney(total)}`}>
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Número de OC, BAC o cliente" />
        <ul className="mt-3 max-h-72 divide-y divide-border overflow-auto rounded-xl border border-border">
          {rows.map((o) => (
            <li key={o.id}>
              <button disabled={busy} onClick={() => save(o.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-surface-2/60">
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                <span className="text-xs text-fg-subtle tabular">{o.date ? formatDate(o.date) : ""} · {formatMoney(o.total)}</span>
              </button>
            </li>
          ))}
          {!rows.length && <li className="px-3 py-3 text-xs text-fg-subtle">{q.trim().length < 2 ? "Escribí al menos 2 letras." : "Nada coincide."}</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export const JURISDICTIONS = ["CABA", "Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán", "Nacional"];

export function JurisdictionSelect({ doc, value, guessed, disabled }: { doc: string; value: string; guessed: boolean; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <select disabled={disabled || busy} defaultValue={value} title={guessed ? "Estimada por el nombre del cliente: confirmala" : undefined}
      className={`h-8 rounded-full border bg-field px-2 text-xs ${guessed ? "border-warn/50 text-warn" : "border-card-border"}`}
      onChange={async (e) => {
        setBusy(true); const r = await setJurisdiction(doc, e.target.value); setBusy(false);
        if (!r.ok) toast.error(r.error); else { toast.success("Jurisdicción guardada"); router.refresh(); }
      }}>
      {!JURISDICTIONS.includes(value) && <option value={value}>{value}</option>}
      {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
    </select>
  );
}

export function AnnualLimitForm({ amount, label, disabled }: { amount: number | null; label: string | null; disabled: boolean }) {
  const router = useRouter();
  const [a, setA] = React.useState(amount ? String(amount).replace(".", ",") : "");
  const [l, setL] = React.useState(label ?? "");
  const [busy, setBusy] = React.useState(false);
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => {
      e.preventDefault();
      const n = a.trim() ? Number(parseArNumber(a)) : null;
      if (a.trim() && !(n && n > 0)) return toast.error("Monto inválido");
      setBusy(true); const r = await saveAnnualLimit(n, l); setBusy(false);
      if (!r.ok) toast.error(r.error); else { toast.success("Límite guardado"); router.refresh(); }
    }}>
      <label className="text-xs text-fg-muted">Límite anual<Input disabled={disabled} value={a} onChange={(e) => setA(e.target.value)} placeholder="Ej.: 500.000.000" className="mt-1 h-9 w-40" /></label>
      <label className="text-xs text-fg-muted">Qué es<Input disabled={disabled} value={l} onChange={(e) => setL(e.target.value)} placeholder="Ej.: tope Pyme tramo 1" className="mt-1 h-9 w-48" /></label>
      <Button size="sm" type="submit" loading={busy} disabled={disabled}>Guardar</Button>
    </form>
  );
}

export function RefreshSuppliersButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await refreshSuppliersNow(); setBusy(false);
      if (!r.ok) return toast.error(r.error);
      if (r.warning) toast.warning(r.warning, { duration: 15000 }); else toast.success(`${r.checked} proveedores revisados`);
      router.refresh();
    }}>{!busy && <RefreshCw />} Revisar proveedores ahora</Button>
  );
}
