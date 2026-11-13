"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { importConvenio, setConvenioCost } from "./actions";

/** Campo de costo por renglón: se guarda al salir del campo o con Enter. */
export function CostInput({ id, value, disabled }: { id: string; value: string | null; disabled?: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState(value ?? "");
  const [saved, setSaved] = React.useState(value ?? "");
  const [busy, setBusy] = React.useState(false);
  const save = async () => {
    if (v.trim() === saved.trim()) return;
    setBusy(true);
    const r = await setConvenioCost(id, v);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    setSaved(v); router.refresh();
  };
  return (
    <Input value={v} disabled={disabled || busy} inputMode="decimal" placeholder="Tu costo" aria-label="Tu costo sin IVA"
      onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="h-8 w-28 text-right tabular" />
  );
}

export function ImportConvenio() {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <input ref={ref} type="file" accept=".xlsx" multiple hidden onChange={async (e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (!files.length) return;
        setBusy(true);
        for (const f of files) {
          const fd = new FormData(); fd.set("file", f);
          const r = await importConvenio(fd);
          if (r.ok) toast.success(`${r.contract}: ${r.n} renglones cargados`); else toast.error(`${f.name}: ${r.error}`);
        }
        setBusy(false); router.refresh();
      }} />
      <Button size="sm" variant="secondary" loading={busy} onClick={() => ref.current?.click()}>{!busy && <Upload />}Subir Excel del convenio</Button>
    </>
  );
}
