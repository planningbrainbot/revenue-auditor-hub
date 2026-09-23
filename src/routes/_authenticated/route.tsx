import { useEffect, type CSSProperties } from "react";
import {
  createFileRoute,
  Outlet,
  redirect,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notificacoes/notification-bell";
import { usePermissions } from "@/hooks/use-permissions";
import { VerComoTarja } from "@/components/ver-como/ver-como-tarja";
import { supabase } from "@/integrations/supabase/client";
import { garantirSessoesIrmas } from "@/lib/sessoes-irmas";
import { areaDoCaminho, AREAS, type Area, type Item } from "@/lib/areas";
import { SemAcessoArea } from "@/components/sem-acesso-area";
import { Button } from "@/components/ui/button";
import { Filete } from "@/components/planning";
import { corDaArea } from "@/lib/planning/cores-area";
import { ChevronRight } from "lucide-react";

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
  admin: "Super admin",
  diretor: "Diretor",
  socio: "Sócio",
  head: "Head",
  auditor: "Auditor",
  socio_regional: "Sócio Regional",
};

// "Área › Página" do cabeçalho, lido do próprio menu (areas.ts): nada de dado
// novo. Mesma regra do grifo da lateral: vale o item de caminho mais específico
// que casa, para /unidades/split dizer "Split do Asaas" e não "Regras da Rede".
// Não passa por permissão de propósito: é rótulo de onde você está, e o portão
// de área logo abaixo já decide se a tela abre.
function trilhaDoCaminho(
  pathname: string,
  searchStr: string,
): { area: Area; item: Item } | null {
  const atual = new URLSearchParams(searchStr);
  let melhor: { area: Area; item: Item } | null = null;
  for (const area of AREAS) {
    for (const grupo of area.grupos) {
      for (const item of grupo.items) {
        const [caminho, busca] = item.url.split("?");
        const casa =
          caminho === "/"
            ? pathname === "/"
            : pathname === caminho || pathname.startsWith(caminho + "/");
        const consultaConfere = [...new URLSearchParams(busca || "")].every(
          ([k, v]) => atual.get(k) === v,
        );
        if (casa && consultaConfere && (!melhor || item.url.length > melhor.item.url.length)) {
          melhor = { area, item };
        }
      }
    }
  }
  return melhor;
}

// Telas que são PORTA, não destino: entram autenticadas, mas sem a moldura.
// O /inicio pergunta em qual produto entrar; menu ali seria contraditório,
// porque o menu já é de um produto — o que a pessoa ainda não escolheu.
const SEM_MOLDURA = ["/inicio"];

function AuthenticatedLayout() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const { user } = Route.useRouteContext();
  const { primaryRole, unidade, loading, temArea } = usePermissions(user.id);

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

  // Caminhos com porta própria fora do menu. `/equipe` mora na área `admin`
  // para o super admin, mas o rodapé da lateral mostra "Minha equipe" a quem
  // administra uma equipe sem ter a área `admin` — trancar aqui tiraria o
  // acesso a um link que a pessoa está vendo.
  const FORA_DO_PORTAO = ["/equipe"];

  const slugDaArea = FORA_DO_PORTAO.includes(pathname) ? null : areaDoCaminho(pathname);
  const areaBloqueada =
    !loading && slugDaArea && !temArea(slugDaArea)
      ? (AREAS.find((a) => a.slug === slugDaArea)?.nome ?? slugDaArea)
      : null;

  const trilha = trilhaDoCaminho(pathname, searchStr);
  // Cor da área na raiz do layout: filete de card clicável, abas e o que mais
  // pedir `--area-atual` herdam daqui sem repetir o slug (a lateral define a
  // sua, porque no celular ela abre em portal).
  const estiloArea = {
    "--area-atual": corDaArea(trilha?.area.slug ?? slugDaArea),
  } as CSSProperties;

  if (SEM_MOLDURA.includes(pathname)) {
    // Só o guarda de autenticação (que vive no `beforeLoad` desta rota) e a
    // tela. Sem barra lateral, sem cabeçalho, sem sino.
    return <Outlet />;
  }

  return (
    <SidebarProvider>
      {/* --app-header-h: altura do cabeçalho fixo, para quem precisa grudar
          algo logo abaixo dele (ex.: cabeçalho de tabela em /admin/permissoes). */}
      <div
        className="flex min-h-screen w-full bg-background [--app-header-h:60px]"
        style={estiloArea}
      >
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Tarja e cabeçalho grudam JUNTOS: o botão de sair da simulação que
              some ao rolar é o mesmo que não existe, porque a tela do sócio é
              longa e a dúvida ("por que sumiu meu menu?") chega no meio dela. */}
          <div className="sticky top-0 z-20">
            <VerComoTarja />
            <header className="flex h-[var(--app-header-h)] items-center gap-3 border-b bg-card px-4">
              <SidebarTrigger />
              <nav aria-label="Onde você está" className="min-w-0 flex-1">
                {trilha && (
                  <ol className="flex min-w-0 items-center gap-1.5 text-sm">
                    <li className="hidden shrink-0 items-center gap-2 text-muted-foreground sm:flex">
                      <Filete className="h-4" />
                      {trilha.area.nome}
                    </li>
                    <li aria-hidden className="hidden text-muted-foreground sm:block">
                      <ChevronRight className="h-3.5 w-3.5" />
                    </li>
                    <li className="min-w-0 truncate font-medium text-foreground" aria-current="page">
                      {trilha.item.title}
                    </li>
                  </ol>
                )}
              </nav>
              <div className="flex items-center gap-2">
                <div className="hidden flex-col items-end gap-1 text-right md:flex">
                  <span className="text-xs text-muted-foreground">{user?.email}</span>
                  {!loading && primaryRole && (
                    <span className="flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium leading-4 text-foreground">
                      {ROLE_LABEL[primaryRole] ?? primaryRole}
                      {(primaryRole === "socio" || primaryRole === "socio_regional") && unidade && (
                        <span className="rounded-full bg-primary/15 px-1.5 text-primary-text">
                          {unidade}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <NotificationBell />
                <ThemeToggle />
                <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
                  Sair
                </Button>
              </div>
            </header>
          </div>
          <main className="flex-1">
            {/* Portão de área, no layout e não em 56 páginas.
                O menu já esconde o que a pessoa não pode abrir, mas link
                direto, favorito e autocomplete do navegador não passam pelo
                menu: em 22/09/2026 alguém com só Planning People caiu em
                /rede-overview e viu "Esta página não carregou", que parece
                defeito do sistema e não falta de acesso.
                Só opina sobre caminho que está no menu; o resto (admin,
                /equipe, /inicio) continua com a checagem da própria tela. */}
            {areaBloqueada ? <SemAcessoArea area={areaBloqueada} /> : <Outlet />}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
