"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { arcaAuth, cleanCuit, generateCsr, inspectCertificate, lastVoucher, type ArcaRpc } from "@/lib/arca";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function ctx() {
  const s = await requireOrg();
  const rpc: ArcaRpc = async (action, data = {}) => {
    const { data: d, error } = await s.supabase.rpc("arca_conn", { p_action: action, p_org: s.org.org_id, p_data: data });
    if (error) throw new Error(error.message);
    return (d ?? {}) as Record<string, unknown>;
  };
  return { s, rpc };
}
const fail = (e: unknown) => ({ ok: false as const, error: (e as Error).message });

export async function saveArcaConfig(cuit: string, pointOfSale: string): Promise<R> {
  try {
    const { rpc } = await ctx();
    await rpc("set_config", { cuit: cleanCuit(cuit), point_of_sale: pointOfSale.trim() });
    revalidatePath("/configuracion");
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Genera la clave privada (queda guardada) y devuelve el pedido de certificado para subir a ARCA. */
export async function generateArcaCsr(): Promise<R<{ csr: string; filename: string }>> {
  try {
    const { s, rpc } = await ctx();
    const st = await rpc("status");
    if (!st.cuit) return { ok: false, error: "Primero guardá el CUIT y el punto de venta" };
    const { data: org } = await s.supabase.from("organizations").select("legal_name, name").eq("id", s.org.org_id).single();
    const alias = "octrack";
    const { privateKeyPem, csrPem } = generateCsr(String(st.cuit), alias, org?.legal_name || org?.name || "Empresa");
    await rpc("save_csr", { private_key: privateKeyPem, csr: csrPem, alias });
    revalidatePath("/configuracion");
    return { ok: true, csr: csrPem, filename: `pedido-${alias}-${st.cuit}.csr` };
  } catch (e) { return fail(e); }
}

export async function downloadArcaCsr(): Promise<R<{ csr: string; filename: string }>> {
  try {
    const { rpc } = await ctx();
    const c = await rpc("csr");
    if (!c.csr) return { ok: false, error: "Todavía no generaste el pedido" };
    return { ok: true, csr: String(c.csr), filename: `pedido-${c.alias}-${c.cuit}.csr` };
  } catch (e) { return fail(e); }
}

/** Guarda el .crt que devuelve ARCA, verificando que sea del pedido generado y del mismo CUIT. */
export async function uploadArcaCert(pem: string): Promise<R<{ expiresAt: string }>> {
  try {
    const { rpc } = await ctx();
    if (pem.length > 20_000 || !pem.includes("BEGIN CERTIFICATE")) return { ok: false, error: "Subí el archivo .crt que te descarga ARCA" };
    const c = await rpc("creds");
    const info = inspectCertificate(pem, String(c.private_key));
    if (info.subjectCuit && c.cuit && info.subjectCuit !== c.cuit) return { ok: false, error: `El certificado es del CUIT ${info.subjectCuit}, no del ${c.cuit}` };
    await rpc("save_cert", { certificate: pem.trim(), expires_at: info.expiresAt });
    revalidatePath("/configuracion");
    return { ok: true, expiresAt: info.expiresAt };
  } catch (e) { return fail(e); }
}

/** Prueba la conexión: login en ARCA y consulta del último comprobante del punto de venta. */
export async function testArca(): Promise<R<{ message: string }>> {
  const { rpc } = await ctx();
  try {
    const auth = await arcaAuth(rpc);
    if (!auth.pointOfSale) throw new Error("Falta el punto de venta");
    const [a, b] = await Promise.all([lastVoucher(auth, auth.pointOfSale, 1), lastVoucher(auth, auth.pointOfSale, 6)]);
    const message = `Conectado. Punto de venta ${auth.pointOfSale}: última Factura A N° ${a}, última Factura B N° ${b}.`;
    await rpc("check", { ok: true, message });
    revalidatePath("/configuracion");
    return { ok: true, message };
  } catch (e) {
    const message = (e as Error).message;
    await rpc("check", { ok: false, message }).catch(() => null);
    revalidatePath("/configuracion");
    return { ok: false, error: message };
  }
}
