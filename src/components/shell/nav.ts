import {
  LayoutDashboard, FileText, Truck, ShoppingCart, Receipt, Landmark, Package, TrendingUp, Bell, Settings,
  Gavel, ShoppingBag, Percent, Building2, type LucideIcon,
} from "lucide-react";

/**
 * Navegación agrupada en pocas secciones. Cada sección junta varias pantallas que se recorren con pestañas arriba.
 * `simple: true` = aparece también en el modo simple (lo justo para el día a día).
 */
export type NavTab = { href: string; label: string; simple?: boolean };
export type NavItem = { href: string; label: string; icon: LucideIcon; simple?: boolean; tabs?: NavTab[] };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  {
    label: "Día a día",
    items: [
      { href: "/dashboard", label: "Inicio", icon: LayoutDashboard, simple: true },
      {
        href: "/ordenes", label: "Órdenes de compra", icon: FileText, simple: true,
        tabs: [
          { href: "/ordenes", label: "Órdenes", simple: true },
          { href: "/ordenes/importar", label: "Importar OC", simple: true },
          { href: "/bac", label: "Avisos del BAC" },
          { href: "/correos", label: "Correos" },
        ],
      },
      {
        href: "/entregas/pendientes", label: "Entregas", icon: Truck, simple: true,
        tabs: [
          { href: "/entregas/pendientes", label: "Pendientes", simple: true },
          { href: "/entregas", label: "Estado por OC", simple: true },
          { href: "/remitos", label: "Remitos" },
          { href: "/entregas/remito", label: "Leer remito" },
        ],
      },
      {
        href: "/compras", label: "Compras y stock", icon: ShoppingCart, simple: true,
        tabs: [
          { href: "/compras", label: "Compras", simple: true },
          { href: "/precios-proveedores", label: "Precios de proveedores", simple: true },
          { href: "/stock", label: "Stock", simple: true },
        ],
      },
      {
        href: "/productos", label: "Mis precios", icon: Package, simple: true,
        tabs: [
          { href: "/productos", label: "Renglones y costos", simple: true },
          { href: "/precios-stock", label: "Qué bajar / subir", simple: true },
        ],
      },
    ],
  },
  {
    label: "Plata",
    items: [
      {
        href: "/facturacion", label: "Facturas y cobros", icon: Receipt, simple: true,
        tabs: [
          { href: "/facturacion", label: "Facturación", simple: true },
          { href: "/cobranzas", label: "Cobranzas", simple: true },
        ],
      },
      {
        href: "/banco", label: "Banco y gastos", icon: Landmark,
        tabs: [
          { href: "/banco", label: "Banco" },
          { href: "/gastos-fijos", label: "Gastos fijos" },
          { href: "/costos", label: "Costos" },
          { href: "/finanzas", label: "Finanzas" },
        ],
      },
      { href: "/impuestos", label: "Impuestos y ARCA", icon: Percent },
    ],
  },
  {
    label: "Análisis",
    items: [
      {
        href: "/analitica/mes", label: "Ganancias", icon: TrendingUp, simple: true,
        tabs: [
          { href: "/analitica/mes", label: "Ganancia del mes", simple: true },
          { href: "/analitica", label: "Analítica" },
          { href: "/analitica/12-meses", label: "Últimos 12 meses" },
          { href: "/analitica/ranking", label: "Ranking" },
          { href: "/simulador", label: "Simulador" },
          { href: "/reportes", label: "Reportes" },
        ],
      },
      { href: "/alertas", label: "Alertas", icon: Bell },
    ],
  },
  {
    label: "Más",
    items: [
      {
        href: "/licitaciones", label: "Licitaciones", icon: Gavel,
        tabs: [
          { href: "/licitaciones", label: "BAC" },
          { href: "/licitaciones/comprar", label: "COMPR.AR" },
        ],
      },
      { href: "/mercadolibre", label: "Mercado Libre", icon: ShoppingBag },
      {
        href: "/organismos", label: "Organismos y proveedores", icon: Building2,
        tabs: [
          { href: "/organismos", label: "Organismos" },
          { href: "/proveedores", label: "Proveedores" },
          { href: "/documentos", label: "Documentos" },
        ],
      },
      {
        href: "/configuracion", label: "Configuración", icon: Settings,
        tabs: [
          { href: "/configuracion", label: "Configuración" },
          { href: "/usuarios", label: "Usuarios" },
        ],
      },
    ],
  },
];

const matches = (path: string, href: string) => path === href || path.startsWith(href + "/");

/** La pantalla (pestaña o sección) que mejor coincide con la ruta actual. */
export function activeHref(path: string) {
  const all = NAV.flatMap((g) => g.items.flatMap((i) => [i.href, ...(i.tabs?.map((t) => t.href) ?? [])]));
  return all.filter((h) => matches(path, h)).sort((a, b) => b.length - a.length)[0];
}

/** Sección a la que pertenece la ruta actual. */
export function activeItem(path: string) {
  const best = activeHref(path);
  if (!best) return undefined;
  return NAV.flatMap((g) => g.items).find((i) => i.href === best || i.tabs?.some((t) => t.href === best));
}
