"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useTheme } from "next-themes";
import { Menu as MenuIcon, Moon, Sun, LogOut, Check, Building2, Plus, Upload, Monitor, X } from "lucide-react";
import Link from "next/link";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/overlays";
import { signOut, switchOrg } from "@/app/actions";
import { CommandSearch } from "./command-search";
import { Brand, SidebarNav } from "./sidebar";

type Props = {
  email: string;
  fullName: string;
  roleLabel: string;
  orgName: string;
  orgId: string;
  memberships: { org_id: string; org_name: string }[];
  canWrite: boolean;
};

export function Header(p: Props) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const { theme, setTheme } = useTheme();
  const [pending, start] = useTransition();
  const initials = (p.fullName || p.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-3 backdrop-blur sm:gap-3 sm:px-5">
      <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <DialogPrimitive.Trigger asChild>
          <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú"><MenuIcon /></Button>
        </DialogPrimitive.Trigger>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 lg:hidden" />
          <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 flex w-72 flex-col gap-5 overflow-y-auto border-r border-border bg-surface p-3 pt-4 lg:hidden">
            <DialogPrimitive.Title className="sr-only">Navegación</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Menú principal</DialogPrimitive.Description>
            <div className="flex items-center justify-between">
              <Brand orgName={p.orgName} />
              <DialogPrimitive.Close asChild><Button variant="ghost" size="icon-sm" aria-label="Cerrar"><X /></Button></DialogPrimitive.Close>
            </div>
            <SidebarNav onNavigate={() => setMobileOpen(false)} />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      <div className="flex min-w-0 flex-1 justify-start"><CommandSearch /></div>

      {p.canWrite && (
        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="secondary" size="sm"><Link href="/ordenes/importar"><Upload /> Importar</Link></Button>
          <Button asChild size="sm"><Link href="/ordenes/nueva"><Plus /> Nueva OC</Link></Button>
        </div>
      )}

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Tema">
            <Sun className="dark:hidden" /><Moon className="hidden dark:block" />
          </Button>
        </MenuTrigger>
        <MenuContent className="min-w-36">
          {[
            ["light", "Claro", Sun], ["dark", "Oscuro", Moon], ["system", "Sistema", Monitor],
          ].map(([v, label, Icon]) => {
            const I = Icon as React.ElementType;
            return (
              <MenuItem key={v as string} onSelect={() => setTheme(v as string)}>
                <I /> {label as string} {theme === v && <Check className="ml-auto" />}
              </MenuItem>
            );
          })}
        </MenuContent>
      </Menu>

      <Menu>
        <MenuTrigger asChild>
          <button className="grid size-8 shrink-0 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-fg ring-offset-2 ring-offset-bg focus-visible:ring-2" aria-label="Cuenta">
            {initials || "?"}
          </button>
        </MenuTrigger>
        <MenuContent className="w-64">
          <div className="px-2.5 py-2">
            <p className="truncate text-sm font-medium">{p.fullName || p.email}</p>
            <p className="truncate text-xs text-fg-subtle">{p.email} · {p.roleLabel}</p>
          </div>
          <MenuSeparator />
          <MenuLabel>Empresa</MenuLabel>
          {p.memberships.map((m) => (
            <MenuItem key={m.org_id} disabled={pending} onSelect={() => start(() => switchOrg(m.org_id))}>
              <Building2 /> <span className="truncate">{m.org_name}</span>
              {m.org_id === p.orgId && <Check className="ml-auto" />}
            </MenuItem>
          ))}
          <MenuItem asChild><Link href="/onboarding?nueva=1"><Plus /> Nueva empresa</Link></MenuItem>
          <MenuSeparator />
          <MenuItem onSelect={() => start(() => signOut())}><LogOut /> Cerrar sesión</MenuItem>
        </MenuContent>
      </Menu>
    </header>
  );
}
