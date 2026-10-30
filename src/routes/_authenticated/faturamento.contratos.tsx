import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { ContratosDoMes } from "@/components/faturamento/contratos-mes";
import { lerBuscaContratos } from "@/lib/faturamento/recorrente";

// Contratos do mês (Fila de trabalho). Contrato: docs/design/contratos/faturamento-contratos.md.
// A porta é a área Faturamento; quem vê cada contrato (dono, gestor, substituto, repasse, tesouraria ou
// controladoria da empresa) é `ops.fat_contratos_mes`. Mês, empresa, filtros e o contrato aberto moram na URL (N7).
export const Route = createFileRoute("/_authenticated/faturamento/contratos")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaContratos(s),
  head: () => ({ meta: [{ title: "Contratos do mês · Planning Brain" }] }),
  component: ContratosDoMesPagina,
});

function ContratosDoMesPagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento
      titulo="Contratos do mês"
      pergunta="Quais contratos do mês precisam da minha resposta?"
      carregando="tabela"
    >
      <ContratosDoMes busca={busca} />
    </PortaoFaturamento>
  );
}
