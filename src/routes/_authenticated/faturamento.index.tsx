import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { MeuFaturamento } from "@/components/faturamento/meu-faturamento";
import { lerBuscaMeuFaturamento } from "@/lib/faturamento/filtro";

// Meu faturamento, a porta da área Faturamento (Visão geral). Contrato: docs/design/contratos/faturamento.md §2.
// O mês e as empresas moram na URL (`?mes=AAAA-MM&emissora=DOC,PIS`, N7); o mês corrente não aparece.
export const Route = createFileRoute("/_authenticated/faturamento/")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaMeuFaturamento(s),
  head: () => ({
    meta: [
      { title: "Meu faturamento · Planning Brain" },
      {
        name: "description",
        content:
          "O que foi pedido já virou nota, e o cliente pagou? A faturar, faturado, recebido e em atraso.",
      },
    ],
  }),
  component: MeuFaturamentoPagina,
});

function MeuFaturamentoPagina() {
  useAuth();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PortaoFaturamento
      titulo="Meu faturamento"
      pergunta="O que eu pedi já virou nota, e o cliente pagou?"
      carregando="kpis"
    >
      <MeuFaturamento
        busca={busca}
        aoMudar={(proxima) => void navigate({ search: proxima, replace: true, resetScroll: false })}
      />
    </PortaoFaturamento>
  );
}
