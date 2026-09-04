import { useEffect } from "react";
import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notificacoes/notification-bell";
import { usePermissions } from "@/hooks/use-permissions";
import { supabase } from "@/integrations/supabase/client";
import { garantirSessoesIrmas } from "@/lib/sessoes-irmas";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // getSession() reads the locally persisted session (no network round-trip).
    // Real verification of the token still happens server-side on every data
    // request via requireSupabaseAuth's getClaims() check.
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session?.user) throw redirect({ to: "/auth" });
    return { user: data.session.user };
  },
  component: AuthenticatedLayout,
});

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  diretor: "Diretor",
  socio: "Sócio",
  head: "Head",
  auditor: "Auditor",
  socio_franqueado: "Sócio Franqueado",
};

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const { user } = Route.useRouteContext();
  const { primaryRole, unidade, loading } = usePermissions(user.id);

  // Garante as sessões do Growth e do Financial para QUALQUER caminho de
  // entrada — senha, Microsoft, redefinição, ou sessão já aberta de antes.
  // Idempotente: não faz nada quando a sessão irmã já existe.
  useEffect(() => {
    void garantirSessoesIrmas();
  }, []);

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <SidebarProvider>
      {/* --app-header-h: altura do cabeçalho fixo, para quem precisa grudar
          algo logo abaixo dele (ex.: cabeçalho de tabela em /admin/permissoes). */}
      <div className="flex min-h-screen w-full bg-background [--app-header-h:60px]">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-20 flex h-[var(--app-header-h)] items-center gap-3 border-b bg-card px-4">
            <SidebarTrigger />
            <div className="min-w-0 flex-1" />
            <div className="flex items-center gap-2">
              <div className="hidden flex-col items-end text-right md:flex">
                <span className="text-xs text-muted-foreground">{user?.email}</span>
                {!loading && primaryRole && (
                  <span className="mt-0.5 flex items-center gap-1 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-foreground">
                    {ROLE_LABEL[primaryRole] ?? primaryRole}
                    {(primaryRole === "socio" || primaryRole === "socio_franqueado") && unidade && (
                      <span className="rounded bg-primary/15 px-1 py-px text-primary">{unidade}</span>
                    )}
                  </span>
                )}
              </div>
              <NotificationBell />
              <ThemeToggle />
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
              >
                Sair
              </button>
            </div>
          </header>
          <main className="flex-1">
            <Outlet />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
