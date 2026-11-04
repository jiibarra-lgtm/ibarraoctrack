import {
  LayoutDashboard, FileText, Upload, Truck, ShoppingCart, Receipt, Wallet, Landmark, Building2, Factory,
  Package, LineChart, Calculator, FileBarChart, FolderOpen, Bell, Settings, Users, Trophy, CalendarRange, CircleDollarSign,
  type LucideIcon,
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
    ],
  },
  {
    label: "Operación",
    items: [
      { href: "/compras", label: "Compras", icon: ShoppingCart, phase: 2 },
      { href: "/costos", label: "Costos", icon: CircleDollarSign, phase: 2 },
      { href: "/entregas", label: "Entregas", icon: Truck, phase: 3 },
      { href: "/facturacion", label: "Facturación", icon: Receipt, phase: 4 },
      { href: "/cobranzas", label: "Cobranzas", icon: Wallet, phase: 4 },
      { href: "/finanzas", label: "Finanzas", icon: Landmark, phase: 4 },
    ],
  },
  {
    label: "Maestros",
    items: [
      { href: "/organismos", label: "Organismos", icon: Building2 },
      { href: "/proveedores", label: "Proveedores", icon: Factory, phase: 2 },
      { href: "/productos", label: "Productos", icon: Package, phase: 2 },
      { href: "/documentos", label: "Documentos", icon: FolderOpen, phase: 3 },
    ],
  },
  {
    label: "Análisis",
    items: [
      { href: "/analitica/ranking", label: "Ranking", icon: Trophy, phase: 2 },
      { href: "/analitica", label: "Analítica", icon: LineChart, phase: 5 },
      { href: "/analitica/12-meses", label: "Últimos 12 meses", icon: CalendarRange, phase: 5 },
      { href: "/simulador", label: "Simulador", icon: Calculator, phase: 5 },
      { href: "/reportes", label: "Reportes", icon: FileBarChart, phase: 5 },
      { href: "/alertas", label: "Alertas", icon: Bell, phase: 5 },
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
