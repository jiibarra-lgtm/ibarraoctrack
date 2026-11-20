"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { ACC_TYPE, validateEntry, type AccType } from "@/lib/accounting";
import { deleteManualEntry, generateEntries, saveAccount, saveManualEntry } from "./actions";

const num = (s: string) => { const n = Number(parseArNumber(s) ?? NaN); return Number.isFinite(n) ? n : 0; };
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

export function GenerateButton({ from, to, auto }: { from: string; to: string; auto?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const run = React.useCallback(async (quiet = false) => {
    setBusy(true);
    const r = await generateEntries(from, to);
    setBusy(false);
    if (!r.ok) return toast.error(r.error, { duration: 12000 });
    if (!quiet) toast.success(`${r.n} asientos automáticos al día`);
    router.refresh();
  }, [from, to, router]);
  const ran = React.useRef(false);
  React.useEffect(() => { if (auto && !ran.current) { ran.current = true; void run(true); } }, [auto, run]);
  return <Button variant="secondary" loading={busy} onClick={() => run()}><RefreshCw /> Actualizar asientos</Button>;
}

type L = { account_code: string; debit: string; credit: string };

export function ManualEntryDialog({ accounts }: { accounts: { code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [date, setDate] = React.useState(todayAr());
  const [desc, setDesc] = React.useState("");
  const [lines, setLines] = React.useState<L[]>([{ account_code: "", debit: "", credit: "" }, { account_code: "", debit: "", credit: "" }]);
  const [busy, setBusy] = React.useState(false);
  const parsed = lines.map((l) => ({ account_code: l.account_code, debit: num(l.debit), credit: num(l.credit) }));
  const err = validateEntry(parsed.filter((l) => l.account_code));
  const d = parsed.reduce((a, l) => a + l.debit, 0), c = parsed.reduce((a, l) => a + l.credit, 0);
  const set = (i: number, k: keyof L) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setLines((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
  const save = async () => {
    setBusy(true);
    const r = await saveManualEntry({ date, description: desc, lines: parsed.filter((l) => l.account_code && (l.debit || l.credit)) });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Asiento registrado");
    setOpen(false); setDesc(""); setLines([{ account_code: "", debit: "", credit: "" }, { account_code: "", debit: "", credit: "" }]);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Asiento manual</Button></DialogTrigger>
      <DialogContent title="Asiento manual" description="Apertura, sueldos, amortizaciones, ajustes o lo que el sistema no registra solo. Tiene que balancear." className="max-w-2xl">
        <div className="mt-3 grid gap-3 sm:grid-cols-[160px_1fr]">
          <Field label="Fecha" htmlFor="me-date"><Input id="me-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Descripción" htmlFor="me-desc"><Input id="me-desc" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Sueldos de noviembre" /></Field>
        </div>
        <table className="mt-3 w-full text-sm">
          <thead className="text-xs text-fg-subtle"><tr><th className="text-left font-medium">Cuenta</th><th className="w-32 text-right font-medium">Debe</th><th className="w-32 text-right font-medium">Haber</th><th className="w-6" /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-1 pr-2"><NativeSelect value={l.account_code} onChange={set(i, "account_code")} className="h-8"><option value="">Elegí…</option>{accounts.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}</NativeSelect></td>
                <td className="px-1"><Input value={l.debit} onChange={set(i, "debit")} inputMode="decimal" className="h-8 text-right tabular" disabled={!!l.credit} /></td>
                <td className="px-1"><Input value={l.credit} onChange={set(i, "credit")} inputMode="decimal" className="h-8 text-right tabular" disabled={!!l.debit} /></td>
                <td>{lines.length > 2 && <button type="button" aria-label="Quitar" className="text-fg-subtle hover:text-danger" onClick={() => setLines((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}</td>
              </tr>
            ))}
            <tr className="text-xs font-medium"><td className="pt-2"><button type="button" className="inline-flex items-center gap-1 text-fg-muted hover:text-fg" onClick={() => setLines((xs) => [...xs, { account_code: "", debit: "", credit: "" }])}><Plus className="size-3.5" /> Línea</button></td>
              <td className="pt-2 text-right tabular">{formatMoney(d)}</td><td className="pt-2 text-right tabular">{formatMoney(c)}</td><td /></tr>
          </tbody>
        </table>
        {err && parsed.some((l) => l.debit || l.credit) && <p className="mt-2 text-xs text-danger">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button loading={busy} disabled={!!err || desc.trim().length < 3} onClick={save}>Registrar</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteEntryButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (!confirm) return <button type="button" className="text-xs text-fg-subtle hover:text-danger" onClick={() => setConfirm(true)}>Borrar</button>;
  return (
    <span className="inline-flex gap-1">
      <Button size="sm" variant="danger" loading={busy} onClick={async () => { setBusy(true); const r = await deleteManualEntry(id); setBusy(false); if (!r.ok) toast.error(r.error); else router.refresh(); }}>Borrar asiento</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>No</Button>
    </span>
  );
}

export function AccountForm() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<AccType>("egreso");
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
      <Field label="Código" htmlFor="ac-code"><Input id="ac-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="5.2.07" className="w-28 tabular" /></Field>
      <Field label="Nombre" htmlFor="ac-name"><Input id="ac-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sueldos y cargas sociales" className="w-64" /></Field>
      <Field label="Tipo" htmlFor="ac-type"><NativeSelect id="ac-type" value={type} onChange={(e) => setType(e.target.value as AccType)}>{Object.entries(ACC_TYPE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</NativeSelect></Field>
      <Button loading={busy} disabled={!code || name.trim().length < 2} onClick={async () => {
        setBusy(true);
        const r = await saveAccount({ code, name, type });
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Cuenta agregada");
        setCode(""); setName("");
        router.refresh();
      }}><Plus /> Agregar cuenta</Button>
    </div>
  );
}
