import { createFileRoute } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { BrokerAdminView } from "@/components/broker/broker-admin-view";

export const Route = createFileRoute("/_authenticated/broker/admin")({
  component: BrokerAdminPage,
});

function BrokerAdminPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Broker · Matriz</h1>
          <p className="text-sm text-muted-foreground">
            Fila de clientes, carteira das unidades e o multiplicador que define o preço
          </p>
        </div>
      </div>
      <BrokerAdminView />
    </div>
  );
}
