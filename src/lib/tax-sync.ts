import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { arcaAuth, getPersona, getVoucher, lastVoucher, PADRON_SERVICE, serviceAuth, type ArcaRpc, type TicketRpc } from "@/lib/arca";
import { VAT_RATES } from "@/lib/einvoice";

export function arcaRpcs(sb: SupabaseClient, org: string) {
  const rpc: ArcaRpc = async (action, data = {}) => {
    const { data: d, error } = await sb.rpc("arca_conn", { p_action: action, p_org: org, p_data: data });
    if (error) throw new Error(error.message);
    return (d ?? {}) as Record<string, unknown>;
  };
  const tickets: TicketRpc = async (service, data) => {
    const { data: d, error } = await sb.rpc("arca_ticket", { p_org: org, p_service: service, p_data: data ?? null });
    if (error) throw new Error(error.message);
    return (d ?? {}) as Record<string, unknown>;
  };
  return { rpc, tickets };
}

const TYPES = [1, 3, 6, 8, 2, 7];

/** Trae de ARCA los comprobantes emitidos en el punto de venta de la app que todavía no están en Impuestos. */
export async function syncEmitted(sb: SupabaseClient, org: string, max = 60) {
  const { rpc } = arcaRpcs(sb, org);
  try {
    const auth = await arcaAuth(rpc);
    if (!auth.pointOfSale) throw new Error("Falta el punto de venta");
    const { data: have } = await sb.rpc("arca_emitted_max", { p_org: org, p_pv: auth.pointOfSale });
    const known = (have ?? {}) as Record<string, number>;
    const rows: Record<string, unknown>[] = [];
    for (const type of TYPES) {
      if (rows.length >= max) break;
      const last = await lastVoucher(auth, auth.pointOfSale, type);
      for (let n = Number(known[String(type)] ?? 0) + 1; n <= last && rows.length < max; n++) {
        const v = await getVoucher(auth, auth.pointOfSale, type, n);
        if (!v?.cae || !v.date) continue;
        const vat_detail: Record<string, { neto: number; iva: number }> = {};
        for (const a of v.ivas) vat_detail[String(VAT_RATES[a.id] ?? 21)] = { neto: a.base, iva: a.amount };
        rows.push({
          issue_date: `${v.date.slice(0, 4)}-${v.date.slice(4, 6)}-${v.date.slice(6, 8)}`, voucher_type: type, point_of_sale: auth.pointOfSale, number: n, cae: v.cae,
          doc_type: String(v.docType), doc_number: v.docNumber, net: v.net, untaxed: v.untaxed, exempt: v.exempt, other_taxes: v.otherTaxes, vat: v.vat,
          total: v.total, currency: v.currency, exchange_rate: v.rate, vat_detail,
        });
      }
    }
    let added = 0;
    if (rows.length) {
      const { data, error } = await sb.rpc("arca_ingest_wsfe", { p_org: org, p_rows: rows });
      if (error) throw new Error(error.message);
      added = Number(data ?? 0);
    }
    await sb.rpc("tax_status_save", { p_org: org, p: { emitted_synced: true, emitted_sync_error: null } });
    return { added };
  } catch (e) {
    await sb.rpc("tax_status_save", { p_org: org, p: { emitted_synced: true, emitted_sync_error: (e as Error).message.slice(0, 400) } });
    throw e;
  }
}

/** Foto del padrón propio (para avisar si cambia algo: condición de IVA, impuestos, domicilio). */
export async function refreshPadron(sb: SupabaseClient, org: string) {
  const { rpc, tickets } = arcaRpcs(sb, org);
  try {
    const auth = await serviceAuth(rpc, tickets, PADRON_SERVICE);
    const p = await getPersona(auth, auth.cuit);
    await sb.rpc("tax_status_save", { p_org: org, p: { padron: p } });
    return p;
  } catch (e) {
    await sb.rpc("tax_status_save", { p_org: org, p: { padron_error: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}

/** Datos de un cliente por CUIT desde el padrón de ARCA. */
export async function lookupPersona(sb: SupabaseClient, org: string, cuit: string) {
  const { rpc, tickets } = arcaRpcs(sb, org);
  const auth = await serviceAuth(rpc, tickets, PADRON_SERVICE);
  return getPersona(auth, cuit);
}
