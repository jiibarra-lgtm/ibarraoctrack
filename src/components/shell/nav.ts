import {
  LayoutDashboard, FileText, Truck, ShoppingCart, Receipt, Landmark, Package, TrendingUp, Bell, Settings,
  Gavel, ShoppingBag, Percent, Building2, AlarmClock, BookOpen, type LucideIcon,
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
      { href: "/recordatorios", label: "Recordatorios", icon: AlarmClock, simple: true },
      {
        href: "/ordenes", label: "Órdenes de compra", icon: FileText, simple: true,
        tabs: [
          { href: "/ordenes", label: "Órdenes", simple: true },
          { href: "/ordenes/importar", label: "Importar OC", simple: true },
          { href: "/bac", label: "Avisos del BAC" },
          { href: "/correos", label: "Correos" },
          { href: "/correos/seguimiento", label: "Seguimiento de correos" },
        ],
      },
      {
        href: "/entregas/pendientes", label: "Entregas", icon: Truck, simple: true,
        tabs: [
          { href: "/entregas/pendientes", label: "Pendientes", simple: true },
          { href: "/entregas", label: "Estado por OC", simple: true },
          { href: "/remitos", label: "Remitos" },
          { href: "/remitos/qr", label: "QR de remitos" },
          { href: "/entregas/remito", label: "Leer remito" },
          { href: "/entregas/flete", label: "Costo de flete" },
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
          { href: "/productos/catalogo", label: "Catálogo", simple: true },
          { href: "/costos-manuales", label: "Costos manuales", simple: true },
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
          { href: "/facturacion/condiciones", label: "Condiciones de venta" },
        ],
      },
      {
        href: "/banco", label: "Tesorería y gastos", icon: Landmark,
        tabs: [
          { href: "/banco", label: "Banco" },
          { href: "/tesoreria/cheques", label: "Cheques" },
          { href: "/tesoreria/caja", label: "Caja" },
          { href: "/tesoreria/conciliacion", label: "Conciliación" },
          { href: "/tesoreria/flujo", label: "Flujo de fondos" },
          { href: "/gastos-fijos", label: "Gastos fijos" },
          { href: "/costos", label: "Costos" },
          { href: "/finanzas", label: "Finanzas" },
        ],
      },
      {
        href: "/impuestos", label: "Impuestos y ARCA", icon: Percent,
        tabs: [
          { href: "/impuestos", label: "Impuestos y ARCA" },
          { href: "/impuestos/iibb", label: "Liquidación IIBB" },
        ],
      },
      { href: "/contabilidad", label: "Contabilidad", icon: BookOpen },
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
      {
        href: "/mercadolibre/panel", label: "Mercado Libre", icon: ShoppingBag,
        tabs: [
          { href: "/mercadolibre/panel", label: "Resumen", simple: true },
          { href: "/mercadolibre/stats", label: "Stats", simple: true },
          { href: "/mercadolibre/publicaciones", label: "Publicaciones", simple: true },
          { href: "/mercadolibre/ventas", label: "Ventas", simple: true },
          { href: "/mercadolibre/preguntas", label: "Preguntas", simple: true },
          { href: "/mercadolibre/publicar", label: "Publicar" },
          { href: "/mercadolibre/precios", label: "Precios y promos" },
          { href: "/mercadolibre/mercado", label: "Mercado y competencia" },
          { href: "/mercadolibre/palabras", label: "Palabras clave" },
          { href: "/mercadolibre/estudio", label: "Estudio de fotos" },
          { href: "/mercadolibre/reportes", label: "Reportes" },
          { href: "/mercadolibre/automatizaciones", label: "Automatizaciones" },
          { href: "/mercadolibre/widget", label: "Widget iPhone", simple: true },
          { href: "/mercadolibre/ajustes", label: "Ajustes", simple: true },
          { href: "/mercadolibre", label: "Operaciones" },
          { href: "/mercadolibre/compras", label: "Gastos, IVA y devoluciones" },
        ],
      },
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
