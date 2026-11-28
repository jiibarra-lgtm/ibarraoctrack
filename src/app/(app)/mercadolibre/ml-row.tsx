"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, ExternalLink, FileCheck2, FileSearch, Link2, Loader2, Undo2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { INVOICE_STATE, ML_STATUS, invoiceNumber, invoiceState, mlMargin, mlUrl, type MlRow } from "@/lib/mercadolibre";
import { cn } from "@/lib/utils";
import { invoiceCandidates, linkInvoice, linkMl, mlSuggestions, setMlPrice, setNoInvoice, unlinkMl, type InvoiceCandidate, type MlSuggestion } from "./actions";

export function MlRowItem({ r, canEdit }: { r: MlRow; canEdit: boolean }) {
  const router = useRouter();
  const st = ML_STATUS[r.status];
  const margin = mlMargin(r);
  const when = r.kind === "venta" ? r.ordered_at : r.delivered_at ?? r.ordered_at;
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)] sm:px-5">
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-medium">{r.title || "(sin título)"}{r.extra_items > 0 && <span className="text-fg-subtle"> · y {r.extra_items} más</span>}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-fg-subtle">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.tone)}>{st.label}</span>
          {r.status === "en_camino" && r.eta && <span>{r.eta}</span>}
          <span>{r.kind === "venta" ? "Vendida" : r.status === "entregada" ? "Llegó" : "Comprada"} {formatDate(when)}</span>
          {r.kind === "venta" && r.invoice_available && <span className="inline-flex items-center gap-0.5 text-accent"><FileCheck2 className="size-3" /> Factura</span>}
          <a href={mlUrl(r)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">#{r.ml_id}<ExternalLink className="size-3" /></a>
        </p>
        {r.counterpart && <p className="mt-0.5 truncate text-xs text-fg-subtle">{r.kind === "venta" ? "Comprador" : "Vendedor"}: {r.counterpart}{r.shipping ? ` · ${r.shipping}` : ""}</p>}
        {r.kind === "compra" && <InvoiceLine r={r} canEdit={canEdit} />}
      </div>

      <div className="text-sm">
        <p className="text-xs text-fg-subtle">{r.quantity ? `${formatQty(r.quantity)} u.` : "Cantidad —"}</p>
        {r.kind === "venta" ? (
          <>
            <p className="font-semibold tabular">{formatMoney(r.total_amount)}</p>
            {r.unit_value && <p className="text-xs text-fg-subtle tabular">{formatMoney(r.unit_value)} c/u</p>}
            {r.fees && Number(r.fees) > 0 && <p className="text-xs text-fg-subtle tabular">Comisión ML {formatMoney(r.fees)} · neto {formatMoney(Number(r.total_amount ?? 0) - Number(r.fees))}</p>}
          </>
        ) : (
          <PriceInput key={`${r.id}:${r.unit_price ?? ""}:${r.unit_value ?? ""}`} r={r} canEdit={canEdit} onSaved={() => router.refresh()} />
        )}
      </div>

      <div className="min-w-0 text-xs">
        {r.po_item_id ? (
          <div className="rounded-xl border border-card-border bg-field/60 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
              <Link href={`/ordenes/${r.purchase_order_id}?tab=productos`} className="truncate font-mono font-semibold hover:underline">OC {r.po_number} · R{r.po_line}</Link>
              {canEdit && <UnlinkButton id={r.id} />}
            </div>
            <p className="truncate text-fg-subtle" title={r.po_item_description ?? ""}>{r.po_item_description}</p>
            <p className="mt-0.5 tabular">
              En la OC: {formatMoney(r.po_item_unit_price)} c/u
              {margin && <span className={cn("ml-1 font-medium", margin.unit >= 0 ? "text-accent" : "text-danger")}>· {margin.unit >= 0 ? "ganás" : "perdés"} {formatMoney(Math.abs(margin.unit))} ({margin.pct.toFixed(0)}%)</span>}
              {r.kind === "venta" && r.unit_value && <span className="ml-1 text-fg-subtle">· en ML a {formatMoney(r.unit_value)}</span>}
            </p>
            {r.link_source === "auto" && <p className="text-[11px] text-fg-subtle">Vinculada sola por parecido del nombre</p>}
          </div>
        ) : canEdit ? (
          <LinkDialog r={r} />
        ) : <span className="text-fg-subtle">Sin vincular</span>}
      </div>
    </li>
  );
}

function PriceInput({ r, canEdit, onSaved }: { r: MlRow; canEdit: boolean; onSaved: () => void }) {
  const [v, setV] = React.useState(r.unit_price ? String(Number(r.unit_price)).replace(".", ",") : "");
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    const before = r.unit_price ? String(Number(r.unit_price)).replace(".", ",") : "";
    if (v.trim() === before) return;
    setSaving(true);
    const res = await setMlPrice(r.id, v);
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    onSaved();
  };
  const total = r.total_amount ? Number(r.total_amount) : r.unit_value && r.quantity ? Number(r.unit_value) * Number(r.quantity) : null;
  const [editing, setEditing] = React.useState(false);
  if (r.unit_value && !editing) {
    return (
      <div>
        <p className="font-semibold tabular">{formatMoney(r.unit_value)} <span className="text-xs font-normal text-fg-subtle">c/u</span></p>
        {total !== null && <p className="text-xs text-fg-subtle tabular">Total {formatMoney(total)}{r.extra_items ? ` · carrito de ${Number(r.extra_items) + 1}` : ""}</p>}
        {canEdit && <button type="button" onClick={() => setEditing(true)} className="text-[11px] text-fg-subtle underline-offset-2 hover:text-fg hover:underline">Corregir</button>}
      </div>
    );
  }
  if (!canEdit) return <p className="font-semibold tabular">—</p>;
  return (
    <div>
      <div className="relative w-36">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fg-subtle">$</span>
        <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          inputMode="decimal" placeholder="Precio c/u" className="h-8 pl-6 text-sm tabular" aria-label="Precio pagado por unidad" />
        {saving && <Loader2 className="absolute right-2 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-fg-subtle" />}
      </div>
      {total !== null && <p className="mt-0.5 text-xs text-fg-subtle tabular">Total {formatMoney(total)}</p>}
    </div>
  );
}

function UnlinkButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <button type="button" disabled={busy} title="Desvincular" className="text-fg-subtle hover:text-danger"
      onClick={async () => { setBusy(true); const r = await unlinkMl(id); setBusy(false); if (!r.ok) toast.error(r.error); else router.refresh(); }}>
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}
    </button>
  );
}

function LinkDialog({ r }: { r: MlRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState<MlSuggestion[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = async (o: boolean) => {
    setOpen(o);
    if (o && !list) setList(await mlSuggestions(r.id));
  };
  const pick = async (s: MlSuggestion) => {
    setBusy(s.po_item_id);
    const res = await linkMl(r.id, s.po_item_id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Vinculada a la OC ${s.bac_number}`);
    setOpen(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={load}>
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm"><Link2 /> Vincular a una OC</Button>
      </DialogTrigger>
      <DialogContent title="Vincular a un renglón de OC" description={r.title} className="max-w-xl">
        {!list ? (
          <p className="flex items-center gap-2 py-6 text-sm text-fg-muted"><Loader2 className="size-4 animate-spin" /> Buscando renglones parecidos…</p>
        ) : !list.length ? (
          <p className="py-6 text-sm text-fg-muted">No hay órdenes cargadas para vincular.</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-border overflow-y-auto">
            {list.map((s) => (
              <li key={s.po_item_id}>
                <button type="button" onClick={() => pick(s)} disabled={!!busy}
                  className="flex w-full items-start justify-between gap-3 px-1 py-2.5 text-left hover:bg-surface-2/60">
                  <span className="min-w-0">
                    <span className="block font-mono text-xs font-semibold">OC {s.bac_number} · R{s.line_number}</span>
                    <span className="line-clamp-2 block text-sm">{s.description}</span>
                    <span className="block text-xs text-fg-subtle">{s.customer_name ?? "—"} · {formatQty(s.quantity)} u. a {formatMoney(s.unit_price)}</span>
                  </span>
                  <span className="shrink-0 text-xs text-fg-subtle tabular">{busy === s.po_item_id ? <Loader2 className="size-4 animate-spin" /> : `${Math.round(Number(s.score) * 100)}%`}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Estado de la factura de la compra, con vincular / desvincular / "no lleva factura". */
function InvoiceLine({ r, canEdit }: { r: MlRow; canEdit: boolean }) {
  const router = useRouter();
  const st = invoiceState(r);
  const [busy, setBusy] = React.useState(false);
  if (!st) return null;
  const info = INVOICE_STATE[st];
  const run = async (f: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true); const res = await f(); setBusy(false);
    if (!res.ok) toast.error(res.error ?? "No se pudo"); else router.refresh();
  };
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium", info.tone)}>
        {st === "cargada" ? <FileCheck2 className="size-3" /> : st === "no_lleva" ? <Ban className="size-3" /> : <FileSearch className="size-3" />}{info.label}
      </span>
      {st === "cargada" && (
        <>
          <Link href={`/precios-proveedores?t=facturas&q=${encodeURIComponent(r.inv_supplier ?? "")}`} className="truncate text-fg-muted hover:text-fg hover:underline">
            {invoiceNumber(r)} · {r.inv_supplier ?? "proveedor"} · {formatMoney(r.inv_total)} · {formatDate(r.inv_date)}
          </Link>
          {r.invoice_link === "auto" && <span className="text-[11px] text-fg-subtle">(encontrada sola)</span>}
          {canEdit && <button type="button" disabled={busy} title="No es esta factura" onClick={() => run(() => linkInvoice(r.id, null))} className="text-fg-subtle hover:text-danger">{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />}</button>}
        </>
      )}
      {canEdit && (st === "esperando" || st === "falta") && (
        <>
          <InvoiceDialog r={r} />
          <button type="button" disabled={busy} onClick={() => run(() => setNoInvoice(r.id, true))} className="text-fg-subtle hover:text-fg hover:underline">No lleva factura</button>
        </>
      )}
      {canEdit && st === "no_lleva" && <button type="button" disabled={busy} onClick={() => run(() => setNoInvoice(r.id, false))} className="inline-flex items-center gap-1 text-fg-subtle hover:text-fg"><Undo2 className="size-3" /> Deshacer</button>}
    </div>
  );
}

function InvoiceDialog({ r }: { r: MlRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [list, setList] = React.useState<InvoiceCandidate[] | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const search = React.useCallback(async (text: string) => { setList(null); setList(await invoiceCandidates(r.id, text)); }, [r.id]);
  const onOpen = (o: boolean) => { setOpen(o); if (o && !list) void search(""); };
  const pick = async (c: InvoiceCandidate) => {
    setBusy(c.id);
    const res = await linkInvoice(r.id, c.id);
    setBusy(null);
    if (!res.ok) return toast.error(res.error);
    toast.success("Factura vinculada");
    setOpen(false); router.refresh();
  };
  const total = Number(r.total_amount ?? 0);
  return (
    <Dialog open={open} onOpenChange={onOpen}>
      <DialogTrigger asChild>
        <button type="button" className="inline-flex items-center gap-1 font-medium text-fg hover:underline"><Link2 className="size-3" /> Buscar factura</button>
      </DialogTrigger>
      <DialogContent title="Vincular la factura" description={`${r.title}${total ? ` · ${formatMoney(total)}` : ""} · comprada ${formatDate(r.ordered_at ?? r.created_at)}`}>
        <form onSubmit={(e) => { e.preventDefault(); void search(q); }} className="flex gap-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Proveedor, número o importe" />
          <Button type="submit" variant="secondary">Buscar</Button>
        </form>
        <p className="mt-2 text-xs text-fg-subtle">{q ? "Resultados de la búsqueda." : "Facturas sin vincular de 10 días antes a 60 días después de la compra, la de importe más parecido primero."} Si no está, cargala en Compras → Subir factura.</p>
        <ul className="mt-3 max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {list === null && <li className="flex items-center justify-center py-8"><Loader2 className="size-4 animate-spin text-fg-subtle" /></li>}
          {list?.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-subtle">No hay facturas que coincidan.</li>}
          {list?.map((c) => {
            const diff = total && c.total ? Number(c.total) - total : null;
            return (
              <li key={c.id}>
                <button type="button" disabled={!!busy} onClick={() => pick(c)} className="flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-2 disabled:opacity-60">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{c.supplier_name ?? "Proveedor sin nombre"}</p>
                    <p className="text-xs text-fg-subtle">{c.letter ?? ""} {String(c.point_of_sale ?? 0).padStart(4, "0")}-{String(c.number ?? 0).padStart(8, "0")} · {formatDate(c.issue_date)} · {c.source === "mercadolibre" ? "bajada de ML" : c.source === "mail" ? "por mail" : "cargada"}</p>
                    {c.items && <p className="truncate text-xs text-fg-muted">{c.items}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular">{formatMoney(c.total)}</p>
                    {diff !== null && <p className={cn("text-[11px] tabular", Math.abs(diff) <= total * 0.01 ? "text-accent" : "text-fg-subtle")}>{Math.abs(diff) <= total * 0.01 ? "mismo importe" : `${diff > 0 ? "+" : "−"}${formatMoney(Math.abs(diff))}`}</p>}
                  </div>
                  {busy === c.id && <Loader2 className="size-4 animate-spin" />}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
