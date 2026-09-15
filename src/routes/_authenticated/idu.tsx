import { createFileRoute } from "@tanstack/react-router";
import { Gauge } from "lucide-react";
import { IduView } from "@/components/idu/idu-view";

export const Route = createFileRoute("/_authenticated/idu")({
  head: () => ({ meta: [{ title: "IDU – Planning" }] }),
  component: IduPage,
});

function IduPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Gauge className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">IDU</h1>
          <p className="text-sm text-muted-foreground">
            Índice de Desempenho da Unidade — a nota do trimestre e o percentual do forecast que ela libera
          </p>
        </div>
      </div>
      <IduView />
    </div>
  );
}
