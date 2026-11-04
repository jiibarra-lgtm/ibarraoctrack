"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney, todayISO } from "@/lib/format";
import { dec, isValidDecimal, parseArNumber, sum } from "@/lib/money";
import { METHOD_LABEL, RETENTIONS } from "@/lib/billing";
import { createCollection } from "@/app/(app)/facturacion/actions";
import { cn } from "@/lib/utils";

export type CollectableInvoice = { id: string; label: string; balance: string; currency: string; customer?: string | null };

type Ret = (typeof RETENTIONS)[number][0];
const EMPTY_RET: Record<Ret, string> = { ret_iibb: "", ret_ganancias: "", ret_iva: "", ret_suss: "", ret_otras: "" };

export function CollectionDialog({ invoice, trigger }: { invoice: CollectableInvoice; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(todayISO());
  const [received, setReceived] = React.useState("");
  const [ret, setRet] = React.useState(EMPTY_RET);
  const [showRet, setShowRet] = React.useState(false);
  const [method, setMethod] = React.useState("transferencia");
  const [reference, setReference] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const n = (v: string) => parseArNumber(v) ?? "0";
  const retTotal = sum(Object.values(ret).map(n));
  const applied = sum([n(received), retTotal]);
  const remaining = isValidDecimal(applied) ? dec(invoice.balance).minus(applied).toFixed(2) : invoice.balance;
  const over = Number(remaining) < 0;

  const fillBalance = () => setReceived(dec(invoice.balance).minus(retTotal).toFixed(2));

  const submit = async () => {
    setSaving(true);
    const r = await createCollection({ invoice_id: invoice.id, payment_date: date, amount_received: received, ...ret, method: method as never, reference, notes: "" });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Cobro registrado");
    setOpen(false);
    setReceived(""); setRet(EMPTY_RET); setReference("");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Registrar cobro · ${invoice.label}`} description={`${invoice.customer ? `${invoice.customer} · ` : ""}Saldo ${formatMoney(invoice.balance, invoice.currency)}`} className="max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fecha de cobro" htmlFor="col-date"><Input id="col-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Medio" htmlFor="col-method">
            <NativeSelect id="col-method" value={method} onChange={(e) => setMethod(e.target.value)}>
              {Object.entries(METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Importe recibido en banco" className="col-span-2" htmlFor="col-recv">
            <div className="flex gap-1.5">
              <Input id="col-recv" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} className="tabular" autoFocus />
              <Button type="button" variant="ghost" size="sm" onClick={fillBalance}>Saldo completo</Button>
            </div>
          </Field>
          <button type="button" onClick={() => setShowRet((v) => !v)} className="col-span-2 inline-flex items-center gap-1 text-left text-sm text-fg-muted hover:text-fg">
            <ChevronDown className={cn("size-4 transition-transform", showRet && "rotate-180")} />
            Retenciones {Number(retTotal) > 0 ? `· ${formatMoney(retTotal, invoice.currency)}` : "(IIBB, Ganancias, IVA, SUSS)"}
          </button>
          {showRet && RETENTIONS.map(([k, label]) => (
            <Field key={k} label={label} htmlFor={`col-${k}`}>
              <Input id={`col-${k}`} inputMode="decimal" value={ret[k]} onChange={(e) => setRet((x) => ({ ...x, [k]: e.target.value }))} className="tabular" />
            </Field>
          ))}
          <Field label="Referencia" className="col-span-2" htmlFor="col-ref"><Input id="col-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="N° de transferencia / orden de pago" /></Field>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-3 text-sm">
          <span className="text-fg-muted">Cancela de la factura</span><span className="text-right font-medium tabular">{formatMoney(applied, invoice.currency)}</span>
          <span className="text-fg-muted">Queda pendiente</span>
          <span className={cn("text-right font-medium tabular", over && "text-danger")}>{over ? "Supera el saldo" : formatMoney(remaining, invoice.currency)}</span>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={submit} loading={saving} disabled={over || Number(applied) <= 0}>Registrar cobro</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
