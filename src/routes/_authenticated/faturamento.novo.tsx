import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import {
  AREA_FATURAMENTO,
  EmConstrucao,
  PaginaFaturamento,
  PortaoFaturamento,
} from "@/components/faturamento/moldura";
import { lerBuscaNovo } from "@/lib/faturamento/filtro";

// Novo pedido (Ficha em modo de edição). Contrato: docs/design/contratos/faturamento-novo.md.
// ESQUELETO da primeira metade da T4: portão de acesso e parâmetros na URL (`?pedido=` rascunho ou
// devolvido, `?emissora=` apelido). O formulário entra na segunda metade.
export const Route = createFileRoute("/_authenticated/faturamento/novo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaNovo(s),
  head: () => ({ meta: [{ title: "Novo pedido · Planning Brain" }] }),
  component: NovoPedidoPagina,
});

const PERGUNTA = "O que precisa ser faturado, para quem e como?";

function NovoPedidoPagina() {
  useAuth();
  return (
    <PortaoFaturamento titulo="Novo pedido" pergunta={PERGUNTA}>
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo="Novo pedido" pergunta={PERGUNTA} />
        <EmConstrucao
          descricao="O formulário do pedido entra na próxima entrega do Portal de Faturamento."
          acao={
            <Button asChild variant="outline" size="sm">
              <Link to="/faturamento/pedidos">Ver pedidos</Link>
            </Button>
          }
        />
      </PaginaFaturamento>
    </PortaoFaturamento>
  );
}
