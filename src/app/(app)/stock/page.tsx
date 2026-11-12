import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, Boxes, Link2, PackageSearch, Search, Wallet } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdjustDialog, EditItemDialog, LinkRow } from "./ui";

export const metadata: Metadata = { title: "Stock" };

type Level = { id: string; name: string; unit: string | null; min_qty: string; active: boolean; entradas: string; salidas: string; ajustes: string; stock: string; last_cost: string | null; last_move: string | null; aliases: number };
type Unlinked = { key: string; description: string; qty: string; moves: number; last_date: string; suggestion_id: string | null; suggestion: string | null };
type Move = { source: string; ref_id: string; mov_date: string; description: string; qty: string; unit_cost: string | null; party: string; doc_id: string | null };

const SOURCE: Record<string, string> = { factura: "Factura de proveedor", mercadolibre: "Compra en Mercado Libre", remito: "Remito", ajuste: "Ajuste" };

export default async function StockPage({ searchParams }: { searchParams: Promise<{ q?: string; id?: string; f?: string }> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const s = await requireOrg();
  const org = s.org.org_id;
  const canEdit = ["admin", "compras", "finanzas", "logistica"].includes(s.org.role);
  await s.supabase.rpc("stock_autolink", { p_org: org }); // une las descripciones nuevas antes de mostrar
  const [{ data: lv }, { data: un }] = await Promise.all([
    s.supabase.from("stock_levels").select("*").eq("org_id", org).eq("active", true).order("name").limit(3000),
    s.supabase.from("stock_unlinked").select("*").eq("org_id", org).order("last_date", { ascending: false }).limit(60),
  ]);
  const all = (lv ?? []) as Level[];
  const unlinked = (un ?? []) as Unlinked[];
  const low = all.filter((x) => Number(x.min_qty) > 0 && Number(x.stock) < Number(x.min_qty));
  const value = all.reduce((a, x) => a + Math.max(0, Number(x.stock)) * Number(x.last_cost ?? 0), 0);
  const withStock = all.filter((x) => Number(x.stock) > 0);
  const shown = all
    .filter((x) => (sp.f === "bajo" ? low.includes(x) : sp.f === "todos" ? true : Number(x.stock) !== 0 || Number(x.min_qty) > 0))
    .filter((x) => !q || x.name.toLowerCase().includes(q))
    .sort((a, b) => Number(b.stock) * Number(b.last_cost ?? 0) - Number(a.stock) * Number(a.last_cost ?? 0));
  const options = all.map((x) => ({ id: x.id, name: x.name }));
  const sel = sp.id ? all.find((x) => x.id === sp.id) : null;
  const { data: mv } = sel ? await s.supabase.from("stock_movements").select("source, ref_id, mov_date, description, qty, unit_cost, party, doc_id").eq("item_id", sel.id).order("mov_date", { ascending: false }).limit(200) : { data: [] };
  const moves = (mv ?? []) as Move[];
  const href = (p: Record<string, string>) => `/stock?${new URLSearchParams({ ...(q ? { q } : {}), ...(sp.f ? { f: sp.f } : {}), ...p })}`;

  return (
    <>
      <PageHeader title="Stock" description="Se mueve solo: entra con las facturas de proveedores y las compras de Mercado Libre, sale con cada remito. Los productos escritos distinto se unen solos; los dudosos los confirmás abajo." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Boxes} label="Productos con stock" value={String(withStock.length)} href="/stock" />
        <Stat icon={Wallet} label="Valor del stock (al último costo)" value={formatMoney(value)} />
        <Stat icon={AlertTriangle} label="Bajo el mínimo" value={String(low.length)} tone={low.length ? "warn" : undefined} href="/stock?f=bajo" />
        <Stat icon={Link2} label="Salidas para confirmar" value={String(unlinked.length)} tone={unlinked.length ? "warn" : undefined} href="#confirmar" />
      </div>

      <div className={cn("mt-5 grid gap-5", sel && "xl:grid-cols-[minmax(0,1fr)_420px]")}>
        <Card className="min-w-0 self-start overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <div className="flex gap-1.5">
              {([["", "Con movimiento"], ["bajo", "Bajo mínimo"], ["todos", "Todos"]] as const).map(([k, l]) => (
                <Link key={k} href={`/stock?${new URLSearchParams({ ...(q ? { q } : {}), ...(k ? { f: k } : {}) })}`} className={cn("rounded-full px-3 py-1 text-xs font-medium", (sp.f ?? "") === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
              ))}
            </div>
            <form className="relative w-full sm:w-72">
              {sp.f && <input type="hidden" name="f" value={sp.f} />}
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar producto…" className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none" />
            </form>
          </div>
          {!shown.length ? <EmptyState icon={<PackageSearch />} title={all.length ? "Nada con ese filtro" : "Todavía no hay movimientos"} description={all.length ? undefined : "El stock se arma con las facturas de proveedores del mail, las compras de Mercado Libre y los remitos."} /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs text-fg-subtle"><tr className="border-b border-border">
                  <th className="px-5 py-2.5 text-left font-medium">Producto</th><th className="px-2 text-right font-medium">Stock</th><th className="px-2 text-right font-medium">Entró</th>
                  <th className="px-2 text-right font-medium">Salió</th><th className="px-2 text-right font-medium">Último costo</th><th className="px-2 text-right font-medium">Valor</th><th className="w-16 px-5" />
                </tr></thead>
                <tbody>
                  {shown.slice(0, 500).map((x) => {
                    const st = Number(x.stock), min = Number(x.min_qty);
                    return (
                      <tr key={x.id} className={cn("border-b border-border last:border-0", sel?.id === x.id && "bg-info-soft/40")}>
                        <td className="max-w-[320px] px-5 py-2.5">
                          <Link href={href({ id: x.id })} className="font-medium leading-snug hover:underline">{x.name}</Link>
                          <p className="text-[11px] text-fg-subtle">{x.last_move ? `último movimiento ${formatDate(x.last_move)}` : "sin movimientos"}{min > 0 ? ` · mínimo ${formatQty(min)}` : ""}{x.aliases > 1 ? ` · ${x.aliases} nombres unidos` : ""}</p>
                        </td>
                        <td className={cn("px-2 text-right font-semibold tabular", st < 0 && "text-danger", min > 0 && st < min && st >= 0 && "text-warn")}>{formatQty(st)} <span className="text-xs font-normal text-fg-subtle">{x.unit ?? ""}</span></td>
                        <td className="px-2 text-right tabular text-fg-muted">{formatQty(x.entradas)}</td>
                        <td className="px-2 text-right tabular text-fg-muted">{formatQty(x.salidas)}</td>
                        <td className="px-2 text-right tabular">{x.last_cost ? formatMoney(x.last_cost) : "—"}</td>
                        <td className="px-2 text-right tabular">{x.last_cost && st > 0 ? formatMoney(st * Number(x.last_cost)) : "—"}</td>
                        <td className="px-5"><div className="flex justify-end gap-2">{canEdit && <><AdjustDialog id={x.id} name={x.name} unit={x.unit} /><EditItemDialog id={x.id} name={x.name} unit={x.unit} min={min} options={options} /></>}</div></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {sel && (
          <Card className="self-start">
            <CardHeader title={sel.name} description={`Stock ${formatQty(sel.stock)} ${sel.unit ?? ""} · movimientos`} />
            <ul className="max-h-[65vh] divide-y divide-border overflow-y-auto">
              {moves.map((m) => (
                <li key={`${m.source}${m.ref_id}`} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{SOURCE[m.source] ?? m.source}{m.party ? ` · ${m.party}` : ""}</p>
                    <p className="truncate text-[11px] text-fg-subtle">{formatDate(m.mov_date)} · {m.description}</p>
                  </div>
                  <div className="shrink-0 text-right tabular">
                    <p className={cn("font-medium", Number(m.qty) < 0 ? "text-danger" : "text-accent")}>{Number(m.qty) > 0 ? "+" : ""}{formatQty(m.qty)}</p>
                    {m.unit_cost && <p className="text-[11px] text-fg-subtle">{formatMoney(m.unit_cost)} c/u</p>}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {unlinked.length > 0 && (
        <Card id="confirmar" className="mt-5 overflow-hidden">
          <CardHeader title="Salidas para confirmar" description="Renglones de remito que no se parecen lo suficiente a ningún producto comprado. Elegí cuál es (queda aprendido para la próxima)." />
          <ul className="divide-y divide-border">
            {unlinked.map((u) => (
              <li key={u.key} className="flex flex-col gap-2 px-5 py-3 text-sm lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0"><p className="font-medium">{u.description}</p><p className="text-xs text-fg-subtle">{formatQty(u.qty)} en {u.moves} remito{u.moves === 1 ? "" : "s"} · último {formatDate(u.last_date)}</p></div>
                {canEdit && <LinkRow k={u.key} description={u.description} suggestionId={u.suggestion_id} suggestion={u.suggestion} options={options} />}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
