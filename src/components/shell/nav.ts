import {
  LayoutDashboard, FileText, Upload, Truck, ShoppingCart, Receipt, Wallet, Landmark, Building2, Factory,
  Package, LineChart, Calculator, FileBarChart, FolderOpen, Bell, Settings, Users, Trophy, CalendarRange, CircleDollarSign,
  Inbox, Mail, Gavel, type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; phase?: number };
export type NavGroup = { label: string; items: NavItem[] };

/** Módulos sin `phase` están disponibles. El resto se habilita en su fase (no hay pantallas simuladas). */
export const NAV: NavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ordenes", label: "Órdenes de compra", icon: FileText },
      { href: "/ordenes/importar", label: "Importar OC", icon: Upload },
      { href: "/bac", label: "Órdenes BAC", icon: Inbox },
      { href: "/correos", label: "Correos", icon: Mail },
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/compras", label: "Compras", icon: ShoppingCart },
      { href: "/costos", label: "Costos", icon: CircleDollarSign },
      { href: "/entregas", label: "Entregas", icon: Truck },
      { href: "/facturacion", label: "Facturación", icon: Receipt },
      { href: "/cobranzas", label: "Cobranzas", icon: Wallet },
      { href: "/finanzas", label: "Finanzas", icon: Landmark },
    ],
  },
  {
    label: "Licitaciones",
    items: [
      { href: "/licitaciones", label: "Licitaciones BAC", icon: Gavel },
      { href: "/licitaciones/comprar", label: "Licitaciones COMPR.AR", icon: Landmark },
    ],
  },
  {
    label: "Maestros",
    items: [
      { href: "/organismos", label: "Organismos", icon: Building2 },
      { href: "/proveedores", label: "Proveedores", icon: Factory },
      { href: "/productos", label: "Productos", icon: Package },
      { href: "/documentos", label: "Documentos", icon: FolderOpen },
    ],
  },
  {
    label: "Análisis",
    items: [
      { href: "/analitica/ranking", label: "Ranking", icon: Trophy },
      { href: "/analitica", label: "Analítica", icon: LineChart },
      { href: "/analitica/12-meses", label: "Últimos 12 meses", icon: CalendarRange },
      { href: "/simulador", label: "Simulador", icon: Calculator },
      { href: "/reportes", label: "Reportes", icon: FileBarChart },
      { href: "/alertas", label: "Alertas", icon: Bell },
    ],
  },
  {
    label: "Sistema",
    items: [
      { href: "/usuarios", label: "Usuarios", icon: Users },
      { href: "/configuracion", label: "Configuración", icon: Settings },
    ],
  },
];
