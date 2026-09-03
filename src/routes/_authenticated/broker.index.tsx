import { createFileRoute } from "@tanstack/react-router";
import { Coins } from "lucide-react";
import { BrokerUnidadeView } from "@/components/broker/broker-unidade-view";

export const Route = createFileRoute("/_authenticated/broker/")({
  component: BrokerUnidadePage,
});

function BrokerUnidadePage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Coins className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Broker</h1>
          <p className="text-sm text-muted-foreground">
            Clientes disponíveis para a sua unidade e o seu saldo em CashBrain
          </p>
        </div>
      </div>
      <BrokerUnidadeView />
    </div>
  );
}
