import type { Metadata } from "next";
import Link from "next/link";
import { CalendarClock, PackageSearch } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Catalog } from "./catalog";
import { CostInput, ImportConvenio } from "./ui";

export const metadata: Metadata = { title: "Productos" };

type Line = { id: string; contract_number: string; line_number: number; option_number: number; item_code: string | null; product_name: string; my_spec: string | null;
  item_description: string; unit: string | null; is_mine: boolean; my_current_price: string | null; my_stock_balance: string | null; best_other_price: string | null; offers: number;
  cost: string | null; contract_name: string | null; oc_lines: number; oc_quantity: string };
type Win = { contract_number: string; kind: string; starts_on: string; ends_on: string; contract_name: string | null };

const NAMES: Record<string, string> = { "623-20-CM26": "Limpieza", "623-26-CM26": "Contenedores", "623-38-CM26": "Tocador y perfumería", "623-43-CM26": "Bazar" };
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ tab?: string; c?: string; v?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const canEdit = ["admin", "finanzas", "compras"].includes(s.org.role);
  const tab = sp.tab === "catalogo" ? "catalogo" : "convenios";

  const Tabs = (
    <div className="mb-4 flex gap-1">
      {[["convenios", "Convenios marco"], ["catalogo", "Catálogo de compras"]].map(([k, l]) => (
        <Link key={k} href={`/productos?tab=${k}`} className={cn("rounded-full px-3 py-1.5 text-sm", tab === k ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg-muted")}>{l}</Link>
      ))}
    </div>
  );
  if (tab === "catalogo") return (<><PageHeader title="Productos" description="Renglones de tus convenios con tu costo, y el catálogo de compras" />{Tabs}<Catalog supabase={s.supabase} org={org} /></>);

  const [{ data: lineData }, { data: winData }] = await Promise.all([
    s.supabase.from("convenio_lines_overview").select("id, contract_number, line_number, option_number, item_code, product_name, my_spec, item_description, unit, is_mine, my_current_price, my_stock_balance, best_other_price, offers, cost, contract_name, oc_lines, oc_quantity")
      .eq("org_id", org).order("contract_number").order("line_number").order("option_number").limit(5000),
    s.supabase.from("convenio_windows").select("contract_number, kind, starts_on, ends_on, contract_name").eq("org_id", org).eq("kind", "precios").gte("ends_on", daysAgo(60)).order("starts_on", { ascending: false }),
  ]);
  const all = (lineData ?? []) as Line[];
  const wins = (winData ?? []) as Win[];
  const contracts = [...new Set(all.map((l) => l.contract_number))];
  const c = sp.c && contracts.includes(sp.c) ? sp.c : contracts[0];
  const view = sp.v === "todos" ? "todos" : sp.v === "sincosto" ? "sincosto" : "mios";
  const q = (sp.q ?? "").trim().toLowerCase();
  const inC = all.filter((l) => l.contract_number === c);
  const list = inC.filter((l) => (view === "todos" || l.is_mine) && (view !== "sincosto" || l.cost === null)
    && (!q || `${l.line_number} ${l.product_name} ${l.my_spec ?? ""} ${l.item_code ?? ""}`.toLowerCase().includes(q)));
  const today = todayAr();
  const label = (k: string, n?: string | null) => NAMES[k] ?? n ?? k;
  const link = (p: Record<string, string | undefined>) => `/productos?${new URLSearchParams(Object.entries({ c, v: view, q: sp.q, ...p }).filter(([, v]) => v) as [string, string][]).toString()}`;
  const open = wins.filter((w) => w.starts_on <= today && w.ends_on >= today);

  return (
    <>
      <PageHeader title="Productos" description="Renglón por renglón de tus convenios marco. Cargá tu costo una vez: cuando entra una OC de ese renglón, ya sabe cuánto te cuesta." actions={canEdit ? <ImportConvenio /> : undefined} />
      {Tabs}

      {open.length > 0 && (
        <Card className="mb-4 border-warn/40 px-5 py-3 text-sm">
          <p className="flex items-center gap-2 font-medium"><CalendarClock className="size-4 text-warn" />Actualización de precios abierta</p>
          <ul className="mt-1 text-fg-muted">{open.map((w) => <li key={w.contract_number}>{label(w.contract_number, w.contract_name)} ({w.contract_number}): hasta el {formatDate(w.ends_on)}{w.ends_on === today ? " · cierra hoy" : ""}</li>)}</ul>
        </Card>
      )}

      {!all.length ? (
        <Card><EmptyState icon={<PackageSearch />} title="Todavía no hay convenios cargados" description="Descargá del BAC el Excel 'Líneas del Convenio Marco' de cada convenio y subilo acá." /></Card>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {contracts.map((k) => {
              const ls = all.filter((l) => l.contract_number === k && l.is_mine);
              const missing = ls.filter((l) => l.cost === null).length;
              const w = wins.find((x) => x.contract_number === k);
              return (
                <Link key={k} href={`/productos?c=${k}`} className={cn("rounded-xl border px-3 py-2 text-left text-sm", k === c ? "border-primary bg-primary/10" : "border-border bg-surface")}>
                  <p className="font-medium">{label(k, ls[0]?.contract_name)}</p>
                  <p className="text-xs text-fg-subtle">{k} · {ls.length} tuyos{missing ? ` · ${missing} sin costo` : ""}{w ? ` · precios ${formatDate(w.starts_on)}–${formatDate(w.ends_on)}` : ""}</p>
                </Link>
              );
            })}
          </div>

          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <div className="flex flex-wrap gap-1">
                {[["mios", "Mis renglones"], ["sincosto", "Sin costo"], ["todos", "Todos los renglones"]].map(([k, l]) => (
                  <Link key={k} href={link({ v: k })} className={cn("rounded-full px-2.5 py-1 text-xs", view === k ? "bg-primary text-primary-fg" : "bg-surface-2 text-fg-muted")}>{l}</Link>
                ))}
              </div>
              <form action="/productos" className="flex gap-2">
                <input type="hidden" name="c" value={c} /><input type="hidden" name="v" value={view} />
                <input name="q" defaultValue={sp.q} placeholder="Buscar renglón o producto" className="h-8 w-56 rounded-lg border border-border bg-field px-3 text-sm" />
              </form>
            </div>
            <div className="hidden grid-cols-[4rem_1fr_7rem_7rem_7rem_5rem] gap-3 border-b border-border px-5 py-2 text-xs text-fg-subtle lg:grid">
              <span>Renglón</span><span>Producto</span><span className="text-right">Tu precio</span><span className="text-right">Mejor otro</span><span className="text-right">Tu costo s/IVA</span><span className="text-right">Margen</span>
            </div>
            <ul className="divide-y divide-border">
              {list.map((l) => {
                const price = l.my_current_price !== null ? Number(l.my_current_price) : null;
                const net = price !== null ? price / 1.21 : null;
                const margin = net && l.cost !== null ? ((net - Number(l.cost)) / net) * 100 : null;
                const beaten = price !== null && l.best_other_price !== null && Number(l.best_other_price) < price;
                return (
                  <li key={l.id} className={cn("grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-2 px-4 py-3 text-sm sm:px-5 lg:grid-cols-[4rem_1fr_7rem_7rem_7rem_5rem] lg:items-center", !l.is_mine && "opacity-70")}>
                    <span className="font-semibold tabular">{l.line_number}{l.option_number > 1 ? `.${l.option_number}` : ""}</span>
                    <div className="min-w-0">
                      <p className="font-medium">{l.product_name}</p>
                      <p className="line-clamp-2 text-xs text-fg-subtle">{l.my_spec ? l.my_spec.replace(/\s+/g, " ") : l.item_description}</p>
                      <p className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-fg-subtle">
                        <span className="font-mono">{l.item_code}</span>{l.unit && <span>· {l.unit}</span>}<span>· {l.offers} ofertas</span>
                        {l.is_mine && l.my_stock_balance !== null && <span>· te quedan {Number(l.my_stock_balance).toLocaleString("es-AR")} de stock</span>}
                        {l.oc_lines > 0 && <Badge tone="info">{l.oc_lines} OC</Badge>}
                        {!l.is_mine && <Badge>no ofertás</Badge>}
                      </p>
                    </div>
                    <div className="col-span-2 grid grid-cols-4 items-center gap-2 lg:contents">
                      <p className="text-right tabular"><span className="text-[11px] text-fg-subtle lg:hidden">Tu precio </span>{price !== null ? formatMoney(price) : "—"}</p>
                      <p className={cn("text-right tabular", beaten && "text-warn")}><span className="text-[11px] text-fg-subtle lg:hidden">Otro </span>{l.best_other_price !== null ? formatMoney(l.best_other_price) : "—"}</p>
                      <div className="flex justify-end">{l.is_mine || l.cost !== null ? <CostInput key={`${l.id}-${l.cost}`} id={l.id} value={l.cost} disabled={!canEdit} /> : <span className="text-fg-subtle">—</span>}</div>
                      <p className={cn("text-right font-medium tabular", margin === null ? "text-fg-subtle" : margin < 10 ? "text-danger" : margin < 20 ? "text-warn" : "text-accent")}>{margin !== null ? `${margin.toFixed(0)}%` : "—"}</p>
                    </div>
                  </li>
                );
              })}
              {!list.length && <li className="px-5 py-6 text-sm text-fg-subtle">Nada para mostrar con este filtro.</li>}
            </ul>
          </Card>
          <p className="mt-2 text-xs text-fg-subtle">Tu precio y el mejor de los demás son los precios actuales del BAC (con IVA). El margen compara tu precio sin IVA contra tu costo sin IVA. En naranja: alguien ofrece más barato.</p>
        </>
      )}
    </>
  );
}
