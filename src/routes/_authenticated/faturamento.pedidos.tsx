import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { PedidosFaturamento } from "@/components/faturamento/pedidos";
import { lerBuscaPedidos } from "@/lib/faturamento/filtro";

// Pedidos (Lista/Relatório). Contrato: docs/design/contratos/faturamento.md §3. Filtros, ordem e página
// na URL (N7); é o destino de todo número de Meu faturamento.
export const Route = createFileRoute("/_authenticated/faturamento/pedidos")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaPedidos(s),
  head: () => ({
    meta: [
      { title: "Pedidos · Planning Brain" },
      {
        name: "description",
        content: "Em que pé está cada pedido de faturamento: situação, próximo passo e quem age.",
      },
    ],
  }),
  component: PedidosPagina,
});

function PedidosPagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento titulo="Pedidos" pergunta="Em que pé está cada pedido?" carregando="tabela">
      <PedidosFaturamento busca={busca} />
    </PortaoFaturamento>
  );
}
