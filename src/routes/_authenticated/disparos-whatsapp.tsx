import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { NpsExecucaoTab } from "@/components/nps/nps-execucao-tab";
import { CustosTab } from "@/components/whatsapp/custos-tab";
import { Carregando, EstadoErro, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";

const ABAS = ["execucao", "custos"] as const;
type Aba = (typeof ABAS)[number];

// Aba e filtros moram na URL (N7): recarregar ou colar o link reproduz a
// tela. Todas as chaves são opcionais, para os links que já apontam para
// /disparos-whatsapp sem search continuarem valendo. O TanStack desserializa
// JSON do search ("?rodada=2026" chega como número), então os filtros de texto
// são coagidos a string em vez de descartados.
function texto(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return typeof v === "string" ? v : String(v);
}

export const Route = createFileRoute("/_authenticated/disparos-whatsapp")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    aba: ABAS.includes(s.aba as Aba) ? (s.aba as Aba) : undefined,
    // Execução
    rodada: texto(s.rodada),
    unidade: texto(s.unidade),
    status: texto(s.status),
    ligacao: texto(s.ligacao),
    pendentes: s.pendentes === true || s.pendentes === "true" ? true : undefined,
    // Custos
    mes: texto(s.mes),
  }),
  component: DisparosWhatsappPage,
});

// Bloqueada desde 17/09/2026: só quem tem `send.whatsapp` (perfil Super admin)
// abre. Antes o beforeLoad redirecionava em silêncio para "/"; agora a página
// diz qual permissão falta (N8) e não monta as abas, então nenhuma leitura de
// disparo ou de custo sai sem a chave. A régua é a mesma RPC `can` de antes, e
// o servidor continua recusando disparo, reenvio e registro por conta própria.
function usePodeDisparar() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["can", "send.whatsapp", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("can", { _key: "send.whatsapp" });
      if (error) throw new Error(error.message);
      return !!data;
    },
    enabled: !!user,
    staleTime: 60_000,
  });
}

function DisparosWhatsappPage() {
  const acesso = usePodeDisparar();
  const { aba } = Route.useSearch();
  const navigate = Route.useNavigate();
  const abaAtual: Aba = aba ?? "execucao";

  let conteudo: ReactNode;
  // Sem usuário a query fica parada em pending: o layout autenticado resolve a
  // sessão logo em seguida, e até lá o esqueleto é o estado honesto.
  if (acesso.isPending) {
    conteudo = <Carregando variante="kpis" />;
  } else if (acesso.error) {
    conteudo = (
      <EstadoErro
        titulo="Não foi possível conferir o seu acesso"
        detalhe={`Permissão send.whatsapp: ${acesso.error instanceof Error ? acesso.error.message : String(acesso.error)}`}
        tentarNovamente={() => void acesso.refetch()}
      />
    );
  } else if (!acesso.data) {
    conteudo = <EstadoSemAcesso oQueFalta="send.whatsapp" />;
  } else {
    conteudo = (
      <Tabs
        value={abaAtual}
        onValueChange={(v) =>
          navigate({
            search: (prev) => ({ ...prev, aba: v === "execucao" ? undefined : (v as Aba) }),
            replace: true,
            resetScroll: false,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="execucao">Execução</TabsTrigger>
          <TabsTrigger value="custos">Custos</TabsTrigger>
        </TabsList>
        <TabsContent value="execucao" className="mt-4">
          <NpsExecucaoTab />
        </TabsContent>
        <TabsContent value="custos" className="mt-4">
          <CustosTab />
        </TabsContent>
      </Tabs>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        titulo="Disparos de WhatsApp"
        pergunta="Quem recebeu a pesquisa, quem não respondeu, e para quem eu ligo?"
        descricao="Últimos 500 envios da pesquisa NPS · clientes sem churn · atualiza a cada 15 s"
      />
      {conteudo}
    </div>
  );
}
