import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/cac")({
  component: BrokerCacPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerCacPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="CAC"
        descricao="O que a matriz cobrou de CAC pelos clientes entregues e o que já foi pago"
      />
      <BrokerUnidadeView secao="cac" />
    </div>
  );
}
