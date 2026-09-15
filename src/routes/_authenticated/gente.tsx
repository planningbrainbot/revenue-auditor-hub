import { createFileRoute, useSearch } from "@tanstack/react-router";
import { Users } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GenteView } from "@/components/gente/gente-view";
import { GenteUmAUmTab, GenteFeedbackTab } from "@/components/gente/gente-conversas-tab";

// A aba vem da URL para o menu poder apontar direto para 1:1 e Feedback, em vez
// de jogar todo mundo no Cadastro e obrigar a clicar de novo.
type Aba = "cadastro" | "um-a-um" | "feedback";
const ABAS: Aba[] = ["cadastro", "um-a-um", "feedback"];

export const Route = createFileRoute("/_authenticated/gente")({
  validateSearch: (busca: Record<string, unknown>): { aba: Aba } => {
    const bruta = String(busca?.aba ?? "cadastro");
    return { aba: (ABAS as string[]).includes(bruta) ? (bruta as Aba) : "cadastro" };
  },
  component: GentePage,
});

function GentePage() {
  const { aba } = useSearch({ from: "/_authenticated/gente" });
  const navegar = Route.useNavigate();

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Planning People</h1>
          <p className="text-sm text-muted-foreground">
            Cadastro, 1:1 e feedback das pessoas das unidades. Cada unidade enxerga só a sua, e
            dentro dela vale a hierarquia.
          </p>
        </div>
      </div>

      <Tabs
        value={aba}
        onValueChange={(v) => navegar({ search: { aba: v as Aba }, replace: true })}
      >
        <TabsList>
          <TabsTrigger value="cadastro">Cadastro</TabsTrigger>
          <TabsTrigger value="um-a-um">1:1</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>
        <TabsContent value="cadastro" className="mt-4">
          <GenteView />
        </TabsContent>
        <TabsContent value="um-a-um" className="mt-4">
          <GenteUmAUmTab />
        </TabsContent>
        <TabsContent value="feedback" className="mt-4">
          <GenteFeedbackTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
