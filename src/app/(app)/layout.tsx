import { requireOrg, ROLE_LABEL, canWrite } from "@/lib/session";
import { Header } from "@/components/shell/header";
import { Brand, SidebarNav } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireOrg();
  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 overflow-y-auto border-r border-border bg-surface px-3 py-4 lg:flex">
        <Brand orgName={s.org.org_name} />
        <SidebarNav />
        <p className="mt-auto px-2.5 text-[11px] text-fg-subtle">Fase 1 · Fundamentos</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          email={s.email}
          fullName={s.fullName}
          roleLabel={ROLE_LABEL[s.org.role]}
          orgName={s.org.org_name}
          orgId={s.org.org_id}
          memberships={s.memberships}
          canWrite={canWrite(s.org.role)}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
