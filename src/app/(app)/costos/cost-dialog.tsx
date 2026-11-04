"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { distribute } from "@/lib/profit";
import { formatMoney } from "@/lib/format";
import { parseArNumber, sum } from "@/lib/money";
import { todayISO } from "@/lib/format";
import { saveCost } from "./actions";

export type OrderOption = { id: string; label: string; customer: string | null; sales: string; units: string };

export function CostDialog({ categories, orders, defaultOrderId, defaultMethod = "importe", trigger }: {
  categories: { id: string; name: string; kind: string }[];
  orders: OrderOption[];
  defaultOrderId?: string;
  defaultMethod?: "importe" | "unidades";
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState(categories[0]?.id ?? "");
  const [desc, setDesc] = React.useState("");
  const [date, setDate] = React.useState(todayISO());
  const [net, setNet] = React.useState("");
  const [vat, setVat] = React.useState("");
  const [method, setMethod] = React.useState<"importe" | "unidades" | "manual">(defaultMethod);
  const [selected, setSelected] = React.useState<string[]>(defaultOrderId ? [defaultOrderId] : []);
  const [manual, setManual] = React.useState<Record<string, string>>({});
  const [adding, setAdding] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const netN = parseArNumber(net) ?? "";
  const sel = orders.filter((o) => selected.includes(o.id));
  const preview = netN && sel.length && method !== "manual"
    ? distribute(netN, sel.map((o) => (method === "importe" ? o.sales : o.units) || "0"))
    : sel.map((o) => parseArNumber(manual[o.id] ?? "") ?? "0");
  const manualTotal = sum(preview);

  const submit = async () => {
    setSaving(true);
    const r = await saveCost({
      category_id: cat, description: desc, cost_date: date, net_amount: net, vat_amount: vat, allocation_method: method,
      targets: sel.map((o) => ({ purchase_order_id: o.id, amount: manual[o.id] ?? "" })),
    });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Gasto registrado");
    setOpen(false);
    setDesc(""); setNet(""); setVat(""); setManual({});
    if (!defaultOrderId) setSelected([]);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> Nuevo gasto</Button>}</DialogTrigger>
      <DialogContent title="Registrar gasto" description="Flete, embalaje, comisiones… y a qué órdenes corresponde." className="max-w-xl">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Categoría"><NativeSelect value={cat} onChange={(e) => setCat(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></Field>
          <Field label="Fecha"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Descripción" className="col-span-2"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Flete a Htal. Argerich" /></Field>
          <Field label="Importe neto"><Input value={net} onChange={(e) => setNet(e.target.value)} inputMode="decimal" className="text-right tabular" /></Field>
          <Field label="IVA"><Input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" className="text-right tabular" placeholder="0" /></Field>
          <Field label="Órdenes" className="col-span-2" hint="Si no elegís ninguna queda como gasto general de la empresa">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <NativeSelect value={adding} onChange={(e) => setAdding(e.target.value)}>
                  <option value="">Agregar orden…</option>
                  {orders.filter((o) => !selected.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label} · {o.customer ?? ""}</option>)}
                </NativeSelect>
                <Button type="button" variant="secondary" disabled={!adding} onClick={() => { setSelected((s) => [...s, adding]); setAdding(""); }}>Agregar</Button>
              </div>
              {sel.length > 1 && (
                <div className="flex flex-wrap gap-2 text-xs">
                  {(["importe", "unidades", "manual"] as const).map((m) => (
                    <label key={m} className="flex items-center gap-1.5">
                      <input type="radio" checked={method === m} onChange={() => setMethod(m)} className="accent-[var(--primary)]" />
                      {m === "importe" ? "Repartir por importe" : m === "unidades" ? "Por unidades" : "Manual"}
                    </label>
                  ))}
                </div>
              )}
              {sel.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {sel.map((o, i) => (
                    <li key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate">{o.label} <span className="text-fg-subtle">{o.customer}</span></span>
                      {method === "manual" && sel.length > 1
                        ? <Input value={manual[o.id] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [o.id]: e.target.value }))} className="h-8 w-28 text-right tabular" inputMode="decimal" />
                        : <span className="tabular text-fg-muted">{netN ? formatMoney(sel.length === 1 ? netN : preview[i]) : "—"}</span>}
                      <button type="button" onClick={() => setSelected((s) => s.filter((x) => x !== o.id))} className="text-fg-subtle hover:text-danger" aria-label="Quitar"><X className="size-4" /></button>
                    </li>
                  ))}
                </ul>
              )}
              {method === "manual" && sel.length > 1 && netN && manualTotal !== Number(netN).toFixed(2) && (
                <p className="text-xs text-warn">Asignado {formatMoney(manualTotal)} de {formatMoney(netN)}</p>
              )}
            </div>
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} loading={saving} disabled={!cat || !desc.trim() || !netN}>Guardar gasto</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
