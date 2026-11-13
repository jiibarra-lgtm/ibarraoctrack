"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";
import { readXlsx } from "@/lib/xlsx-lite";
import { contractFromFilename, parseConvenioLines } from "@/lib/convenio-lines";

type R = { ok: true; n?: number; contract?: string } | { ok: false; error: string };
const can = (role: string) => ["admin", "finanzas", "compras"].includes(role);

/** Tu costo (sin IVA) de un renglón del convenio. Vacío = sin costo. Se aplica a las OC de ese renglón. */
export async function setConvenioCost(lineId: string, raw: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(lineId)) return { ok: false, error: "No permitido" };
  const t = raw.trim().replace(/\$/g, "").replace(/\s/g, "");
  const v = t === "" ? null : Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  if (v !== null && !(Number.isFinite(v) && v >= 0)) return { ok: false, error: "Costo inválido" };
  const { error } = await s.supabase.rpc("convenio_set_cost", { p_org: s.org.org_id, p_line: lineId, p_cost: v });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/productos");
  return { ok: true };
}

/** Sube el Excel "Líneas del Convenio Marco" (actualiza renglones y precios; los costos que cargaste se mantienen). */
export async function importConvenio(form: FormData): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "No permitido" };
  const f = form.get("file");
  if (!(f instanceof File) || f.size === 0) return { ok: false, error: "Elegí el Excel" };
  if (f.size > 15 * 1024 * 1024) return { ok: false, error: "El archivo es muy grande" };
  const contract = (String(form.get("contract") ?? "").trim().toUpperCase()) || contractFromFilename(f.name);
  if (!contract) return { ok: false, error: "No encontré el número de convenio (ej. 623-38-CM26) en el nombre del archivo: escribilo" };
  const { data: org } = await s.supabase.from("organizations").select("cuit").eq("id", s.org.org_id).single();
  const { data: conn } = await s.supabase.from("arca_connection").select("cuit").eq("org_id", s.org.org_id).maybeSingle();
  const cuit = String(conn?.cuit ?? org?.cuit ?? "").replace(/\D/g, "");
  if (cuit.length !== 11) return { ok: false, error: "Falta el CUIT de la empresa en Configuración" };
  try {
    const lines = parseConvenioLines(readXlsx(new Uint8Array(await f.arrayBuffer())), cuit);
    if (!lines.length) return { ok: false, error: "El Excel no tiene renglones" };
    const { data, error } = await s.supabase.rpc("convenio_import", { p_org: s.org.org_id, p_contract: contract, p_name: String(form.get("name") ?? ""), p_lines: lines });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/productos");
    return { ok: true, n: Number(data ?? lines.length), contract };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
