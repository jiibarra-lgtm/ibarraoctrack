"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { linkSupplierCost, searchSupplierItems, type SupplierPick } from "@/app/(app)/analitica/mes/actions";

const STOP = new Set(["de", "del", "la", "el", "los", "las", "con", "para", "por", "x", "tipo", "marca", "color", "medida", "unidad", "unidades", "uni", "und", "cm", "mm", "mts"]);
/** Primeras palabras útiles de la descripción del renglón, para la búsqueda inicial. */
const suggest = (d: string) => d.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w.toLowerCase()) && !/^\d+$/.test(w)).slice(0, 2).join(" ");

/**
 * Botón para tomar el costo de un renglón de OC de un producto comprado (Precios de proveedores).
 * El costo sin IVA queda = neto unitario de la factura ÷ cuántas unidades de la OC salen de una comprada.
 */
export function SupplierCostPicker({ itemId, convenioLineId, description, linkedLabel, disabled }: {
  itemId: string; convenioLineId: string | null; description: string; linkedLabel?: string | null; disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState(() => suggest(description));
  const [rows, setRows] = React.useState<SupplierPick[] | null>(null);
  const [pick, setPick] = React.useState<SupplierPick | null>(null);
  const [div, setDiv] = React.useState("1");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await searchSupplierItems(q);
      setRows(r.ok ? r.rows : []);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const d = Number(div.replace(",", ".")) || 0;
  const cost = pick && d > 0 ? pick.unit_net / d : null;

  const save = async (source: string | null) => {
    setBusy(true);
    const r = await linkSupplierCost(itemId, source, d || 1, convenioLineId);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(source ? `Costo tomado de la compra: ${formatMoney("cost" in r ? r.cost : 0)} c/u sin IVA` : "Se quitó el vínculo con la compra");
    setOpen(false); setPick(null); router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setPick(null); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant={linkedLabel ? "secondary" : "ghost"} disabled={disabled} title={linkedLabel ? `Costo de: ${linkedLabel}` : "Tomar el costo de un producto comprado"}
          className={cn("h-8 px-2", linkedLabel && "text-accent")}>
          <Link2 />
        </Button>
      </DialogTrigger>
      <DialogContent title="Tomar el costo de un producto comprado" description={description}>
        {linkedLabel && (
          <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-accent/30 bg-accent-soft/40 px-3 py-2 text-xs">
            <span>Ahora: {linkedLabel}</span>
            <Button size="sm" variant="ghost" loading={busy} onClick={() => save(null)}>Quitar vínculo</Button>
          </div>
        )}
        {!pick ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Producto, código o proveedor" className="pl-9" />
            </div>
            <ul className="mt-3 max-h-80 divide-y divide-border overflow-auto rounded-xl border border-border">
              {rows === null && <li className="px-3 py-3 text-xs text-fg-subtle">Buscando…</li>}
              {rows?.length === 0 && <li className="px-3 py-3 text-xs text-fg-subtle">No hay compras que coincidan. Probá con otra palabra o con el nombre del proveedor.</li>}
              {rows?.map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => { setPick(r); setDiv(r.pack && r.pack > 1 ? String(r.pack) : "1"); }} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-surface-2/60">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.description}</span>
                      <span className="block truncate text-xs text-fg-subtle">{r.supplier} · {r.date ? formatDate(r.date) : "sin fecha"} · FC {r.number}{r.code ? ` · ${r.code}` : ""}{r.pack ? ` · x${r.pack}` : ""}</span>
                    </span>
                    <span className="text-right text-xs tabular">
                      <span className="block text-sm font-medium">{formatMoney(r.unit_net)}</span>
                      <span className="text-fg-subtle">neto{r.unit ? ` por ${r.unit}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="rounded-xl border border-border px-3 py-2">
              <p className="font-medium">{pick.description}</p>
              <p className="text-xs text-fg-subtle">{pick.supplier} · {pick.date ? formatDate(pick.date) : ""} · neto {formatMoney(pick.unit_net)}{pick.unit ? ` por ${pick.unit}` : ""}{pick.unit_final ? ` · final ${formatMoney(pick.unit_final)}` : ""}</p>
            </div>
            <label className="block text-xs text-fg-muted">
              ¿Cuántas unidades de la OC salen de 1 unidad comprada?
              <Input value={div} onChange={(e) => setDiv(e.target.value)} inputMode="decimal" className="mt-1 h-9 w-32 tabular" />
              <span className="mt-1 block text-fg-subtle">Ej.: si compraste por caja de 1500 y la OC pide unidades, poné 1500. Si la OC pide la caja, dejá 1.</span>
            </label>
            <p className="rounded-xl bg-field px-3 py-2">Costo del renglón: <b className="tabular">{cost !== null ? formatMoney(cost) : "—"}</b> c/u sin IVA</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPick(null)}>Volver</Button>
              <Button loading={busy} disabled={cost === null} onClick={() => save(pick.id)}>Usar este costo</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
