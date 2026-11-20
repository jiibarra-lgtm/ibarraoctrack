"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { parseArNumber } from "@/lib/money";
import { coefSum, JURISDICTIONS, liquidateIibb, type IibbDeductions, type IibbJur } from "@/lib/iibb";
import { markIibbPaid, reopenIibbFiling, saveIibbFiling, saveJurisdictions } from "./actions";

const num = (s: string) => { const n = Number(parseArNumber(s) ?? NaN); return Number.isFinite(n) ? n : 0; };
const show = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

type JurRow = { code: number; coefficient: string; rate: string; active: boolean };

/** Coeficientes unificados (CM05) y alícuotas por jurisdicción. */
export function JurisdictionsForm({ initial, canEdit }: { initial: { code: number; coefficient: number; rate: number; active: boolean }[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<JurRow[]>(initial.map((j) => ({ code: j.code, coefficient: String(j.coefficient).replace(".", ","), rate: String(j.rate).replace(".", ","), active: j.active })));
  const [busy, setBusy] = React.useState(false);
  const used = new Set(rows.map((r) => r.code));
  const sum = coefSum(rows.filter((r) => r.active).map((r) => ({ code: r.code, coefficient: num(r.coefficient), rate: 0 })));
  const set = (i: number, k: keyof JurRow, v: string | boolean | number) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  return (
    <div className="px-5 pb-5">
      <table className="w-full text-sm">
        <thead className="text-xs text-fg-subtle"><tr><th className="py-1.5 text-left font-medium">Jurisdicción</th><th className="w-24 text-right font-medium">Coeficiente</th><th className="w-20 text-right font-medium">Alícuota %</th><th className="w-14 text-center font-medium">Activa</th><th className="w-6" /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="py-1 pr-2">
                <NativeSelect value={r.code} disabled={!canEdit} className="h-8" onChange={(e) => set(i, "code", Number(e.target.value))}>
                  {Object.entries(JURISDICTIONS).filter(([c]) => Number(c) === r.code || !used.has(Number(c))).map(([c, n]) => <option key={c} value={c}>{c} · {n}</option>)}
                </NativeSelect>
              </td>
              <td className="px-1"><Input value={r.coefficient} disabled={!canEdit} inputMode="decimal" className="h-8 text-right tabular" onChange={(e) => set(i, "coefficient", e.target.value)} /></td>
              <td className="px-1"><Input value={r.rate} disabled={!canEdit} inputMode="decimal" className="h-8 text-right tabular" onChange={(e) => set(i, "rate", e.target.value)} /></td>
              <td className="text-center"><input type="checkbox" checked={r.active} disabled={!canEdit} onChange={(e) => set(i, "active", e.target.checked)} /></td>
              <td>{canEdit && rows.length > 1 && <button type="button" aria-label="Quitar" className="text-fg-subtle hover:text-danger" onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`mt-2 text-xs ${Math.abs(sum - 1) > 0.0005 ? "text-danger" : "text-fg-subtle"}`}>Suma de coeficientes de las activas: <b className="tabular">{sum.toFixed(4)}</b> (tiene que dar 1,0000). Salen del CM05 que presenta el contador cada año.</p>
      {canEdit && (
        <div className="mt-3 flex justify-between gap-2">
          <Button size="sm" variant="ghost" onClick={() => { const free = Object.keys(JURISDICTIONS).map(Number).find((c) => !used.has(c)); if (free) setRows((xs) => [...xs, { code: free, coefficient: "0", rate: "3", active: true }]); }}><Plus /> Jurisdicción</Button>
          <Button size="sm" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await saveJurisdictions(rows.map((x) => ({ code: x.code, coefficient: num(x.coefficient), rate: num(x.rate), active: x.active })));
            setBusy(false);
            if (!r.ok) return toast.error(r.error);
            toast.success("Jurisdicciones guardadas");
            router.refresh();
          }}>Guardar</Button>
        </div>
      )}
    </div>
  );
}

/** Planilla de la liquidación del mes: se editan las deducciones y se ve el saldo por jurisdicción en vivo. */
export function IibbWorksheet({ month, base: base0, jurisdictions, defaults, favorPrev, status, paidAt, canEdit }: {
  month: string; base: number; jurisdictions: IibbJur[]; defaults: Record<number, IibbDeductions>; favorPrev: Record<number, number>;
  status: "borrador" | "presentada" | null; paidAt: string | null; canEdit: boolean;
}) {
  const router = useRouter();
  const locked = status === "presentada" || !canEdit;
  const [base, setBase] = React.useState(show(base0));
  const [ded, setDed] = React.useState(() => Object.fromEntries(jurisdictions.map((j) => [j.code, {
    retenciones: show(defaults[j.code]?.retenciones ?? 0), percepciones: show(defaults[j.code]?.percepciones ?? 0), sircreb: show(defaults[j.code]?.sircreb ?? 0),
  }])) as Record<number, Record<keyof IibbDeductions, string>>);
  const [busy, setBusy] = React.useState<string | null>(null);
  const parsed = Object.fromEntries(jurisdictions.map((j) => [j.code, { retenciones: num(ded[j.code].retenciones), percepciones: num(ded[j.code].percepciones), sircreb: num(ded[j.code].sircreb) }])) as Record<number, IibbDeductions>;
  const l = liquidateIibb(num(base), jurisdictions, parsed, favorPrev);
  const set = (code: number, k: keyof IibbDeductions) => (e: React.ChangeEvent<HTMLInputElement>) => setDed((o) => ({ ...o, [code]: { ...o[code], [k]: e.target.value } }));
  const run = async (key: string, fn: () => Promise<{ ok: boolean; error?: string }>, msg: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) return toast.error(r.error ?? "Error");
    toast.success(msg);
    router.refresh();
  };
  const cell = "h-8 w-28 text-right tabular";
  return (
    <div>
      <div className="flex flex-wrap items-end gap-3 px-5 pb-4">
        <label className="grid gap-1 text-xs text-fg-muted">Base imponible total del mes (ventas netas sin IVA)
          <Input value={base} disabled={locked} inputMode="decimal" className="h-9 w-48 tabular" onChange={(e) => setBase(e.target.value)} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-sm tabular">
          <thead className="text-xs text-fg-subtle"><tr className="border-y border-border">
            <th className="px-5 py-2 text-left font-medium">Jurisdicción</th><th className="px-2 text-right font-medium">Coef.</th><th className="px-2 text-right font-medium">Base</th>
            <th className="px-2 text-right font-medium">Alíc.</th><th className="px-2 text-right font-medium">Impuesto</th><th className="px-2 text-right font-medium">Retenciones</th>
            <th className="px-2 text-right font-medium">Percepciones</th><th className="px-2 text-right font-medium">SIRCREB</th><th className="px-2 text-right font-medium">Saldo a favor ant.</th>
            <th className="px-2 text-right font-medium">A pagar</th><th className="px-5 text-right font-medium">Saldo a favor</th>
          </tr></thead>
          <tbody>
            {l.rows.map((r) => (
              <tr key={r.code} className="border-b border-border">
                <td className="px-5 py-1.5">{r.code} · {JURISDICTIONS[r.code]}</td>
                <td className="px-2 text-right">{r.coefficient.toFixed(4)}</td>
                <td className="px-2 text-right">{formatMoney(r.base)}</td>
                <td className="px-2 text-right">{show(r.rate)}%</td>
                <td className="px-2 text-right font-medium">{formatMoney(r.tax)}</td>
                <td className="px-1 text-right">{locked ? formatMoney(r.retenciones) : <Input value={ded[r.code].retenciones} onChange={set(r.code, "retenciones")} inputMode="decimal" className={cell} />}</td>
                <td className="px-1 text-right">{locked ? formatMoney(r.percepciones) : <Input value={ded[r.code].percepciones} onChange={set(r.code, "percepciones")} inputMode="decimal" className={cell} />}</td>
                <td className="px-1 text-right">{locked ? formatMoney(r.sircreb) : <Input value={ded[r.code].sircreb} onChange={set(r.code, "sircreb")} inputMode="decimal" className={cell} />}</td>
                <td className="px-2 text-right">{formatMoney(r.favor_prev)}</td>
                <td className="px-2 text-right font-semibold">{formatMoney(r.due)}</td>
                <td className="px-5 text-right text-accent">{r.favor_next ? formatMoney(r.favor_next) : "—"}</td>
              </tr>
            ))}
            <tr className="font-semibold"><td className="px-5 py-2" colSpan={4}>Total</td><td className="px-2 text-right">{formatMoney(l.totalTax)}</td><td colSpan={4} /><td className="px-2 text-right">{formatMoney(l.totalDue)}</td><td className="px-5 text-right text-accent">{formatMoney(l.rows.reduce((a, r) => a + r.favor_next, 0))}</td></tr>
          </tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4">
          {status === "presentada" ? (
            <>
              <span className="mr-auto text-sm text-fg-muted">Presentada{paidAt ? ` · pagada el ${paidAt.split("-").reverse().join("/")}` : " · falta pagar"}</span>
              <Button size="sm" variant="ghost" loading={busy === "reopen"} onClick={() => run("reopen", () => reopenIibbFiling(month), "Volvió a borrador")}>Corregir</Button>
              <Button size="sm" variant={paidAt ? "ghost" : "default"} loading={busy === "paid"} onClick={() => run("paid", () => markIibbPaid(month, !paidAt), paidAt ? "Marcada sin pagar" : "Marcada como pagada")}>{paidAt ? "Desmarcar pago" : "Marcar pagada"}</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" loading={busy === "draft"} onClick={() => run("draft", () => saveIibbFiling(month, num(base), parsed, "borrador"), "Borrador guardado")}>Guardar borrador</Button>
              <Button size="sm" loading={busy === "present"} onClick={() => run("present", () => saveIibbFiling(month, num(base), parsed, "presentada"), "Liquidación presentada")}>Marcar como presentada</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
