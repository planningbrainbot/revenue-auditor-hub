import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import {
  AREA_FATURAMENTO,
  AREA_TESOURARIA,
  EmConstrucao,
  PaginaFaturamento,
  PortaoFaturamento,
} from "@/components/faturamento/moldura";

// Fila da tesouraria (Fila de trabalho). Contrato: docs/design/contratos/faturamento-tesouraria.md.
// ESQUELETO da primeira metade da T4: só a área Faturamento · Tesouraria (`edit.faturamento_tesouraria`)
// abre. A fila entra na segunda metade.
export const Route = createFileRoute("/_authenticated/faturamento/tesouraria")({
  head: () => ({ meta: [{ title: "Fila da tesouraria · Planning Brain" }] }),
  component: FilaTesourariaPagina,
});

const PERGUNTA = "Qual pedido eu confiro e faturo agora?";

function FilaTesourariaPagina() {
  useAuth();
  return (
    <PortaoFaturamento
      area={AREA_TESOURARIA}
      oQueFalta="Faturamento · Tesouraria"
      titulo="Fila da tesouraria"
      pergunta={PERGUNTA}
      carregando="tabela"
    >
      <PaginaFaturamento>
        <PageHeader area={AREA_FATURAMENTO} titulo="Fila da tesouraria" pergunta={PERGUNTA} />
        <EmConstrucao descricao="A fila da tesouraria entra na próxima entrega do Portal de Faturamento." />
      </PaginaFaturamento>
    </PortaoFaturamento>
  );
}
