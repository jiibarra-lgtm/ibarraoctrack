"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { addDays, CONCEPTS, computeTotals, guessIvaCondition, installments, IVA_CONDITIONS, PAYMENT_KINDS, type SaleCondition } from "@/lib/einvoice";
import { emitEInvoice, listSaleConditions, loadOrderForInvoice, lookupCustomerCuit } from "@/app/(app)/facturacion/einvoice-actions";

type L = { description: string; quantity: string; unit: string; unit_price: string; vat_rate: number };
const blank: L = { description: "", quantity: "1", unit: "", unit_price: "", vat_rate: 21 };
const num = (s: string) => Number(parseArNumber(s) ?? NaN);
const show = (n: number) => String(n).replace(".", ",");
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const monthBounds = (iso: string) => { const [y, m] = iso.split("-").map(Number); return { from: `${iso.slice(0, 7)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; };
const dmy = (iso: string) => iso.split("-").reverse().join("/");

/** Factura electrónica con CAE: desde una OC (todo precargado) o suelta. */
export function EInvoiceDialog({ purchaseOrderId, trigger }: { purchaseOrderId?: string; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [poLabel, setPoLabel] = React.useState<string | null>(null);
  const [left, setLeft] = React.useState<number | null>(null);
  const [customerId, setCustomerId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [cuit, setCuit] = React.useState("");
  const [address, setAddress] = React.useState("");
  const [iva, setIva] = React.useState(4);
  const [incl, setIncl] = React.useState(true);
  const [lines, setLines] = React.useState<L[]>([{ ...blank }]);
  const [notes, setNotes] = React.useState("");
  const [looking, setLooking] = React.useState(false);
  // Condición de venta (como en Tango): define lo que sale impreso y el vencimiento de cobro
  const [conds, setConds] = React.useState<SaleCondition[]>([]);
  const [condId, setCondId] = React.useState("");
  const [due, setDue] = React.useState(todayAr());
  const [concept, setConcept] = React.useState<1 | 2 | 3>(1);
  const [svcFrom, setSvcFrom] = React.useState(monthBounds(todayAr()).from);
  const [svcTo, setSvcTo] = React.useState(monthBounds(todayAr()).to);
  const cond = conds.find((c) => c.id === condId) ?? null;
  const pickCond = (id: string, list = conds) => {
    setCondId(id);
    const c = list.find((x) => x.id === id);
    setDue(addDays(todayAr(), c?.days.length ? Math.max(...c.days) : 0));
  };
  const lookup = async () => {
    setLooking(true);
    const r = await lookupCustomerCuit(cuit);
    setLooking(false);
    if (!r.ok) { toast.error(r.error, { duration: 10000 }); return; }
    setName(r.name); if (r.address) setAddress(r.address); setIva(r.iva_condition);
    toast.success("Datos traídos del padrón de ARCA");
  };

  const load = async () => {
    setConfirm(false);
    setLoading(true);
    const cr = await listSaleConditions();
    const list = cr.ok ? cr.conditions : [];
    setConds(list);
    const fallback = list.find((c) => c.is_default) ?? list[0];
    if (fallback) pickCond(fallback.id, list);
    if (!purchaseOrderId) { setLoading(false); return; }
    const r = await loadOrderForInvoice(purchaseOrderId);
    setLoading(false);
    if (!r.ok) { toast.error(r.error); setOpen(false); return; }
    const o = r.order;
    setPoLabel(o.label);
    setLeft(o.order_total - o.invoiced);
    setCustomerId(o.customer.id);
    setName(o.customer.name);
    setCuit(o.customer.cuit ?? "");
    setAddress(o.customer.address ?? "");
    setIva(o.customer.iva_condition ?? guessIvaCondition(o.customer.name, o.customer.cuit));
    // la condición habitual del cliente, si tiene
    if (o.customer.sale_condition_id && list.some((c) => c.id === o.customer.sale_condition_id)) pickCond(o.customer.sale_condition_id, list);
    setIncl(true);
    setNotes(`OC ${o.label}`);
    setLines(o.items.length ? o.items.map((i) => ({ description: i.description, quantity: show(i.quantity), unit: i.unit ?? "", unit_price: show(i.unit_price), vat_rate: 21 })) : [{ ...blank }]);
  };

  const parsed = lines.map((l) => ({ description: l.description.trim(), quantity: num(l.quantity), unit: l.unit.trim() || null, unit_price: num(l.unit_price), vat_rate: l.vat_rate }));
  const valid = parsed.every((l) => l.description && l.quantity > 0 && l.unit_price >= 0 && Number.isFinite(l.unit_price));
  const totals = valid ? computeTotals(parsed, incl) : null;
  const letter = IVA_CONDITIONS[iva]?.letter ?? "B";
  const cuitOk = /^\d{11}$/.test(cuit.replace(/\D/g, ""));
  const over = totals && left !== null && totals.total > left + 1;
  const svcOk = concept === 1 || (!!svcFrom && !!svcTo && svcFrom <= svcTo);
  const canEmit = !!totals && totals.total > 0 && cuitOk && name.trim().length >= 2 && !over && !!cond && due >= todayAr() && svcOk;
  const cuotas = cond && totals && cond.days.length > 1 ? installments(todayAr(), cond.days, totals.total) : [];
  const setL = (i: number, k: keyof L) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setLines((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: k === "vat_rate" ? Number(e.target.value) : e.target.value } : x)));

  const submit = async () => {
    if (!totals) return;
    setBusy(true);
    const r = await emitEInvoice({
      purchase_order_id: purchaseOrderId ?? null, customer_id: customerId, receiver_name: name.trim(), receiver_cuit: cuit, receiver_address: address.trim() || null,
      iva_condition: iva, prices_include_vat: incl, lines: parsed as never, notes: notes.trim() || null,
      sale_condition_id: condId, payment_due: due, concept, service_from: concept === 1 ? null : svcFrom, service_to: concept === 1 ? null : svcTo,
    });
    setBusy(false);
    if (!r.ok) { toast.error(r.error, { duration: 12000 }); setConfirm(false); return; }
    toast.success(`${r.label} emitida · CAE ${r.cae}`);
    setOpen(false);
    router.refresh();
    window.open(`/imprimir/factura/${r.id}`, "_blank");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v) void load(); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={poLabel ? `Facturar OC ${poLabel}` : "Factura electrónica"} description="Se pide el CAE a ARCA. Revisá antes de emitir: una factura emitida sólo se anula con nota de crédito." className="top-[4vh] max-h-[92vh] max-w-3xl overflow-y-auto">
        {loading ? <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin" /></div> : (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cliente (razón social)" htmlFor="ei-name"><Input id="ei-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="CUIT" htmlFor="ei-cuit">
                <div className="flex gap-2">
                  <Input id="ei-cuit" value={cuit} onChange={(e) => setCuit(e.target.value)} invalid={!!cuit && !cuitOk} placeholder="30-00000000-0" className="tabular" />
                  <Button type="button" variant="secondary" size="sm" className="h-9 shrink-0" disabled={!cuitOk} loading={looking} onClick={lookup} title="Completar con el padrón de ARCA">{!looking && <Search />} ARCA</Button>
                </div>
              </Field>
              <Field label="Domicilio" htmlFor="ei-addr"><Input id="ei-addr" value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
              <Field label={`Condición de IVA → Factura ${letter}`} htmlFor="ei-iva">
                <NativeSelect id="ei-iva" value={iva} onChange={(e) => setIva(Number(e.target.value))}>
                  {Object.entries(IVA_CONDITIONS).map(([k, v]) => <option key={k} value={k}>{v.label} (Factura {v.letter})</option>)}
                </NativeSelect>
              </Field>
            </div>

            <div className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-3">
              <Field label="Condición de venta" htmlFor="ei-cond" hint={cond ? `ARCA: ${PAYMENT_KINDS[cond.arca_kind].label}${PAYMENT_KINDS[cond.arca_kind].electronic ? " (medio electrónico)" : ""}` : undefined}>
                <NativeSelect id="ei-cond" value={condId} onChange={(e) => pickCond(e.target.value)}>
                  {!conds.length && <option value="">Sin condiciones cargadas</option>}
                  {conds.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Vencimiento de pago" htmlFor="ei-due" hint={cond?.days.length ? `${cond.days.join("/")} días desde hoy` : "Al contado vence hoy"}>
                <Input id="ei-due" type="date" value={due} min={todayAr()} onChange={(e) => setDue(e.target.value)} invalid={due < todayAr()} />
              </Field>
              <Field label="Concepto" htmlFor="ei-concept">
                <NativeSelect id="ei-concept" value={concept} onChange={(e) => setConcept(Number(e.target.value) as 1 | 2 | 3)}>
                  {Object.entries(CONCEPTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </NativeSelect>
              </Field>
              {concept !== 1 && (
                <>
                  <Field label="Período facturado desde" htmlFor="ei-sf"><Input id="ei-sf" type="date" value={svcFrom} onChange={(e) => setSvcFrom(e.target.value)} /></Field>
                  <Field label="Hasta" htmlFor="ei-st"><Input id="ei-st" type="date" value={svcTo} onChange={(e) => setSvcTo(e.target.value)} invalid={!svcOk} /></Field>
                  <p className="self-end pb-2 text-xs text-fg-subtle">Para servicios ARCA pide período y vencimiento de pago.</p>
                </>
              )}
              {cuotas.length > 1 && (
                <p className="text-xs text-fg-muted sm:col-span-3">Cuotas: {cuotas.map((q) => `${dmy(q.due)} ${formatMoney(q.amount)}`).join(" · ")}</p>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                  <th className="px-3 py-2 text-left font-medium">Descripción</th><th className="w-20 px-2 text-right font-medium">Cant.</th>
                  <th className="w-32 px-2 text-right font-medium">Precio c/u</th><th className="w-20 px-2 font-medium">IVA</th><th className="w-28 px-2 text-right font-medium">Importe</th><th className="w-8" />
                </tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5"><Input value={l.description} onChange={setL(i, "description")} className="h-8" /></td>
                      <td className="px-1"><Input value={l.quantity} onChange={setL(i, "quantity")} inputMode="decimal" className="h-8 text-right tabular" /></td>
                      <td className="px-1"><Input value={l.unit_price} onChange={setL(i, "unit_price")} inputMode="decimal" className="h-8 text-right tabular" /></td>
                      <td className="px-1"><NativeSelect value={l.vat_rate} onChange={setL(i, "vat_rate")} className="h-8">{[21, 10.5, 27, 0].map((r) => <option key={r} value={r}>{show(r)}%</option>)}</NativeSelect></td>
                      <td className="px-2 text-right tabular">{Number.isFinite(num(l.quantity) * num(l.unit_price)) ? formatMoney(num(l.quantity) * num(l.unit_price)) : "—"}</td>
                      <td className="px-1"><button type="button" className="text-fg-subtle hover:text-danger disabled:opacity-30" disabled={lines.length === 1} onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between border-t border-border px-3 py-2">
                <button type="button" onClick={() => setLines((xs) => [...xs, { ...blank }])} className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"><Plus className="size-3.5" /> Agregar renglón</button>
                <label className="flex items-center gap-2 text-xs text-fg-muted"><input type="checkbox" checked={incl} onChange={(e) => setIncl(e.target.checked)} /> Los precios incluyen IVA (como en la OC)</label>
              </div>
            </div>

            <Field label="Observaciones (opcional, sale impresa)" htmlFor="ei-notes"><Input id="ei-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

            {totals && (
              <div className="flex flex-wrap items-end justify-end gap-x-6 gap-y-1 text-sm tabular">
                <span className="text-fg-muted">Neto {formatMoney(totals.net)}</span>
                {totals.vat.map((v) => <span key={v.id} className="text-fg-muted">IVA {show(v.rate)}% {formatMoney(v.amount)}</span>)}
                <span className="text-base font-semibold">Total {formatMoney(totals.total)}</span>
              </div>
            )}
            {over && <p className="text-right text-xs font-medium text-danger">Supera lo que falta facturar de la OC ({formatMoney(left!)})</p>}

            {!confirm ? (
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
                <Button disabled={!canEmit} onClick={() => setConfirm(true)}>Revisar y emitir</Button>
              </div>
            ) : (
              <div className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
                <p className="flex items-start gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />
                  <span>Vas a emitir <b>Factura {letter}</b> por <b>{formatMoney(totals!.total)}</b> a <b>{name}</b> (CUIT {cuit}), <b>{cond?.name}</b> con vencimiento el <b>{dmy(due)}</b>. Es un comprobante fiscal real: no se puede borrar, sólo anular con nota de crédito.</span></p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" disabled={busy} onClick={() => setConfirm(false)}>Volver</Button>
                  <Button loading={busy} onClick={submit}>Emitir factura</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
