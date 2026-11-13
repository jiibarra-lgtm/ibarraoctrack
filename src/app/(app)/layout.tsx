import { requireOrg, ROLE_LABEL, canWrite } from "@/lib/session";
import { Header } from "@/components/shell/header";
import { Brand, SidebarNav } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PushPrompt } from "@/components/push-prompt";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await requireOrg();
  return (
    <div className="flex min-h-dvh gap-3 p-0 lg:p-3">
      <aside className="sticky top-3 hidden h-[calc(100dvh-1.5rem)] w-60 shrink-0 flex-col gap-6 overflow-y-auto rounded-2xl border border-side-border bg-side px-3 py-4 text-side-fg shadow-[var(--glass-shadow)] backdrop-blur-2xl lg:flex">
        <Brand orgName={s.org.org_name} />
        <SidebarNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Header
          email={s.email}
          fullName={s.fullName}
          roleLabel={ROLE_LABEL[s.org.role]}
          orgName={s.org.org_name}
          orgId={s.org.org_id}
          memberships={s.memberships}
          canWrite={canWrite(s.org.role)}
        />
        <main className="mx-auto w-full max-w-[1400px] flex-1 border-panel-border bg-panel px-4 pb-[calc(var(--bottom-nav)+1.5rem)] pt-6 backdrop-blur-md sm:px-6 lg:rounded-3xl lg:border lg:px-8 lg:pb-6">{children}</main>
        <BottomNav />
        <PushPrompt />
      </div>
    </div>
  );
}
