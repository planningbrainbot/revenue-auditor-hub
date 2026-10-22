import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Settings2 } from "lucide-react";
import { Carregando, EstadoErro, EstadoSemAcesso, PageHeader } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { CartoesDoTopo, CHAVE, FiltroSelect, FiltrosTarefas } from "@/components/tarefas/comum";
import { ConfigQuadro } from "@/components/tarefas/config-quadro";
import { FichaTarefa } from "@/components/tarefas/ficha-tarefa";
import { QuadroKanban } from "@/components/tarefas/quadro-kanban";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { carregarQuadro } from "@/lib/tarefas/tarefas.functions";
import {
  contar,
  filtrar,
  hojeSaoPaulo,
  lerBuscaTarefas,
  temFiltro,
  type BuscaTarefas,
} from "@/lib/tarefas/regras";

// Um quadro em colunas (Fila de trabalho). Contrato docs/design/contratos/tarefas.md.
// Quem não é membro recebe "sem acesso" sem nome nem conteúdo do quadro: a RLS devolve nada.

type Busca = BuscaTarefas & { config?: boolean };

export const Route = createFileRoute("/_authenticated/tarefas/quadros/$quadroId")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput): Busca => ({
    ...lerBuscaTarefas(s),
    config: s.config === true || s.config === "true" || s.config === 1 ? true : undefined,
  }),
  head: () => ({ meta: [{ title: "Quadro · Planning Brain" }] }),
  component: Pagina,
});

const TITULO = "Quadro";
const PERGUNTA = "Em que pé está o trabalho deste quadro?";

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <Carregando variante="pagina" />
      </main>
    );
  if (!perms.temArea("tarefas"))
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <EstadoSemAcesso oQueFalta="a área Tarefas (a administração concede)" />
      </main>
    );
  return <ComAcesso />;
}

function ComAcesso() {
  const { user } = useAuth();
  const eu = user?.id ?? "";
  const { quadroId } = Route.useParams();
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const fn = useServerFn(carregarQuadro);
  const q = useQuery({
    queryKey: [...CHAVE, "quadro", quadroId],
    enabled: !!eu,
    queryFn: () => fn({ data: { quadroId } }),
    retry: false,
  });
  const hoje = hojeSaoPaulo();
  const mudar = (b: Partial<Busca>) => navigate({ search: (s) => ({ ...s, ...b }), replace: true });
  const limpar = () => navigate({ search: { tarefa: busca.tarefa }, replace: true });

  if (q.isLoading || !eu)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <Carregando variante="pagina" />
      </main>
    );
  if (q.isError)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <EstadoErro
          titulo="O quadro não carregou"
          detalhe={`Fonte: ops.tarefas. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      </main>
    );
  const d = q.data;
  if (!d)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <EstadoSemAcesso oQueFalta="ser membro deste quadro (peça ao dono), ou o quadro foi arquivado" />
        <Button asChild variant="outline">
          <Link to="/tarefas/quadros">Ver meus quadros</Link>
        </Button>
      </main>
    );

  const visiveis = filtrar(d.tarefas, busca, { hoje, eu, usarStatus: false });
  const membros = d.membros.map((m) => ({
    valor: m.userId,
    rotulo: m.userId === eu ? `${m.nome} (você)` : m.nome,
  }));

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="tarefas"
        titulo={TITULO}
        pergunta={d.quadro.nome}
        descricao={
          <>
            {d.quadro.descricao ? `${d.quadro.descricao} · ` : ""}
            Todas as tarefas do quadro · contagem: tarefa · {d.membros.length}{" "}
            {d.membros.length === 1 ? "pessoa" : "pessoas"}.
          </>
        }
        acoes={
          <Button variant="outline" onClick={() => mudar({ config: true })}>
            <Settings2 className="size-4" aria-hidden />
            {d.quadro.meuPapel === "dono" ? "Configurar quadro" : "Sobre o quadro"}
          </Button>
        }
      />
      <CartoesDoTopo
        contagem={contar(d.tarefas, hoje)}
        aoFiltrar={(b) => mudar({ ...b, status: undefined })}
      />
      <FiltrosTarefas
        key={busca.busca ?? ""}
        busca={busca}
        aoMudar={mudar}
        aoLimpar={temFiltro(busca) ? limpar : undefined}
        projetos={d.projetos
          .filter((p) => !p.arquivado)
          .map((p) => ({ valor: p.id, rotulo: p.nome }))}
        departamentos={d.departamentos
          .filter((x) => x.ativo)
          .map((x) => ({ valor: x.id, rotulo: x.nome }))}
        extra={
          <FiltroSelect
            rotulo="Responsável"
            valor={busca.responsavel}
            opcoes={[{ valor: "ninguem", rotulo: "Sem responsável" }, ...membros]}
            aoMudar={(v) => mudar({ responsavel: v })}
          />
        }
      />
      <QuadroKanban
        dados={d}
        tarefas={visiveis}
        hoje={hoje}
        eu={eu}
        filtrando={temFiltro(busca)}
        aoAbrir={(id) => mudar({ tarefa: id })}
      />
      <FichaTarefa
        tarefaId={busca.tarefa}
        quadroId={quadroId}
        eu={eu}
        aoFechar={() => mudar({ tarefa: undefined })}
      />
      <ConfigQuadro
        aberto={!!busca.config}
        aoFechar={() => mudar({ config: undefined })}
        dados={d}
        eu={eu}
      />
    </main>
  );
}
