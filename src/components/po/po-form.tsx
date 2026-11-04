"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, useWatch, type FieldPath, type Control, type UseFormRegister } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Copy, Plus, Trash2, Wand2, CircleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import {
  purchaseOrderSchema, emptyItem, PO_STATUSES, PO_STATUS_LABEL,
  type PurchaseOrderInput, type PurchaseOrderData,
} from "@/lib/po/schema";
import { differs, isValidDecimal, lineTotal, parseArNumber, sum } from "@/lib/money";
import { formatMoney, parseArDate } from "@/lib/format";
import type { SaveResult } from "@/app/(app)/ordenes/actions";
import type { ExtractionWarning } from "@/lib/bac/types";
import { cn } from "@/lib/utils";

type Props = {
  defaultValues: PurchaseOrderInput;
  onSave: (values: PurchaseOrderInput) => Promise<SaveResult>;
  submitLabel?: string;
  customers?: { id: string; name: string }[];
  review?: string[];
  warnings?: ExtractionWarning[];
  aside?: React.ReactNode;
  cancelHref?: string;
  /** Importación: resumen chico con sólo lo dudoso; el formulario completo queda plegado. */
  compact?: boolean;
};

type F = FieldPath<PurchaseOrderInput>;

export function PoForm({ defaultValues, onSave, submitLabel = "Guardar orden", customers = [], review = [], warnings = [], aside, cancelHref, compact = false }: Props) {
  const router = useRouter();
  const form = useForm<PurchaseOrderInput, unknown, PurchaseOrderData>({
    resolver: zodResolver(purchaseOrderSchema),
    defaultValues,
    mode: "onBlur",
  });
  const { register, control, handleSubmit, formState, setError, setValue, getValues } = form;
  const { errors, dirtyFields, isSubmitting } = formState;
  const items = useFieldArray({ control, name: "items" });
  const reviewSet = React.useMemo(() => new Set(review), [review]);

  const err = (path: string): string | undefined => {
    const parts = path.split(".");
    let cur: unknown = errors;
    for (const p of parts) cur = (cur as Record<string, unknown> | undefined)?.[p];
    return (cur as { message?: string } | undefined)?.message;
  };
  const isDirty = (path: string): boolean => {
    let cur: unknown = dirtyFields;
    for (const p of path.split(".")) cur = (cur as Record<string, unknown> | undefined)?.[p];
    return Boolean(cur);
  };
  const needsReview = (path: string) => reviewSet.has(path) && !isDirty(path);

  const onSubmit = handleSubmit(async () => {
    const res = await onSave(getValues());
    if (res.ok) {
      toast.success("Orden guardada");
      router.push(`/ordenes/${res.id}`);
      router.refresh();
    } else {
      if (res.fieldErrors) {
        Object.entries(res.fieldErrors).forEach(([k, m]) => setError(k as F, { message: m }));
      }
      toast.error(res.error);
    }
  }, () => {
    setShowAll(true);
    toast.error("Revisá los campos marcados en rojo.");
  });

  const pendingReview = review.filter((p) => !isDirty(p)).length;
  const [showAll, setShowAll] = React.useState(!compact || review.some((p) => p === "items" || p.startsWith("items.")));

  const T = (name: F, label: string, opts: { className?: string; placeholder?: string; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; hint?: string } = {}) => (
    <Field label={label} error={err(name)} review={needsReview(name)} className={opts.className} htmlFor={name} hint={opts.hint}>
      <Input id={name} {...register(name)} invalid={!!err(name)} review={needsReview(name)} placeholder={opts.placeholder} type={opts.type} inputMode={opts.inputMode} />
    </Field>
  );

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
      {(warnings.some((w) => w.level !== "info") || (!compact && pendingReview > 0)) && (
        <Card className="border-warn/40 bg-warn-soft/40">
          <CardBody className="flex flex-col gap-2">
            {!compact && pendingReview > 0 && (
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <AlertTriangle className="size-4 text-warn" />
                {pendingReview} campo{pendingReview === 1 ? "" : "s"} para revisar (marcados en amarillo).
              </p>
            )}
            {warnings.filter((w) => w.level !== "info").map((w, i) => (
              <p key={i} className={cn("flex items-start gap-2 text-sm", w.level === "error" ? "text-danger" : "text-fg-muted")}>
                {w.level === "error" ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : w.level === "info" ? <Info className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" />}
                {w.message}
              </p>
            ))}
          </CardBody>
        </Card>
      )}

      <div className={cn("grid gap-5", aside && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <div className="flex min-w-0 flex-col gap-5">
          {compact && (
            <CompactSummary control={control} register={register} err={err} needsReview={needsReview} setValue={setValue}
              review={review} showAll={showAll} onToggle={() => setShowAll((v) => !v)} />
          )}
          <div className={cn("flex flex-col gap-5", !showAll && "hidden")}>
          <Card>
            <CardHeader title="Orden de compra" description="Datos de la OC según BAC" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {T("bac_number", "Número de OC", { className: "col-span-2", placeholder: "412-17904-OC24" })}
              {T("bac_type", "Tipo", { placeholder: "Original" })}
              {T("fiscal_year", "Ejercicio", { inputMode: "numeric", placeholder: "2024" })}
              <DateField control={control} register={register} name="issue_date" label="Fecha autorización" err={err} needsReview={needsReview} setValue={setValue} />
              <DateField control={control} register={register} name="perfected_date" label="Fecha perfeccionamiento" err={err} needsReview={needsReview} setValue={setValue} />
              <DateField control={control} register={register} name="received_date" label="Fecha recepción" err={err} needsReview={needsReview} setValue={setValue} />
              {T("bac_status", "Estado en BAC", { placeholder: "Perfeccionado" })}
              <Field label="Estado interno" error={err("status")} htmlFor="status">
                <NativeSelect id="status" {...register("status")}>
                  {PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
                </NativeSelect>
              </Field>
              {T("contract_duration", "Duración del contrato", { className: "col-span-2 md:col-span-1" })}
              <Field label="Moneda" error={err("currency")} htmlFor="currency">
                <NativeSelect id="currency" {...register("currency")}>
                  <option value="ARS">ARS — Pesos</option>
                  <option value="USD">USD — Dólares</option>
                </NativeSelect>
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Proceso de compra" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {T("expediente_number", "Expediente", { className: "col-span-2", placeholder: "EX-2023-07838510- -GCABA-DGCYC" })}
              {T("process_number", "Procedimiento", { className: "col-span-2 md:col-span-1", placeholder: "623-0216-LPU23" })}
              {T("contratacion_number", "N° contratación", { className: "col-span-2 md:col-span-1" })}
              {T("process_type", "Tipo", { placeholder: "Bienes" })}
              {T("modality", "Modalidad", { placeholder: "Convenio Marco" })}
              {T("award_act_number", "Acto de adjudicación", { className: "col-span-2", placeholder: "RS-2023-…" })}
              <Field label="Clase" className="col-span-2 md:col-span-4" htmlFor="process_class">
                <Textarea id="process_class" rows={2} {...register("process_class")} />
              </Field>
              <Field label="Encuadre legal" className="col-span-2 md:col-span-4" htmlFor="legal_framework">
                <Input id="legal_framework" {...register("legal_framework")} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Comprador" description="El organismo se crea automáticamente si no existe" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field label="Organismo comprador" className="col-span-2" error={err("customer_name")} review={needsReview("customer_name")} htmlFor="customer_name" hint="Unidad ejecutora (ej. 412 - HTAL. COSME ARGERICH)">
                <Input id="customer_name" list="customers-list" {...register("customer_name")} invalid={!!err("customer_name")} review={needsReview("customer_name")} />
                <datalist id="customers-list">{customers.map((c) => <option key={c.id} value={c.name} />)}</datalist>
              </Field>
              {T("jurisdiction", "Jurisdicción solicitante", { className: "col-span-2", placeholder: "401 - MINISTERIO DE SALUD" })}
              {T("dependencia", "Unidad ejecutora / dependencia", { className: "col-span-2" })}
              {T("buyer_phone", "Teléfono")}
              {T("buyer_address", "Dirección")}
              <Field label="Observaciones del comprador" className="col-span-2 md:col-span-4" htmlFor="buyer_notes">
                <Textarea id="buyer_notes" rows={2} {...register("buyer_notes")} />
              </Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Adjudicatario" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {T("awardee_name", "Razón social", { className: "col-span-2" })}
              {T("awardee_cuit", "CUIT", { placeholder: "20-04424052-2", inputMode: "numeric" })}
              {T("awardee_entity_number", "Número de ente", { inputMode: "numeric" })}
            </CardBody>
          </Card>

          <ItemsSection
            control={control} register={register} items={items} err={err} needsReview={needsReview}
            setValue={setValue} currency={useWatch({ control, name: "currency" }) || "ARS"}
          />

          <Card>
            <CardHeader title="Totales y condiciones" />
            <CardBody className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {T("total_amount", "Importe total", { inputMode: "decimal", placeholder: "132.225,00" })}
              {T("discount_amount", "Importe bonificado", { inputMode: "decimal" })}
              {T("net_amount", "Importe neto", { inputMode: "decimal", hint: "Si queda vacío se usa la suma de renglones" })}
              {T("vat_amount", "IVA", { inputMode: "decimal" })}
              {T("delivery_term_text", "Plazo de entrega", { className: "col-span-2", placeholder: "Durante los 5 días hábiles…" })}
              {T("delivery_term_days", "Plazo (días)", { inputMode: "numeric" })}
              <DateField control={control} register={register} name="due_date" label="Fecha límite de entrega" err={err} needsReview={needsReview} setValue={setValue} />
              {T("delivery_place", "Lugar de entrega", { className: "col-span-2" })}
              {T("payment_terms", "Condiciones de pago", { className: "col-span-2" })}
              <Field label="Condiciones contractuales" className="col-span-2 md:col-span-4" htmlFor="contract_terms">
                <Textarea id="contract_terms" rows={2} {...register("contract_terms")} />
              </Field>
              <Field label="Observaciones internas" className="col-span-2 md:col-span-4" htmlFor="notes">
                <Textarea id="notes" rows={2} {...register("notes")} />
              </Field>
            </CardBody>
          </Card>

          <AuthorizersSection control={control} register={register} />
          </div>
        </div>
        {aside && <div className="min-w-0 xl:sticky xl:top-20 xl:self-start">{aside}</div>}
      </div>

      <div className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-2 border-t border-border bg-bg/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {cancelHref && <Button type="button" variant="ghost" onClick={() => router.push(cancelHref)}>Cancelar</Button>}
        <Button type="submit" size="lg" loading={isSubmitting}>{submitLabel}</Button>
      </div>
    </form>
  );
}

type Helpers = {
  control: Control<PurchaseOrderInput, unknown, PurchaseOrderData>;
  register: UseFormRegister<PurchaseOrderInput>;
  err: (p: string) => string | undefined;
  needsReview: (p: string) => boolean;
  setValue: ReturnType<typeof useForm<PurchaseOrderInput, unknown, PurchaseOrderData>>["setValue"];
};

/** Fecha con input nativo (selector móvil) y pegado de "DD/MM/AAAA". */
function DateField({ name, label, register, err, needsReview, setValue }: Helpers & { name: F; label: string }) {
  return (
    <Field label={label} error={err(name)} review={needsReview(name)} htmlFor={name}>
      <Input
        id={name}
        type="date"
        {...register(name)}
        invalid={!!err(name)}
        review={needsReview(name)}
        onPaste={(e) => {
          const iso = parseArDate(e.clipboardData.getData("text"));
          if (iso) {
            e.preventDefault();
            setValue(name, iso, { shouldDirty: true, shouldValidate: true });
          }
        }}
      />
    </Field>
  );
}

function ItemsSection({ control, register, items, err, needsReview, setValue, currency }: Helpers & { items: ReturnType<typeof useFieldArray<PurchaseOrderInput, "items">>; currency: string }) {
  const watched = useWatch({ control, name: "items" }) ?? [];
  const declaredTotal = useWatch({ control, name: "total_amount" });
  const totals = watched.map((it) => parseArNumber(String(it?.total_amount ?? "")) ?? "");
  const itemsSum = totals.every(isValidDecimal) ? sum(totals) : null;
  const declared = parseArNumber(String(declaredTotal ?? "")) ?? "";
  const mismatch = itemsSum && isValidDecimal(declared) && differs(itemsSum, declared);

  return (
    <Card>
      <CardHeader
        title={`Renglones (${items.fields.length})`}
        description="Cantidades y precios exactos; el total se verifica contra cantidad × precio"
        action={
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            const max = Math.max(0, ...watched.map((w) => Number(w?.line_number) || 0));
            items.append(emptyItem(max + 1));
          }}>
            <Plus /> Renglón
          </Button>
        }
      />
      <div className="divide-y divide-border">
        {items.fields.map((f, i) => (
          <ItemRow key={f.id} i={i} control={control} register={register} err={err} needsReview={needsReview} setValue={setValue}
            currency={currency} onRemove={items.fields.length > 1 ? () => items.remove(i) : undefined}
            onDuplicate={() => items.insert(i + 1, { ...watched[i], id: "", option_number: (Number(watched[i]?.option_number) || 1) + 1 } as never)} />
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 border-t border-border bg-surface-2/60 px-5 py-3 text-sm">
        <span className="text-fg-muted">Suma de renglones</span>
        <span className="font-semibold tabular">{itemsSum ? formatMoney(itemsSum, currency) : "—"}</span>
        {mismatch && (
          <span className="flex items-center gap-1.5 text-warn"><AlertTriangle className="size-4" /> No coincide con el importe total {formatMoney(declared, currency)}</span>
        )}
      </div>
    </Card>
  );
}

function ItemRow({ i, control, register, err, needsReview, setValue, currency, onRemove, onDuplicate }: Helpers & { i: number; currency: string; onRemove?: () => void; onDuplicate: () => void }) {
  const [open, setOpen] = React.useState(false);
  const it = useWatch({ control, name: `items.${i}` });
  const norm = (v: unknown) => parseArNumber(String(v ?? "")) ?? "";
  const q = norm(it?.quantity), p = norm(it?.unit_price), t = norm(it?.total_amount);
  const expected = isValidDecimal(q) && isValidDecimal(p) ? lineTotal(q, p) : null;
  const bad = expected && isValidDecimal(t) && differs(expected, t);
  const P = (k: string) => `items.${i}.${k}` as F;
  const hasDelivery = it?.delivery_address || it?.delivery_term || it?.delivery_notes || it?.delivery_phone;

  return (
    <div className="@container px-4 py-4 sm:px-5">
      <div className="grid grid-cols-6 gap-3 @5xl:grid-cols-[64px_56px_150px_minmax(220px,1fr)_100px_96px_120px_128px_auto]">
        <Field label="Renglón" error={err(P("line_number"))} className="col-span-2 @5xl:col-span-1">
          <Input {...register(P("line_number"))} inputMode="numeric" invalid={!!err(P("line_number"))} />
        </Field>
        <Field label="Opción" className="col-span-1">
          <Input {...register(P("option_number"))} inputMode="numeric" />
        </Field>
        <Field label="Código catálogo" className="col-span-3 @5xl:col-span-1" review={needsReview(P("bac_code"))}>
          <Input {...register(P("bac_code"))} className="font-mono text-[13px]" review={needsReview(P("bac_code"))} />
        </Field>
        <Field label="Descripción" error={err(P("description_original"))} review={needsReview(P("description_original"))} className="col-span-6 @5xl:col-span-1">
          <Textarea rows={2} {...register(P("description_original"))} invalid={!!err(P("description_original"))} review={needsReview(P("description_original"))} className="min-h-9 resize-y" />
        </Field>
        <Field label="Cantidad" error={err(P("quantity"))} review={needsReview(P("quantity"))} className="col-span-2 @5xl:col-span-1">
          <Input {...register(P("quantity"))} inputMode="decimal" className="tabular text-right" invalid={!!err(P("quantity"))} review={needsReview(P("quantity"))} />
        </Field>
        <Field label="Unidad" className="col-span-2 @5xl:col-span-1">
          <Input {...register(P("unit"))} />
        </Field>
        <Field label="Precio unit." error={err(P("unit_price"))} review={needsReview(P("unit_price"))} className="col-span-2 @5xl:col-span-1">
          <Input {...register(P("unit_price"))} inputMode="decimal" className="tabular text-right" invalid={!!err(P("unit_price"))} review={needsReview(P("unit_price"))} />
        </Field>
        <Field label="Total" error={err(P("total_amount"))} review={needsReview(P("total_amount"))} className="col-span-4 @5xl:col-span-1">
          <Input {...register(P("total_amount"))} inputMode="decimal" className={cn("tabular text-right", bad && "border-warn")} invalid={!!err(P("total_amount"))} review={needsReview(P("total_amount"))} />
        </Field>
        <div className="col-span-2 flex items-end justify-end gap-1 @5xl:col-span-1">
          <Button type="button" variant="ghost" size="icon-sm" onClick={onDuplicate} title="Duplicar como otra opción"><Copy /></Button>
          {onRemove && <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove} title="Quitar renglón" className="hover:text-danger"><Trash2 /></Button>}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
        {bad && (
          <span className="flex items-center gap-1.5 rounded-md bg-warn-soft px-2 py-1 text-warn">
            <AlertTriangle className="size-3.5" />
            {q} × {formatMoney(p, currency)} = {formatMoney(expected, currency)}
            <button type="button" className="ml-1 inline-flex items-center gap-1 font-medium underline" onClick={() => setValue(P("total_amount"), expected!, { shouldDirty: true, shouldValidate: true })}>
              <Wand2 className="size-3" /> usar calculado
            </button>
          </span>
        )}
        {!t && expected && (
          <button type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => setValue(P("total_amount"), expected, { shouldDirty: true, shouldValidate: true })}>
            <Wand2 className="size-3" /> Completar total ({formatMoney(expected, currency)})
          </button>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg">
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          Detalle de entrega{hasDelivery ? " ·" : ""} {hasDelivery && <span className="text-fg-subtle">{String(it?.delivery_address || it?.delivery_term || "").slice(0, 40)}</span>}
        </button>
      </div>

      {open && (
        <div className="mt-3 grid grid-cols-2 gap-3 rounded-md border border-border bg-surface-2/50 p-3 md:grid-cols-4">
          <Field label="Dirección de entrega" className="col-span-2"><Input {...register(P("delivery_address"))} /></Field>
          <Field label="Teléfono"><Input {...register(P("delivery_phone"))} /></Field>
          <Field label="Empaquetamiento"><Input {...register(P("packaging"))} /></Field>
          <Field label="Plazo" className="col-span-2"><Input {...register(P("delivery_term"))} /></Field>
          <Field label="Código interno" className="col-span-2"><Input {...register(P("internal_code"))} /></Field>
          <Field label="Observaciones de entrega" className="col-span-2 md:col-span-4"><Textarea rows={2} {...register(P("delivery_notes"))} /></Field>
        </div>
      )}
    </div>
  );
}

function AuthorizersSection({ control, register }: Pick<Helpers, "control" | "register">) {
  const arr = useFieldArray({ control, name: "authorizers" });
  return (
    <Card>
      <CardHeader
        title="Autorizadores"
        action={<Button type="button" variant="ghost" size="sm" onClick={() => arr.append({ nombre: "", cargo: "", fecha: "" })}><Plus /> Agregar</Button>}
      />
      {arr.fields.length === 0 ? (
        <CardBody className="text-sm text-fg-subtle">Sin autorizadores cargados.</CardBody>
      ) : (
        <CardBody className="flex flex-col gap-3">
          {arr.fields.map((f, i) => (
            <div key={f.id} className="grid grid-cols-[1fr_1fr_auto] gap-3 sm:grid-cols-[1fr_1fr_160px_auto]">
              <Input placeholder="Nombre" {...register(`authorizers.${i}.nombre`)} />
              <Input placeholder="Cargo" {...register(`authorizers.${i}.cargo`)} />
              <Input type="date" className="col-span-2 sm:col-span-1" {...register(`authorizers.${i}.fecha`)} />
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => arr.remove(i)} className="hover:text-danger"><Trash2 /></Button>
            </div>
          ))}
        </CardBody>
      )}
    </Card>
  );
}

const REVIEW_LABEL: Record<string, string> = {
  bac_number: "Número de OC", customer_name: "Organismo comprador", total_amount: "Importe total", issue_date: "Fecha autorización",
  awardee_cuit: "CUIT adjudicatario", net_amount: "Importe neto", perfected_date: "Fecha perfeccionamiento", due_date: "Fecha límite de entrega",
};
const DATE_FIELDS = new Set(["issue_date", "perfected_date", "due_date", "received_date"]);

/** Resumen de una importación: lo leído en una tarjeta y, editables, sólo los campos dudosos. */
function CompactSummary({ control, register, err, needsReview, setValue, review, showAll, onToggle }: Helpers & { review: string[]; showAll: boolean; onToggle: () => void }) {
  const v = useWatch({ control });
  const cur = v.currency || "ARS";
  const items = v.items ?? [];
  const fieldsToFix = review.filter((p) => REVIEW_LABEL[p] && needsReview(p));
  const itemIssues = review.some((p) => p === "items" || p.startsWith("items.")) ;
  const fmtDate = (iso?: string) => (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso.split("-").reverse().join("/") : "—");
  const money = (x: unknown) => { const n = parseArNumber(String(x ?? "")); return n ? formatMoney(n, cur) : "—"; };

  return (
    <Card>
      <CardHeader title={v.bac_number || "Orden sin número"} description={v.customer_name || "Organismo sin detectar"}
        action={<span className="text-lg font-semibold tabular">{money(v.total_amount)}</span>} />
      <CardBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          {[["Autorización", fmtDate(v.issue_date)], ["Perfeccionamiento", fmtDate(v.perfected_date)], ["Entrega", v.delivery_term_text || fmtDate(v.due_date)], ["Proceso", v.process_number || "—"]].map(([k, val]) => (
            <div key={k} className="min-w-0"><dt className="text-xs text-fg-subtle">{k}</dt><dd className="truncate">{val}</dd></div>
          ))}
        </dl>
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0 truncate"><span className="text-fg-subtle tabular">R{String(it?.line_number ?? "")}</span> {it?.description_original || <em className="text-warn">sin descripción</em>}</span>
              <span className="shrink-0 tabular text-fg-muted">{it?.quantity || "?"} × {money(it?.unit_price)} = <span className="font-medium text-fg">{money(it?.total_amount)}</span></span>
            </li>
          ))}
        </ul>
        {fieldsToFix.length > 0 && (
          <div className="flex flex-col gap-3 rounded-md border border-warn/40 bg-warn-soft/30 p-3">
            <p className="flex items-center gap-2 text-sm font-medium"><AlertTriangle className="size-4 text-warn" />Confirmá {fieldsToFix.length === 1 ? "este dato" : "estos datos"}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {fieldsToFix.map((p) => (
                <Field key={p} label={REVIEW_LABEL[p]} error={err(p)} review htmlFor={`c-${p}`}>
                  <Input id={`c-${p}`} type={DATE_FIELDS.has(p) ? "date" : undefined} {...register(p as F)} review invalid={!!err(p)}
                    onPaste={DATE_FIELDS.has(p) ? (e) => { const iso = parseArDate(e.clipboardData.getData("text")); if (iso) { e.preventDefault(); setValue(p as F, iso, { shouldDirty: true }); } } : undefined} />
                </Field>
              ))}
            </div>
          </div>
        )}
        {itemIssues && <p className="flex items-center gap-2 text-sm text-warn"><AlertTriangle className="size-4" />Algún renglón no se leyó completo: abrí todos los datos para revisarlo.</p>}
        <button type="button" onClick={onToggle} className="inline-flex items-center gap-1 self-start text-sm text-fg-muted hover:text-fg">
          <ChevronDown className={cn("size-4 transition-transform", showAll && "rotate-180")} />
          {showAll ? "Ocultar todos los datos" : "Ver / editar todos los datos"}
        </button>
      </CardBody>
    </Card>
  );
}
