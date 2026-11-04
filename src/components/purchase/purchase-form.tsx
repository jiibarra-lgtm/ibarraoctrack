"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type Control, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, Link2, Plus, Search, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { DOC_TYPES, emptyPurchaseItem, purchaseSchema, type PurchaseInput } from "@/lib/purchase/schema";
import { differs, isValidDecimal, parseArNumber, sum, dec } from "@/lib/money";
import { formatMoney, formatQty } from "@/lib/format";
import { savePurchase, suggestPoItems, type Suggestion } from "@/app/(app)/compras/actions";
import { cn } from "@/lib/utils";

type Props = {
  defaultValues: PurchaseInput;
  suppliers: { id: string; name: string; cuit: string | null }[];
  review?: string[];
  warnings?: string[];
  initialSuggestions?: Record<number, Suggestion[]>;
  aside?: React.ReactNode;
  submitLabel?: string;
};

const n = (v: unknown) => parseArNumber(String(v ?? "")) ?? "";

export function PurchaseForm({ defaultValues, suppliers, review = [], warnings = [], initialSuggestions = {}, aside, submitLabel = "Guardar compra" }: Props) {
  const router = useRouter();
  const form = useForm<PurchaseInput>({ resolver: zodResolver(purchaseSchema) as never, defaultValues, mode: "onBlur" });
  const { register, control, handleSubmit, setValue, setError, formState, getValues } = form;
  const items = useFieldArray({ control, name: "items" });
  const reviewSet = new Set(review);
  const err = (p: string) => p.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown> | undefined)?.[k], formState.errors) as { message?: string } | undefined;

  const watchedItems = useWatch({ control, name: "items" }) ?? [];
  const net = useWatch({ control, name: "net_amount" });
  const itemsNet = watchedItems.every((it) => isValidDecimal(n(it?.net_amount))) ? sum(watchedItems.map((it) => n(it?.net_amount))) : null;
  const netMismatch = itemsNet && isValidDecimal(n(net)) && differs(itemsNet, n(net), "1");

  const onSubmit = handleSubmit(async () => {
    const res = await savePurchase(getValues());
    if (!res.ok) {
      Object.entries(res.fieldErrors ?? {}).forEach(([k, m]) => setError(k as never, { message: m }));
      toast.error(res.error);
      return;
    }
    toast.success("Compra registrada");
    router.push(`/compras/${res.id}`);
    router.refresh();
  }, () => toast.error("Revisá los campos marcados."));

  const T = (name: keyof PurchaseInput, label: string, extra: { className?: string; placeholder?: string; type?: string; inputMode?: "decimal" | "numeric" } = {}) => (
    <Field label={label} error={err(String(name))?.message} review={reviewSet.has(String(name))} className={extra.className}>
      <Input {...register(name as never)} type={extra.type} inputMode={extra.inputMode} placeholder={extra.placeholder} invalid={!!err(String(name))} review={reviewSet.has(String(name))} />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {(warnings.length > 0 || review.length > 0) && (
        <Card className="border-warn/40 bg-warn-soft/40">
          <CardBody className="flex flex-col gap-1.5 text-sm">
            {review.length > 0 && <p className="flex items-center gap-2 font-medium"><AlertTriangle className="size-4 text-warn" /> Revisá los campos en amarillo antes de confirmar.</p>}
            {warnings.map((w, i) => <p key={i} className="text-fg-muted">{w}</p>)}
          </CardBody>
        </Card>
      )}
      <div className={cn("grid gap-5", aside && "xl:grid-cols-[minmax(0,1fr)_400px]")}>
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Comprobante" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Proveedor" className="col-span-2" error={err("supplier_name")?.message} review={reviewSet.has("supplier_name")} hint="Se crea solo si es nuevo">
                <Input list="suppliers-list" {...register("supplier_name")} review={reviewSet.has("supplier_name")}
                  onChange={(e) => {
                    register("supplier_name").onChange(e);
                    const s = suppliers.find((x) => x.name.toLowerCase() === e.target.value.toLowerCase());
                    setValue("supplier_id", s?.id ?? "");
                    if (s?.cuit) setValue("supplier_cuit", s.cuit);
                  }} />
                <datalist id="suppliers-list">{suppliers.map((s) => <option key={s.id} value={s.name}>{s.cuit ?? ""}</option>)}</datalist>
              </Field>
              {T("supplier_cuit", "CUIT", { placeholder: "30-12345678-9", inputMode: "numeric" })}
              <Field label="Tipo">
                <NativeSelect {...register("doc_type")}>{DOC_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</NativeSelect>
              </Field>
              {T("point_of_sale", "Punto de venta", { inputMode: "numeric", placeholder: "00004" })}
              {T("number", "Número", { inputMode: "numeric", placeholder: "00012345" })}
              {T("invoice_date", "Fecha", { type: "date" })}
              {T("due_date", "Vencimiento", { type: "date" })}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Renglones (${items.fields.length})`}
              description="Vinculá cada renglón con el de la orden que abastece. Una compra puede repartirse entre varias órdenes."
              action={<Button type="button" variant="secondary" size="sm" onClick={() => items.append(emptyPurchaseItem())}><Plus /> Renglón</Button>}
            />
            <div className="divide-y divide-border">
              {items.fields.map((f, i) => (
                <ItemRow key={f.id} i={i} control={control} register={register} setValue={setValue} err={err}
                  review={reviewSet} suggestions={initialSuggestions[i] ?? []}
                  onRemove={items.fields.length > 1 ? () => items.remove(i) : undefined} />
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border bg-surface-2/60 px-5 py-3 text-sm">
              <span className="text-fg-muted">Neto de renglones</span>
              <span className="font-semibold tabular">{itemsNet ? formatMoney(itemsNet) : "—"}</span>
              {netMismatch && <span className="flex items-center gap-1.5 text-warn"><AlertTriangle className="size-4" /> No coincide con el neto del comprobante</span>}
            </div>
          </Card>

          <Card>
            <CardHeader title="Totales" description="Si sos Responsable Inscripto, el costo se toma sin IVA" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {T("net_amount", "Neto gravado", { inputMode: "decimal" })}
              {T("vat_amount", "IVA", { inputMode: "decimal" })}
              {T("other_taxes", "Percepciones / otros", { inputMode: "decimal" })}
              {T("total_amount", "Total", { inputMode: "decimal" })}
              {T("payment_terms", "Condición de pago", { className: "col-span-2" })}
              {T("cae", "CAE")}
              <Field label="Pagada">
                <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" {...register("paid")} className="size-4 accent-[var(--primary)]" /> Ya pagué esta factura</label>
              </Field>
              <Field label="Observaciones" className="col-span-2 md:col-span-4"><Textarea rows={2} {...register("notes")} /></Field>
            </CardBody>
          </Card>
        </div>
        {aside && <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">{aside}</div>}
      </div>
      <div className="sticky bottom-0 z-20 -mx-4 flex justify-end gap-2 border-t border-card-border bg-surface-solid/85 px-4 py-3 backdrop-blur-xl lg:rounded-b-3xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <Button type="button" variant="ghost" onClick={() => router.back()}>Cancelar</Button>
        <Button type="submit" size="lg" loading={formState.isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function ItemRow({ i, control, register, setValue, err, review, suggestions, onRemove }: {
  i: number; control: Control<PurchaseInput>; register: UseFormRegister<PurchaseInput>; setValue: UseFormSetValue<PurchaseInput>;
  err: (p: string) => { message?: string } | undefined; review: Set<string>; suggestions: Suggestion[]; onRemove?: () => void;
}) {
  const it = useWatch({ control, name: `items.${i}` });
  const allocs = useFieldArray({ control, name: `items.${i}.allocations` });
  const [open, setOpen] = React.useState(false);
  const q = n(it?.quantity), p = n(it?.unit_price), d = n(it?.discount_pct) || "0";
  const computed = isValidDecimal(q) && isValidDecimal(p) ? dec(q).times(dec(p)).times(dec(1).minus(dec(d).div(100))).toDecimalPlaces(2).toFixed(2) : null;
  const P = (k: string) => `items.${i}.${k}` as never;
  const allocated = (it?.allocations ?? []).reduce((a, x) => a + Number(n(x?.quantity) || 0), 0);

  // Autocompletar neto
  React.useEffect(() => {
    if (computed && !n(it?.net_amount)) setValue(P("net_amount"), computed as never, { shouldDirty: true });
  }, [computed]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (s: Suggestion) => {
    const remainingHere = Math.max(0, Number(q || 0) - allocated);
    const qty = Math.min(Number(s.remaining), remainingHere || Number(s.remaining));
    allocs.append({ purchase_order_item_id: s.purchase_order_item_id, label: `${s.order_label} · R${s.line_number}`, quantity: String(qty) });
    setOpen(false);
  };

  return (
    <div className="@container px-4 py-4 sm:px-5">
      <div className="grid grid-cols-6 gap-3 @4xl:grid-cols-[minmax(220px,1fr)_96px_90px_120px_84px_72px_130px_auto]">
        <Field label="Descripción del proveedor" className="col-span-6 @4xl:col-span-1" error={err(`items.${i}.description`)?.message} review={review.has(`items.${i}.description`)}>
          <Input {...register(P("description"))} />
        </Field>
        <Field label="Cantidad" className="col-span-2 @4xl:col-span-1" error={err(`items.${i}.quantity`)?.message}><Input {...register(P("quantity"))} inputMode="decimal" className="text-right tabular" /></Field>
        <Field label="Unidad" className="col-span-2 @4xl:col-span-1"><Input {...register(P("unit"))} /></Field>
        <Field label="Precio unit." className="col-span-2 @4xl:col-span-1" error={err(`items.${i}.unit_price`)?.message}><Input {...register(P("unit_price"))} inputMode="decimal" className="text-right tabular" /></Field>
        <Field label="Bonif. %" className="col-span-2 @4xl:col-span-1"><Input {...register(P("discount_pct"))} inputMode="decimal" className="text-right tabular" /></Field>
        <Field label="IVA %" className="col-span-2 @4xl:col-span-1"><Input {...register(P("vat_rate"))} inputMode="decimal" className="text-right tabular" /></Field>
        <Field label="Neto" className="col-span-2 @4xl:col-span-1"><Input {...register(P("net_amount"))} inputMode="decimal" className="text-right tabular" /></Field>
        <div className="col-span-6 flex items-end justify-end @4xl:col-span-1">
          {onRemove && <Button type="button" variant="ghost" size="icon-sm" className="hover:text-danger" onClick={onRemove} aria-label="Quitar"><Trash2 /></Button>}
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 rounded-md bg-surface-2/60 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link2 className="size-3.5 text-fg-muted" />
          <span className="text-fg-muted">Abastece a:</span>
          {allocs.fields.length === 0 && <span className="text-fg-subtle">sin vincular (stock o gasto general)</span>}
          {allocs.fields.map((a, k) => (
            <span key={a.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface py-0.5 pl-2.5 pr-1">
              <span className="font-medium">{(it?.allocations?.[k]?.label) || "Renglón"}</span>
              <input {...register(`items.${i}.allocations.${k}.quantity` as never)} inputMode="decimal" className="w-14 rounded border border-border bg-field px-1 text-right tabular" aria-label="Cantidad asignada" />
              <button type="button" onClick={() => allocs.remove(k)} className="rounded-full p-0.5 text-fg-subtle hover:text-danger" aria-label="Quitar vínculo"><X className="size-3" /></button>
            </span>
          ))}
          <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><Plus className="size-3" /> Vincular a orden</button>
          {allocated > Number(q || 0) && <span className="text-danger">Asignaste más de lo comprado</span>}
        </div>
        {err(`items.${i}.allocations`)?.message && <p className="text-xs text-danger">{err(`items.${i}.allocations`)?.message}</p>}
        {(open || (allocs.fields.length === 0 && suggestions.length > 0)) && (
          <SuggestionPicker initial={suggestions} query={String(it?.description ?? "")} onPick={add} onClose={() => setOpen(false)} />
        )}
      </div>
    </div>
  );
}

function SuggestionPicker({ initial, query, onPick, onClose }: { initial: Suggestion[]; query: string; onPick: (s: Suggestion) => void; onClose: () => void }) {
  const [q, setQ] = React.useState(query);
  const [rows, setRows] = React.useState<Suggestion[]>(initial);
  const [loading, setLoading] = React.useState(false);
  const run = async (text: string) => {
    setLoading(true);
    setRows(await suggestPoItems(text));
    setLoading(false);
  };
  return (
    <div className="rounded-md border border-border bg-surface p-2">
      <div className="flex items-center gap-2">
        <Search className="size-4 text-fg-subtle" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(q); } }}
          placeholder="Buscar renglón por descripción…" className="h-8 flex-1 bg-transparent text-sm outline-none" />
        <Button type="button" size="sm" variant="secondary" loading={loading} onClick={() => run(q)}>Buscar</Button>
        <Button type="button" size="icon-sm" variant="ghost" onClick={onClose} aria-label="Cerrar"><X /></Button>
      </div>
      {rows.length === 0 ? (
        <p className="px-2 py-3 text-xs text-fg-subtle">Sin coincidencias en órdenes abiertas.</p>
      ) : (
        <ul className="mt-1 divide-y divide-border">
          {rows.map((s) => (
            <li key={s.purchase_order_item_id}>
              <button type="button" onClick={() => onPick(s)} className="flex w-full items-start gap-3 rounded px-2 py-2 text-left hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm"><span className="font-medium">{s.order_label}</span> · R{s.line_number} · {s.description}</p>
                  <p className="text-xs text-fg-subtle">{s.customer_name ?? ""} · faltan comprar {formatQty(s.remaining)} de {formatQty(s.quantity)} · venta {formatMoney(s.unit_price)} c/u</p>
                </div>
                <Badge tone={s.by_alias ? "accent" : s.score > 0.5 ? "primary" : "neutral"}>
                  {s.by_alias ? <><Sparkles className="size-3" /> Equivalencia</> : `${Math.round(s.score * 100)}%`}
                </Badge>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
