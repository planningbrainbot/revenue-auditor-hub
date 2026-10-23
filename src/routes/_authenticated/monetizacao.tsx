import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DashboardMonetizacao } from "@/components/monetizacao/dashboard";
import { Consultoria } from "@/components/monetizacao/consultoria";
import { Cella } from "@/components/monetizacao/cella";
import { PainelDiagnostico } from "@/components/monetizacao/diagnostico/painel";
import { validarBuscaMonetizacao, type BuscaMonetizacao } from "@/components/monetizacao/busca";
import { Carregando } from "@/components/planning";
import { usePermissions } from "@/hooks/use-permissions";

// Aba, período, produto e os filtros próprios de cada visão moram na URL (N7):
// recarregar ou colar o link reproduz a tela. Valor igual ao padrão não vai para a URL.
export const Route = createFileRoute("/_authenticated/monetizacao")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaMonetizacao(s),
  component: Page,
});
function Page() {
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const perms = usePermissions();
  const mudarBusca = (patch: Partial<BuscaMonetizacao>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  // Consultoria (Handoff e repasse · Cruzamento com a call) tem fontes próprias (onboarding, plataforma da
  // Consultoria, contratos, PAT): não baixa a carga do CRM que as outras visões dividem.
  // Quem tem só a chave da tela Consultoria (view.consultoria, 22/10/2026) abre a Consultoria em qualquer link da
  // Monetização. Enquanto as permissões chegam, as outras telas não desenham: pediriam dado que a pessoa não lê.
  const soConsultoria = !perms.loading && !perms.can("view.monetizacao") && perms.can("view.consultoria");
  if (busca.aba === "handoff-consultoria") return <Consultoria busca={busca} mudarBusca={mudarBusca} />;
  // A URL só guarda os filtros da Consultoria com a aba dela: o primeiro clique leva a aba junto.
  if (soConsultoria)
    return <Consultoria busca={busca} mudarBusca={(patch) => mudarBusca({ aba: "handoff-consultoria", ...patch })} />;
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <Carregando variante="kpis" />
      </main>
    );
  // Cella (22/10/2026): lê o funil da Diehl & Cella pelo Brain, sem a carga do CRM.
  if (busca.aba === "cella") return <Cella busca={busca} mudarBusca={mudarBusca} />;
  // Base nova (pipe 40, 16/10/2026): Operação, Pré-venda e Forecast têm a seção própria, com leitura própria; a
  // validação da URL só deixa `base=nova` nessas três abas.
  if (busca.base === "nova") return <PainelDiagnostico busca={busca} mudarBusca={mudarBusca} />;
  return <DashboardMonetizacao busca={busca} mudarBusca={mudarBusca} />;
}
