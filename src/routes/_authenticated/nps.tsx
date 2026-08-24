import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareHeart } from "lucide-react";
import { NpsPainelTab } from "@/components/nps/nps-painel-tab";

export const Route = createFileRoute("/_authenticated/nps")({
  component: NpsPage,
});

function NpsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <MessageSquareHeart className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">NPS</h1>
          <p className="text-sm text-muted-foreground">
            Análise das respostas da pesquisa de satisfação — NPS/CSAT, evolução, por unidade e respostas
          </p>
        </div>
      </div>

      <NpsPainelTab />
    </div>
  );
}
