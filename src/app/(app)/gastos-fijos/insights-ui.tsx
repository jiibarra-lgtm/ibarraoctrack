"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { saveCostSettings, setCostPersonal } from "./actions";

export function PersonalToggle({ id, personal }: { id: string; personal: boolean }) {
  const router = useRouter();
  return (
    <button type="button" onClick={async () => { const r = await setCostPersonal(id, !personal); if (!r.ok) toast.error(r.error); else router.refresh(); }}
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", personal ? "bg-warn-soft text-warn" : "bg-field text-fg-muted hover:text-fg")}>
      {personal ? "Personal" : "Negocio"}
    </button>
  );
}

export function CostSettings({ inflation, alertPct }: { inflation: string; alertPct: string }) {
  const router = useRouter();
  const [inf, setInf] = React.useState(inflation);
  const [al, setAl] = React.useState(alertPct);
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-end gap-2 text-xs">
      <label className="grid gap-1">Inflación mensual %<Input value={inf} onChange={(e) => setInf(e.target.value)} className="h-8 w-20" inputMode="decimal" /></label>
      <label className="grid gap-1">Avisar si sube más de %<Input value={al} onChange={(e) => setAl(e.target.value)} className="h-8 w-20" inputMode="decimal" /></label>
      <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
        setBusy(true); const r = await saveCostSettings(inf, al); setBusy(false);
        if (!r.ok) toast.error(r.error); else { toast.success("Guardado"); router.refresh(); }
      }}>Guardar</Button>
    </div>
  );
}
