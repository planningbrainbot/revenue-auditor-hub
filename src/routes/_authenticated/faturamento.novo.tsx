import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { NovoPedido } from "@/components/faturamento/novo-pedido";
import { lerBuscaNovo } from "@/lib/faturamento/filtro";

// Novo pedido (Ficha em modo de edição). Contrato: docs/design/contratos/faturamento-novo.md.
// `?pedido=` abre um rascunho ou devolvido; `?emissora=` pré-seleciona a empresa. A página não é item do
// menu, então confere a área sozinha; quem pede em qual empresa quem diz é o banco.
// A sugestão de serviço (T5) entra pela prop `assistente` do NovoPedido; enquanto não, fica desligada.
export const Route = createFileRoute("/_authenticated/faturamento/novo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaNovo(s),
  head: () => ({ meta: [{ title: "Novo pedido · Planning Brain" }] }),
  component: NovoPedidoPagina,
});

function NovoPedidoPagina() {
  useAuth();
  const busca = Route.useSearch();
  return (
    <PortaoFaturamento
      titulo="Novo pedido"
      pergunta="O que precisa ser faturado, para quem e como?"
    >
      <NovoPedido busca={busca} />
    </PortaoFaturamento>
  );
}
