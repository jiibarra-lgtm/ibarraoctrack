type PgError = { code?: string; message: string; details?: string | null };

/** Traduce errores de Postgres/Supabase a mensajes claros para el usuario. */
export function friendlyDbError(e: PgError | null | undefined): string {
  if (!e) return "Error desconocido";
  const msg = e.message ?? "";
  if (e.code === "23505") {
    if (msg.includes("uq_po_bac_number")) return "Ya existe una orden con ese número BAC.";
    if (msg.includes("uq_poi_line_option") || msg.includes("purchase_order_items")) return "Hay renglones repetidos (mismo renglón y opción).";
    if (msg.includes("documents_org_id_sha256")) return "Ese archivo ya fue subido.";
    return "Ya existe un registro con esos datos.";
  }
  if (e.code === "40001") return msg;
  if (e.code === "42501") return "No tenés permisos para esta operación.";
  if (e.code === "23514") return "Algún valor no cumple las reglas (montos negativos, cantidades en cero o formato inválido).";
  if (e.code === "22P02") return "Hay un valor con formato inválido.";
  if (["22023", "P0002", "55000"].includes(e.code ?? "")) return msg;
  return msg || "No se pudo completar la operación.";
}
