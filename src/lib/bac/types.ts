import type { PurchaseOrderInput } from "@/lib/po/schema";

/** Resultado de extracción: borrador de orden + campos que requieren revisión humana. */
export type ExtractedOrder = {
  order: PurchaseOrderInput;
  /** Rutas de campos dudosos o faltantes: "bac_number", "items.0.unit_price" */
  review: string[];
  warnings: ExtractionWarning[];
};

export type ExtractionWarning = {
  level: "error" | "warning" | "info";
  path?: string;
  message: string;
};
