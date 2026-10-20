import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { FichaDoPedido } from "@/components/faturamento/ficha-pedido";
import { lerVolta } from "@/lib/faturamento/filtro";

// Ficha do pedido. Contrato: docs/design/contratos/faturamento-pedido.md.
// O portão do layout casa só caminho exato, então esta página confere a área sozinha; o pedido fora do
// escopo (CA-09) quem recusa é `ops.fat_pedido`, e a tela não mostra nenhum dado dele.
// `volta` é o caminho e os filtros da tela de origem (Pedidos, Meu faturamento, Fila da tesouraria).
export const Route = createFileRoute("/_authenticated/faturamento/pedido/$id")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): { volta?: string } => {
    const volta = lerVolta(s.volta);
    return volta ? { volta } : {};
  },
  head: () => ({ meta: [{ title: "Pedido · Planning Brain" }] }),
  component: PedidoPagina,
});

function PedidoPagina() {
  useAuth();
  const { id } = Route.useParams();
  const { volta } = Route.useSearch();
  return (
    <PortaoFaturamento titulo="Pedido" pergunta="Este pedido já virou nota, e o cliente pagou?">
      <FichaDoPedido id={id} volta={volta} />
    </PortaoFaturamento>
  );
}
