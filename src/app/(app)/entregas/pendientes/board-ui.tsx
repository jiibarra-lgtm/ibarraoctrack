"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, MapPin, Pencil, Plus, Search, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Badge, Input, Textarea } from "@/components/ui/primitives";
import { formatDate } from "@/lib/format";
import { safeAction } from "@/lib/safe-action";
import { cn } from "@/lib/utils";
import { addOrderToBoard, deleteBoardItem, saveBoardItem, setBoardStatus } from "./actions";

export type BoardOrder = { id: string; number: string; customer: string | null; delivered_pct: number | null; status: string; due_date: string | null };
export type BoardItem = {
  id: string; place: string; address: string | null; note: string | null; oc_text: string | null; oc_refs: string[];
  status: "pendiente" | "entregado"; delivered_on: string | null; orders: BoardOrder[];
  missing?: { number: string; in_bac: boolean }[];
};

const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const mapsUrl = (a: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${a}, CABA`)}`;

function OrderChips({ item }: { item: BoardItem }) {
  const missing = item.missing ?? [];
  if (!item.orders.length && !item.oc_text) return <span className="text-xs text-fg-subtle">Sin número de OC</span>;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.orders.map((o) => {
        const pct = Math.round(Number(o.delivered_pct ?? 0));
        return (
          <Link key={o.id} href={`/ordenes/${o.id}?tab=entregas`} title={o.customer ?? undefined}>
            <Badge tone={pct >= 100 ? "accent" : pct > 0 ? "info" : "neutral"}>OC {o.number} · {pct}% entregado</Badge>
          </Link>
        );
      })}
      {missing.map((m) => (
        <Link key={m.number} href={m.in_bac ? `/bac?f=todas&q=${encodeURIComponent(m.number)}` : "/ordenes/importar"}
          title={m.in_bac ? "Llegó el aviso del BAC pero falta importar el PDF de la OC" : "Esta OC no está cargada: subí el PDF de la orden"}>
          <Badge tone="danger">OC {m.number} · falta el documento de la OC{m.in_bac ? " (está en Órdenes BAC)" : ""}</Badge>
        </Link>
      ))}
      {!item.oc_refs.length && item.oc_text && <span className="text-xs text-fg-subtle">OC {item.oc_text}</span>}
    </div>
  );
}

export function BoardCard({ item, canEdit }: { item: BoardItem; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDel, setConfirmDel] = React.useState(false);
  const [date, setDate] = React.useState(todayAr());
  const run = async (k: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string) => {
    setBusy(k);
    const r = await safeAction(fn);
    setBusy(null);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success(okMsg);
    router.refresh();
  };
  const pending = item.status === "pendiente";
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{item.place}</p>
          {item.address && (
            <a href={mapsUrl(item.address)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg">
              <MapPin className="size-3" /> {item.address}
            </a>
          )}
        </div>
        {!pending && item.delivered_on && <Badge tone="accent">Entregado {formatDate(item.delivered_on)}</Badge>}
      </div>
      {item.note && <p className="whitespace-pre-line text-sm">{item.note}</p>}
      <OrderChips item={item} />
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {pending ? (
            <>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 w-36 text-xs" aria-label="Fecha de entrega" />
              <Button size="sm" loading={busy === "ok"} onClick={() => run("ok", () => setBoardStatus(item.id, "entregado", date), "Marcado como entregado")}>{busy !== "ok" && <Check />} Entregado</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" loading={busy === "undo"} onClick={() => run("undo", () => setBoardStatus(item.id, "pendiente"), "Volvió a pendientes")}>{busy !== "undo" && <Undo2 />} Volver a pendiente</Button>
          )}
          <ItemDialog item={item} trigger={<Button size="sm" variant="ghost"><Pencil /> Editar</Button>} />
          {confirmDel ? (
            <span className="flex items-center gap-1 text-xs">
              ¿Borrar?
              <Button size="sm" variant="ghost" className="text-danger" loading={busy === "del"} onClick={() => run("del", () => deleteBoardItem(item.id), "Borrado")}>Sí, borrar</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>No</Button>
            </span>
          ) : <Button size="sm" variant="ghost" className="text-fg-subtle" onClick={() => setConfirmDel(true)}><Trash2 /></Button>}
        </div>
      )}
    </li>
  );
}

export function ItemDialog({ item, trigger }: { item?: BoardItem; trigger: React.ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ place: item?.place ?? "", address: item?.address ?? "", note: item?.note ?? "", oc_text: item?.oc_text ?? "" });
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    setBusy(true);
    const r = await safeAction(() => saveBoardItem({ id: item?.id ?? "", ...f }));
    setBusy(false);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success(item ? "Guardado" : "Agregado a pendientes");
    setOpen(false);
    if (!item) setF({ place: "", address: "", note: "", oc_text: "" });
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={item ? "Editar entrega" : "Nueva entrega pendiente"} description="Si ponés el número de OC (ej. 417-14591-OC26) se vincula sola con la orden.">
        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-fg-muted">Organismo / lugar<Input id="board-place" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="H. Gral. Agudos Dr. Parmenio Piñero" /></label>
          <label className="grid gap-1 text-xs text-fg-muted">Dirección<Input id="board-address" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Varela 1301" /></label>
          <label className="grid gap-1 text-xs text-fg-muted">Qué llevar<Textarea id="board-note" rows={3} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="600 cajas de toallas de papel" /></label>
          <label className="grid gap-1 text-xs text-fg-muted">OC<Input id="board-oc" value={f.oc_text} onChange={(e) => setF({ ...f, oc_text: e.target.value })} placeholder="426-19261-oc26" /></label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} disabled={!f.place.trim()} onClick={save}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function NewItemButton() {
  return <ItemDialog trigger={<Button><Plus /> Nueva entrega</Button>} />;
}

export function AddOrderButton({ poId }: { poId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await safeAction(() => addOrderToBoard(poId));
      setBusy(false);
      if (!r.ok) { if (r.error) toast.error(r.error); return; }
      toast.success("Agregada a pendientes");
      router.refresh();
    }}>{!busy && <Plus />} A la hoja de ruta</Button>
  );
}

/** Lista con buscador (por organismo, dirección, producto u OC). */
export function BoardList({ items, canEdit, empty }: { items: BoardItem[]; canEdit: boolean; empty: string }) {
  const [q, setQ] = React.useState("");
  const t = q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const shown = !t ? items : items.filter((i) => [i.place, i.address, i.note, i.oc_text].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(t));
  return (
    <>
      {items.length > 6 && (
        <div className="relative border-b border-border px-4 pb-3 sm:px-5">
          <Search className="pointer-events-none absolute left-7 top-[9px] size-4 text-fg-subtle sm:left-8" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar organismo, producto u OC" className="h-9 pl-9" />
        </div>
      )}
      {!shown.length ? <p className="px-5 py-6 text-sm text-fg-subtle">{q ? "Nada coincide." : empty}</p> : (
        <ul className={cn("divide-y divide-border")}>{shown.map((i) => <BoardCard key={i.id} item={i} canEdit={canEdit} />)}</ul>
      )}
    </>
  );
}
