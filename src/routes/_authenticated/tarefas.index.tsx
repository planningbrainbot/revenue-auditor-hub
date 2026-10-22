import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageSquare, Plus } from "lucide-react";
import {
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
} from "@/components/planning";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CartoesDoTopo,
  CHAVE,
  DialogoNovaTarefa,
  FiltroSelect,
  FiltrosTarefas,
  SeloPrazo,
  SeloPrioridade,
} from "@/components/tarefas/comum";
import { FichaTarefa } from "@/components/tarefas/ficha-tarefa";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { carregarMinhasTarefas } from "@/lib/tarefas/tarefas.functions";
import {
  contar,
  filtrar,
  hojeSaoPaulo,
  lerBuscaTarefas,
  ordenarPorPrazo,
  temFiltro,
  type BuscaTarefas,
  type FiltroStatus,
} from "@/lib/tarefas/regras";

// Minhas tarefas (arquétipo Fila de trabalho): tudo o que está comigo, de qualquer quadro.
// Contrato docs/design/contratos/tarefas.md. Filtros e a ficha aberta ficam na URL (N7).

export const Route = createFileRoute("/_authenticated/tarefas/")({
  validateSearch: (s: Record<string, unknown> & SearchSchemaInput) => lerBuscaTarefas(s),
  head: () => ({ meta: [{ title: "Minhas tarefas · Planning Brain" }] }),
  component: Pagina,
});

const TITULO = "Minhas tarefas";
const PERGUNTA = "O que está comigo, e o que vence primeiro?";

function Pagina() {
  const perms = usePermissions();
  if (perms.loading)
    return (
      <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
        <PageHeader area="tarefas" titulo={TITULO} pergunta={PERGUNTA} />
        <Carregando variante="tabela" />
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
  const busca = Route.useSearch();
  const navigate = Route.useNavigate();
  const [novaAberta, setNovaAberta] = useState(false);
  const fn = useServerFn(carregarMinhasTarefas);
  const q = useQuery({
    queryKey: [...CHAVE, "minhas", eu],
    enabled: !!eu,
    queryFn: () => fn(),
    retry: false,
  });
  const hoje = hojeSaoPaulo();

  const mudar = (b: Partial<BuscaTarefas>) =>
    navigate({ search: (s) => ({ ...s, ...b }), replace: true });
  const limpar = () => navigate({ search: { tarefa: busca.tarefa }, replace: true });

  const d = q.data;
  const nomeQuadro = useMemo(() => new Map((d?.quadros ?? []).map((x) => [x.id, x.nome])), [d]);
  const nomeColuna = useMemo(() => new Map((d?.colunas ?? []).map((x) => [x.id, x.nome])), [d]);
  const nomeProjeto = useMemo(() => new Map((d?.projetos ?? []).map((x) => [x.id, x.nome])), [d]);
  const nomeDep = useMemo(() => new Map((d?.departamentos ?? []).map((x) => [x.id, x.nome])), [d]);

  // Os cartões contam todas as minhas tarefas abertas; a lista obedece aos filtros.
  const contagem = contar(d?.tarefas ?? [], hoje);
  const lista = ordenarPorPrazo(filtrar(d?.tarefas ?? [], busca, { hoje, eu, usarStatus: true }));
  // A tarefa sai desta lista quando passa para outra pessoa, mas a ficha aberta continua nela.
  const ultimaFicha = useRef<{ tarefa?: string; quadro?: string }>({});
  const achado = busca.tarefa ? d?.tarefas.find((t) => t.id === busca.tarefa)?.quadroId : undefined;
  if (achado) ultimaFicha.current = { tarefa: busca.tarefa, quadro: achado };
  const quadroDaFicha =
    achado ??
    (ultimaFicha.current.tarefa === busca.tarefa ? ultimaFicha.current.quadro : undefined);

  const acoes = d?.quadros.length ? (
    <Button onClick={() => setNovaAberta(true)}>
      <Plus className="size-4" aria-hidden />
      Nova tarefa
    </Button>
  ) : null;

  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6 md:py-6">
      <PageHeader
        area="tarefas"
        titulo={TITULO}
        pergunta={PERGUNTA}
        descricao="Tarefas em que você é responsável, em todos os quadros de que é membro · abertas por padrão · contagem: tarefa."
        acoes={acoes}
      />

      {q.isLoading || !eu ? (
        <Carregando variante="tabela" />
      ) : q.isError ? (
        <EstadoErro
          titulo="As tarefas não carregaram"
          detalhe={`Fonte: ops.tarefas. ${(q.error as Error).message}`}
          tentarNovamente={() => q.refetch()}
        />
      ) : !d?.quadros.length ? (
        <EstadoVazio
          titulo="Você ainda não está em nenhum quadro"
          descricao="Crie um quadro e convide quem trabalha com você, ou peça para alguém te convidar."
          acao={
            <Button asChild>
              <Link to="/tarefas/quadros">Ir para Quadros</Link>
            </Button>
          }
        />
      ) : (
        <>
          <CartoesDoTopo contagem={contagem} aoFiltrar={mudar} />
          <FiltrosTarefas
            key={busca.busca ?? ""}
            busca={busca}
            aoMudar={mudar}
            aoLimpar={temFiltro(busca) ? limpar : undefined}
            projetos={d.projetos
              .filter((p) => !p.arquivado)
              .map((p) => ({
                valor: p.id,
                rotulo: `${nomeQuadro.get(p.quadroId) ?? ""} · ${p.nome}`,
              }))}
            departamentos={d.departamentos
              .filter((x) => x.ativo)
              .map((x) => ({ valor: x.id, rotulo: x.nome }))}
            extra={
              <>
                <FiltroSelect
                  rotulo="Quadro"
                  valor={busca.quadro}
                  opcoes={d.quadros.map((x) => ({ valor: x.id, rotulo: x.nome }))}
                  aoMudar={(v) => mudar({ quadro: v })}
                />
                <FiltroSelect
                  rotulo="Status"
                  valor={busca.status === undefined ? "abertas" : busca.status}
                  opcoes={[
                    { valor: "abertas", rotulo: "Abertas" },
                    { valor: "concluidas", rotulo: "Concluídas" },
                    { valor: "todas", rotulo: "Todas" },
                  ]}
                  aoMudar={(v) =>
                    mudar({ status: v === "abertas" || !v ? undefined : (v as FiltroStatus) })
                  }
                  largura="w-36"
                />
              </>
            }
          />

          {!lista.length ? (
            temFiltro(busca) ? (
              <EstadoVazio
                titulo="Nenhuma tarefa com esses filtros"
                total={d.tarefas.length}
                acao={
                  <Button variant="outline" onClick={limpar}>
                    Limpar filtros
                  </Button>
                }
              />
            ) : (
              <EstadoVazio
                titulo="Nada aberto com você"
                descricao="Quando alguém passar uma tarefa para você, ou você criar uma, ela aparece aqui."
              />
            )
          ) : (
            <div className="overflow-x-auto rounded-xl border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tarefa</TableHead>
                    <TableHead>Quadro</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Prioridade</TableHead>
                    <TableHead>Projeto</TableHead>
                    <TableHead>Departamento</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lista.map((t) => (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => mudar({ tarefa: t.id })}
                      aria-selected={busca.tarefa === t.id}
                    >
                      <TableCell className="max-w-md">
                        <button
                          type="button"
                          className="text-left font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:outline-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            mudar({ tarefa: t.id });
                          }}
                        >
                          {t.titulo}
                        </button>
                        {t.comentarios > 0 && (
                          <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <MessageSquare className="size-3.5" aria-hidden />
                            {t.comentarios}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{nomeQuadro.get(t.quadroId)}</TableCell>
                      <TableCell className="text-sm">{nomeColuna.get(t.colunaId)}</TableCell>
                      <TableCell>
                        <SeloPrazo prazo={t.prazo} hoje={hoje} concluida={t.concluida} />
                      </TableCell>
                      <TableCell>
                        <SeloPrioridade prioridade={t.prioridade} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.projetoId ? nomeProjeto.get(t.projetoId) : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {t.departamentoId ? nomeDep.get(t.departamentoId) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <DialogoNovaTarefa
            aberto={novaAberta}
            aoFechar={() => setNovaAberta(false)}
            quadros={d.quadros}
            primeiraColuna={(qid) => d.colunas.find((c) => c.quadroId === qid)?.id}
            eu={eu}
            aoCriar={(id) => {
              setNovaAberta(false);
              mudar({ tarefa: id });
            }}
          />
        </>
      )}

      <FichaTarefa
        tarefaId={busca.tarefa}
        quadroId={quadroDaFicha}
        procurando={q.isLoading || q.isFetching}
        eu={eu}
        aoFechar={() => mudar({ tarefa: undefined })}
      />
    </main>
  );
}
