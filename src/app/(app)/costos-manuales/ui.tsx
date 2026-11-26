"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { deleteManualCost, linkManualCost, orderLines, saveManualCost, searchOrders, unlinkManualCost } from "./actions";

export type ManualCost = {
  id: string; sku: string | null; description: string; supplier: string | null; cost: string | null; includes_vat: boolean;
  vat_pct: string; cost_net: string | null; cost_gross: string | null; notes: string | null;
};

const preview = (cost: string, incl: boolean, vat: string) => {
  const c = Number(parseArNumber(cost) ?? NaN), v = Number(parseArNumber(vat || "21") ?? 21);
  if (!Number.isFinite(c)) return null;
  return incl ? { net: c / (1 + v / 100), gross: c } : { net: c, gross: c * (1 + v / 100) };
};

export function ManualCostDialog({ row, suppliers, trigger }: { row?: ManualCost; suppliers: string[]; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [sku, setSku] = React.useState(row?.sku ?? "");
  const [desc, setDesc] = React.useState(row?.description ?? "");
  const [supplier, setSupplier] = React.useState(row?.supplier ?? "");
  const [cost, setCost] = React.useState(row?.cost ? String(Number(row.cost)).replace(".", ",") : "");
  const [incl, setIncl] = React.useState(row?.includes_vat ?? false);
  const [vat, setVat] = React.useState(row?.vat_pct ? String(Number(row.vat_pct)) : "21");
  const [notes, setNotes] = React.useState(row?.notes ?? "");
  const [saving, setSaving] = React.useState(false);
  const p = cost ? preview(cost, incl, vat) : null;

  const submit = async () => {
    setSaving(true);
    const r = await saveManualCost({ id: row?.id, sku, description: desc, supplier, cost, includes_vat: incl, vat_pct: vat, notes });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(row ? "Costo actualizado" : "Costo agregado");
    setOpen(false);
    if (!row) { setSku(""); setDesc(""); setCost(""); setNotes(""); }
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button><Plus /> Agregar costo</Button>}</DialogTrigger>
      <DialogContent title={row ? "Editar costo" : "Agregar costo"} description="Costo manual de un producto. No se mezcla con facturas, compras ni banco." className="max-w-xl">
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU"><Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="0001" /></Field>
          <Field label="Proveedor">
            <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} list="mc-suppliers" placeholder="FRANCAT" />
            <datalist id="mc-suppliers">{suppliers.map((x) => <option key={x} value={x} />)}</datalist>
          </Field>
          <Field label="Descripción" className="col-span-2"><Input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="TOALLA INTERCALADA 4 PLIEGOS BLANCA 20X24" /></Field>
          <Field label="Costo"><Input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" className="text-right tabular" placeholder="vacío = sin costo" /></Field>
          <Field label="¿Ese costo ya incluye IVA?">
            <NativeSelect value={incl ? "si" : "no"} onChange={(e) => setIncl(e.target.value === "si")}><option value="no">No (es neto)</option><option value="si">Sí (es final)</option></NativeSelect>
          </Field>
          <Field label="IVA %"><Input value={vat} onChange={(e) => setVat(e.target.value)} inputMode="decimal" className="text-right tabular" /></Field>
          <div className="self-end pb-2 text-sm">
            {p ? <>Neto <b className="tabular">{formatMoney(p.net)}</b> · Con IVA <b className="tabular">{formatMoney(p.gross)}</b></> : <span className="text-fg-subtle">—</span>}
          </div>
          <Field label="Notas" className="col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} loading={saving} disabled={!desc.trim()}>Guardar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditCostButton({ row, suppliers }: { row: ManualCost; suppliers: string[] }) {
  return <ManualCostDialog row={row} suppliers={suppliers} trigger={<Button size="icon-sm" variant="ghost" aria-label="Editar"><Pencil /></Button>} />;
}

export function DeleteCostButton({ id, links }: { id: string; links: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (!confirm) return <Button size="icon-sm" variant="ghost" aria-label="Borrar" onClick={() => setConfirm(true)}><Trash2 /></Button>;
  return (
    <span className="inline-flex items-center gap-1">
      <Button size="sm" variant="danger" loading={busy} onClick={async () => {
        setBusy(true); const r = await deleteManualCost(id); setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Costo borrado"); router.refresh();
      }}>{links ? `Borrar (y ${links} vínculo${links > 1 ? "s" : ""})` : "Borrar"}</Button>
      <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setConfirm(false)}><X /></Button>
    </span>
  );
}

/** Vincular a mano un costo con una OC (y opcionalmente un renglón). Nada se vincula solo. */
export function LinkDialog({ cost, defaultOrder, trigger }: { cost: ManualCost; defaultOrder?: { id: string; label: string }; trigger?: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [orders, setOrders] = React.useState<{ id: string; label: string; customer: string | null }[]>([]);
  const [order, setOrder] = React.useState<{ id: string; label: string } | null>(defaultOrder ?? null);
  const [lines, setLines] = React.useState<{ id: string; label: string; quantity: number; unit: string | null }[]>([]);
  const [line, setLine] = React.useState("");
  const [qty, setQty] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const search = React.useCallback(async (text: string) => {
    setBusy("s"); const r = await searchOrders(text); setBusy(null);
    if (r.ok) setOrders(r.orders); else toast.error(r.error);
  }, []);
  const pick = React.useCallback(async (o: { id: string; label: string }) => {
    setOrder(o); setLine(""); setQty("");
    const r = await orderLines(o.id);
    if (r.ok) setLines(r.lines); else toast.error(r.error);
  }, []);
  const onOpen = (v: boolean) => {
    setOpen(v);
    if (v && defaultOrder) pick(defaultOrder);
    else if (v && !orders.length) search("");
  };
  const ln = lines.find((l) => l.id === line);
  const units = qty ? Number(parseArNumber(qty) ?? 0) : ln?.quantity ?? 0;
  const total = cost.cost_net ? Number(cost.cost_net) * units : null;

  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm" variant="ghost"><Link2 /> Vincular</Button>}</DialogTrigger>
      <DialogContent title="Vincular a una orden de compra" description={cost.description} className="max-w-xl">
        <div className="space-y-3">
          {!defaultOrder && (
            <Field label="Orden de compra">
              <div className="flex gap-2">
                <Input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(q); } }} placeholder="N° BAC, OC-000123 u organismo" />
                <Button type="button" variant="secondary" loading={busy === "s"} onClick={() => search(q)}><Search /></Button>
              </div>
            </Field>
          )}
          {!order && orders.length > 0 && (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
              {orders.map((o) => <li key={o.id}><button type="button" onClick={() => pick(o)} className="w-full px-3 py-2 text-left hover:bg-field"><b>{o.label}</b> <span className="text-fg-subtle">{o.customer}</span></button></li>)}
            </ul>
          )}
          {order && (
            <>
              <div className="flex items-center justify-between rounded-md bg-field px-3 py-2 text-sm">
                <span>OC <b>{order.label}</b></span>
                {!defaultOrder && <button type="button" onClick={() => { setOrder(null); setLines([]); }} className="text-xs underline">cambiar</button>}
              </div>
              <Field label="Renglón (opcional)" hint="Si no elegís renglón, queda vinculado a la orden en general.">
                <NativeSelect value={line} onChange={(e) => setLine(e.target.value)}>
                  <option value="">Toda la orden</option>
                  {lines.map((l) => <option key={l.id} value={l.id}>{l.label.slice(0, 90)} ({l.quantity.toLocaleString("es-AR")} {l.unit ?? "u."})</option>)}
                </NativeSelect>
              </Field>
              <Field label="Cantidad de este costo" hint={ln ? `Vacío = la cantidad del renglón (${ln.quantity.toLocaleString("es-AR")}). Si el costo es por caja y la OC por unidad, poné cuántas cajas.` : "Cuántas unidades de este costo lleva la orden."}>
                <Input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="text-right tabular" />
              </Field>
              {total !== null && units > 0 && <p className="text-sm">Costo neto total: <b className="tabular">{formatMoney(total)}</b> <span className="text-fg-subtle">({units.toLocaleString("es-AR")} × {formatMoney(cost.cost_net)})</span></p>}
            </>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button loading={busy === "l"} disabled={!order || (!line && !qty)} onClick={async () => {
            setBusy("l");
            const r = await linkManualCost({ manual_cost_id: cost.id, purchase_order_id: order!.id, purchase_order_item_id: line, quantity: qty });
            setBusy(null);
            if (!r.ok) return toast.error(r.error);
            toast.success(`Vinculado a la OC ${order!.label}`); setOpen(false); router.refresh();
          }}>Vincular</Button>
        </div>
        {!line && order && !qty && <p className="mt-2 text-right text-xs text-fg-subtle">Para vincular a la orden en general poné la cantidad.</p>}
      </DialogContent>
    </Dialog>
  );
}

export function UnlinkButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <button type="button" aria-label="Desvincular" disabled={busy} className="text-fg-subtle hover:text-danger disabled:opacity-50" onClick={async () => {
      setBusy(true); const r = await unlinkManualCost(id); setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success("Desvinculado"); router.refresh();
    }}><X className="size-3.5" /></button>
  );
}
