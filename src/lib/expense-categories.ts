/** Rubros de gastos variables (pagos con tarjeta y transferencias). */
export const VAR_CATEGORIES: Record<string, string> = {
  comida: "Comida y supermercado", vehiculos: "Vehículos y combustible", ferreteria: "Ferretería y materiales", salud: "Salud y farmacia",
  servicios: "Servicios", telefonia: "Teléfono e internet", software: "Sistemas y suscripciones", seguros: "Seguros", impuestos: "Impuestos",
  bancos: "Bancos y tarjetas", sueldos: "Sueldos", alquiler: "Alquiler", honorarios: "Honorarios", proveedores: "Pagos a proveedores", compras: "Compras online", otros: "Otros",
};

/** Rubros de gastos fijos. */
export const CATEGORY_LABEL: Record<string, string> = {
  sueldos: "Sueldos y cargas", alquiler: "Alquiler", servicios: "Servicios (luz, gas, agua)", telefonia: "Teléfono e internet", salud: "Prepaga / salud",
  impuestos: "Impuestos y tasas", seguros: "Seguros", honorarios: "Honorarios (contador, abogado)", bancos: "Bancos y comisiones", software: "Sistemas y suscripciones", vehiculos: "Vehículos y combustible", otros: "Otros",
};
