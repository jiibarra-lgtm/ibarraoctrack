import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ExternalLink, FileText, Factory, PackageSearch, Search, Tags } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import { HideInvoice, UploadInvoices } from "./ui";

export const metadata: Metadata = { title: "Precios de proveedores" };

type Price = {
  id: string; invoice_id: string; code: string | null; description: string; unit: string | null; pack: number | null; quantity: string;
  unit_net: string; unit_final: string | null; issue_date: string | null; supplier_name: string; supplier_cuit: string | null;
  point_of_sale: number | null; number: number | null; letter: string | null; mail_id: string | null;
  times?: number; min_final?: string | null; max_final?: string | null; prev_final?: string | null; detail?: string | null; discount_pct?: string | null; list_price?: string | null;
};
type Inv = {
  id: string; issue_date: string | null; supplier_name: string; supplier_cuit: string | null; letter: string | null; kind: string;
  point_of_sale: number | null; number: number | null; total: string | null; items_net: string | null; quality: string; hidden: boolean;
  mail_id: string | null; source: string; arca_voucher_id: string | null; filename: string; supplier_invoice_items: { count: number }[];
};

const TABS = [["productos", "Productos"], ["renglones", "Todas las compras"], ["facturas", "Facturas"]] as const;
const numLabel = (r: { letter: string | null; point_of_sale: number | null; number: number | null }) =>
  r.number ? `FC ${r.letter ?? ""} ${String(r.point_of_sale ?? 0).padStart(5, "0")}-${String(r.number).padStart(8, "0")}`.replace("  ", " ") : "Sin número";
const mailUrl = (id: string | null) => (id ? `https://mail.google.com/mail/u/0/#all/${id}` : null);
const clean = (q: string) => q.replace(/[,()*%\\]/g, " ").trim().slice(0, 60);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const currentMonth = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 7);
const fmtCuit = (c: string | null) => (c && c.length === 11 ? `${c.slice(0, 2)}-${c.slice(2, 10)}-${c.slice(10)}` : c ?? "");

function PriceCell({ r }: { r: Price }) {
  const final = r.unit_final ? Number(r.unit_final) : null;
  return (
    <div className="text-right tabular">
      <p className="font-semibold">{final !== null ? formatMoney(final) : "—"}</p>
      {r.pack && final !== null && <p className="text-[11px] text-fg-muted">{formatMoney(final / r.pack)} por unidad (×{r.pack})</p>}
      <p className="text-[11px] text-fg-subtle">neto {formatMoney(r.unit_net)}</p>
    </div>
  );
}

function Trend({ r }: { r: Price }) {
  if (!r.prev_final || !r.unit_final) return null;
  const a = Number(r.prev_final), b = Number(r.unit_final);
  if (!a) return null;
  const pct = ((b - a) / a) * 100;
  if (Math.abs(pct) < 0.5) return <span className="text-[11px] text-fg-subtle">igual que la vez anterior</span>;
  return <span className={cn("text-[11px] font-medium", pct > 0 ? "text-danger" : "text-accent")}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs. {formatMoney(a)}</span>;
}

export default async function SupplierPricesPage({ searchParams }: { searchParams: Promise<{ t?: string; q?: string; ocultas?: string }> }) {
  const sp = await searchParams;
  const t = (TABS.find(([k]) => k === sp.t)?.[0] ?? "productos") as (typeof TABS)[number][0];
  const q = clean(sp.q ?? "");
  const s = await requireOrg();
  const org = s.org.org_id;
  const writable = canWrite(s.org.role);
  const like = q ? `description.ilike.*${q}*,supplier_name.ilike.*${q}*,code.ilike.*${q}*` : null;

  const { data: invAll } = await s.supabase.from("supplier_invoices").select("id, issue_date, supplier_cuit, supplier_name, total, hidden, quality")
    .eq("org_id", org).eq("hidden", false).order("issue_date", { ascending: false, nullsFirst: false }).limit(5000);
  const invs = (invAll ?? []) as Pick<Inv, "id" | "issue_date" | "supplier_cuit" | "supplier_name" | "total" | "hidden" | "quality">[];
  const suppliers = new Set(invs.map((i) => i.supplier_cuit || i.supplier_name.toLowerCase())).size;
  const month = currentMonth();
  const monthInvs = invs.filter((i) => i.issue_date?.startsWith(month));
  const review = invs.filter((i) => i.quality !== "ok").length;
  // Subas: última compra de cada producto contra la compra anterior al mismo proveedor (últimos 60 días)
  const { data: recentPrices } = await s.supabase.from("supplier_product_prices").select("id, description, supplier_name, unit_final, prev_final, issue_date, mail_id, pack")
    .eq("org_id", org).gte("issue_date", daysAgo(60)).not("prev_final", "is", null).limit(2000);
  const rises = ((recentPrices ?? []) as Pick<Price, "id" | "description" | "supplier_name" | "unit_final" | "prev_final" | "issue_date" | "mail_id" | "pack">[])
    .map((r) => ({ ...r, pct: Number(r.prev_final) ? (Number(r.unit_final) / Number(r.prev_final) - 1) * 100 : 0 }))
    .filter((r) => r.pct >= 3).sort((a, b) => b.pct - a.pct);
  const { count: productCount } = await s.supabase.from("supplier_product_prices").select("id", { count: "exact", head: true }).eq("org_id", org);

  let prices: Price[] = [];
  let lines: Price[] = [];
  let invoices: Inv[] = [];
  if (t === "productos") {
    let qy = s.supabase.from("supplier_product_prices").select("*").eq("org_id", org);
    if (like) qy = qy.or(like);
    const { data } = await (q ? qy.order("unit_final", { ascending: true, nullsFirst: false }) : qy.order("issue_date", { ascending: false, nullsFirst: false })).limit(400);
    prices = (data ?? []) as Price[];
  } else if (t === "renglones") {
    let qy = s.supabase.from("supplier_items_overview").select("*").eq("org_id", org);
    if (like) qy = qy.or(like);
    const { data } = await qy.order("issue_date", { ascending: false, nullsFirst: false }).order("line").limit(500);
    lines = (data ?? []) as Price[];
  } else {
    let qy = s.supabase.from("supplier_invoices").select("*, supplier_invoice_items(count)").eq("org_id", org);
    if (!sp.ocultas) qy = qy.eq("hidden", false);
    if (q) qy = qy.ilike("supplier_name", `%${q}%`);
    const { data } = await qy.order("issue_date", { ascending: false, nullsFirst: false }).limit(400);
    invoices = (data ?? []) as Inv[];
  }
  const cheapest = q && prices.length > 1 ? prices.find((p) => p.unit_final)?.id : null;
  const href = (p: Record<string, string>) => `/precios-proveedores?${new URLSearchParams({ t, ...(q ? { q } : {}), ...p })}`;

  return (
    <>
      <PageHeader title="Precios de proveedores"
        description="Cada producto que compraste con su precio final (con IVA y percepciones), la fecha y el proveedor. Se lee solo de las facturas en PDF que llegan a tu mail."
        actions={writable && <UploadInvoices />} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FileText} label="Facturas leídas" value={String(invs.length)} sub={`${monthInvs.length} este mes`} href="/precios-proveedores?t=facturas" />
        <Stat icon={Tags} label="Productos con precio" value={String(productCount ?? 0)} href="/precios-proveedores" />
        <Stat icon={Factory} label="Proveedores" value={String(suppliers)} />
        <Stat icon={AlertTriangle} label="Para revisar" value={String(review)} tone={review ? "warn" : undefined} sub={review ? "renglones que no cierran" : "todo cierra"} href="/precios-proveedores?t=facturas" />
      </div>

      {rises.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <div className="border-b border-border px-4 py-3 sm:px-5">
            <p className="font-semibold">Subieron de precio ({rises.length})</p>
            <p className="text-xs text-fg-subtle">Última factura de los últimos 60 días contra la compra anterior del mismo producto al mismo proveedor. Revisá el margen de las OC que lo usan.</p>
          </div>
          <ul className="max-h-80 divide-y divide-border overflow-y-auto">
            {rises.slice(0, 40).map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm sm:px-5">
                <div className="min-w-0"><p className="truncate font-medium">{r.description}</p>
                  <p className="text-xs text-fg-subtle">{r.supplier_name} · {formatDate(r.issue_date)}{r.mail_id && <> · <a className="underline" href={mailUrl(r.mail_id)!} target="_blank" rel="noreferrer">ver factura</a></>}</p></div>
                <div className="shrink-0 text-right tabular">
                  <p className={cn("font-semibold", r.pct >= 10 ? "text-danger" : "text-warn")}>▲ {r.pct.toFixed(1)}%</p>
                  <p className="text-[11px] text-fg-subtle">{formatMoney(r.prev_final)} → {formatMoney(r.unit_final)}</p>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5 overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex rounded-full bg-field p-0.5">
            {TABS.map(([k, l]) => (
              <Link key={k} href={`/precios-proveedores?${new URLSearchParams({ t: k, ...(q ? { q } : {}) })}`}
                className={cn("rounded-full px-3 py-1 text-xs font-semibold", t === k ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>{l}</Link>
            ))}
          </div>
          <form className="relative w-full lg:w-80">
            <input type="hidden" name="t" value={t} />
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
            <input name="q" defaultValue={q} placeholder={t === "facturas" ? "Buscar proveedor…" : "Buscar producto, código o proveedor…"}
              className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </form>
        </div>

        {!invs.length ? (
          <EmptyState icon={<PackageSearch />} title="Todavía no hay facturas de proveedores"
            description="Pegá de nuevo el script de Gmail (Configuración → Copiar script) y ejecutá «reiniciar»: lee las facturas en PDF de los últimos 6 meses. También podés subir PDFs a mano."
            action={<Button asChild variant="secondary"><Link href="/configuracion#gmail">Ir a Configuración</Link></Button>} />
        ) : t === "productos" ? (
          !prices.length ? <EmptyState icon={<Search />} title="No encontré ese producto" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-xs text-fg-subtle">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2.5 text-left font-medium">Producto</th>
                    <th className="px-3 text-left font-medium">Proveedor</th>
                    <th className="px-3 text-left font-medium">Última compra</th>
                    <th className="px-3 text-right font-medium">Precio final c/u</th>
                    <th className="px-5 text-right font-medium">Historial</th>
                  </tr>
                </thead>
                <tbody>
                  {prices.map((r) => (
                    <tr key={r.id} className={cn("border-b border-border align-top last:border-0", r.id === cheapest && "bg-accent/5")}>
                      <td className="max-w-[340px] px-5 py-2.5">
                        <p className="font-medium leading-snug">{r.description}</p>
                        <p className="text-[11px] text-fg-subtle">{[r.code, r.unit && `por ${r.unit}`].filter(Boolean).join(" · ")}{r.id === cheapest && <span className="ml-1 font-semibold text-accent">· el más barato</span>}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={href({ q: r.supplier_name })} className="hover:underline">{r.supplier_name || "—"}</Link>
                        {r.supplier_cuit && <p className="text-[11px] text-fg-subtle tabular">{fmtCuit(r.supplier_cuit)}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        <p>{formatDate(r.issue_date)} · {formatQty(r.quantity)} {r.unit ?? "u."}</p>
                        {mailUrl(r.mail_id) ? <a href={mailUrl(r.mail_id)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-fg-subtle hover:text-fg">{numLabel(r)} <ExternalLink className="size-3" /></a>
                          : <span className="text-fg-subtle">{numLabel(r)}</span>}
                      </td>
                      <td className="px-3 py-2.5"><PriceCell r={r} /></td>
                      <td className="px-5 py-2.5 text-right text-xs">
                        <p className="text-fg-muted">{r.times} {r.times === 1 ? "compra" : "compras"}{r.times && r.times > 1 && r.min_final && r.max_final && r.min_final !== r.max_final ? ` · ${formatMoney(r.min_final)} a ${formatMoney(r.max_final)}` : ""}</p>
                        <Trend r={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : t === "renglones" ? (
          !lines.length ? <EmptyState icon={<Search />} title="No hay compras con esa búsqueda" /> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-xs text-fg-subtle">
                  <tr className="border-b border-border">
                    <th className="px-5 py-2.5 text-left font-medium">Fecha</th>
                    <th className="px-3 text-left font-medium">Producto</th>
                    <th className="px-3 text-left font-medium">Proveedor</th>
                    <th className="px-3 text-right font-medium">Cantidad</th>
                    <th className="px-3 text-right font-medium">Precio final c/u</th>
                    <th className="px-5 text-right font-medium">Total renglón</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((r) => (
                    <tr key={r.id} className="border-b border-border align-top last:border-0">
                      <td className="whitespace-nowrap px-5 py-2.5 text-xs">{formatDate(r.issue_date)}</td>
                      <td className="max-w-[320px] px-3 py-2.5">
                        <p className="leading-snug">{r.description}</p>
                        <p className="text-[11px] text-fg-subtle">{[r.code, r.list_price && `lista ${formatMoney(r.list_price)}`, r.discount_pct && Number(r.discount_pct) > 0 && `−${Number(r.discount_pct)}%`].filter(Boolean).join(" · ")}</p>
                      </td>
                      <td className="px-3 py-2.5 text-xs">{r.supplier_name || "—"}<p className="text-fg-subtle">{numLabel(r)}</p></td>
                      <td className="px-3 py-2.5 text-right tabular">{formatQty(r.quantity)} <span className="text-xs text-fg-subtle">{r.unit ?? ""}</span></td>
                      <td className="px-3 py-2.5"><PriceCell r={r} /></td>
                      <td className="px-5 py-2.5 text-right font-medium tabular">{r.unit_final ? formatMoney(Number(r.unit_final) * Number(r.quantity)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <>
            <div className="flex justify-end px-5 pt-3 text-xs">
              <Link href={sp.ocultas ? href({}) : href({ ocultas: "1" })} className="text-fg-subtle hover:text-fg">{sp.ocultas ? "Ocultar las ocultas" : "Ver también las ocultas"}</Link>
            </div>
            {!invoices.length ? <EmptyState icon={<Search />} title="No hay facturas con esa búsqueda" /> : (
              <ul className="divide-y divide-border">
                {invoices.map((r) => {
                  const n = r.supplier_invoice_items?.[0]?.count ?? 0;
                  return (
                    <li key={r.id} className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm", r.hidden && "opacity-50")}>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{r.supplier_name || "Proveedor sin identificar"} <span className="font-normal text-fg-subtle">· {numLabel(r)}{r.kind !== "factura" ? ` · ${r.kind === "nota_credito" ? "Nota de crédito" : "Nota de débito"}` : ""}</span></p>
                        <p className="text-xs text-fg-subtle">
                          {formatDate(r.issue_date)} · {n} producto{n === 1 ? "" : "s"} · {r.source === "mail" ? "del mail" : `subida a mano (${r.filename})`}
                          {r.arca_voucher_id ? " · coincide con ARCA" : " · todavía no está en ARCA"}
                          {r.quality === "revisar" && <span className="ml-1 font-medium text-warn">· revisar: los renglones no suman el total</span>}
                          {r.quality === "sin_items" && <span className="ml-1 font-medium text-warn">· no se pudieron leer los productos</span>}
                        </p>
                      </div>
                      <p className="font-semibold tabular">{formatMoney(r.total)}</p>
                      {mailUrl(r.mail_id) && <a href={mailUrl(r.mail_id)!} target="_blank" rel="noreferrer" className="text-fg-subtle hover:text-fg" title="Ver el mail"><ExternalLink className="size-3.5" /></a>}
                      {writable && <HideInvoice id={r.id} hidden={r.hidden} />}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </Card>
      <p className="mt-3 text-xs text-fg-subtle">El precio final reparte el total pagado de cada factura (IVA y percepciones incluidos) entre sus productos. El neto es sin impuestos y con los descuentos ya aplicados.</p>
    </>
  );
}
