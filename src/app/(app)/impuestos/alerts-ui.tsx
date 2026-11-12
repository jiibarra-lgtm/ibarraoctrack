"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { saveSircrebRate } from "./tax-actions";

export function SircrebRateForm({ value }: { value: string }) {
  const router = useRouter();
  const [v, setV] = React.useState(value);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span>Alícuota del padrón SIRCREB %</span>
      <Input value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-20" inputMode="decimal" placeholder="ej. 0,6" />
      <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
        setBusy(true); const r = await saveSircrebRate(v); setBusy(false);
        if (!r.ok) toast.error(r.error); else { toast.success("Guardado"); router.refresh(); }
      }}>Guardar</Button>
    </div>
  );
}
