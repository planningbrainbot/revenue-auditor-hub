import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DashboardMonetizacao } from "@/components/monetizacao/dashboard";
import { Consultoria } from "@/components/monetizacao/consultoria";
import { validarBuscaMonetizacao, type BuscaMonetizacao } from "@/components/monetizacao/busca";

// Aba, período, produto e os filtros próprios de cada visão moram na URL (N7):
// recarregar ou colar o link reproduz a tela. Valor igual ao padrão não vai para a URL.
export const Route = createFileRoute("/_authenticated/monetizacao")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => validarBuscaMonetizacao(s),
  component: Page,
});
function Page() {
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const mudarBusca = (patch: Partial<BuscaMonetizacao>) =>
    navigate({
      search: (prev) => ({ ...prev, ...patch }),
      replace: true,
      resetScroll: false,
    });
  // Consultoria (Handoff e repasse · Cruzamento com a call) tem fontes próprias (onboarding, plataforma da
  // Consultoria, contratos, PAT): não baixa a carga do CRM que as outras visões dividem.
  if (busca.aba === "handoff-consultoria")
    return <Consultoria busca={busca} mudarBusca={mudarBusca} />;
  return <DashboardMonetizacao busca={busca} mudarBusca={mudarBusca} />;
}
