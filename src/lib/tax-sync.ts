import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { arcaAuth, getPersona, getVoucher, lastVoucher, PADRON_SERVICE, serviceAuth, type ArcaRpc, type TicketRpc } from "@/lib/arca";
import { VAT_RATES } from "@/lib/einvoice";
import { parseApocrifos } from "@/lib/apocrifos";

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

/**
 * Padrón de proveedores (una vez por mes): estado del CUIT y condición de IVA de cada proveedor que facturó en el último año.
 * Revisa de a `max` por vez, empezando por los que nunca se revisaron. Si ARCA no da acceso, guarda el error y corta.
 */
export async function refreshSupplierPadron(sb: SupabaseClient, org: string, max = 25) {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const retry = new Date(Date.now() - 864e5).toISOString();
  const [{ data: risks }, { data: done }] = await Promise.all([
    sb.from("supplier_risks").select("cuit, name, last_date").eq("org_id", org).order("last_date", { ascending: false }).limit(500),
    sb.from("supplier_padron").select("cuit, checked_at, error").eq("org_id", org).limit(1000),
  ]);
  const seen = new Map(((done ?? []) as { cuit: string; checked_at: string; error: string | null }[]).map((x) => [x.cuit, x]));
  const own = new Set<string>();
  const todo = ((risks ?? []) as { cuit: string; name: string }[]).filter((r) => {
    if (own.has(r.cuit)) return false;
    own.add(r.cuit);
    const s = seen.get(r.cuit);
    return !s || s.checked_at < (s.error ? retry : since);
  }).slice(0, max);
  if (!todo.length) return { checked: 0, error: null as string | null };
  const { rpc, tickets } = arcaRpcs(sb, org);
  const rows: Record<string, unknown>[] = [];
  let error: string | null = null;
  try {
    const auth = await serviceAuth(rpc, tickets, PADRON_SERVICE);
    for (const t of todo) {
      try {
        const p = await getPersona(auth, t.cuit);
        rows.push({ cuit: t.cuit, name: p.name, status: p.status ?? "ACTIVO", iva: p.monotributo ? `Monotributo ${p.monotributo}` : p.ivaCondition === 1 ? "Responsable inscripto" : p.ivaCondition === 4 ? "Exento" : String(p.ivaCondition ?? ""), data: p, error: null });
      } catch (e) {
        const msg = (e as Error).message;
        // "no encontró ese CUIT" o un CUIT inactivo: es un dato, no un error del servicio
        if (/no encontr|inexistente|inactiv|baja/i.test(msg)) rows.push({ cuit: t.cuit, status: /inactiv|baja/i.test(msg) ? "INACTIVO" : "NO ENCONTRADO", error: msg.slice(0, 300) });
        else { error = msg; break; }
      }
    }
  } catch (e) { error = (e as Error).message; }
  if (error && !rows.length) rows.push({ cuit: todo[0].cuit, error: error.slice(0, 300) });
  if (rows.length) await sb.rpc("supplier_padron_save", { p_org: org, p_rows: rows });
  return { checked: rows.filter((r) => !r.error || r.status).length, error };
}

/** URL pública de ARCA con la base de contribuyentes con facturas apócrifas (ZIP con un TXT/CSV). */
export const APOCRIFOS_URL = "https://servicioscf.afip.gob.ar/Facturacion/facturasApocrifas/DownloadFile.aspx";

/** Baja la base de apócrifos de ARCA y la guarda (una vez por mes; si falla, queda el error para mostrarlo). */
export async function loadApocrifos(sb: SupabaseClient) {
  try {
    const res = await fetch(APOCRIFOS_URL, { signal: AbortSignal.timeout(25000), headers: { "user-agent": "Mozilla/5.0 OC Track" } });
    if (!res.ok) throw new Error(`ARCA respondió ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    let text: string;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const { unzipSync } = await import("fflate");
      const files = unzipSync(buf);
      text = Object.values(files).map((f) => new TextDecoder("latin1").decode(f)).join("\n");
    } else text = new TextDecoder("latin1").decode(buf);
    const rows = parseApocrifos(text);
    if (rows.length < 50) throw new Error("El archivo de ARCA no trajo la lista esperada");
    for (let i = 0; i < rows.length; i += 5000) {
      const { error } = await sb.rpc("arca_apocrifos_load", { p_rows: rows.slice(i, i + 5000), p_first: i === 0, p_last: i + 5000 >= rows.length });
      if (error) throw new Error(error.message);
    }
    return { rows: rows.length };
  } catch (e) {
    await sb.rpc("arca_apocrifos_load", { p_rows: [], p_first: false, p_last: false, p_error: (e as Error).message.slice(0, 300) });
    throw e;
  }
}

/** Mantenimiento automático al abrir Impuestos y ARCA: vínculos factura ↔ OC, padrón de proveedores (mensual) y apócrifos (mensual). */
export async function autoMaintainArca(sb: SupabaseClient, org: string, hasCert: boolean) {
  await sb.rpc("arca_autolink", { p_org: org });
  const { data: meta } = await sb.from("arca_apocrifos_meta").select("loaded_at, tried_at").maybeSingle();
  const old = (iso: string | null | undefined, days: number) => !iso || Date.now() - Date.parse(iso) > days * 864e5;
  const m = meta as { loaded_at: string | null; tried_at: string | null } | null;
  if (old(m?.loaded_at, 30) && old(m?.tried_at, 1)) await loadApocrifos(sb).catch(() => null);
  if (!hasCert) return;
  // Si ARCA rechazó el servicio en las últimas 24 h, no insistir en cada apertura
  const { data: fail } = await sb.from("supplier_padron").select("cuit").eq("org_id", org).not("error", "is", null).is("status", null)
    .gte("checked_at", new Date(Date.now() - 864e5).toISOString()).limit(1);
  if (!fail?.length) await refreshSupplierPadron(sb, org).catch(() => null);
}
