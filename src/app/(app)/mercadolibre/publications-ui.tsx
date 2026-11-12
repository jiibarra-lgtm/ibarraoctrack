"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { restockMlNow, setMlStockRule } from "./ml-actions";

type Rule = { enabled: boolean; min: number; target: number };

export function DefaultRuleForm({ rule, disabled }: { rule: Rule | null; disabled: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState({ enabled: rule?.enabled ?? false, min: String(rule?.min ?? 10), target: String(rule?.target ?? 10) });
  const [busy, setBusy] = React.useState(false);
  const save = async (next = f) => {
    setBusy(true);
    const r = await setMlStockRule("*", { enabled: next.enabled, min: Number(next.min), target: Number(next.target) });
    setBusy(false);
    if (!r.ok) toast.error(r.error); else { toast.success(next.enabled ? `Listo: cuando una publicación baje de ${next.min}, se repone a ${next.target}` : "Reposición automática apagada"); router.refresh(); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <label className="flex items-center gap-2 font-medium">
        <input type="checkbox" checked={f.enabled} disabled={disabled || busy} onChange={(e) => { const n = { ...f, enabled: e.target.checked }; setF(n); void save(n); }} />
        Reponer stock automáticamente
      </label>
      <span className="text-fg-muted">si baja de</span>
      <input value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/\D/g, "") })} disabled={disabled} className="h-8 w-16 rounded-lg border border-card-border bg-field px-2 text-center tabular" />
      <span className="text-fg-muted">dejarla en</span>
      <input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value.replace(/\D/g, "") })} disabled={disabled} className="h-8 w-16 rounded-lg border border-card-border bg-field px-2 text-center tabular" />
      {!disabled && <Button size="sm" variant="secondary" loading={busy} onClick={() => save()}>Guardar</Button>}
    </div>
  );
}

export function ItemRule({ id, rule, inherited }: { id: string; rule: Rule | null; inherited: Rule | null }) {
  const router = useRouter();
  const [edit, setEdit] = React.useState(false);
  const [f, setF] = React.useState({ min: String(rule?.min ?? inherited?.min ?? 10), target: String(rule?.target ?? inherited?.target ?? 10) });
  const run = async (r: Rule | null) => {
    const x = await setMlStockRule(id, r);
    if (!x.ok) toast.error(x.error); else { setEdit(false); router.refresh(); }
  };
  const eff = rule ?? inherited;
  if (edit) return (
    <div className="flex items-center justify-end gap-1.5 text-xs">
      <input value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/\D/g, "") })} className="h-7 w-12 rounded border border-card-border bg-field text-center" title="Mínimo" />
      <span>→</span>
      <input value={f.target} onChange={(e) => setF({ ...f, target: e.target.value.replace(/\D/g, "") })} className="h-7 w-12 rounded border border-card-border bg-field text-center" title="Reponer a" />
      <button type="button" className="font-medium text-primary" onClick={() => run({ enabled: true, min: Number(f.min), target: Number(f.target) })}>OK</button>
      <button type="button" className="text-fg-subtle" onClick={() => setEdit(false)}>×</button>
    </div>
  );
  return (
    <div className="flex items-center justify-end gap-2 text-xs">
      <span className={eff?.enabled ? "text-fg-muted" : "text-fg-subtle"}>{eff?.enabled ? `mín. ${eff.min} → ${eff.target}${rule ? "" : " (general)"}` : "no se repone"}</span>
      <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => setEdit(true)}>cambiar</button>
      {rule ? <button type="button" className="text-fg-subtle hover:text-fg" onClick={() => run(null)} title="Usar la regla general">↺</button>
        : <button type="button" className="text-fg-subtle hover:text-danger" onClick={() => run({ enabled: false, min: 0, target: 1 })} title="No reponer esta publicación">no</button>}
    </div>
  );
}

export function RestockNowButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await restockMlNow(); setBusy(false);
      if (!r.ok) toast.error(r.error, { duration: 10000 }); else { toast.success(r.msg ?? "Listo"); router.refresh(); }
    }}>{!busy && <RefreshCw />} Revisar publicaciones ahora</Button>
  );
}
