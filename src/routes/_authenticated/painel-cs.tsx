import { createFileRoute } from "@tanstack/react-router";
import { UserCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnboardingTab } from "@/components/painel-cs/onboarding-tab";
import { SaudeCarteiraTab } from "@/components/painel-cs/saude-carteira-tab";
import { TratativasTab } from "@/components/painel-cs/tratativas-tab";

export const Route = createFileRoute("/_authenticated/painel-cs")({
  component: PainelCsPage,
});

function PainelCsPage() {
  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <UserCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">CS</h1>
          <p className="text-sm text-muted-foreground">
            Onboarding, saúde da carteira e tratativas — visão única do relacionamento com o cliente
          </p>
        </div>
      </div>

      <Tabs defaultValue="onboarding" className="w-full">
        <TabsList>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="saude-carteira">Saúde da Carteira</TabsTrigger>
          <TabsTrigger value="tratativas">Tratativas</TabsTrigger>
        </TabsList>

        <TabsContent value="onboarding">
          <OnboardingTab />
        </TabsContent>
        <TabsContent value="saude-carteira">
          <SaudeCarteiraTab />
        </TabsContent>
        <TabsContent value="tratativas">
          <TratativasTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
