import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { invoiceLabel, type CollectionRow, type InvoiceBalance, type PoBilling } from "@/lib/billing";

export type InboxRow = {
  id: string; org_id: string; bac_number: string; unit_code: string; convenio_number: string | null; convenio_name: string | null;
  process_number: string | null; process_name: string | null; notified_at: string | null; perfected_at: string | null;
  prd_number: string | null; prd_at: string | null; dismissed: boolean; first_seen_at: string;
  purchase_order_id: string | null; po_status: string | null; po_total: string | null; po_currency: string | null; unit_name: string | null; loaded: boolean;
};

export type Step = { key: string; label: string; at: string | null; done: boolean; note?: string };
export type TrackEvent = { at: string; kind: "mail" | "aviso" | "sistema" | "entrega" | "factura" | "cobro"; title: string; detail?: string; tags?: string[]; href?: string };

export const MAIL_KIND_LABEL: Record<string, string> = {
  oc_generada: "BAC avisó la orden", oc_perfeccionada: "BAC: orden perfeccionada", prd: "SIGAF: Parte de Recepción emitido",
  pago: "SIGAF: pago acreditado", publicacion: "BAC: pliego publicado",
};

/** Seguimiento completo de una OC: pasos (avisada → cobrada) y línea de tiempo de mails y sistema. */
export async function loadTrack(sb: SupabaseClient, orgId: string, bacNumber: string) {
  const oc = bacNumber.toUpperCase();
  const [{ data: inbox }, { data: po }] = await Promise.all([
    sb.from("bac_inbox_overview").select("*").eq("org_id", orgId).eq("bac_number", oc).maybeSingle(),
    sb.from("purchase_orders_overview").select("*").eq("org_id", orgId).ilike("bac_number", oc).maybeSingle(),
  ]);
  if (!inbox && !po) return null;
  const poId = po?.id as string | undefined;

  const [events, mails, deliv, deliveries, billing, invoices, collections, docs] = await Promise.all([
    sb.from("bac_mail_events").select("kind, received_at, subject, data, result").eq("org_id", orgId).eq("data->>bac_number", oc).order("received_at"),
    sb.from("mail_messages").select("id, subject, from_name, from_email, received_at, category, snippet, attachments").eq("org_id", orgId).eq("bac_number", oc).order("received_at"),
    poId ? sb.from("po_delivery_summary").select("*").eq("purchase_order_id", poId).maybeSingle() : Promise.resolve({ data: null }),
    poId ? sb.from("deliveries").select("id, actual_date, planned_date, status, remito_number").eq("purchase_order_id", poId).order("planned_date") : Promise.resolve({ data: [] }),
    poId ? sb.from("po_billing").select("*").eq("purchase_order_id", poId).maybeSingle() : Promise.resolve({ data: null }),
    poId ? sb.from("invoice_balances").select("*").eq("purchase_order_id", poId).eq("status", "emitida").order("issue_date") : Promise.resolve({ data: [] }),
    poId ? sb.from("collections").select("*").eq("purchase_order_id", poId).eq("status", "confirmado").order("payment_date") : Promise.resolve({ data: [] }),
    poId ? sb.from("documents").select("doc_type, created_at").eq("purchase_order_id", poId) : Promise.resolve({ data: [] }),
  ]);

  const inv = (invoices.data ?? []) as InvoiceBalance[];
  const cols = (collections.data ?? []) as CollectionRow[];
  const b = billing.data as PoBilling | null;
  const d = deliv.data as { delivered_pct: string; last_delivery_date: string | null } | null;
  const prdDoc = (docs.data ?? []).find((x) => x.doc_type === "prd");
  const deliveredPct = Number(d?.delivered_pct ?? 0);

  const steps: Step[] = [
    { key: "avisada", label: "Avisada", at: inbox?.notified_at ?? inbox?.first_seen_at ?? null, done: !!inbox },
    { key: "perfeccionada", label: "Perfeccionada", at: inbox?.perfected_at ?? (po?.perfected_date ?? null), done: !!(inbox?.perfected_at || po?.perfected_date) },
    { key: "cargada", label: "Cargada", at: po?.created_at ?? null, done: !!po },
    { key: "entregada", label: "Entregada", at: deliveredPct >= 100 ? d?.last_delivery_date ?? null : null, done: deliveredPct >= 100, note: deliveredPct > 0 && deliveredPct < 100 ? `${deliveredPct.toFixed(0)}%` : undefined },
    { key: "prd", label: "PRD", at: inbox?.prd_at ?? prdDoc?.created_at ?? null, done: !!(inbox?.prd_number || prdDoc) },
    { key: "facturada", label: "Facturada", at: Number(b?.invoiced_pct ?? 0) >= 100 ? inv[inv.length - 1]?.issue_date ?? null : null, done: Number(b?.invoiced_pct ?? 0) >= 100, note: Number(b?.invoiced_pct ?? 0) > 0 && Number(b?.invoiced_pct ?? 0) < 100 ? `${Number(b?.invoiced_pct).toFixed(0)}%` : undefined },
    { key: "cobrada", label: "Cobrada", at: Number(b?.collected_pct ?? 0) >= 100 ? cols[cols.length - 1]?.payment_date ?? null : null, done: Number(b?.collected_pct ?? 0) >= 100, note: Number(b?.collected_pct ?? 0) > 0 && Number(b?.collected_pct ?? 0) < 100 ? `${Number(b?.collected_pct).toFixed(0)}%` : undefined },
  ];

  const tl: TrackEvent[] = [];
  (events.data ?? []).forEach((e) => tl.push({ at: e.received_at, kind: "aviso", title: MAIL_KIND_LABEL[e.kind] ?? e.kind,
    detail: e.kind === "prd" ? `Parte N° ${(e.data as { prd_number?: string }).prd_number}` : e.kind === "oc_generada" ? (e.data as { convenio_name?: string }).convenio_name ?? undefined : e.result ?? undefined,
    tags: [e.result ?? ""].filter(Boolean) }));
  (mails.data ?? []).filter((m) => !["orden", "perfeccionamiento", "prd", "pago"].includes(m.category) || (m.attachments as unknown[]).length)
    .forEach((m) => tl.push({ at: m.received_at, kind: "mail", title: m.subject || "(sin asunto)", detail: `${m.from_name ?? m.from_email} · ${m.snippet ?? ""}`.slice(0, 220),
      tags: (m.attachments as { name: string }[]).map((a) => a.name).slice(0, 3), href: `/correos?id=${m.id}` }));
  if (po) tl.push({ at: po.created_at, kind: "sistema", title: "Orden cargada en el sistema", detail: po.source === "importacion" ? "Importada del PDF de BAC" : "Carga manual", href: `/ordenes/${poId}` });
  (deliveries.data ?? []).filter((x) => x.actual_date).forEach((x) => tl.push({ at: `${x.actual_date}T12:00:00-03:00`, kind: "entrega", title: "Entrega realizada", detail: x.remito_number ? `Remito ${x.remito_number}` : undefined, href: `/ordenes/${poId}?tab=entregas` }));
  inv.forEach((i) => tl.push({ at: `${i.issue_date}T12:00:00-03:00`, kind: "factura", title: `Factura ${invoiceLabel(i)} emitida`, detail: `Total $ ${Number(i.total_amount).toLocaleString("es-AR", { minimumFractionDigits: 2 })}`, href: `/ordenes/${poId}?tab=facturacion` }));
  cols.forEach((c) => tl.push({ at: `${c.payment_date}T12:00:00-03:00`, kind: "cobro", title: "Cobro registrado", detail: `$ ${Number(c.amount_received).toLocaleString("es-AR", { minimumFractionDigits: 2 })}${c.reference ? ` · ${c.reference}` : ""}`, href: `/ordenes/${poId}?tab=facturacion` }));
  tl.sort((a, b2) => a.at.localeCompare(b2.at));

  const daysSince = inbox?.notified_at ? Math.floor((Date.now() - new Date(inbox.notified_at).getTime()) / 864e5) : null;
  return { oc, daysSince, inbox: inbox as InboxRow | null, po, steps, timeline: tl, billing: b, deliveredPct, mails: mails.data ?? [] };
}
