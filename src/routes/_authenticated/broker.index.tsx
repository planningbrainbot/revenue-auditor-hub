import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/")({
  component: BrokerUnidadePage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerUnidadePage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Fila de oportunidades"
        descricao="Clientes disponíveis para a sua unidade e o seu saldo em CashBrain"
      />
      <BrokerUnidadeView />
    </div>
  );
}
