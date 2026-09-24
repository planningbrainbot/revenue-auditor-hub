import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsCoberturaTab } from "@/components/nps/nps-cobertura-tab";
import { NpsPlanoAcaoTab } from "@/components/nps/nps-plano-acao-tab";
import { PageHeader } from "@/components/planning";

const ABAS = ["cobertura", "plano"] as const;
type Aba = (typeof ABAS)[number];

// Aba e filtros do Plano de ação moram na URL (N7): recarregar ou colar o link
// reproduz a tela. Todas as chaves são opcionais, para os links que já apontam
// para /base-contatos sem search continuarem valendo. O TanStack desserializa
// JSON do search ("?q=123" chega como número), então os filtros de texto são
// coagidos a string em vez de descartados.
function texto(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" ? v : String(v);
}

export const Route = createFileRoute("/_authenticated/base-contatos")({
  validateSearch: (s: Record<string, unknown>) => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : undefined,
    q: texto(s.q),
    unidade: texto(s.unidade),
    situacao: texto(s.situacao),
  }),
  component: BaseContatosPage,
});

function BaseContatosPage() {
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const abaAtual: Aba = aba ?? "cobertura";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Base de Contatos"
        pergunta="Quais clientes ativos não têm contato para receber a pesquisa?"
        descricao="Clientes ativos (franquias de unidades regionais, sem churn) · contato válido = WhatsApp com 10+ dígitos"
      />

      <Tabs
        value={abaAtual}
        onValueChange={(v) =>
          navigate({
            search: (prev) => ({ ...prev, aba: v === "cobertura" ? undefined : (v as Aba) }),
            replace: true,
            resetScroll: false,
          })
        }
        className="w-full"
      >
        <TabsList>
          <TabsTrigger value="cobertura">Cobertura</TabsTrigger>
          <TabsTrigger value="plano">Plano de ação</TabsTrigger>
        </TabsList>

        <TabsContent value="cobertura">
          <NpsCoberturaTab />
        </TabsContent>
        <TabsContent value="plano">
          <NpsPlanoAcaoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
