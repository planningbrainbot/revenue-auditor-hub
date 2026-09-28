import { createFileRoute } from "@tanstack/react-router";
import type { SearchSchemaInput } from "@tanstack/react-router";
import { Carregando, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { PerguntarAoBrain } from "@/components/cockpit-ceo/conversa/perguntar";
import { usePermissions } from "@/hooks/use-permissions";

// "Perguntar ao Brain" (contrato docs/design/contratos/cockpit-ceo-perguntar.md). Item da área
// Cockpit do CEO. A conversa e as visões são privadas; a conversa aberta e a visão salva aberta
// ficam na URL (N7): recarregar ou colar o link reabre a mesma conversa, com os números
// consultados de novo com o acesso de quem abre.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAFICO = /^[a-z0-9-]{1,60}$/i;
type Busca = { conversa?: string; visao?: string; grafico?: string };

export const Route = createFileRoute("/_authenticated/cockpit-ceo_/perguntar")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): Busca => ({
    ...(typeof s.conversa === "string" && UUID.test(s.conversa) ? { conversa: s.conversa } : {}),
    ...(typeof s.visao === "string" && UUID.test(s.visao) ? { visao: s.visao } : {}),
    // Aberta pela gaveta de um gráfico do cockpit: o id do gráfico vai como contexto da 1ª pergunta.
    ...(typeof s.grafico === "string" && GRAFICO.test(s.grafico) ? { grafico: s.grafico } : {}),
  }),
  head: () => ({ meta: [{ title: "Perguntar ao Brain · Planning Brain" }] }),
  component: Pagina,
});

const PERGUNTA = "O que você quer saber sobre a empresa?";
const DESCRICAO =
  "Empresa inteira no seu acesso · os números saem das mesmas fontes e regras do cockpit · conversas e visões são só suas";

function Pagina() {
  const perms = usePermissions();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6 md:py-5">
      <PageHeader
        area="cockpit_ceo"
        titulo="Perguntar ao Brain"
        pergunta={PERGUNTA}
        descricao={DESCRICAO}
      />
      {perms.loading ? (
        <Carregando variante="pagina" />
      ) : !perms.temArea("cockpit_ceo") ? (
        <EstadoSemAcesso oQueFalta="a área Cockpit do CEO (a administração da plataforma concede)" />
      ) : (
        <PerguntarAoBrain
          conversaInicial={busca.conversa ?? null}
          visaoInicial={busca.visao ?? null}
          graficoInicial={busca.grafico ?? null}
          aoMudarBusca={(b) =>
            navigate({
              search: (s: Busca) => {
                const n = { ...s, ...b };
                return {
                  ...(n.conversa ? { conversa: n.conversa } : {}),
                  ...(n.visao ? { visao: n.visao } : {}),
                  ...(n.grafico && !n.conversa ? { grafico: n.grafico } : {}),
                };
              },
              replace: true,
            })
          }
        />
      )}
    </main>
  );
}
