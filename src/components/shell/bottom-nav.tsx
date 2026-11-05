"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, FileText, Inbox, LayoutDashboard, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { href: "/ordenes", label: "Órdenes", icon: FileText },
  { href: "/ordenes/importar", label: "Importar", icon: Plus, main: true },
  { href: "/bac", label: "BAC", icon: Inbox },
  { href: "/alertas", label: "Alertas", icon: Bell },
];

/** Barra inferior tipo app (sólo celular). */
export function BottomNav() {
  const pathname = usePathname();
  const best = ITEMS.map((i) => i.href).filter((h) => pathname === h || pathname.startsWith(h + "/")).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Navegación principal" className="glass fixed inset-x-2 bottom-2 z-40 rounded-2xl pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="grid grid-cols-5">
        {ITEMS.map((it) => {
          const Icon = it.icon;
          const active = best === it.href;
          return (
            <li key={it.href}>
              <Link href={it.href} className={cn("flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium", active ? "text-brand" : "text-fg-muted")}>
                {it.main
                  ? <span className="grid size-10 place-items-center rounded-full bg-primary text-primary-fg shadow-md"><Icon className="size-5" /></span>
                  : <Icon className="size-5" />}
                {!it.main && it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
