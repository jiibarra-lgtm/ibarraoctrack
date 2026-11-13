"use client";
import * as React from "react";
import { VAR_CATEGORIES } from "@/lib/expense-categories";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff, Eye } from "lucide-react";
import { setPayeeRule } from "./actions";


export function CategorySelect({ payeeKey, value }: { payeeKey: string; value: string }) {
  const router = useRouter();
  return (
    <select value={value} aria-label="Rubro" className="h-7 rounded-full border border-card-border bg-field px-2 text-xs"
      onChange={async (e) => { const r = await setPayeeRule(payeeKey, { category: e.target.value }); if (!r.ok) toast.error(r.error); else { toast.success("Rubro actualizado para este destinatario"); router.refresh(); } }}>
      {Object.entries(VAR_CATEGORIES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
}

export function IgnoreToggle({ payeeKey, ignored }: { payeeKey: string; ignored: boolean }) {
  const router = useRouter();
  return (
    <button type="button" title={ignored ? "Volver a contar" : "Es personal: no contar"} className="text-fg-subtle hover:text-fg"
      onClick={async () => { const r = await setPayeeRule(payeeKey, { ignore: !ignored }); if (!r.ok) toast.error(r.error); else router.refresh(); }}>
      {ignored ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
    </button>
  );
}
