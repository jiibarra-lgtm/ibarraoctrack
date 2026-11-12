"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, EyeOff, GitMerge, Pencil, Plus, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { parseArNumber } from "@/lib/money";
import { stockAction } from "./actions";

type Opt = { id: string; name: string };
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const run = async (a: Parameters<typeof stockAction>[0], p: Record<string, unknown>, ok: string) => {
    setBusy(true); const r = await stockAction(a, p); setBusy(false);
    if (!r.ok) { toast.error(r.error); return false; }
    toast.success(ok); router.refresh(); return true;
  };
  return { busy, run };
}

export function AdjustDialog({ id, name, unit }: { id: string; name: string; unit: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [qty, setQty] = React.useState("");
  const [note, setNote] = React.useState("Conteo físico");
  const [mode, setMode] = React.useState<"suma" | "resta">("suma");
  const { busy, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" title="Ajustar stock" className="text-fg-subtle hover:text-fg"><SlidersHorizontal className="size-4" /></button></DialogTrigger>
      <DialogContent title={`Ajustar stock · ${name}`} description="Para conteos, roturas, muestras o mercadería que entró sin factura.">
        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label="Movimiento" htmlFor="aj-m"><NativeSelect id="aj-m" value={mode} onChange={(e) => setMode(e.target.value as "suma" | "resta")}><option value="suma">Entra (+)</option><option value="resta">Sale (−)</option></NativeSelect></Field>
            <Field label={`Cantidad${unit ? ` (${unit})` : ""}`} htmlFor="aj-q"><Input id="aj-q" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" /></Field>
          </div>
          <Field label="Motivo" htmlFor="aj-n"><Input id="aj-n" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex justify-end"><Button loading={busy} onClick={async () => {
            const n = Number(parseArNumber(qty) ?? NaN);
            if (await run("adjust", { item_id: id, qty: mode === "resta" ? -n : n, note }, "Stock ajustado")) { setOpen(false); setQty(""); }
          }}>Guardar</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditItemDialog({ id, name, unit, min, options }: { id: string; name: string; unit: string | null; min: number; options: Opt[] }) {
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name, unit: unit ?? "", min: String(min).replace(".", ","), into: "" });
  const { busy, run } = useRun();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" title="Editar" className="text-fg-subtle hover:text-fg"><Pencil className="size-4" /></button></DialogTrigger>
      <DialogContent title="Editar producto" description="El mínimo te avisa cuando hay que reponer.">
        <div className="mt-4 space-y-3">
          <Field label="Nombre" htmlFor="ed-n"><Input id="ed-n" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidad" htmlFor="ed-u"><Input id="ed-u" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="caja, unidad, kg…" /></Field>
            <Field label="Stock mínimo" htmlFor="ed-m"><Input id="ed-m" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} inputMode="decimal" /></Field>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" disabled={busy} onClick={async () => { if (await run("update", { item_id: id, active: false }, "Producto ocultado (no cuenta como stock)")) setOpen(false); }}><EyeOff /> No es stock</Button>
            <Button loading={busy} onClick={async () => { if (await run("update", { item_id: id, name: f.name, unit: f.unit, min_qty: Number(parseArNumber(f.min) ?? 0) }, "Guardado")) setOpen(false); }}>Guardar</Button>
          </div>
          <div className="border-t border-border pt-3">
            <Field label="Es el mismo producto que…" htmlFor="ed-i">
              <div className="flex gap-2">
                <NativeSelect id="ed-i" value={f.into} onChange={(e) => setF({ ...f, into: e.target.value })}><option value="">Elegí para unirlos</option>{options.filter((o) => o.id !== id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect>
                <Button variant="secondary" disabled={!f.into || busy} onClick={async () => { if (await run("merge", { from: id, into: f.into }, "Productos unidos")) setOpen(false); }}><GitMerge /> Unir</Button>
              </div>
            </Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LinkRow({ k, description, suggestionId, suggestion, options }: { k: string; description: string; suggestionId: string | null; suggestion: string | null; options: Opt[] }) {
  const [pick, setPick] = React.useState("");
  const { busy, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {suggestionId && <Button size="sm" variant="secondary" disabled={busy} onClick={() => run("link", { key: k, item_id: suggestionId }, "Vinculado")}><Check /> Es {suggestion && suggestion.length > 34 ? `${suggestion.slice(0, 34)}…` : suggestion}</Button>}
      <NativeSelect value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 w-48 text-xs"><option value="">Otro producto…</option>{options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</NativeSelect>
      {pick && <Button size="sm" disabled={busy} onClick={() => run("link", { key: k, item_id: pick }, "Vinculado")}>Vincular</Button>}
      <Button size="sm" variant="ghost" disabled={busy} title="Crear un producto nuevo con este nombre" onClick={() => run("new_item", { key: k, name: description }, "Producto creado")}><Plus /> Nuevo</Button>
      <Button size="sm" variant="ghost" disabled={busy} title="No es mercadería de stock" onClick={() => run("link", { key: k, item_id: null }, "Marcado como no stock")}><X /></Button>
    </div>
  );
}
