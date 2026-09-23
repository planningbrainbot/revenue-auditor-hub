import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnboardingTab } from "@/components/painel-cs/onboarding-tab";
import { TratativasTab } from "@/components/painel-cs/tratativas-tab";
import { PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/painel-cs")({
  component: PainelCsPage,
});

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function PainelCsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="CS"
        descricao="Onboarding e tratativas — visão única do relacionamento com o cliente"
      />

      <Tabs defaultValue="onboarding" className="w-full">
        <TabsList>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="tratativas">Tratativas</TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding">
          <OnboardingTab />
        </TabsContent>
        <TabsContent value="tratativas">
          <TratativasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
