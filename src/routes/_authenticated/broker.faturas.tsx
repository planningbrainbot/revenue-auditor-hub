import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/faturas")({
  component: BrokerFaturasPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerFaturasPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Faturas e pagamentos"
        descricao="Compra de CashBrain, faturas em aberto e pagamentos confirmados"
      />
      <BrokerUnidadeView secao="faturas" />
    </div>
  );
}
