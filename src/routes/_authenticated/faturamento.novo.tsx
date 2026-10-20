import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useAssistenteServico } from "@/hooks/use-jev-faturamento";
import { PortaoFaturamento } from "@/components/faturamento/moldura";
import { NovoPedido } from "@/components/faturamento/novo-pedido";
import { lerBuscaNovo } from "@/lib/faturamento/filtro";

// Novo pedido (Ficha em modo de edição). Contrato: docs/design/contratos/faturamento-novo.md.
// `?pedido=` abre um rascunho ou devolvido; `?emissora=` pré-seleciona a empresa. A página não é item do
// menu, então confere a área sozinha; quem pede em qual empresa quem diz é o banco.
// A sugestão de serviço e o aviso de descrição (T5, o Jev) entram pela prop `assistente`, só com
// FATURAMENTO_JEV=1 no servidor.
export const Route = createFileRoute("/_authenticated/faturamento/novo")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaNovo(s),
  head: () => ({ meta: [{ title: "Novo pedido · Planning Brain" }] }),
  component: NovoPedidoPagina,
});

function NovoPedidoPagina() {
  useAuth();
  const busca = Route.useSearch();
  const assistente = useAssistenteServico();
  return (
    <PortaoFaturamento
      titulo="Novo pedido"
      pergunta="O que precisa ser faturado, para quem e como?"
    >
      <NovoPedido busca={busca} assistente={assistente} />
    </PortaoFaturamento>
  );
}
