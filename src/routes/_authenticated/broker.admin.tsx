import { createFileRoute } from "@tanstack/react-router";
import { BrokerAdminView } from "@/components/broker/broker-admin-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/admin")({
  component: BrokerAdminPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BrokerAdminPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Matriz"
        descricao="Fila de clientes, carteira das unidades e o multiplicador que define o preço"
      />
      <BrokerAdminView />
    </div>
  );
}
