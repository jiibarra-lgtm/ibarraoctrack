"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney, todayISO } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { uploadPrivate } from "@/lib/upload";
import { attachDocument } from "@/app/(app)/ordenes/actions";
import { createInvoice, readInvoiceDocument } from "@/app/(app)/facturacion/actions";

export type BillableOrder = { id: string; label: string; customer: string | null; to_invoice: string; currency: string };

const EMPTY = { invoice_type: "B", point_of_sale: "", number: "", issue_date: "", due_date: "", net_amount: "", vat_amount: "", other_taxes: "", total_amount: "", cae: "", notes: "" };

export function InvoiceDialog({ orders, orgId, defaultOrderId, trigger }: { orders: BillableOrder[]; orgId: string; defaultOrderId?: string; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [poId, setPoId] = React.useState(defaultOrderId ?? "");
  const [f, setF] = React.useState({ ...EMPTY, issue_date: todayISO() });
  const [docId, setDocId] = React.useState<string | null>(null);
  const [reading, setReading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const file = React.useRef<HTMLInputElement>(null);
  const po = orders.find((o) => o.id === poId);
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  const reset = () => { setF({ ...EMPTY, issue_date: todayISO() }); setDocId(null); if (!defaultOrderId) setPoId(""); };

  const onPdf = async (fl: FileList | null) => {
    const fileObj = fl?.[0];
    if (!fileObj || !poId) return;
    setReading(true);
    try {
      const up = await uploadPrivate(fileObj, orgId, `ordenes/${poId}`);
      const at = await attachDocument({ purchaseOrderId: poId, storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256, docType: "factura_emitida" });
      if (!at.ok) { toast.error(at.error); return; }
      setDocId(at.id);
      const r = await readInvoiceDocument(at.id);
      if (!r.ok || !r.data) { toast.message(r.ok ? "PDF adjuntado" : r.error); return; }
      const d = r.data;
      setF((x) => ({
        ...x, invoice_type: d.invoice_type || x.invoice_type, point_of_sale: d.point_of_sale || x.point_of_sale, number: d.number || x.number,
        issue_date: d.issue_date || x.issue_date, net_amount: d.net_amount || x.net_amount, vat_amount: d.vat_amount || x.vat_amount,
        other_taxes: d.other_taxes && d.other_taxes !== "0.00" ? d.other_taxes : x.other_taxes, total_amount: d.total_amount || x.total_amount, cae: d.cae || x.cae,
      }));
      toast.success("Datos leídos del PDF: revisalos y guardá");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReading(false);
      if (file.current) file.current.value = "";
    }
  };

  const submit = async () => {
    setSaving(true);
    const r = await createInvoice({ ...f, purchase_order_id: poId, document_id: docId ?? "", invoice_type: f.invoice_type as never });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Factura registrada");
    setOpen(false);
    reset();
    router.refresh();
  };

  const total = parseArNumber(f.total_amount);
  const over = po && total && Number(total) > Number(po.to_invoice);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Registrar factura emitida" description="Factura al organismo por esta orden. Subí el PDF y se completa solo." className="max-w-xl">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Orden" className="col-span-2 sm:col-span-4" htmlFor="inv-po">
            <NativeSelect id="inv-po" value={poId} onChange={(e) => setPoId(e.target.value)} disabled={!!defaultOrderId}>
              <option value="">Elegí la orden…</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.customer ?? "—"} · falta facturar {formatMoney(o.to_invoice, o.currency)}</option>)}
            </NativeSelect>
          </Field>
          <div className="col-span-2 sm:col-span-4">
            <input ref={file} type="file" hidden accept="application/pdf" onChange={(e) => onPdf(e.target.files)} />
            <Button type="button" variant="secondary" size="sm" disabled={!poId || reading} onClick={() => file.current?.click()}>
              {reading ? <Loader2 className="animate-spin" /> : <FileUp />} {docId ? "PDF adjuntado" : "Subir PDF de la factura"}
            </Button>
          </div>
          <Field label="Tipo" htmlFor="inv-type">
            <NativeSelect id="inv-type" value={f.invoice_type} onChange={set("invoice_type")}>
              {["A", "B", "C", "M", "E"].map((t) => <option key={t} value={t}>Factura {t}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Punto de venta" htmlFor="inv-pv"><Input id="inv-pv" inputMode="numeric" value={f.point_of_sale} onChange={set("point_of_sale")} placeholder="0003" /></Field>
          <Field label="Número" className="col-span-2" htmlFor="inv-nro"><Input id="inv-nro" inputMode="numeric" value={f.number} onChange={set("number")} placeholder="00001234" /></Field>
          <Field label="Fecha" className="col-span-2" htmlFor="inv-date"><Input id="inv-date" type="date" value={f.issue_date} onChange={set("issue_date")} /></Field>
          <Field label="Vencimiento" className="col-span-2" htmlFor="inv-due" hint="Vacío: según días de cobro de Configuración"><Input id="inv-due" type="date" value={f.due_date} onChange={set("due_date")} /></Field>
          <Field label="Total" className="col-span-2" htmlFor="inv-total" error={over ? `Supera lo pendiente (${formatMoney(po!.to_invoice, po!.currency)})` : undefined}>
            <div className="flex gap-1.5">
              <Input id="inv-total" inputMode="decimal" value={f.total_amount} onChange={set("total_amount")} className="tabular" />
              {po && Number(po.to_invoice) > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => setF((x) => ({ ...x, total_amount: po.to_invoice }))}>Todo</Button>}
            </div>
          </Field>
          <Field label="Neto" htmlFor="inv-net"><Input id="inv-net" inputMode="decimal" value={f.net_amount} onChange={set("net_amount")} className="tabular" /></Field>
          <Field label="IVA" htmlFor="inv-vat"><Input id="inv-vat" inputMode="decimal" value={f.vat_amount} onChange={set("vat_amount")} className="tabular" /></Field>
          <Field label="CAE" className="col-span-2" htmlFor="inv-cae"><Input id="inv-cae" inputMode="numeric" value={f.cae} onChange={set("cae")} /></Field>
          <Field label="Notas" className="col-span-2" htmlFor="inv-notes"><Input id="inv-notes" value={f.notes} onChange={set("notes")} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} loading={saving} disabled={!poId || !f.total_amount || !!over}>Registrar factura</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
