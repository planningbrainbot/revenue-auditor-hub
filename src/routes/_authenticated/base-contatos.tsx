import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsCoberturaTab } from "@/components/nps/nps-cobertura-tab";
import { NpsPlanoAcaoTab } from "@/components/nps/nps-plano-acao-tab";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/base-contatos")({
  component: BaseContatosPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function BaseContatosPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="Base de Contatos"
        descricao="Cobertura de contato de WhatsApp por unidade e plano de ação do CS pra fechar o cadastro"
      />

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
