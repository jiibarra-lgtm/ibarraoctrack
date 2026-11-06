"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, FileCheck2, Link2, Loader2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Input } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { ML_STATUS, mlMargin, mlUrl, type MlRow } from "@/lib/mercadolibre";
import { cn } from "@/lib/utils";
import { linkMl, mlSuggestions, setMlPrice, unlinkMl, type MlSuggestion } from "./actions";

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
          {r.invoice_available && <span className="inline-flex items-center gap-0.5 text-accent"><FileCheck2 className="size-3" /> Factura</span>}
          <a href={mlUrl(r)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">#{r.ml_id}<ExternalLink className="size-3" /></a>
        </p>
        {r.counterpart && <p className="mt-0.5 truncate text-xs text-fg-subtle">{r.kind === "venta" ? "Comprador" : "Vendedor"}: {r.counterpart}{r.shipping ? ` · ${r.shipping}` : ""}</p>}
      </div>

      <div className="text-sm">
        <p className="text-xs text-fg-subtle">{r.quantity ? `${formatQty(r.quantity)} u.` : "Cantidad —"}</p>
        {r.kind === "venta" ? (
          <>
            <p className="font-semibold tabular">{formatMoney(r.total_amount)}</p>
            {r.unit_value && <p className="text-xs text-fg-subtle tabular">{formatMoney(r.unit_value)} c/u</p>}
          </>
        ) : (
          <PriceInput r={r} canEdit={canEdit} onSaved={() => router.refresh()} />
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
  const total = r.unit_price && r.quantity ? Number(r.unit_price) * Number(r.quantity) : null;
  if (!canEdit) return <p className="font-semibold tabular">{r.unit_price ? formatMoney(r.unit_price) : "—"}</p>;
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
