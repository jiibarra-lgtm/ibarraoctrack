"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { DELIVERY_STATUSES, DELIVERY_STATUS_LABEL, type DeliveryStatus } from "@/lib/delivery";
import { formatQty, todayISO } from "@/lib/format";
import { saveDelivery, confirmRemito, type DeliveryInput } from "@/app/(app)/entregas/actions";
import { cn } from "@/lib/utils";

export type DeliveryItemOption = {
  id: string; line_number: number; option_number: number; description: string; quantity: string;
  committed: string;   // entregado + programado en otras entregas activas
};

export type DeliveryDefaults = {
  id?: string; version?: number; planned_date?: string; actual_date?: string; delivery_place?: string; responsible?: string;
  transport?: string; remito_number?: string; status?: DeliveryStatus; notes?: string; quantities?: Record<string, string>;
};

/** Formulario de entrega: cantidades por renglón con el pendiente a la vista; nunca más que lo adjudicado. */
export function DeliveryForm({ poId, items, defaults, jobId, onDone, submitLabel = "Guardar entrega" }: {
  poId: string; items: DeliveryItemOption[]; defaults?: DeliveryDefaults; jobId?: string; onDone?: () => void; submitLabel?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = React.useState<DeliveryStatus>(defaults?.status ?? "programada");
  const [q, setQ] = React.useState<Record<string, string>>(defaults?.quantities ?? {});
  const [f, setF] = React.useState({
    planned_date: defaults?.planned_date ?? "", actual_date: defaults?.actual_date ?? "", delivery_place: defaults?.delivery_place ?? "",
    responsible: defaults?.responsible ?? "", transport: defaults?.transport ?? "", remito_number: defaults?.remito_number ?? "", notes: defaults?.notes ?? "",
  });
  const [saving, setSaving] = React.useState(false);
  const delivered = ["entregada", "recibida_provisional", "conformada"].includes(status);

  const pending = (it: DeliveryItemOption) => {
    const own = defaults?.quantities?.[it.id] && defaults.id ? Number(defaults.quantities[it.id]) : 0; // al editar, lo propio no cuenta como comprometido
    return Math.max(0, Number(it.quantity) - Number(it.committed) + own);
  };
  const over = items.filter((it) => Number((q[it.id] ?? "0").replace(",", ".")) > pending(it) + 1e-9);

  const submit = async () => {
    setSaving(true);
    const payload: DeliveryInput = {
      id: defaults?.id, version: defaults?.version, purchase_order_id: poId, status, ...f,
      actual_date: delivered && !f.actual_date ? todayISO() : f.actual_date,
      items: items.map((it) => ({ purchase_order_item_id: it.id, quantity: q[it.id] ?? "" })),
    };
    const r = jobId ? await confirmRemito(jobId, payload) : await saveDelivery(payload);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(jobId ? "Entrega registrada desde el remito" : "Entrega guardada");
    onDone?.();
    if (jobId) router.push(`/ordenes/${poId}?tab=entregas`);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-border">
        <div className="flex items-center justify-between border-b border-border bg-surface-2/50 px-3 py-2 text-xs text-fg-muted">
          <span>Renglón</span>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => setQ(Object.fromEntries(items.map((it) => [it.id, String(pending(it))])))}>Todo lo pendiente</button>
        </div>
        <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto">
          {items.map((it) => {
            const p = pending(it);
            const bad = over.includes(it);
            return (
              <li key={it.id} className="flex items-center gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm"><span className="text-fg-subtle tabular">R{it.line_number}.{it.option_number}</span> {it.description}</p>
                  <p className="text-xs text-fg-subtle tabular">Adjudicado {formatQty(it.quantity)} · pendiente {formatQty(p)}</p>
                </div>
                <Input value={q[it.id] ?? ""} onChange={(e) => setQ((s) => ({ ...s, [it.id]: e.target.value }))} inputMode="decimal" placeholder="0"
                  className={cn("h-9 w-24 text-right tabular", bad && "border-danger")} disabled={p === 0 && !q[it.id]} aria-label={`Cantidad renglón ${it.line_number}`} />
              </li>
            );
          })}
        </ul>
      </div>
      {over.length > 0 && <p className="text-sm text-danger">Hay cantidades mayores a lo pendiente: no se puede entregar más de lo adjudicado.</p>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Estado">
          <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as DeliveryStatus)}>
            {DELIVERY_STATUSES.filter((s) => s !== "cancelada" && s !== "rechazada").map((s) => <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>)}
          </NativeSelect>
        </Field>
        <Field label="N° de remito"><Input value={f.remito_number} onChange={(e) => setF({ ...f, remito_number: e.target.value })} /></Field>
        <Field label="Fecha prevista"><Input type="date" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} /></Field>
        <Field label="Fecha real" hint={delivered && !f.actual_date ? "Si queda vacía se usa hoy" : undefined}><Input type="date" value={f.actual_date} onChange={(e) => setF({ ...f, actual_date: e.target.value })} /></Field>
        <Field label="Lugar de entrega" className="col-span-2"><Input value={f.delivery_place} onChange={(e) => setF({ ...f, delivery_place: e.target.value })} /></Field>
        <Field label="Responsable"><Input value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} /></Field>
        <Field label="Transporte"><Input value={f.transport} onChange={(e) => setF({ ...f, transport: e.target.value })} /></Field>
        <Field label="Observaciones" className="col-span-2"><Textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        {onDone && <Button variant="ghost" onClick={onDone}>Cancelar</Button>}
        <Button onClick={submit} loading={saving} disabled={over.length > 0}>{submitLabel}</Button>
      </div>
    </div>
  );
}
