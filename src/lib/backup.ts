import { writeXlsx, type Sheet } from "@/lib/xlsx-write";

const NAMES: Record<string, string> = {
  purchase_orders: "Órdenes", purchase_order_items: "Renglones OC", deliveries: "Entregas", delivery_items: "Renglones entregas",
  remitos: "Remitos", remito_items: "Renglones remitos", sales_invoices: "Facturas", collections: "Cobros", purchases: "Compras",
  purchase_items: "Renglones compras", costs: "Gastos", customers: "Organismos", suppliers: "Proveedores",
  convenio_lines: "Productos convenio", bac_orders_inbox: "Avisos BAC",
};

const value = (v: unknown) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) && v.length < 16 ? Number(v) : v;
  return JSON.stringify(v);
};

/** Convierte la copia de la base (una lista de filas por tabla) en un Excel con una hoja por tabla. */
export function backupToXlsx(dump: { org?: string; tables: Record<string, Record<string, unknown>[]> }, generatedAt: string): Uint8Array {
  const sheets: Sheet[] = [{ name: "Resumen", rows: [["Copia de seguridad", dump.org ?? ""], ["Generada", generatedAt], [], ["Hoja", "Filas"],
    ...Object.keys(NAMES).map((k) => [NAMES[k], dump.tables[k]?.length ?? 0])] }];
  for (const k of Object.keys(NAMES)) {
    const rows = dump.tables[k] ?? [];
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    sheets.push({ name: NAMES[k], rows: [cols, ...rows.map((r) => cols.map((c) => value(r[c])))] });
  }
  return writeXlsx(sheets);
}
