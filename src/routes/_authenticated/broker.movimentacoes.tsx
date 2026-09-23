import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/movimentacoes")({
  component: BrokerMovimentacoesPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerMovimentacoesPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Movimentações"
        descricao="Extrato do seu saldo em CashBrain: crédito, bloqueio, compra e liberação"
      />
      <BrokerUnidadeView secao="movimentacoes" />
    </div>
  );
}
