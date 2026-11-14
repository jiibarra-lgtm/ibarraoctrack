"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/primitives";
import { setItemCost } from "./actions";

export function CostCell({ itemId, lineId, value, disabled }: { itemId: string; lineId: string | null; value: string | null; disabled: boolean }) {
  const router = useRouter();
  const initial = value === null ? "" : String(Number(value)).replace(".", ",");
  const [v, setV] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (v.trim() === initial) return;
    setBusy(true);
    const r = await setItemCost(itemId, v, lineId);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); setV(initial); return; }
    router.refresh();
  };
  return (
    <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
      disabled={disabled || busy} inputMode="decimal" placeholder="$ costo" aria-label="Costo unitario sin IVA" className="ml-auto h-8 w-28 text-right tabular" />
  );
}
