import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/")({
  component: BrokerOportunidadesPage,
});

// Contrato: docs/design/contratos/broker.md (Fila de trabalho). A procedência
// com a hora da leitura fica no rodapé da fila, visível também nos estados.
function BrokerOportunidadesPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Oportunidades"
        pergunta="Que oportunidade eu pego agora, e quanto de CashBrain ela custa?"
        descricao="Fila da rede · saldo da unidade em CashBrain (CB)"
      />
      <BrokerUnidadeView secao="oportunidades" />
    </div>
  );
}
