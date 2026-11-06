"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import type { Direction, VoucherRow } from "@/lib/arca-comprobantes";

type R = { ok: true; nuevos: number; actualizados: number; vinculados: number } | { ok: false; error: string };

/** Guarda un lote de comprobantes leídos de Mis Comprobantes. Repetir el archivo no duplica. */
export async function importVouchers(direction: Direction, rows: VoucherRow[]): Promise<R> {
  try {
    if (direction !== "emitido" && direction !== "recibido") return { ok: false, error: "Archivo inválido" };
    if (!Array.isArray(rows) || rows.length > 5000) return { ok: false, error: "Lote demasiado grande" };
    const s = await requireOrg();
    const { data, error } = await s.supabase.rpc("import_arca_vouchers", { p_org: s.org.org_id, p_direction: direction, p_rows: rows, p_source: "mis_comprobantes" });
    if (error) return { ok: false, error: error.code === "42501" ? "No tenés permisos para importar" : error.message };
    revalidatePath("/impuestos");
    const d = (data ?? {}) as { nuevos?: number; actualizados?: number; vinculados?: number };
    return { ok: true, nuevos: d.nuevos ?? 0, actualizados: d.actualizados ?? 0, vinculados: d.vinculados ?? 0 };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
