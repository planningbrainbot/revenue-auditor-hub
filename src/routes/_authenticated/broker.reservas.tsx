import { createFileRoute } from "@tanstack/react-router";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/reservas")({
  component: BrokerReservasPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerReservasPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Minhas reservas"
        descricao="Clientes que a sua unidade segurou, o prazo para precificar e os já fechados"
      />
      <BrokerUnidadeView secao="reservas" />
    </div>
  );
}
