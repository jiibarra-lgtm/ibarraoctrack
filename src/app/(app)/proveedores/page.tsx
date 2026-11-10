import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Factory, Search } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatQty } from "@/lib/format";
import { sum } from "@/lib/money";
import { cn } from "@/lib/utils";
import { SupplierDialog } from "./supplier-dialog";

export const metadata: Metadata = { title: "Proveedores" };

type P = { id: string; supplier_id: string; invoice_date: string; net_amount: string; paid: boolean; purchase_items: { description: string; unit_price: string; discount_pct: string; quantity: string }[] };
type Item = { id: string; supplier_cuit: string | null; supplier_name: string; description: string; code: string | null; unit_final: string | null; unit_net: string; quantity: string; unit: string | null; pack: number | null; issue_date: string | null; mail_id: string | null; point_of_sale: number | null; number: number | null };
type Voucher = { doc_number: string | null; issue_date: string; total: string; credit_note: boolean; point_of_sale: number; number: number; voucher_type: number };

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const mailUrl = (id: string | null) => (id ? `https://mail.google.com/mail/u/0/#all/${id}` : null);

export default async function SuppliersPage({ searchParams }: { searchParams: Promise<{ id?: string; q?: string }> }) {
  const { id, q: q0 } = await searchParams;
  const q = (q0 ?? "").trim().toLowerCase();
  const s = await requireOrg();
  const org = s.org.org_id;
  const [{ data: suppliers }, { data: purchases }, { data: itemsData }, { data: vouchersData }] = await Promise.all([
    s.supabase.from("suppliers").select("*").eq("org_id", org).order("name").limit(5000),
    s.supabase.from("purchases").select("id, supplier_id, invoice_date, net_amount, due_date, paid, purchase_items(description, unit_price, discount_pct, quantity)")
      .eq("org_id", org).eq("status", "confirmada").order("invoice_date", { ascending: false }).limit(2000),
    s.supabase.from("supplier_items_overview").select("id, supplier_cuit, supplier_name, description, code, unit_final, unit_net, quantity, unit, pack, issue_date, mail_id, point_of_sale, number")
      .eq("org_id", org).order("issue_date", { ascending: false, nullsFirst: false }).limit(8000),
    s.supabase.from("arca_vouchers").select("doc_number, issue_date, total, credit_note, point_of_sale, number, voucher_type")
      .eq("org_id", org).eq("direction", "recibido").order("issue_date", { ascending: false }).limit(10000),
  ]);

  const bySup = new Map<string, P[]>();
  ((purchases ?? []) as P[]).forEach((p) => bySup.set(p.supplier_id, [...(bySup.get(p.supplier_id) ?? []), p]));
  const itemsByCuit = new Map<string, Item[]>();
  ((itemsData ?? []) as Item[]).forEach((it) => { const k = digits(it.supplier_cuit); if (k) itemsByCuit.set(k, [...(itemsByCuit.get(k) ?? []), it]); });
  const vByCuit = new Map<string, Voucher[]>();
  ((vouchersData ?? []) as Voucher[]).forEach((v) => { const k = digits(v.doc_number); if (k) vByCuit.set(k, [...(vByCuit.get(k) ?? []), v]); });

  const rows = (suppliers ?? []).map((sp) => {
    const cuit = digits(sp.cuit);
    const ps = bySup.get(sp.id) ?? [];
    const vs = vByCuit.get(cuit) ?? [];
    const its = itemsByCuit.get(cuit) ?? [];
    const products = new Set(its.map((i) => norm(i.description))).size + new Set(ps.flatMap((p) => p.purchase_items.map((i) => norm(i.description)))).size;
    const arcaTotal = vs.reduce((a, v) => a + (v.credit_note ? -1 : 1) * Number(v.total), 0);
    const last = [ps[0]?.invoice_date, vs[0]?.issue_date, its[0]?.issue_date].filter(Boolean).sort().pop() ?? null;
    return { sp, cuit, ps, vs, its, products, arcaTotal, last };
  });
  const filtered = rows
    .filter((r) => !q || r.sp.name.toLowerCase().includes(q) || r.cuit.includes(q.replace(/\D/g, "") || "§") || r.its.some((i) => i.description.toLowerCase().includes(q)))
    .sort((a, b) => (b.last ?? "").localeCompare(a.last ?? "") || a.sp.name.localeCompare(b.sp.name));
  const writable = canWrite(s.org.role);
  const sel = rows.find((x) => x.sp.id === id);

  // productos del proveedor seleccionado: último precio de cada uno
  const selProducts = sel ? (() => {
    const m = new Map<string, { it: Item; times: number; prev: number | null }>();
    for (const it of sel.its) {
      const k = norm(it.description);
      const cur = m.get(k);
      if (!cur) m.set(k, { it, times: 1, prev: null });
      else { cur.times++; if (cur.prev === null && it.unit_final) cur.prev = Number(it.unit_final); }
    }
    return [...m.values()];
  })() : [];
  const manual = sel ? sel.ps.flatMap((p) => p.purchase_items.map((it, k) => ({ key: `${p.id}-${k}`, date: p.invoice_date, it }))) : [];
  const href = (p: Record<string, string>) => `/proveedores?${new URLSearchParams({ ...(q ? { q } : {}), ...p })}`;

  return (
    <>
      <PageHeader title="Proveedores" description="Lo que le compraste a cada uno: productos con su último precio (de las facturas en PDF del mail) y comprobantes de ARCA." actions={writable && <SupplierDialog />} />
      <div className={cn("grid gap-5", sel && "lg:grid-cols-[minmax(0,1fr)_480px]")}>
        <Card className="self-start overflow-hidden">
          <form className="relative border-b border-border px-4 py-3 sm:px-5">
            {id && <input type="hidden" name="id" value={id} />}
            <Search className="pointer-events-none absolute left-7 top-1/2 size-4 -translate-y-1/2 text-fg-subtle sm:left-8" />
            <input name="q" defaultValue={q0 ?? ""} placeholder="Buscar proveedor, CUIT o producto…"
              className="h-9 w-full rounded-full border border-card-border bg-field pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
          </form>
          {!filtered.length ? <EmptyState icon={<Factory />} title={rows.length ? "No encontré ese proveedor" : "Sin proveedores"} description={rows.length ? undefined : "Se crean solos al cargar facturas, o agregalos acá."} /> : (
            <ul className="max-h-[75vh] divide-y divide-border overflow-y-auto">
              {filtered.slice(0, 400).map(({ sp, ps, vs, products, arcaTotal, last }) => {
                const unpaid = ps.filter((p) => !p.paid).length;
                return (
                  <li key={sp.id} className={cn("flex items-center gap-3 px-4 py-3 sm:px-5", id === sp.id && "bg-info-soft/50")}>
                    <Link href={href({ id: sp.id })} className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{sp.name} {sp.rating ? <span className="text-xs text-warn">{"★".repeat(sp.rating)}</span> : null}</p>
                      <p className="truncate text-xs text-fg-subtle">{[sp.cuit, last ? `última compra ${formatDate(last)}` : "sin compras", products ? `${products} producto${products === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</p>
                    </Link>
                    <div className="hidden text-right text-xs sm:block">
                      <p className="text-sm font-medium tabular">{formatMoney(arcaTotal || Number(sum(ps.map((p) => p.net_amount))))}</p>
                      <p className="text-fg-subtle">{vs.length ? `${vs.length} comprobante${vs.length === 1 ? "" : "s"}` : `${ps.length} compras`}{unpaid ? ` · ${unpaid} impagas` : ""}</p>
                    </div>
                    {writable && <SupplierDialog supplier={sp} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {sel && (
          <div className="flex flex-col gap-5 self-start">
            <Card>
              <CardHeader title={sel.sp.name} description="Productos comprados · último precio final por unidad (con IVA y percepciones)" />
              {!selProducts.length && !manual.length ? (
                <p className="px-5 pb-5 text-sm text-fg-subtle">
                  Todavía no hay productos de este proveedor. Aparecen solos cuando llega su factura en PDF al mail (con el script de Gmail actualizado) o si la subís en{" "}
                  <Link href="/precios-proveedores" className="underline">Precios de proveedores</Link>.
                </p>
              ) : (
                <ul className="max-h-[55vh] divide-y divide-border overflow-y-auto">
                  {selProducts.map(({ it, times, prev }) => {
                    const fin = it.unit_final ? Number(it.unit_final) : null;
                    const pct = fin && prev ? ((fin - prev) / prev) * 100 : null;
                    return (
                      <li key={it.id} className="flex items-start justify-between gap-3 px-5 py-2.5 text-sm">
                        <div className="min-w-0 flex-1">
                          <p className="leading-snug">{it.description}</p>
                          <p className="text-[11px] text-fg-subtle">
                            {formatDate(it.issue_date)} · {formatQty(it.quantity)} {it.unit ?? "u."}{times > 1 ? ` · ${times} compras` : ""}
                            {mailUrl(it.mail_id) && <a href={mailUrl(it.mail_id)!} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center text-fg-subtle hover:text-fg"><ExternalLink className="size-3" /></a>}
                          </p>
                        </div>
                        <div className="shrink-0 text-right tabular">
                          <p className="font-semibold">{fin !== null ? formatMoney(fin) : formatMoney(it.unit_net)}</p>
                          {it.pack && fin !== null && <p className="text-[11px] text-fg-muted">{formatMoney(fin / it.pack)} c/u (×{it.pack})</p>}
                          {pct !== null && Math.abs(pct) >= 0.5 && <p className={cn("text-[11px] font-medium", pct > 0 ? "text-danger" : "text-accent")}>{pct > 0 ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}%</p>}
                        </div>
                      </li>
                    );
                  })}
                  {manual.map(({ key, date, it }) => (
                    <li key={key} className="flex items-baseline justify-between gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1 truncate">{it.description}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">{formatDate(date)}</span>
                      <span className="w-28 shrink-0 text-right tabular">{formatMoney((Number(it.unit_price) * (1 - Number(it.discount_pct) / 100)).toFixed(2))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {selProducts.length > 0 && (
                <div className="border-t border-border px-5 py-2.5 text-xs">
                  <Link href={`/precios-proveedores?${new URLSearchParams({ q: sel.sp.name })}`} className="text-fg-subtle hover:text-fg">Ver todas las compras de este proveedor →</Link>
                </div>
              )}
            </Card>

            {sel.vs.length > 0 && (
              <Card>
                <CardHeader title="Comprobantes en ARCA" description={`${sel.vs.length} recibidos · ${formatMoney(sel.arcaTotal)}`} />
                <ul className="max-h-[40vh] divide-y divide-border overflow-y-auto">
                  {sel.vs.slice(0, 200).map((v) => {
                    const hasItems = sel.its.some((i) => i.point_of_sale === v.point_of_sale && i.number === v.number);
                    return (
                      <li key={`${v.voucher_type}-${v.point_of_sale}-${v.number}`} className="flex items-baseline justify-between gap-3 px-5 py-2 text-sm">
                        <span className="text-xs text-fg-subtle">{formatDate(v.issue_date)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{v.credit_note ? "NC" : "FC"} {String(v.point_of_sale).padStart(5, "0")}-{String(v.number).padStart(8, "0")}{hasItems ? "" : <span className="ml-1 font-sans text-[11px] text-fg-subtle">· sin PDF</span>}</span>
                        <span className={cn("shrink-0 tabular", v.credit_note && "text-danger")}>{v.credit_note ? "−" : ""}{formatMoney(v.total)}</span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>
        )}
      </div>
    </>
  );
}
