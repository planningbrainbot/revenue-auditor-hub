import { createFileRoute } from "@tanstack/react-router";
import { LayoutDashboard } from "lucide-react";
import { IndicadoresTrimestreView } from "@/components/indicadores-trimestre/indicadores-trimestre-view";

export const Route = createFileRoute("/_authenticated/indicadores-trimestre")({
  head: () => ({ meta: [{ title: "Indicadores do Trimestre – Planning" }] }),
  component: IndicadoresTrimestrePage,
});

function IndicadoresTrimestrePage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <LayoutDashboard className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Indicadores do Trimestre</h1>
          <p className="text-sm text-muted-foreground">
            Os dois slides do deck de Expansão — financeiro e comercial — por unidade
          </p>
        </div>
      </div>
      <IndicadoresTrimestreView />
    </div>
  );
}
