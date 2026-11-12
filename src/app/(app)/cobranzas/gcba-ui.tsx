"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { matchDeposit } from "./gcba-actions";

type Opt = { id: string; label: string; total: number };

/** Elegir una o varias facturas que paga un depósito; muestra cuánto queda de retención. */
export function ManualMatch({ movementId, amount, options }: { movementId: string; amount: number; options: Opt[] }) {
  const router = useRouter();
  const [picked, setPicked] = React.useState<string[]>([]);
  const [next, setNext] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  // sugeridas: facturas cuyo total menos 1,5%–4% da el depósito
  const suggested = options.filter((o) => amount <= o.total && amount >= o.total * 0.94).slice(0, 8);
  const total = options.filter((o) => picked.includes(o.id)).reduce((a, o) => a + o.total, 0);
  const add = (id: string) => { if (id && !picked.includes(id)) setPicked([...picked, id]); setNext(""); };
  return (
    <div className="flex w-full max-w-xl flex-col gap-1.5">
      <div className="flex gap-2">
        <NativeSelect value={next} onChange={(e) => add(e.target.value)} className="h-8 text-xs">
          <option value="">Agregar factura que paga…</option>
          {suggested.length > 0 && <optgroup label="Posibles por monto">{suggested.map((o) => <option key={`s${o.id}`} value={o.id}>{o.label}</option>)}</optgroup>}
          <optgroup label="Todas las pendientes">{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</optgroup>
        </NativeSelect>
        <Button size="sm" disabled={!picked.length || busy} loading={busy} onClick={async () => {
          setBusy(true); const r = await matchDeposit(movementId, picked); setBusy(false);
          if (!r.ok) toast.error(r.error); else { toast.success("Depósito vinculado"); router.refresh(); }
        }}>Vincular</Button>
      </div>
      {picked.length > 0 && (
        <p className="text-xs text-fg-muted">
          {picked.length} factura{picked.length === 1 ? "" : "s"} por {formatMoney(total)} · retención implícita {formatMoney(total - amount)} ({total ? (((total - amount) / total) * 100).toFixed(2) : 0}%)
          <button type="button" className="ml-2 underline" onClick={() => setPicked([])}>limpiar</button>
        </p>
      )}
    </div>
  );
}
