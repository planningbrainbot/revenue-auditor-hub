import { createFileRoute } from "@tanstack/react-router";
import { BookUser } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsCoberturaTab } from "@/components/nps/nps-cobertura-tab";
import { NpsPlanoAcaoTab } from "@/components/nps/nps-plano-acao-tab";

export const Route = createFileRoute("/_authenticated/base-contatos")({
  component: BaseContatosPage,
});

function BaseContatosPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <BookUser className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Base de Contatos</h1>
          <p className="text-sm text-muted-foreground">
            Cobertura de contato de WhatsApp por unidade e plano de ação do CS pra fechar o cadastro
          </p>
        </div>
      </div>

      <Tabs defaultValue="cobertura" className="w-full">
        <TabsList>
          <TabsTrigger value="cobertura">Cobertura</TabsTrigger>
          <TabsTrigger value="plano-acao">Plano de Ação</TabsTrigger>
        </TabsList>

        <TabsContent value="cobertura">
          <NpsCoberturaTab />
        </TabsContent>
        <TabsContent value="plano-acao">
          <NpsPlanoAcaoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
