import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnboardingTab } from "@/components/painel-cs/onboarding-tab";
import { TratativasTab } from "@/components/painel-cs/tratativas-tab";
import { PageHeader } from "@/components/planning";
import { usePermissions } from "@/hooks/use-permissions";

const ABAS = ["onboarding", "tratativas"] as const;
type Aba = (typeof ABAS)[number];

// Aba e filtros da aba Tratativas moram na URL (N7): recarregar ou colar o
// link reproduz a tela. Todas as chaves são opcionais, para os links que já
// apontam para /painel-cs sem search continuarem valendo. O TanStack
// desserializa JSON do search ("?q=123" chega como número), então os filtros
// de texto são coagidos a string em vez de descartados.
function texto(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" ? v : String(v);
}

export const Route = createFileRoute("/_authenticated/painel-cs")({
  validateSearch: (s: Record<string, unknown>) => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : undefined,
    q: texto(s.q),
    unidade: texto(s.unidade),
    status: texto(s.status),
    de: texto(s.de),
    ate: texto(s.ate),
  }),
  component: PainelCsPage,
});

function PainelCsPage() {
  const perms = usePermissions();
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const abaAtual: Aba = aba ?? "onboarding";
  // Enquanto as permissões carregam o recorte não é conhecido: omite, em vez
  // de dizer "todas as unidades" para quem só vê a própria.
  const recorte = perms.loading
    ? null
    : perms.scopedToOwnUnit && perms.unidade
      ? perms.unidade
      : "todas as unidades";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="CS"
        pergunta="Quais clientes estão travados no onboarding, e quanto perdemos em churn?"
        descricao={`Cards do Pipefy de onboarding e da Central de Tratativas · unidades da rede${recorte ? ` · ${recorte}` : ""}`}
        procedencia={{ fonte: "Pipefy: onboarding e Central de Tratativas" }}
      />

      <Tabs
        value={abaAtual}
        onValueChange={(v) =>
          navigate({
            search: (prev) => ({ ...prev, aba: v as Aba }),
            replace: true,
            resetScroll: false,
          })
        }
        className="w-full"
      >
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
