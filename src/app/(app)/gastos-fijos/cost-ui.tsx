"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { addFromArca, saveFixedCost, setCostActive, setMonthPaid, type CostInput } from "./actions";

export const CATEGORY_LABEL: Record<string, string> = {
  sueldos: "Sueldos y cargas", alquiler: "Alquiler", servicios: "Servicios (luz, gas, agua)", telefonia: "Teléfono e internet", salud: "Prepaga / salud",
  impuestos: "Impuestos y tasas", seguros: "Seguros", honorarios: "Honorarios (contador, abogado)", bancos: "Bancos y comisiones", software: "Sistemas y suscripciones", vehiculos: "Vehículos y combustible", otros: "Otros",
};
const FREQ: [number, string][] = [[1, "Mensual"], [2, "Bimestral"], [3, "Trimestral"], [6, "Semestral"], [12, "Anual"]];
const EMPTY: CostInput = { name: "", category: "otros", amount: "", frequency: 1, due_day: "", notes: "" };

export function CostDialog({ initial, id, trigger }: { initial?: Partial<CostInput>; id?: string; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState<CostInput>({ ...EMPTY, ...initial });
  const [saving, setSaving] = React.useState(false);
  const set = (k: keyof CostInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    setSaving(true);
    const r = await saveFixedCost(f, id);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(id ? "Gasto actualizado" : "Gasto agregado");
    setOpen(false); if (!id) setF(EMPTY);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> Agregar gasto</Button>}</DialogTrigger>
      <DialogContent title={id ? "Editar gasto fijo" : "Nuevo gasto fijo"} description="Sueldos, alquiler, contador, seguros… lo que pagás siempre." className="max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nombre" className="col-span-2" htmlFor="fc-name"><Input id="fc-name" value={f.name} onChange={set("name")} placeholder="Ej.: Sueldo Juan, Alquiler depósito" /></Field>
          <Field label="Categoría" htmlFor="fc-cat">
            <NativeSelect id="fc-cat" value={f.category} onChange={set("category")}>
              {Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Importe" htmlFor="fc-amt"><Input id="fc-amt" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="0,00" className="tabular" /></Field>
          <Field label="Frecuencia" htmlFor="fc-freq">
            <NativeSelect id="fc-freq" value={String(f.frequency)} onChange={set("frequency")}>
              {FREQ.map(([n, l]) => <option key={n} value={n}>{l}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Vence el día" htmlFor="fc-day"><Input id="fc-day" inputMode="numeric" value={f.due_day} onChange={set("due_day")} placeholder="10" /></Field>
          <Field label="Notas" className="col-span-2" htmlFor="fc-notes"><Input id="fc-notes" value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} loading={saving} disabled={!f.name.trim()}>Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditCost(props: { id: string; initial: Partial<CostInput> }) {
  return <CostDialog {...props} trigger={<button type="button" className="text-fg-subtle hover:text-fg" title="Editar"><Pencil className="size-3.5" /></button>} />;
}

export function PaidToggle({ costId, period, paid, amount, billId }: { costId: string; period: string; paid: boolean; amount: string; billId?: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <button type="button" disabled={busy} onClick={async () => {
      setBusy(true); const r = await setMonthPaid(costId, period, !paid, amount, billId); setBusy(false);
      if (!r.ok) toast.error(r.error); else router.refresh();
    }} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", paid ? "bg-accent-soft text-accent" : "bg-field text-fg-muted hover:text-fg")}>
      {paid && <Check className="size-3" />}{paid ? "Pagado" : "Marcar pagado"}
    </button>
  );
}

export function ActiveToggle({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  return (
    <button type="button" title={active ? "Pausar (deja de sumar)" : "Reactivar"} className={cn("hover:text-fg", active ? "text-fg-subtle" : "text-warn")}
      onClick={async () => { const r = await setCostActive(id, !active); if (!r.ok) toast.error(r.error); else router.refresh(); }}>
      <Power className="size-3.5" />
    </button>
  );
}

export function AddArcaButton({ cuit, name, avg }: { cuit: string; name: string; avg: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await addFromArca(cuit, name, avg); setBusy(false);
      if (!r.ok) toast.error(r.error); else { toast.success(`${name} agregado a gastos fijos`); router.refresh(); }
    }}>{!busy && <Plus />} Es gasto fijo</Button>
  );
}
