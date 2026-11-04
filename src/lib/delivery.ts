export const DELIVERY_STATUSES = ["programada", "en_preparacion", "despachada", "entregada", "recibida_provisional", "conformada", "rechazada", "cancelada"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  programada: "Programada", en_preparacion: "En preparación", despachada: "Despachada", entregada: "Entregada",
  recibida_provisional: "Recibida provisional", conformada: "Conformada", rechazada: "Rechazada", cancelada: "Cancelada",
};

export const DELIVERY_TONE: Record<DeliveryStatus, "neutral" | "primary" | "accent" | "warn" | "danger" | "info"> = {
  programada: "info", en_preparacion: "warn", despachada: "primary", entregada: "accent",
  recibida_provisional: "accent", conformada: "accent", rechazada: "danger", cancelada: "neutral",
};

/** Entregado físicamente (no implica conformidad administrativa). */
export const DELIVERED: DeliveryStatus[] = ["entregada", "recibida_provisional", "conformada"];
export const ACTIVE: DeliveryStatus[] = ["programada", "en_preparacion", "despachada"];
export const deliveryNumber = (n: number | string) => `ENT-${String(n).padStart(6, "0")}`;
