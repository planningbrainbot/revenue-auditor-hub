import { createFileRoute } from "@tanstack/react-router";
import { BrokerAdminView } from "@/components/broker/broker-admin-view";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/broker/admin")({
  component: BrokerAdminPage,
});

// Contrato: docs/design/contratos/broker.md (Configuração + Lista). A aba vive
// em ?aba= e a procedência, com a hora da leitura, fica no rodapé da view.
function BrokerAdminPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Matriz"
        pergunta="Quanto a rede tem a comprar, reservou e deve de CAC?"
        descricao="Fila de clientes, carteira das unidades e o multiplicador que define o preço · fila e saldos em CashBrain (CB), CAC em R$"
      />
      <BrokerAdminView />
    </div>
  );
}
