import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayISO, formatDate, formatMoney } from "@/lib/format";
import { invoiceLabel, type InvoiceBalance, type PoBilling } from "@/lib/billing";

export type AlertLevel = "danger" | "warn" | "info";
export type AlertKind = "bac" | "entrega" | "cobranza" | "facturacion" | "documentacion" | "margen" | "pagos" | "importacion" | "cierre";
export type Alert = { id: string; level: AlertLevel; kind: AlertKind; title: string; detail: string; href: string; amount?: string; date?: string | null };

export const KIND_LABEL: Record<AlertKind, string> = {
  bac: "Órdenes sin cargar",
  entrega: "Entregas", cobranza: "Cobranzas", facturacion: "Facturación", documentacion: "Documentación",
  margen: "Márgenes", pagos: "Pagos a proveedores", importacion: "Importaciones", cierre: "Cierre",
};

const ACTIVE = ["recibida", "perfeccionada", "en_ejecucion", "completada"];
const addDays = (iso: string, d: number) => new Date(new Date(`${iso}T12:00:00Z`).getTime() + d * 864e5).toISOString().slice(0, 10);

/**
 * Alertas calculadas al momento con datos reales (no se guardan): entregas atrasadas o próximas,
 * facturas vencidas, órdenes entregadas sin facturar, documentación faltante, márgenes bajos,
 * compras vencidas sin pagar, importaciones trabadas y órdenes listas para cerrar.
 */
export async function computeAlerts(sb: SupabaseClient, orgId: string): Promise<Alert[]> {
  const today = todayISO();
  const soon = addDays(today, 7);
  const [pos, deliv, billing, profit, invoices, docs, payables, jobs, inbox] = await Promise.all([
    sb.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, status, due_date, currency").eq("org_id", orgId).neq("status", "anulada").limit(2000),
    sb.from("po_delivery_summary").select("purchase_order_id, delivered_pct, is_late, due_date").eq("org_id", orgId).limit(2000),
    sb.from("po_billing").select("*").eq("org_id", orgId).limit(2000),
    sb.from("po_profitability").select("purchase_order_id, operating_margin_estimated, min_margin_pct, direct_cost_estimated").eq("org_id", orgId).limit(2000),
    sb.from("invoice_balances").select("*").eq("org_id", orgId).eq("collection_status", "vencida").limit(1000),
    sb.from("documents").select("purchase_order_id, doc_type").eq("org_id", orgId).not("purchase_order_id", "is", null).limit(10000),
    sb.from("purchases").select("id, number, point_of_sale, due_date, total_amount, currency, suppliers(name)").eq("org_id", orgId).eq("status", "confirmada").eq("paid", false).lt("due_date", today).limit(500),
    sb.from("import_jobs").select("id, kind, status, created_at, documents(title)").eq("org_id", orgId).in("status", ["revision", "error"]).limit(200),
    sb.from("bac_inbox_overview").select("bac_number, unit_name, unit_code, notified_at, first_seen_at, prd_number, loaded, dismissed").eq("org_id", orgId).limit(3000),
  ]);
  const prdByOc = new Map((inbox.data ?? []).filter((r) => r.prd_number).map((r) => [String(r.bac_number), String(r.prd_number)]));

  const out: Alert[] = [];
  const po = new Map((pos.data ?? []).map((p) => [p.id as string, p]));
  const label = (id: string) => { const p = po.get(id); return p ? `${p.bac_number ?? p.display_number}` : "Orden"; };
  const cust = (id: string) => po.get(id)?.customer_name ?? "—";
  const dl = new Map((deliv.data ?? []).map((d) => [d.purchase_order_id as string, d]));
  const bl = new Map(((billing.data ?? []) as PoBilling[]).map((b) => [b.purchase_order_id, b]));
  const docTypes = new Map<string, Set<string>>();
  (docs.data ?? []).forEach((d) => { const k = d.purchase_order_id as string; docTypes.set(k, (docTypes.get(k) ?? new Set()).add(d.doc_type as string)); });

  for (const p of pos.data ?? []) {
    const id = p.id as string;
    const d = dl.get(id);
    const b = bl.get(id);
    const delivered = Number(d?.delivered_pct ?? 0);
    const href = `/ordenes/${id}`;
    if (!ACTIVE.includes(p.status as string)) continue;

    // Entregas
    if (d?.is_late) {
      out.push({ id: `late-${id}`, level: "danger", kind: "entrega", title: `Entrega atrasada · ${label(id)}`, detail: `${cust(id)} · vencía ${formatDate(p.due_date)} · entregado ${delivered.toFixed(0)}%`, href: `${href}?tab=entregas`, date: p.due_date });
    } else if (p.due_date && p.due_date >= today && p.due_date <= soon && delivered < 100) {
      out.push({ id: `soon-${id}`, level: "warn", kind: "entrega", title: `Entrega vence pronto · ${label(id)}`, detail: `${cust(id)} · vence ${formatDate(p.due_date)} · entregado ${delivered.toFixed(0)}%`, href: `${href}?tab=entregas`, date: p.due_date });
    }

    // Facturación pendiente de lo entregado
    if (delivered >= 100 && b && Number(b.to_invoice) > 0) {
      out.push({ id: `inv-${id}`, level: "warn", kind: "facturacion", title: `Entregada sin facturar · ${label(id)}`, detail: `${cust(id)} · falta facturar ${formatMoney(b.to_invoice, b.currency)}`, href: `${href}?tab=facturacion`, amount: b.to_invoice });
    }

    // Documentación
    const t = docTypes.get(id) ?? new Set<string>();
    if (delivered > 0) {
      const missing = [
        !t.has("remito_oficial") && !t.has("remito") && "remito oficial",
        delivered >= 100 && !t.has("prd") && !prdByOc.has(String(p.bac_number ?? "").toUpperCase()) && "PRD",
      ].filter(Boolean) as string[];
      if (b && Number(b.invoiced_amount) > 0 && !t.has("factura_emitida")) missing.push("PDF de la factura");
      if (missing.length) {
        out.push({ id: `doc-${id}`, level: "info", kind: "documentacion", title: `Falta documentación · ${label(id)}`, detail: `${cust(id)} · falta ${missing.join(", ")}`, href: `${href}?tab=documentos` });
      }
    }

    // Lista para cerrar
    if (delivered >= 100 && b && Number(b.order_total) > 0 && Number(b.to_invoice) <= 0 && Number(b.to_collect) <= 0) {
      out.push({ id: `close-${id}`, level: "info", kind: "cierre", title: `Lista para cerrar · ${label(id)}`, detail: `${cust(id)} · entregada, facturada y cobrada`, href });
    }
  }

  // Órdenes avisadas por BAC que no están cargadas
  for (const r of inbox.data ?? []) {
    if (r.loaded || r.dismissed) continue;
    out.push({ id: `bac-${r.bac_number}`, level: "warn", kind: "bac", title: `OC sin cargar · ${r.bac_number}`,
      detail: `${r.unit_name ?? `Unidad ${r.unit_code}`} · avisada ${formatDate(r.notified_at ?? r.first_seen_at)}`, href: `/bac/${r.bac_number}`, date: r.notified_at ?? r.first_seen_at });
  }

  // Márgenes
  for (const r of profit.data ?? []) {
    const id = r.purchase_order_id as string;
    const p = po.get(id);
    if (!p || !ACTIVE.includes(p.status as string) || r.operating_margin_estimated === null || r.direct_cost_estimated === null) continue;
    const m = Number(r.operating_margin_estimated), min = Number(r.min_margin_pct);
    if (m < 0) out.push({ id: `neg-${id}`, level: "danger", kind: "margen", title: `Pierde plata · ${label(id)}`, detail: `${cust(id)} · margen ${m.toFixed(1)}%`, href: `/ordenes/${id}?tab=compras` });
    else if (m < min) out.push({ id: `low-${id}`, level: "warn", kind: "margen", title: `Margen bajo · ${label(id)}`, detail: `${cust(id)} · margen ${m.toFixed(1)}% (mínimo ${min}%)`, href: `/ordenes/${id}?tab=compras` });
  }

  // Cobranzas vencidas
  for (const i of (invoices.data ?? []) as InvoiceBalance[]) {
    out.push({ id: `due-${i.invoice_id}`, level: "danger", kind: "cobranza", title: `Factura vencida · ${invoiceLabel(i)}`,
      detail: `${cust(i.purchase_order_id)} · ${label(i.purchase_order_id)} · ${i.days_overdue} días de atraso`, href: "/cobranzas", amount: i.balance, date: i.due_date });
  }

  // Pagos a proveedores vencidos
  for (const p of payables.data ?? []) {
    out.push({ id: `pay-${p.id}`, level: "warn", kind: "pagos", title: `Pago vencido · ${(p.suppliers as unknown as { name: string } | null)?.name ?? "Proveedor"}`,
      detail: `Factura ${p.point_of_sale ? `${p.point_of_sale}-` : ""}${p.number ?? "s/n"} · venció ${formatDate(p.due_date)}`, href: "/finanzas", amount: String(p.total_amount), date: p.due_date });
  }

  // Importaciones
  for (const j of jobs.data ?? []) {
    const base = j.kind === "factura_proveedor" ? "/compras/importar" : j.kind === "remito" ? "/entregas/remito" : "/ordenes/importar";
    out.push({ id: `job-${j.id}`, level: j.status === "error" ? "warn" : "info", kind: "importacion",
      title: j.status === "error" ? "Importación con error" : "Importación para revisar", detail: (j.documents as unknown as { title: string } | null)?.title ?? "Documento", href: `${base}/${j.id}` });
  }

  const rank: Record<AlertLevel, number> = { danger: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level] || String(a.date ?? "9").localeCompare(String(b.date ?? "9")));
}
