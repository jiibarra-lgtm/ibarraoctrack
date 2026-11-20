"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Pencil, Plus, Scale, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { parseArNumber } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import { CASH_CATEGORIES, CHEQUE_STATUS, chequeNext, type CashCategory, type ChequeDirection, type ChequeStatus } from "@/lib/treasury";
import { cashCount, deleteCashMovement, reconcileMovement, saveCashMovement, saveCheque, setChequeStatus, unreconcileMovement } from "./actions";

const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const num = (s: string) => Number(parseArNumber(s) ?? NaN);

export type ChequeRow = {
  id: string; direction: ChequeDirection; kind: "fisico" | "echeq"; bank: string | null; number: string | null; counterpart_name: string | null; counterpart_cuit: string | null;
  amount: string; issue_date: string; pay_date: string; status: ChequeStatus; status_date: string | null; endorsed_to: string | null; purchase_order_id: string | null; notes: string | null;
};

/** Alta / edición de un cheque (recibido de un cliente o emitido a un proveedor). */
export function ChequeEditor({ row, direction, orders }: { row?: ChequeRow; direction: ChequeDirection; orders: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [v, setV] = React.useState(() => ({
    kind: row?.kind ?? "echeq", bank: row?.bank ?? "", number: row?.number ?? "", counterpart_name: row?.counterpart_name ?? "", counterpart_cuit: row?.counterpart_cuit ?? "",
    amount: row ? String(row.amount).replace(".", ",") : "", issue_date: row?.issue_date ?? todayAr(), pay_date: row?.pay_date ?? todayAr(), purchase_order_id: row?.purchase_order_id ?? "", notes: row?.notes ?? "",
  }));
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((o) => ({ ...o, [k]: e.target.value }));
  const dir = row?.direction ?? direction;
  const save = async () => {
    setBusy(true);
    const r = await saveCheque({
      id: row?.id ?? null, direction: dir, kind: v.kind as "fisico" | "echeq", bank: v.bank || null, number: v.number || null, counterpart_name: v.counterpart_name,
      counterpart_cuit: v.counterpart_cuit || null, amount: num(v.amount), issue_date: v.issue_date, pay_date: v.pay_date, purchase_order_id: v.purchase_order_id || null, notes: v.notes || null,
    });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(row ? "Cheque actualizado" : "Cheque cargado");
    setOpen(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{row ? <Button size="icon-sm" variant="ghost" aria-label="Editar"><Pencil /></Button> : <Button variant={dir === "recibido" ? "default" : "secondary"}><Plus /> {dir === "recibido" ? "Cheque recibido" : "Cheque emitido"}</Button>}</DialogTrigger>
      <DialogContent title={dir === "recibido" ? "Cheque recibido (de terceros)" : "Cheque emitido (propio)"} description={dir === "recibido" ? "Queda en cartera hasta que lo deposites o lo endoses." : "Queda pendiente hasta que se debite del banco."}>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Tipo" htmlFor="ch-kind"><NativeSelect id="ch-kind" value={v.kind} onChange={set("kind")}><option value="echeq">E-cheq</option><option value="fisico">Cheque físico</option></NativeSelect></Field>
          <Field label="Importe" htmlFor="ch-amount"><Input id="ch-amount" value={v.amount} inputMode="decimal" className="tabular" onChange={set("amount")} invalid={!!v.amount && !(num(v.amount) > 0)} /></Field>
          <Field label={dir === "recibido" ? "Librador / de quién lo recibís" : "A la orden de"} htmlFor="ch-name" className="sm:col-span-2"><Input id="ch-name" value={v.counterpart_name} onChange={set("counterpart_name")} /></Field>
          <Field label="CUIT (opcional)" htmlFor="ch-cuit"><Input id="ch-cuit" value={v.counterpart_cuit} className="tabular" onChange={set("counterpart_cuit")} /></Field>
          <Field label="Banco" htmlFor="ch-bank"><Input id="ch-bank" value={v.bank} onChange={set("bank")} /></Field>
          <Field label="Número" htmlFor="ch-num"><Input id="ch-num" value={v.number} className="tabular" onChange={set("number")} /></Field>
          <Field label="Fecha de emisión" htmlFor="ch-issue"><Input id="ch-issue" type="date" value={v.issue_date} onChange={set("issue_date")} /></Field>
          <Field label="Fecha de pago (cobro / débito)" htmlFor="ch-pay"><Input id="ch-pay" type="date" value={v.pay_date} min={v.issue_date} onChange={set("pay_date")} /></Field>
          {dir === "recibido" && (
            <Field label="Orden de compra (opcional)" htmlFor="ch-po">
              <NativeSelect id="ch-po" value={v.purchase_order_id} onChange={set("purchase_order_id")}>
                <option value="">—</option>
                {orders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </NativeSelect>
            </Field>
          )}
          <Field label="Nota (opcional)" htmlFor="ch-notes" className="sm:col-span-2"><Input id="ch-notes" value={v.notes} onChange={set("notes")} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} disabled={!(num(v.amount) > 0) || v.counterpart_name.trim().length < 2} onClick={save}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ACTION_LABEL: Partial<Record<ChequeStatus, string>> = {
  depositado: "Depositar", acreditado: "Acreditado", endosado: "Endosar", rechazado: "Rechazado", anulado: "Anular", debitado: "Debitado", cartera: "Volver a cartera", emitido: "Volver a emitido",
};

/** Botones para mover el cheque de estado (depositar, endosar, rechazado, etc.). */
export function ChequeStatusButtons({ row }: { row: ChequeRow }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [endorse, setEndorse] = React.useState(false);
  const [to, setTo] = React.useState("");
  const go = async (st: ChequeStatus) => {
    if (st === "endosado" && !endorse) { setEndorse(true); return; }
    setBusy(st);
    const r = await setChequeStatus(row.id, st, { endorsed_to: to });
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success(`Cheque ${CHEQUE_STATUS[st].label.toLowerCase()}`);
    setEndorse(false);
    router.refresh();
  };
  const next = chequeNext(row.direction, row.status);
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {endorse && <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Endosado a…" className="h-8 w-40" autoFocus />}
      {next.map((st) => (
        <Button key={st} size="sm" variant={st === "rechazado" || st === "anulado" ? "ghost" : "secondary"} loading={busy === st} onClick={() => go(st)}>{ACTION_LABEL[st] ?? st}</Button>
      ))}
    </div>
  );
}

/** Movimiento de caja (entrada o salida de efectivo). */
export function CashForm() {
  const router = useRouter();
  const [dir, setDir] = React.useState<"in" | "out">("out");
  const [cat, setCat] = React.useState<CashCategory>("gasto");
  const [amount, setAmount] = React.useState("");
  const [concept, setConcept] = React.useState("");
  const [date, setDate] = React.useState(todayAr());
  const [busy, setBusy] = React.useState(false);
  const cats = (Object.keys(CASH_CATEGORIES) as CashCategory[]).filter((k) => k !== "arqueo" && (CASH_CATEGORIES[k].dir === "both" || CASH_CATEGORIES[k].dir === dir));
  const save = async () => {
    setBusy(true);
    const r = await saveCashMovement({ mov_date: date, direction: dir, amount: num(amount), category: cat, concept, reference: null });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(dir === "in" ? "Entrada registrada" : "Salida registrada");
    setAmount(""); setConcept("");
    router.refresh();
  };
  return (
    <div className="grid gap-3 px-5 pb-5 sm:grid-cols-[120px_160px_1fr_140px_150px_auto] sm:items-end">
      <Field label="Movimiento" htmlFor="cm-dir">
        <NativeSelect id="cm-dir" value={dir} onChange={(e) => { const d = e.target.value as "in" | "out"; setDir(d); setCat(d === "in" ? "venta" : "gasto"); }}>
          <option value="in">Entra</option><option value="out">Sale</option>
        </NativeSelect>
      </Field>
      <Field label="Tipo" htmlFor="cm-cat"><NativeSelect id="cm-cat" value={cat} onChange={(e) => setCat(e.target.value as CashCategory)}>{cats.map((k) => <option key={k} value={k}>{CASH_CATEGORIES[k].label}</option>)}</NativeSelect></Field>
      <Field label="Concepto" htmlFor="cm-concept"><Input id="cm-concept" value={concept} onChange={(e) => setConcept(e.target.value)} placeholder={dir === "in" ? "Cobro remito 10456" : "Nafta, viáticos…"} /></Field>
      <Field label="Importe" htmlFor="cm-amount"><Input id="cm-amount" value={amount} inputMode="decimal" className="tabular" onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Fecha" htmlFor="cm-date"><Input id="cm-date" type="date" value={date} max={todayAr()} onChange={(e) => setDate(e.target.value)} /></Field>
      <Button loading={busy} disabled={!(num(amount) > 0) || concept.trim().length < 2} onClick={save}><Plus /> Agregar</Button>
    </div>
  );
}

export function DeleteCashButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (!confirm) return <button type="button" aria-label="Borrar" className="text-fg-subtle hover:text-danger" onClick={() => setConfirm(true)}><Trash2 className="size-4" /></button>;
  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="danger" loading={busy} onClick={async () => { setBusy(true); const r = await deleteCashMovement(id); setBusy(false); if (!r.ok) toast.error(r.error); else router.refresh(); }}>Borrar</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
    </span>
  );
}

/** Arqueo de caja: contás la plata y queda el ajuste si no coincide. */
export function CashCountForm({ balance }: { balance: number }) {
  const router = useRouter();
  const [counted, setCounted] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const c = num(counted);
  const diff = Number.isFinite(c) ? Math.round((c - balance) * 100) / 100 : null;
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
      <Field label="Lo que contaste en la caja" htmlFor="cc-counted"><Input id="cc-counted" value={counted} inputMode="decimal" className="w-44 tabular" onChange={(e) => setCounted(e.target.value)} /></Field>
      {diff !== null && <p className={`pb-2 text-sm ${diff === 0 ? "text-accent" : "text-warn"}`}>{diff === 0 ? "Coincide" : `Diferencia ${formatMoney(diff)}`}</p>}
      <Button variant="secondary" loading={busy} disabled={diff === null || c < 0} onClick={async () => {
        setBusy(true);
        const r = await cashCount(c);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success(r.adjusted ? `Ajuste registrado: ${formatMoney(r.adjusted)}` : "La caja coincide");
        setCounted("");
        router.refresh();
      }}><Scale /> Hacer arqueo</Button>
    </div>
  );
}

export const RECON_LABEL: Record<string, string> = {
  cobro: "Cobro de cliente", pago_proveedor: "Pago a proveedor", gasto_fijo: "Gasto fijo", cheque: "Cheque", caja: "Caja (efectivo)", impuesto: "Impuesto",
  banco: "Gasto / interés del banco", titular: "Retiro o aporte del titular", otro: "Otro",
};

/** Conciliar un movimiento: con una sugerencia de un clic o eligiendo a mano qué es. */
export function ReconcileControls({ movementId, direction, suggestions }: { movementId: string; direction: "in" | "out"; suggestions: { kind: string; ref_id: string | null; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [manual, setManual] = React.useState(false);
  const [kind, setKind] = React.useState(direction === "in" ? "cobro" : "pago_proveedor");
  const [note, setNote] = React.useState("");
  const go = async (k: string, ref: string | null, n: string | null, key: string) => {
    setBusy(key);
    const r = await reconcileMovement(movementId, k as never, ref, n);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Conciliado");
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {suggestions.map((sg, i) => (
        <Button key={i} size="sm" variant="secondary" loading={busy === `s${i}`} onClick={() => go(sg.kind, sg.ref_id, sg.label, `s${i}`)} title="Conciliar con esto">
          <Check /> {sg.label}
        </Button>
      ))}
      {!manual ? <Button size="sm" variant="ghost" onClick={() => setManual(true)}>Otro…</Button> : (
        <span className="flex flex-wrap items-center gap-1.5">
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 w-48">
            {Object.entries(RECON_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </NativeSelect>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota" className="h-8 w-44" />
          <Button size="sm" loading={busy === "m"} onClick={() => go(kind, null, note || null, "m")}>Conciliar</Button>
        </span>
      )}
    </div>
  );
}

export function UnreconcileButton({ movementId }: { movementId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="ghost" loading={busy} onClick={async () => { setBusy(true); const r = await unreconcileMovement(movementId); setBusy(false); if (!r.ok) toast.error(r.error); else router.refresh(); }}>
      <Undo2 /> Deshacer
    </Button>
  );
}
