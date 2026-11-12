"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Replace, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { cn } from "@/lib/utils";
import { savePoSubstitution } from "./substitution-actions";

export type Subst = { id: string; purchase_order_item_id: string; description: string; quantity: string; unit_cost: string; notes: string | null };
type L = { description: string; quantity: string; unit_cost: string };
const n = (s: string) => Number(parseArNumber(s) ?? NaN);
const show = (x: number) => String(Number(x)).replace(".", ",");

/** "Por otra cosa": lo que realmente se entregó en un renglón, con su costo real. */
export function SubstitutionDialog({ itemId, label, saleNet, cur, current, disabled }: {
  itemId: string; label: string; saleNet: number; cur: string; current: Subst[]; disabled: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const init = (): L[] => current.length ? current.map((s) => ({ description: s.description, quantity: show(Number(s.quantity)), unit_cost: show(Number(s.unit_cost)) })) : [{ description: "", quantity: "1", unit_cost: "" }];
  const [lines, setLines] = React.useState<L[]>(init);
  const [withVat, setWithVat] = React.useState(false);
  const [notes, setNotes] = React.useState(current[0]?.notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const k = withVat ? 1.21 : 1;
  const cost = lines.reduce((a, l) => a + (n(l.quantity) || 0) * (n(l.unit_cost) || 0) / k, 0);
  const margin = saleNet - cost;
  const set = (i: number, f: keyof L) => (e: React.ChangeEvent<HTMLInputElement>) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, [f]: e.target.value } : x)));
  const valid = lines.every((l) => !l.description.trim() || (n(l.quantity) > 0 && n(l.unit_cost) >= 0));
  const save = async (clear = false) => {
    setBusy(true);
    const r = await savePoSubstitution(itemId, clear ? [] : lines.filter((l) => l.description.trim()).map((l) => ({ description: l.description.trim(), quantity: n(l.quantity), unit_cost: Math.round((n(l.unit_cost) / k) * 10000) / 10000 })), notes);
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(clear ? "El renglón vuelve a ser el producto de la OC" : "Guardado: el costo del renglón es lo que entregaste");
    setOpen(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) { setLines(init()); setNotes(current[0]?.notes ?? ""); } }}>
      <DialogTrigger asChild>
        <Button size="sm" variant={current.length ? "secondary" : "ghost"} disabled={disabled} className="h-8"><Replace /> {current.length ? "Entregado por otra cosa" : "Por otra cosa"}</Button>
      </DialogTrigger>
      <DialogContent title={`Por otra cosa · ${label}`} description="Cargá lo que entregaste realmente con tu costo. Ese costo reemplaza al del renglón y se compara con lo que paga la OC." className="max-w-2xl">
        <div className="mt-4 space-y-3">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-3 py-2 text-left font-medium">Lo que entregaste</th><th className="w-24 px-2 text-right font-medium">Cant.</th><th className="w-36 px-2 text-right font-medium">Costo c/u</th><th className="w-28 px-2 text-right font-medium">Subtotal</th><th className="w-8" /></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b border-border last:border-0">
                    <td className="px-2 py-1.5"><Input value={l.description} onChange={set(i, "description")} placeholder="Ej. Silla de oficina" className="h-8" /></td>
                    <td className="px-1"><Input value={l.quantity} onChange={set(i, "quantity")} inputMode="decimal" className="h-8 text-right tabular" /></td>
                    <td className="px-1"><Input value={l.unit_cost} onChange={set(i, "unit_cost")} inputMode="decimal" className="h-8 text-right tabular" /></td>
                    <td className="px-2 text-right tabular">{formatMoney(((n(l.quantity) || 0) * (n(l.unit_cost) || 0)) / k, cur)}</td>
                    <td className="px-1"><button type="button" disabled={lines.length === 1} onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))} className="text-fg-subtle hover:text-danger disabled:opacity-30"><Trash2 className="size-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center justify-between border-t border-border px-3 py-2">
              <button type="button" onClick={() => setLines((xs) => [...xs, { description: "", quantity: "1", unit_cost: "" }])} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"><Plus className="size-3.5" /> Agregar producto</button>
              <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /> Los costos que puse incluyen IVA</label>
            </div>
          </div>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota (opcional): por qué se entregó otra cosa" />
          <div className="grid grid-cols-3 gap-3 rounded-xl bg-surface-2/60 p-3 text-sm tabular">
            <div><p className="text-xs text-fg-subtle">Paga la OC (sin IVA)</p><p className="font-semibold">{formatMoney(saleNet, cur)}</p></div>
            <div><p className="text-xs text-fg-subtle">Tu costo real</p><p className="font-semibold">{formatMoney(cost, cur)}</p></div>
            <div><p className="text-xs text-fg-subtle">Ganancia del renglón</p><p className={cn("font-semibold", margin < 0 ? "text-danger" : "text-accent")}>{formatMoney(margin, cur)}{saleNet > 0 && <span className="ml-1 text-xs font-normal">({((margin / saleNet) * 100).toFixed(1)}%)</span>}</p></div>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            {current.length > 0 ? <Button variant="ghost" disabled={busy} onClick={() => save(true)}>Volver al producto de la OC</Button> : <span />}
            <Button loading={busy} disabled={!valid} onClick={() => save()}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
