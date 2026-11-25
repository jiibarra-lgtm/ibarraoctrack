"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Pause, Play, RefreshCw, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { parseArNumber } from "@/lib/money";
import { formatMoney } from "@/lib/format";
import {
  mlAddCompetitor, mlAnswer, mlBlockBuyer, mlBulkUpdate, mlDeleteAutoAnswer, mlDeletePriceRule, mlJoinPromotion, mlLeavePromotion, mlMarkEventsSeen, mlRemoveCompetitor,
  mlSaveAutoAnswer, mlSavePriceRule, mlSaveSettings, mlSendMessage, mlSetCost, mlStartAbTest, mlStopAbTest, mlSyncNow, mlUpdateItem, mlUploadInvoice, mlVacation,
} from "./pro-actions";

const num = (s: string) => { const n = Number(parseArNumber(s) ?? NaN); return Number.isFinite(n) ? n : NaN; };
type Res = { ok: true } | { ok: false; error: string };
function useRun() {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const run = async <T extends Res>(key: string, fn: () => Promise<T>, msg?: string | ((r: T) => string)) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) { toast.error((r as { error: string }).error, { duration: 9000 }); return null; }
    if (msg) toast.success(typeof msg === "function" ? msg(r) : msg);
    router.refresh();
    return r;
  };
  return { busy, run };
}

export function MlSyncNowButton() {
  const { busy, run } = useRun();
  return <Button size="sm" variant="secondary" loading={busy === "s"} onClick={() => run("s", mlSyncNow, (r) => (r as { summary: string }).summary)}><RefreshCw /> Actualizar ahora</Button>;
}

export function MarkSeenButton() {
  const { busy, run } = useRun();
  return <Button size="sm" variant="ghost" loading={busy === "m"} onClick={() => run("m", mlMarkEventsSeen)}><Check /> Marcar leído</Button>;
}

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------
/** Precio, stock y estado editables en la fila. */
export function ItemQuickEdit({ id, price, stock, status, canEdit }: { id: string; price: number | null; stock: number | null; status: string | null; canEdit: boolean }) {
  const { busy, run } = useRun();
  const [p, setP] = React.useState(price ? String(price).replace(".", ",") : "");
  const [q, setQ] = React.useState(stock !== null ? String(stock) : "");
  if (!canEdit) return null;
  const dirty = num(p) !== Number(price) || Number(q) !== Number(stock);
  return (
    <div className="flex items-center gap-1.5">
      <Input aria-label="Precio" value={p} onChange={(e) => setP(e.target.value)} className="h-8 w-28 text-right tabular" inputMode="decimal" />
      <Input aria-label="Stock" value={q} onChange={(e) => setQ(e.target.value.replace(/\D/g, ""))} className="h-8 w-16 text-right tabular" inputMode="numeric" />
      {dirty && <Button size="sm" loading={busy === "save"} onClick={() => run("save", () => mlUpdateItem(id, { ...(num(p) !== Number(price) ? { price: num(p) } : {}), ...(Number(q) !== Number(stock) ? { available_quantity: Number(q) } : {}) }), "Publicación actualizada")}>Guardar</Button>}
      {status === "active" && <Button size="icon-sm" variant="ghost" aria-label="Pausar" loading={busy === "pause"} onClick={() => run("pause", () => mlUpdateItem(id, { status: "paused" }), "Pausada")}><Pause /></Button>}
      {status === "paused" && <Button size="icon-sm" variant="ghost" aria-label="Activar" loading={busy === "play"} onClick={() => run("play", () => mlUpdateItem(id, { status: "active" }), "Activada")}><Play /></Button>}
    </div>
  );
}

/** Selección múltiple + acción masiva. Las casillas están en la tabla (name="sel"). */
export function BulkBar({ formId }: { formId: string }) {
  const { busy, run } = useRun();
  const [kind, setKind] = React.useState<"price_pct" | "price" | "stock" | "status">("price_pct");
  const [value, setValue] = React.useState("");
  const selected = () => [...document.querySelectorAll<HTMLInputElement>(`#${formId} input[name=sel]:checked`)].map((x) => x.value);
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-border px-5 py-3">
      <Field label="Edición masiva (marcá las publicaciones)" htmlFor="bulk-kind">
        <NativeSelect id="bulk-kind" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setValue(""); }} className="h-9 w-56">
          <option value="price_pct">Cambiar precio en %</option><option value="price">Precio fijo</option><option value="stock">Stock</option><option value="status">Pausar / activar</option>
        </NativeSelect>
      </Field>
      {kind === "status" ? (
        <NativeSelect value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-40"><option value="">Elegí…</option><option value="paused">Pausar</option><option value="active">Activar</option></NativeSelect>
      ) : <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "price_pct" ? "ej. 10 o -5" : kind === "stock" ? "unidades" : "$"} className="h-9 w-32 tabular" inputMode="decimal" />}
      <Button size="sm" loading={busy === "bulk"} disabled={!value} onClick={async () => {
        const ids = selected();
        if (!ids.length) return toast.error("Marcá al menos una publicación");
        const v = kind === "status" ? value : num(value);
        if (kind !== "status" && !Number.isFinite(v as number)) return toast.error("Valor inválido");
        const r = await run("bulk", () => mlBulkUpdate(ids, { kind, value: v }), (x) => `${(x as { done: number }).done} publicaciones actualizadas`);
        const errs = (r as { errors?: string[] } | null)?.errors ?? [];
        if (errs.length) toast.error(errs.join(" · "), { duration: 12000 });
      }}>Aplicar a las marcadas</Button>
    </div>
  );
}

export function CostInput({ id, cost, canEdit }: { id: string; cost: number | null; canEdit: boolean }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState(cost !== null ? String(cost).replace(".", ",") : "");
  const changed = (v === "" ? null : num(v)) !== cost;
  return (
    <span className="inline-flex items-center gap-1">
      <Input aria-label="Costo por unidad" value={v} disabled={!canEdit} onChange={(e) => setV(e.target.value)} placeholder="costo" className="h-8 w-24 text-right tabular" inputMode="decimal" />
      {changed && canEdit && <Button size="sm" variant="secondary" loading={busy === "c"} onClick={() => run("c", () => mlSetCost(id, v === "" ? null : num(v)), "Costo guardado")}>OK</Button>}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Preguntas
// ---------------------------------------------------------------------------
export function AnswerBox({ id, suggestions, canEdit }: { id: string; suggestions: { name: string; answer: string }[]; canEdit: boolean }) {
  const { busy, run } = useRun();
  const [t, setT] = React.useState("");
  if (!canEdit) return null;
  return (
    <div className="mt-2 space-y-2">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((s) => <button key={s.name} type="button" onClick={() => setT(s.answer)} className="rounded-full border border-border bg-field px-2.5 py-1 text-xs hover:border-brand">{s.name}</button>)}
        </div>
      )}
      <div className="flex gap-2">
        <textarea value={t} onChange={(e) => setT(e.target.value)} rows={2} maxLength={2000} placeholder="Escribí la respuesta…" className="min-h-[60px] flex-1 rounded-lg border border-card-border bg-field px-3 py-2 text-sm" />
        <Button loading={busy === "a"} disabled={t.trim().length < 2} onClick={async () => { const r = await run("a", () => mlAnswer(id, t), "Respondida"); if (r) setT(""); }}>Responder</Button>
      </div>
    </div>
  );
}

export function AutoAnswerEditor({ row }: { row?: { id: string; name: string; keywords: string[]; answer: string; active: boolean } }) {
  const { busy, run } = useRun();
  const [name, setName] = React.useState(row?.name ?? "");
  const [kw, setKw] = React.useState(row?.keywords.join(", ") ?? "");
  const [ans, setAns] = React.useState(row?.answer ?? "");
  const [active, setActive] = React.useState(row?.active ?? true);
  return (
    <div className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[160px_1fr]">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre (ej. Factura)" className="h-9" />
      <Input value={kw} onChange={(e) => setKw(e.target.value)} placeholder="Palabras que la activan, separadas por coma" className="h-9" />
      <textarea value={ans} onChange={(e) => setAns(e.target.value)} rows={2} placeholder="Respuesta" className="rounded-lg border border-card-border bg-field px-3 py-2 text-sm sm:col-span-2" />
      <div className="flex items-center justify-between gap-2 sm:col-span-2">
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Activa</label>
        <div className="flex gap-2">
          {row && <Button size="sm" variant="ghost" loading={busy === "d"} onClick={() => run("d", () => mlDeleteAutoAnswer(row.id), "Borrada")}><Trash2 /></Button>}
          <Button size="sm" loading={busy === "s"} onClick={async () => { const r = await run("s", () => mlSaveAutoAnswer({ id: row?.id, name, keywords: kw, answer: ans, active }), "Guardada"); if (r && !row) { setName(""); setKw(""); setAns(""); } }}>{row ? "Guardar" : "Agregar"}</Button>
        </div>
      </div>
    </div>
  );
}

export function BlockBuyerButton({ userId, blocked }: { userId: string; blocked: boolean }) {
  const { busy, run } = useRun();
  return blocked
    ? <Button size="sm" variant="ghost" loading={busy === "b"} onClick={() => run("b", () => mlBlockBuyer(userId, false), "Desbloqueado")}><Undo2 /> Desbloquear</Button>
    : <Button size="sm" variant="ghost" loading={busy === "b"} onClick={() => run("b", () => mlBlockBuyer(userId, true, "Desde la app"), "Bloqueado: no puede comprarte ni preguntarte")}>Bloquear</Button>;
}

// ---------------------------------------------------------------------------
// Ventas
// ---------------------------------------------------------------------------
export function InvoiceUpload({ pack }: { pack: string }) {
  const { busy, run } = useRun();
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf" hidden onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        const fd = new FormData(); fd.append("pack", pack); fd.append("file", f);
        await run("i", () => mlUploadInvoice(fd), "Factura subida a la venta");
      }} />
      <Button size="sm" variant="ghost" loading={busy === "i"} onClick={() => ref.current?.click()}>Subir factura</Button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Precios
// ---------------------------------------------------------------------------
export function PriceRuleEditor({ itemId, rule, price }: { itemId: string; price: number; rule?: { strategy: string; min_price: number; max_price: number | null; margin_pct: number | null; step: number; active: boolean; last_result: string | null } }) {
  const { busy, run } = useRun();
  const [strategy, setStrategy] = React.useState(rule?.strategy ?? "match_lowest");
  const [min, setMin] = React.useState(rule ? String(rule.min_price) : String(Math.round(price * 0.9)));
  const [max, setMax] = React.useState(rule?.max_price ? String(rule.max_price) : "");
  const [margin, setMargin] = React.useState(rule?.margin_pct !== null && rule?.margin_pct !== undefined ? String(rule.margin_pct) : "20");
  const [active, setActive] = React.useState(rule?.active ?? true);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <NativeSelect value={strategy} onChange={(e) => setStrategy(e.target.value)} className="h-8 w-44">
        <option value="match_lowest">Igualar al más barato −$1</option><option value="win_catalog">Ganar el catálogo</option><option value="cost_plus">Costo + margen</option>
      </NativeSelect>
      <Input value={min} onChange={(e) => setMin(e.target.value)} placeholder="piso" className="h-8 w-24 tabular" title="Nunca baja de este precio" />
      <Input value={max} onChange={(e) => setMax(e.target.value)} placeholder="techo" className="h-8 w-24 tabular" />
      {strategy === "cost_plus" && <Input value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="margen %" className="h-8 w-20 tabular" />}
      <label className="flex items-center gap-1"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> activa</label>
      <Button size="sm" loading={busy === "s"} onClick={() => run("s", () => mlSavePriceRule({ item_id: itemId, strategy: strategy as "match_lowest", min_price: num(min), max_price: max ? num(max) : null, margin_pct: strategy === "cost_plus" ? num(margin) : null, step: 1, active }), "Regla guardada")}>Guardar</Button>
      {rule && <Button size="icon-sm" variant="ghost" aria-label="Borrar regla" loading={busy === "d"} onClick={() => run("d", () => mlDeletePriceRule(itemId), "Regla borrada")}><Trash2 /></Button>}
      {rule?.last_result && <span className="text-fg-subtle">· {rule.last_result}</span>}
    </div>
  );
}

export function PromoButton({ itemId, promo, joined, suggested }: { itemId: string; promo: { id: string; type: string; name: string }; joined: boolean; suggested: number | null }) {
  const { busy, run } = useRun();
  const [price, setPrice] = React.useState(suggested ? String(Math.round(suggested)) : "");
  if (joined) return <Button size="sm" variant="ghost" loading={busy === "l"} onClick={() => run("l", () => mlLeavePromotion(itemId, promo), "Saliste de la promoción")}>Salir de {promo.name}</Button>;
  return (
    <span className="inline-flex items-center gap-1">
      {promo.type === "DEAL" || promo.type === "PRICE_DISCOUNT" ? <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="precio promo" className="h-8 w-24 tabular" /> : null}
      <Button size="sm" variant="secondary" loading={busy === "j"} onClick={() => run("j", () => mlJoinPromotion(itemId, promo, price ? num(price) : null), `Sumada a ${promo.name}`)}>Sumar a {promo.name}</Button>
    </span>
  );
}

export function AbTestForm({ itemId, title, price }: { itemId: string; title: string; price: number }) {
  const { busy, run } = useRun();
  const [field, setField] = React.useState<"title" | "price">("title");
  const [b, setB] = React.useState("");
  const [days, setDays] = React.useState("3");
  return (
    <div className="grid gap-2 sm:grid-cols-[140px_1fr_90px_auto] sm:items-end">
      <Field label="Qué probar" htmlFor="ab-f"><NativeSelect id="ab-f" value={field} onChange={(e) => { setField(e.target.value as "title"); setB(""); }}><option value="title">Título</option><option value="price">Precio</option></NativeSelect></Field>
      <Field label={`Variante B (la A es la actual: ${field === "title" ? title : formatMoney(price)})`} htmlFor="ab-b"><Input id="ab-b" value={b} onChange={(e) => setB(e.target.value)} maxLength={field === "title" ? 60 : 12} /></Field>
      <Field label="Días c/u" htmlFor="ab-d"><Input id="ab-d" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} /></Field>
      <Button loading={busy === "ab"} disabled={!b.trim()} onClick={() => run("ab", () => mlStartAbTest({ item_id: itemId, field, variant_b: field === "price" ? String(num(b)) : b, days_each: Number(days) || 3, rounds: 4 }), "Prueba A/B iniciada con la variante B")}>Empezar</Button>
    </div>
  );
}

export function AbStopButtons({ id }: { id: string }) {
  const { busy, run } = useRun();
  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="ghost" loading={busy === "a"} onClick={() => run("a", () => mlStopAbTest(id, "a"), "Quedó la A")}>Terminar con A</Button>
      <Button size="sm" variant="ghost" loading={busy === "b"} onClick={() => run("b", () => mlStopAbTest(id, "b"), "Quedó la B")}>Terminar con B</Button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Competencia
// ---------------------------------------------------------------------------
export function CompetitorForm({ myItems }: { myItems: { id: string; title: string }[] }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState("");
  const [mine, setMine] = React.useState("");
  const [seller, setSeller] = React.useState(false);
  return (
    <div className="grid gap-2 px-5 pb-4 sm:grid-cols-[1fr_260px_auto] sm:items-end">
      <Field label="Link de la publicación o producto de catálogo (o número de vendedor)" htmlFor="cp-v"><Input id="cp-v" value={v} onChange={(e) => setV(e.target.value)} placeholder="https://articulo.mercadolibre.com.ar/MLA-…" /></Field>
      <Field label="Compite con mi publicación (opcional)" htmlFor="cp-m">
        <NativeSelect id="cp-m" value={mine} onChange={(e) => setMine(e.target.value)}><option value="">—</option>{myItems.map((i) => <option key={i.id} value={i.id}>{i.title.slice(0, 50)}</option>)}</NativeSelect>
      </Field>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={seller} onChange={(e) => setSeller(e.target.checked)} /> seguir al vendedor</label>
        <Button loading={busy === "c"} disabled={!v.trim()} onClick={async () => { const r = await run("c", () => mlAddCompetitor(v, mine || null, seller), "Agregado: te aviso si cambia"); if (r) setV(""); }}>Seguir</Button>
      </div>
    </div>
  );
}

export function RemoveCompetitor({ id }: { id: string }) {
  const { busy, run } = useRun();
  return <Button size="icon-sm" variant="ghost" aria-label="Dejar de seguir" loading={busy === "r"} onClick={() => run("r", () => mlRemoveCompetitor(id), "Ya no se sigue")}><Trash2 /></Button>;
}

// ---------------------------------------------------------------------------
// Automatizaciones
// ---------------------------------------------------------------------------
export function SettingToggle({ field, value, label, hint }: { field: "auto_answers" | "push_sales" | "push_questions" | "push_claims" | "repricing"; value: boolean; label: string; hint?: string }) {
  const { busy, run } = useRun();
  return (
    <label className="flex items-start gap-3 py-2">
      <input type="checkbox" className="mt-1" checked={value} disabled={busy === field} onChange={(e) => run(field, () => mlSaveSettings({ [field]: e.target.checked }), e.target.checked ? "Activado" : "Desactivado")} />
      <span><span className="text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-fg-subtle">{hint}</span>}</span>
    </label>
  );
}

export function HoursForm({ from, to, days, offAnswer }: { from: number; to: number; days: number[]; offAnswer: string }) {
  const { busy, run } = useRun();
  const [f, setF] = React.useState(String(from)), [t, setT] = React.useState(String(to)), [d, setD] = React.useState(days), [a, setA] = React.useState(offAnswer);
  const DAYS = ["L", "M", "X", "J", "V", "S", "D"];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        De <Input value={f} onChange={(e) => setF(e.target.value.replace(/\D/g, ""))} className="h-8 w-14 tabular" /> a <Input value={t} onChange={(e) => setT(e.target.value.replace(/\D/g, ""))} className="h-8 w-14 tabular" /> hs
        <span className="ml-2 flex gap-1">{DAYS.map((x, i) => { const n = i + 1, on = d.includes(n); return <button key={x} type="button" onClick={() => setD(on ? d.filter((y) => y !== n) : [...d, n].sort())} className={`size-8 rounded-full text-xs font-semibold ${on ? "bg-primary text-primary-fg" : "bg-field text-fg-muted"}`}>{x}</button>; })}</span>
      </div>
      <textarea value={a} onChange={(e) => setA(e.target.value)} rows={3} className="w-full rounded-lg border border-card-border bg-field px-3 py-2 text-sm" />
      <Button size="sm" loading={busy === "h"} onClick={() => run("h", () => mlSaveSettings({ hours_from: Number(f), hours_to: Number(t), work_days: d, off_hours_answer: a }), "Horario guardado")}>Guardar horario</Button>
    </div>
  );
}

export function GoalsForm({ sales, units, profit }: { sales: number | null; units: number | null; profit: number | null }) {
  const { busy, run } = useRun();
  const [s, setS] = React.useState(sales ? String(sales) : ""), [u, setU] = React.useState(units ? String(units) : ""), [p, setP] = React.useState(profit ? String(profit) : "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Ventas del mes ($)" htmlFor="g-s"><Input id="g-s" value={s} onChange={(e) => setS(e.target.value)} className="w-36 tabular" /></Field>
      <Field label="Unidades" htmlFor="g-u"><Input id="g-u" value={u} onChange={(e) => setU(e.target.value.replace(/\D/g, ""))} className="w-24 tabular" /></Field>
      <Field label="Ganancia neta ($)" htmlFor="g-p"><Input id="g-p" value={p} onChange={(e) => setP(e.target.value)} className="w-36 tabular" /></Field>
      <Button size="sm" loading={busy === "g"} onClick={() => run("g", () => mlSaveSettings({ goal_sales: s ? num(s) : null, goal_units: u ? Number(u) : null, goal_profit: p ? num(p) : null }), "Metas guardadas")}>Guardar metas</Button>
    </div>
  );
}

export function TemplateForm({ value }: { value: string }) {
  const { busy, run } = useRun();
  const [v, setV] = React.useState(value);
  return (
    <div className="space-y-2">
      <textarea value={v} onChange={(e) => setV(e.target.value)} rows={8} className="w-full rounded-lg border border-card-border bg-field px-3 py-2 font-mono text-xs" />
      <p className="text-xs text-fg-subtle">{"{titulo}"} se reemplaza por el título de la publicación.</p>
      <Button size="sm" loading={busy === "t"} onClick={() => run("t", () => mlSaveSettings({ desc_template: v }), "Plantilla guardada")}>Guardar plantilla</Button>
    </div>
  );
}

export function VacationButton({ on }: { on: boolean }) {
  const { busy, run } = useRun();
  const [confirm, setConfirm] = React.useState(false);
  if (on) return <Button loading={busy === "v"} onClick={() => run("v", () => mlVacation(false), (r) => `Volviste: ${(r as { n: number }).n} publicaciones reactivadas`)}><Play /> Volver de vacaciones</Button>;
  if (!confirm) return <Button variant="secondary" onClick={() => setConfirm(true)}><Pause /> Activar modo vacaciones</Button>;
  return (
    <span className="inline-flex gap-2">
      <Button variant="danger" loading={busy === "v"} onClick={() => run("v", () => mlVacation(true), (r) => `${(r as { n: number }).n} publicaciones pausadas`)}>Pausar todas las activas</Button>
      <Button variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
    </span>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  return <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success("Copiado"); } catch { toast.error("No se pudo copiar"); } }}><Copy /> {label}</Button>;
}

export function MessageForm({ pack, buyer }: { pack: string; buyer: string }) {
  const { busy, run } = useRun();
  const [open, setOpen] = React.useState(false);
  const [t, setT] = React.useState("");
  if (!open) return <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Mensaje</Button>;
  return (
    <span className="flex w-full gap-1.5">
      <Input value={t} onChange={(e) => setT(e.target.value)} maxLength={350} placeholder="Mensaje al comprador…" className="h-8 flex-1" />
      <Button size="sm" loading={busy === "m"} disabled={t.trim().length < 2} onClick={async () => { const r = await run("m", () => mlSendMessage(pack, buyer, t), "Mensaje enviado"); if (r) { setT(""); setOpen(false); } }}>Enviar</Button>
    </span>
  );
}
