import { createFileRoute } from "@tanstack/react-router";
import { MessageSquareHeart } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsPainelTab } from "@/components/nps/nps-painel-tab";
import { NpsExecucaoTab } from "@/components/nps/nps-execucao-tab";
import { NpsPlanoAcaoTab } from "@/components/nps/nps-plano-acao-tab";

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
            Pesquisa de satisfação via WhatsApp — cobertura, painel analítico e acompanhamento de disparos
          </p>
        </div>
      </div>

      <Tabs defaultValue="painel" className="w-full">
        <TabsList>
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="execucao">Execução</TabsTrigger>
          <TabsTrigger value="plano-acao">Plano de Ação</TabsTrigger>
        </TabsList>

        <TabsContent value="painel">
          <NpsPainelTab />
        </TabsContent>
        <TabsContent value="execucao">
          <NpsExecucaoTab />
        </TabsContent>
        <TabsContent value="plano-acao">
          <NpsPlanoAcaoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
