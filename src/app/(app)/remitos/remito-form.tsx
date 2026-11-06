"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import { FileText, Link2, Loader2, Plus, Save, Search, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/primitives";
import { RemitoSheet } from "@/components/remito/remito-sheet";
import { waLink, type RemitoIssuer } from "@/lib/remitos";
import { cn } from "@/lib/utils";
import { emitRemito, findOrderForRemito, searchProducts, type OrderForRemito } from "./actions";

export type PlaceOption = { key: string; name: string; address: string | null; cuit: string | null; iva: string | null; place_id?: string; customer_id?: string };
type Row = { key: string; description: string; quantity: string; detail: string; purchase_order_item_id?: string; product_id?: string; line?: number; max?: string };

const uid = () => Math.random().toString(36).slice(2);
const label = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-fg-subtle";
const field = "h-10 w-full rounded-xl border border-card-border bg-field px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

export function RemitoForm({ places, issuer, nowDate, nowTime, initialOc }: {
  places: PlaceOption[]; issuer: RemitoIssuer; nowDate: string; nowTime: string; initialOc?: string;
}) {
  const router = useRouter();
  const [pick, setPick] = React.useState("");
  const [rec, setRec] = React.useState({ name: "", address: "", cuit: "", iva: "" });
  const [placeId, setPlaceId] = React.useState<string | undefined>();
  const [customerId, setCustomerId] = React.useState<string | undefined>();
  const [savePlace, setSavePlace] = React.useState(false);
  const [date, setDate] = React.useState(nowDate);
  const [time, setTime] = React.useState(nowTime);
  const [provisional, setProvisional] = React.useState(true);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [notes, setNotes] = React.useState("");
  const [ocQ, setOcQ] = React.useState(initialOc ?? "");
  const [oc, setOc] = React.useState<OrderForRemito | null>(null);
  const [ocBusy, setOcBusy] = React.useState(false);
  const [registerDelivery, setRegisterDelivery] = React.useState(true);
  const [qr, setQr] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const url = waLink(issuer.whatsapp);
    if (url) QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setQr).catch(() => null);
  }, [issuer.whatsapp]);

  const choose = (key: string) => {
    setPick(key);
    const p = places.find((x) => x.key === key);
    if (!p) { setPlaceId(undefined); setCustomerId(undefined); return; }
    setRec({ name: p.name, address: p.address ?? "", cuit: p.cuit ?? "", iva: p.iva ?? "" });
    setPlaceId(p.place_id); setCustomerId(p.customer_id); setSavePlace(false);
  };

  const loadOc = React.useCallback(async (q: string) => {
    if (q.trim().length < 3) return;
    setOcBusy(true);
    const r = await findOrderForRemito(q);
    setOcBusy(false);
    if (!r) { toast.error("No encontré esa orden"); return; }
    setOc(r);
    setOcQ(r.number);
    setCustomerId((c) => c ?? r.customer_id ?? undefined);
    setRec((x) => x.name ? x : {
      name: r.dependencia?.replace(/^\d+\s*-\s*/, "") || r.customer_name || "",
      address: r.delivery_place || r.customer_address || "", cuit: r.customer_cuit ?? "", iva: x.iva,
    });
    const pending = r.items.filter((i) => Number(i.pending) > 0);
    setRows((prev) => [
      ...prev.filter((p) => !p.purchase_order_item_id),
      ...(pending.length ? pending : r.items).map((i) => ({ key: uid(), description: i.description, quantity: String(Number(i.pending) > 0 ? Number(i.pending) : Number(i.quantity)), detail: "", purchase_order_item_id: i.id, line: i.line, max: i.pending })),
    ]);
    toast.success(`OC ${r.number}: ${pending.length || r.items.length} renglones cargados`);
  }, []);

  const auto = React.useRef(false);
  React.useEffect(() => {
    if (initialOc && !auto.current) { auto.current = true; void loadOc(initialOc); }
  }, [initialOc, loadOc]);

  const clearOc = () => { setOc(null); setOcQ(""); setRows((r) => r.filter((x) => !x.purchase_order_item_id)); };
  const setRow = (key: string, k: keyof Row, v: string) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [k]: v } : r)));

  const submit = async () => {
    setSaving(true);
    const r = await emitRemito({
      recipient_name: rec.name, recipient_address: rec.address, recipient_cuit: rec.cuit, recipient_iva: rec.iva,
      place_id: placeId ?? "", customer_id: customerId ?? "", purchase_order_id: oc?.id ?? "",
      register_delivery: !!oc && registerDelivery, save_place: savePlace && !placeId, provisional, date, time, notes,
      items: rows.map((x) => ({ description: x.description, quantity: x.quantity, detail: x.detail, purchase_order_item_id: x.purchase_order_item_id ?? "", product_id: x.product_id ?? "" })),
    });
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Remito emitido");
    router.push(`/remitos/${r.id}?nuevo=1`);
  };

  const filled = rows.filter((r) => r.description.trim() && Number(r.quantity.replace(",", ".")) > 0);
  const ready = rec.name.trim() && filled.length > 0;
  const over = rows.filter((r) => r.max && Number(r.quantity.replace(",", ".")) > Number(r.max) && Number(r.max) > 0);

  return (
    <div className="grid gap-5 pb-24 xl:grid-cols-[minmax(0,1fr)_460px]">
      <div className="space-y-4">
        {/* Orden de compra */}
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold tracking-wide"><Link2 className="size-4" /> ORDEN DE COMPRA <span className="font-normal text-fg-subtle">(opcional)</span></h3>
          {oc ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-card-border bg-field/60 px-4 py-3">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold">OC {oc.number}</p>
                <p className="truncate text-xs text-fg-subtle">{oc.customer_name ?? "—"}{oc.dependencia ? ` · ${oc.dependencia}` : ""} · {oc.items.length} renglones</p>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={registerDelivery} onChange={(e) => setRegisterDelivery(e.target.checked)} className="size-4 accent-[var(--brand)]" /> Registrar la entrega en la orden</label>
                <button type="button" onClick={clearOc} className="text-fg-subtle hover:text-danger" title="Quitar la orden"><X className="size-4" /></button>
              </div>
            </div>
          ) : (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void loadOc(ocQ); }}>
              <input value={ocQ} onChange={(e) => setOcQ(e.target.value)} placeholder="Número de OC (ej. 415-18676-OC26) — completa destinatario y productos" className={field} />
              <Button type="submit" variant="secondary" disabled={ocBusy || ocQ.trim().length < 3}>{ocBusy ? <Loader2 className="animate-spin" /> : <Search />} Buscar</Button>
            </form>
          )}
        </Card>

        {/* Destinatario */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold tracking-wide">DESTINATARIO</h3>
          <label className={label} htmlFor="r-pick">Hospital / cliente (elegí o escribí)</label>
          <select id="r-pick" value={pick} onChange={(e) => choose(e.target.value)} className={cn(field, "mb-3")}>
            <option value="">— Elegir de la lista —</option>
            {places.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className={label} htmlFor="r-name">Nombre</label><input id="r-name" value={rec.name} onChange={(e) => { setRec({ ...rec, name: e.target.value }); setPlaceId(undefined); }} className={field} /></div>
            <div className="sm:col-span-2"><label className={label} htmlFor="r-addr">Domicilio</label><input id="r-addr" value={rec.address} onChange={(e) => setRec({ ...rec, address: e.target.value })} className={field} /></div>
            <div><label className={label} htmlFor="r-cuit">CUIT</label><input id="r-cuit" value={rec.cuit} inputMode="numeric" onChange={(e) => setRec({ ...rec, cuit: e.target.value })} className={field} /></div>
            <div><label className={label} htmlFor="r-iva">Cond. IVA</label><input id="r-iva" value={rec.iva} placeholder="Resp. Inscripto / Exento" onChange={(e) => setRec({ ...rec, iva: e.target.value })} className={field} /></div>
          </div>
          {!placeId && rec.name.trim() && (
            <label className="mt-3 inline-flex items-center gap-2 rounded-full border border-card-border px-3 py-1.5 text-xs font-medium">
              <input type="checkbox" checked={savePlace} onChange={(e) => setSavePlace(e.target.checked)} className="size-4 accent-[var(--brand)]" /><Save className="size-3.5" /> Guardar este lugar en la lista
            </label>
          )}
        </Card>

        {/* Datos */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold tracking-wide">DATOS DEL REMITO</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className={label} htmlFor="r-date">Fecha</label><input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></div>
            <div><label className={label} htmlFor="r-time">Hora</label><input id="r-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} /></div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide"><input type="checkbox" checked={provisional} onChange={(e) => setProvisional(e.target.checked)} className="size-4 accent-[var(--brand)]" /> Remito provisorio</label>
        </Card>

        {/* Productos */}
        <Card className="p-5">
          <h3 className="mb-3 text-sm font-bold tracking-wide">PRODUCTOS</h3>
          <ProductSearch onPick={(p) => setRows((r) => [...r, { key: uid(), description: p.description, quantity: "1", detail: "", product_id: p.id }])} />
          <div className="mt-3 hidden grid-cols-[minmax(0,1fr)_96px_minmax(0,0.6fr)_32px] gap-2 border-b-2 border-fg/80 pb-1.5 text-[11px] font-bold uppercase text-fg-subtle sm:grid">
            <span>Descripción</span><span>Cantidad</span><span>Detalle</span><span />
          </div>
          <ul className="divide-y divide-border">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_88px_32px] gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_96px_minmax(0,0.6fr)_32px]">
                <div className="min-w-0">
                  <input value={r.description} onChange={(e) => setRow(r.key, "description", e.target.value)} placeholder="Descripción" className={cn(field, "h-9")} />
                  {r.line && <span className="mt-0.5 block text-[11px] text-fg-subtle">Renglón {r.line} de la OC{r.max ? ` · pendiente ${r.max}` : ""}</span>}
                </div>
                <input value={r.quantity} onChange={(e) => setRow(r.key, "quantity", e.target.value)} inputMode="decimal" aria-label="Cantidad"
                  className={cn(field, "h-9 text-center tabular", r.max && Number(r.quantity.replace(",", ".")) > Number(r.max) && Number(r.max) > 0 && "border-warn")} />
                <input value={r.detail} onChange={(e) => setRow(r.key, "detail", e.target.value)} placeholder="Marca, lote, presentación…" aria-label="Detalle" className={cn(field, "col-span-2 h-9 sm:col-span-1")} />
                <button type="button" onClick={() => setRows((x) => x.filter((y) => y.key !== r.key))} className="row-start-1 grid h-9 place-items-center text-fg-subtle hover:text-danger sm:row-start-auto" style={{ gridColumn: "3" }} aria-label="Quitar"><Trash2 className="size-4" /></button>
              </li>
            ))}
          </ul>
          <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setRows((r) => [...r, { key: uid(), description: "", quantity: "1", detail: "" }])}><Plus /> Fila vacía</Button>
          {over.length > 0 && <p className="mt-2 text-xs text-warn">Ojo: {over.length === 1 ? "un renglón supera" : `${over.length} renglones superan`} lo pendiente de la OC.</p>}
        </Card>

        <Card className="p-5">
          <label className={label} htmlFor="r-notes">Notas (opcional — salen en el remito)</label>
          <textarea id="r-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="w-full rounded-xl border border-card-border bg-field px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
        </Card>
      </div>

      {/* Vista previa */}
      <div className="hidden xl:block">
        <div className="sticky top-4">
          <p className="mb-2 text-xs font-medium text-fg-subtle">Vista previa</p>
          <div className="overflow-hidden rounded-2xl border border-card-border bg-white shadow-sm" style={{ height: 1056 * 0.56 }}>
            <div style={{ transform: "scale(0.56)", transformOrigin: "top left", width: 816 }}>
              <RemitoSheet qrSvg={qr} data={{
                label: null, provisional, issuedAt: `${date}T${time}:00-03:00`, recipient: rec,
                items: filled, notes, issuer, poNumber: oc?.number ?? null,
              }} />
            </div>
          </div>
        </div>
      </div>

      <div className="fixed inset-x-0 z-30 border-t border-card-border bg-surface/90 px-4 py-3 backdrop-blur" style={{ bottom: "var(--bottom-nav, 0px)" }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <p className="truncate text-xs text-fg-subtle">{ready ? `${filled.length} ${filled.length === 1 ? "producto" : "productos"} para ${rec.name}` : "Completá el destinatario y agregá productos"}</p>
          <Button onClick={submit} loading={saving} disabled={!ready}><FileText /> Emitir remito</Button>
        </div>
      </div>
    </div>
  );
}

function ProductSearch({ onPick }: { onPick: (p: { id: string; description: string }) => void }) {
  const [q, setQ] = React.useState("");
  const [res, setRes] = React.useState<{ id: string; description: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => { searchProducts(q).then((r) => { setRes(r); setOpen(true); }); }, 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
      <input value={q} onChange={(e) => { setQ(e.target.value); if (e.target.value.trim().length < 2) setOpen(false); }} onFocus={() => res.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar producto del catálogo para agregar…" className={cn(field, "pl-9")} />
      {open && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-card-border bg-surface-solid p-1 shadow-lg">
          {res.length ? res.map((p) => (
            <li key={p.id}><button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { onPick(p); setQ(""); setRes([]); setOpen(false); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-field">{p.description}</button></li>
          )) : <li className="px-3 py-2 text-sm text-fg-subtle">Sin resultados: usá “Fila vacía” y se agrega al catálogo al emitir.</li>}
        </ul>
      )}
    </div>
  );
}
