import { createFileRoute } from "@tanstack/react-router";
import { Scale } from "lucide-react";
import { EbitOperacionalView } from "@/components/ebit-operacional/ebit-operacional-view";

export const Route = createFileRoute("/_authenticated/ebit-operacional")({
  component: EbitOperacionalPage,
});

function EbitOperacionalPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Scale className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">EBIT Operacional</h1>
          <p className="text-sm text-muted-foreground">
            Meta: zerar o custo operacional do time via venda de serviços internos para as unidades
          </p>
        </div>
      </div>
      <EbitOperacionalView />
    </div>
  );
}
