import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import {
  AREA_FATURAMENTO,
  EmConstrucao,
  PaginaFaturamento,
  PortaoFaturamento,
} from "@/components/faturamento/moldura";
import { partesDoLink } from "@/lib/areas";
import { lerVolta } from "@/lib/faturamento/filtro";

// Ficha do pedido. Contrato: docs/design/contratos/faturamento-pedido.md.
// ESQUELETO da primeira metade da T4. O portão do layout casa só caminho exato, então esta página confere a
// área sozinha; o pedido fora do escopo (CA-09) quem recusa é `ops.fat_pedido`, na segunda metade.
// `volta` é o caminho e os filtros da tela de origem (Pedidos, Meu faturamento, Fila da tesouraria).
export const Route = createFileRoute("/_authenticated/faturamento/pedido/$id")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): { volta?: string } => {
    const volta = lerVolta(s.volta);
    return volta ? { volta } : {};
  },
  head: () => ({ meta: [{ title: "Pedido · Planning Brain" }] }),
  component: PedidoPagina,
});

const PERGUNTA = "Este pedido já virou nota, e o cliente pagou?";

function PedidoPagina() {
  useAuth();
  const { volta } = Route.useSearch();
  // A lista de origem com os filtros dela; sem `volta`, Pedidos sem filtro.
  const destino = partesDoLink(volta ?? "/faturamento/pedidos");
  return (
    <PortaoFaturamento titulo="Pedido" pergunta={PERGUNTA}>
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo="Pedido" pergunta={PERGUNTA} />
        <EmConstrucao
          descricao="A ficha do pedido entra na próxima entrega do Portal de Faturamento."
          acao={
            <Button asChild variant="outline" size="sm">
              <Link to={destino.to as never} search={destino.search as never}>
                <ArrowLeft className="size-4" aria-hidden />
                Voltar
              </Link>
            </Button>
          }
        />
      </PaginaFaturamento>
    </PortaoFaturamento>
  );
}
