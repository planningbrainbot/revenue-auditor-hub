// Visão "Hoje" da Operação da Monetização (spec docs/superpowers/specs/2026-10-01-monetizacao-acompanhamento-diario.md,
// contrato monetizacao-operacao.md, adendo de 01/10). Arquétipo Visão geral dentro da aba: pergunta e universo,
// KpiCard com meta, "O que pede atenção" em caixa com borda, e a lista linha a linha só no Sheet (Fila de trabalho).
// Nada é calculado aqui: os números vêm de src/lib/monetizacao/acompanhamento.ts.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Download, Info, ListChecks, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EstadoVazio, KpiCard, KpiGrade, Procedencia, Secao } from "@/components/planning";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import {
  ALVOS,
  DIAS_UTEIS_ALERTA_ALTO,
  DIAS_UTEIS_SEM_CONEXAO,
  INDICADORES_DIA,
  conexaoPorUnidade,
  contarPorProduto,
  diaUtilAnterior,
  estoqueERitmo,
  eventosDoDia,
  fimDoMes,
  listaDeAtencao,
  marcacaoDoMes,
  type ItemAtencao,
} from "@/lib/monetizacao/acompanhamento";
import { FERIADOS_NACIONAIS } from "@/lib/monetizacao/feriados";
import { linhaDa, reguaDoPipe } from "@/lib/monetizacao/funil-cumulativo";
import { carregarApoioAcompanhamento, type ApoioAcompanhamento } from "@/lib/monetizacao/functions";
import { type Filtro } from "@/lib/monetizacao/model";
import { nomeDoRecorte } from "@/lib/monetizacao/responsavel";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Negocio } from "@/lib/monetizacao/types";
import type { FiltroAtencao } from "./busca";
import { downloadCsv, FONTE_MONETIZACAO } from "./common";

type Abrir = (
  title: string,
  rows: Negocio[],
  opcoes?: { estoque?: boolean; recorte?: string },
) => void;

const INT = new Intl.NumberFormat("pt-BR");
const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const rotuloMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`;

/** "Finance 19 · Cella 5 · Consultoria 1": só os produtos com card, do maior para o menor. */
function quebraPorProduto(cards: Negocio[]) {
  const n = contarPorProduto(cards);
  return ([...PRODUTOS, "sem_produto"] as const)
    .filter((p) => n[p] > 0)
    .sort((a, b) => n[b] - n[a])
    .map((p) => `${NOMES[p]} ${INT.format(n[p])}`)
    .join(" · ");
}

export function VisaoHoje({
  data,
  filter,
  hoje,
  rotuloProduto,
  atencao,
  mudarAtencao,
  abrir,
}: {
  data: BaseMonetizacao;
  filter: Filtro;
  hoje: string;
  rotuloProduto: string;
  atencao: FiltroAtencao | undefined;
  mudarAtencao: (v: FiltroAtencao | undefined) => void;
  abrir: Abrir;
}) {
  const { user } = useAuth();
  const apoioFn = useServerFn(carregarApoioAcompanhamento);
  const apoio = useQuery({
    queryKey: ["monetizacao-apoio-hoje", user?.id],
    queryFn: () => apoioFn(),
    enabled: !!user,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const [porQue, setPorQue] = useState(false);

  const f = { owner: filter.owner, owners: filter.owners, product: filter.product };
  const quem = nomeDoRecorte(filter);
  const regua = reguaDoPipe(data.stages);
  const anterior = diaUtilAnterior(hoje);
  const dia = eventosDoDia(data.cards, regua, hoje, f);
  const antes = eventosDoDia(data.cards, regua, anterior, f);
  const mes = marcacaoDoMes(data.cards, data.stages, f, hoje);
  // Nome da unidade: o de `monetizacao_unidades` manda; o cadastro da rede só completa as que faltam.
  const unidades = [
    ...data.units,
    ...(apoio.data?.unidades ?? [])
      .filter((u) => !data.units.some((x) => x.id === u.id))
      .map((u) => ({ id: u.id, name: u.nome })),
  ];
  const porUnidade = conexaoPorUnidade(mes, unidades);
  const plano = data.plans.find((p) => p.month === hoje.slice(0, 7) && p.owner_id === filter.owner);
  const estoque = estoqueERitmo(data.cards, regua, f, plano, mes.abordados, hoje);
  const lista = listaDeAtencao(data.cards, regua, f, unidades, hoje);
  const altos = lista?.filter((i) => i.diasUteis >= DIAS_UTEIS_ALERTA_ALTO).length ?? 0;
  const fim = fimDoMes(hoje.slice(0, 7));
  const feriadosRestantes = [...FERIADOS_NACIONAIS].filter(
    (d) => d >= hoje && d <= fim && ![0, 6].includes(new Date(d + "T12:00:00Z").getUTCDay()),
  );
  const universo = [
    "Pipe 39",
    `pré-venda: ${quem}`,
    rotuloProduto,
    `${rotuloMes(hoje)} até ${ddmm(hoje)}`,
    "régua cumulativa: cada abordado conta até a etapa mais adiantada a que chegou",
  ].join(" · ");
  const taxaKpi = (
    rotulo: string,
    valor: number | null,
    alvo: number,
    rotuloAlvo: string,
    nota: string,
    cards: Negocio[] | undefined,
  ) => (
    <KpiCard
      rotulo={rotulo}
      valor={valor === null ? "" : PCT.format(valor)}
      estado={valor === null ? "nao-apurado" : "ok"}
      nota={valor === null ? "nenhum card na etapa de cima no mês" : nota}
      meta={
        valor === null
          ? undefined
          : { valor: PCT.format(alvo), rotulo: rotuloAlvo, progresso: valor / alvo }
      }
      abrir={cards && cards.length ? { onClick: () => abrir(rotulo, cards) } : undefined}
    />
  );
  const conexao = linhaDa(mes.funil, "conexao");
  const agendada = linhaDa(mes.funil, "agendada");

  return (
    <Secao titulo="O mês vai chegar a 50% de marcação?" descricao={universo}>
      {/* 1. Hoje e o dia útil anterior: eventos do dia, de qualquer mês de abordagem */}
      <section aria-label="Hoje" className="rounded-xl border bg-card p-4">
        <p className="text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">Hoje, {ddmm(hoje)}</span> · entre
          parênteses, {ddmm(anterior)}, o dia útil anterior
        </p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-3 xl:grid-cols-5">
          {INDICADORES_DIA.map(({ chave, rotulo }) => {
            const hojeCards = dia[chave];
            const antesCards = antes[chave];
            return (
              <div key={chave} className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {rotulo}
                </p>
                {hojeCards === null ? (
                  <p className="mt-1 text-sm text-muted-foreground">etapa fora do pipe</p>
                ) : (
                  <>
                    <p className="mt-1 flex items-baseline gap-1.5">
                      {hojeCards.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => abrir(`${rotulo} · ${ddmm(hoje)}`, hojeCards)}
                          className="num rounded-sm text-2xl font-bold text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {INT.format(hojeCards.length)}
                        </button>
                      ) : (
                        <span className="num text-2xl font-bold text-foreground">0</span>
                      )}
                      {antesCards && antesCards.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => abrir(`${rotulo} · ${ddmm(anterior)}`, antesCards)}
                          className="num rounded-sm text-sm text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          ({INT.format(antesCards.length)})
                        </button>
                      ) : (
                        <span className="num text-sm text-muted-foreground">(0)</span>
                      )}
                    </p>
                    {hojeCards.length > 0 && (
                      <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">
                        {quebraPorProduto(hojeCards)}
                      </p>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Eventos do dia: cada card que entrou na etapa no dia, de qualquer mês de abordagem. A
          saída da Base pela integração do Ops não é abordagem, e toque desfeito em menos de 30
          minutos não conta.
        </p>
      </section>

      {/* 2. Mês até hoje, na coorte cumulativa */}
      <div className="space-y-2">
        <KpiGrade colunas={4}>
          {taxaKpi(
            "Qualificação",
            mes.taxaConexao,
            ALVOS.conexao,
            "alvo",
            `${INT.format(mes.conexao ?? 0)} de ${INT.format(mes.abordados)} abordados`,
            conexao?.cards,
          )}
          {taxaKpi(
            "Levantamento com sócio",
            mes.taxaLevantamento,
            ALVOS.levantamento,
            "alvo",
            `${INT.format(mes.agendados ?? 0)} de ${INT.format(mes.conexao ?? 0)} com Qualificação`,
            agendada?.cards,
          )}
          {taxaKpi(
            "Marcação",
            mes.marcacao,
            ALVOS.marcacao,
            "meta",
            `${INT.format(mes.agendados ?? 0)} de ${INT.format(mes.abordados)} abordados`,
            agendada?.cards,
          )}
          <KpiCard
            rotulo="Faltam para 50%"
            valor={mes.faltam === null ? "" : INT.format(mes.faltam)}
            unidade={mes.faltam === 1 ? "levantamento" : "levantamentos"}
            estado={mes.faltam === null ? "nao-apurado" : "ok"}
            nota={`sobre os ${INT.format(mes.abordados)} abordados do mês`}
          />
        </KpiGrade>
        <p className="text-xs text-muted-foreground">
          Quem foi abordado hoje ainda não teve tempo de responder. Faltam = metade dos abordados,
          arredondada para cima, menos os agendados
          {mes.faltam !== null &&
            `: ${INT.format(Math.ceil(ALVOS.marcacao * mes.abordados))} − ${INT.format(mes.agendados ?? 0)} = ${INT.format(mes.faltam)}`}
          .
        </p>
      </div>

      {/* 5. O que pede atenção: até 3 itens, um por linha, cada um com destino */}
      <section aria-label="O que pede atenção" className="rounded-xl border bg-card">
        <h3 className="px-4 pt-3 text-sm font-semibold text-foreground">O que pede atenção</h3>
        <ul className="divide-y">
          {lista && lista.length > 0 && (
            <ItemAtencaoLinha
              icone="atencao"
              texto={
                <>
                  <strong className="num font-semibold text-foreground">
                    {INT.format(lista.length)}
                  </strong>{" "}
                  {lista.length === 1 ? "abordado" : "abordados"} há {DIAS_UTEIS_SEM_CONEXAO} dias
                  úteis ou mais, sem Qualificação · {INT.format(altos)}{" "}
                  {altos === 1 ? "passa" : "passam"} de {DIAS_UTEIS_ALERTA_ALTO} dias úteis
                </>
              }
              acao={
                <Button variant="outline" size="sm" onClick={() => mudarAtencao("todos")}>
                  <ListChecks className="size-4" strokeWidth={1.75} aria-hidden />
                  Abrir lista
                </Button>
              }
            />
          )}
          {estoque.meta !== null && estoque.faltamContas > 0 && (
            <ItemAtencaoLinha
              icone="atencao"
              texto={
                <>
                  A Base não cobre a meta de {INT.format(estoque.meta)} abordagens: faltam{" "}
                  <strong className="num font-semibold text-foreground">
                    {INT.format(estoque.faltamContas)}
                  </strong>{" "}
                  {estoque.faltamContas === 1 ? "conta" : "contas"}, mesmo esgotando a Base
                </>
              }
              acao={
                <Button asChild variant="outline" size="sm">
                  <Link to="/clientes" search={{ view: "produtos" }}>
                    Abrir Produtos e listas
                  </Link>
                </Button>
              }
            />
          )}
          <ItemAtencaoLinha
            icone="info"
            texto={<>“Três produtos” ainda não se mede: o campo de produto do card aceita um só</>}
            acao={
              <Button variant="outline" size="sm" onClick={() => setPorQue(true)}>
                Ver por quê
              </Button>
            }
          />
        </ul>
      </section>

      {/* 3 e 4. Qualificação por unidade · Estoque e ritmo */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ConexaoPorUnidade porUnidade={porUnidade} abrir={abrir} />
        <EstoqueRitmo
          estoque={estoque}
          abordados={mes.abordados}
          fim={fim}
          feriados={feriadosRestantes}
          abrir={abrir}
        />
      </div>

      <ListaAtencao
        lista={lista}
        aberta={!!atencao}
        filtro={atencao ?? "todos"}
        mudar={mudarAtencao}
        apoio={apoio}
        hoje={hoje}
        recorte={rotuloProduto}
        quem={quem}
        measuredAt={data.measured_at}
      />
      <Dialog open={porQue} onOpenChange={setPorQue}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Por que “três produtos” ainda não se mede</DialogTitle>
            <DialogDescription>
              O campo Caixa · Produto do card no Pipedrive é de opção única: guarda um produto só.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>
              Quando o pré-vendedor apresenta o Caixa de Oportunidade inteiro, a tela só sabe o
              produto que está no card, e cada número por produto conta esse produto.
            </p>
            <p>
              Medir os três produtos apresentados no mesmo card depende de a frente 01 mudar o
              campo. Até lá, este aviso fica aqui.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </Secao>
  );
}

function ItemAtencaoLinha({
  icone,
  texto,
  acao,
}: {
  icone: "atencao" | "info";
  texto: ReactNode;
  acao: ReactNode;
}) {
  const Icone = icone === "atencao" ? TriangleAlert : Info;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
      <p className="flex min-w-0 items-start gap-2 text-sm text-muted-foreground">
        <Icone
          className={cn(
            "mt-0.5 size-4 shrink-0",
            icone === "atencao" ? "text-warning" : "text-info",
          )}
          strokeWidth={1.75}
          aria-hidden
        />
        <span>{texto}</span>
      </p>
      {acao}
    </li>
  );
}

function ConexaoPorUnidade({
  porUnidade,
  abrir,
}: {
  porUnidade: ReturnType<typeof conexaoPorUnidade>;
  abrir: Abrir;
}) {
  const alvo = ALVOS.conexao * 100;
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">
        Em que unidade os abordados do mês respondem?
      </h3>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Qualificação de N abordados no mês, pela unidade da conta na Base. Traço: alvo de{" "}
        {PCT.format(ALVOS.conexao)}.
      </p>
      {porUnidade === null ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Não apurado: a carga não trouxe a unidade dos cards.
        </p>
      ) : porUnidade.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Nenhum card abordado no mês ainda.</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {porUnidade.map((u) => {
            const pct = u.abordados.length ? (u.conexao.length / u.abordados.length) * 100 : 0;
            return (
              <li key={u.unidade}>
                <button
                  type="button"
                  onClick={() => abrir(`${u.unidade} · abordados no mês`, u.abordados)}
                  className="grid w-full grid-cols-[minmax(0,9rem)_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-md px-1 py-1 text-left outline-none transition-colors duration-[120ms] hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    className={cn(
                      "truncate text-sm",
                      u.unidade === "Sem unidade" ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {u.unidade}
                  </span>
                  <span className="relative block h-2 rounded-full bg-muted" aria-hidden>
                    <span
                      className="absolute inset-y-0 left-0 rounded-full bg-primary-text"
                      style={{ width: `${pct}%` }}
                    />
                    <span
                      className="absolute -inset-y-1 border-l border-dashed border-muted-foreground"
                      style={{ left: `${alvo}%` }}
                    />
                  </span>
                  <span className="num text-right text-sm text-foreground">
                    {INT.format(u.conexao.length)}{" "}
                    <span className="text-muted-foreground">
                      de {INT.format(u.abordados.length)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-auto pt-3 text-xs text-muted-foreground">
        Com 1 ou 2 abordagens, a taxa ainda não diz nada. Card sem unidade na conta entra em “Sem
        unidade”; a unidade não é deduzida pelo dono do card.
      </p>
    </section>
  );
}

function EstoqueRitmo({
  estoque,
  abordados,
  fim,
  feriados,
  abrir,
}: {
  estoque: ReturnType<typeof estoqueERitmo>;
  abordados: number;
  fim: string;
  feriados: string[];
  abrir: Abrir;
}) {
  const linha = (numero: ReactNode, texto: ReactNode, nota?: ReactNode) => (
    <li className="flex items-baseline gap-3">
      <span className="num w-14 shrink-0 text-right text-2xl font-bold text-foreground">
        {numero}
      </span>
      <span className="min-w-0 text-sm text-foreground">
        {texto}
        {nota && <span className="block text-[13px] text-muted-foreground">{nota}</span>}
      </span>
    </li>
  );
  return (
    <section className="flex flex-col rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">A Base dá para a meta do mês?</h3>
      <ul className="mt-3 space-y-3">
        {linha(
          estoque.base.length > 0 ? (
            <button
              type="button"
              onClick={() => abrir("Base elegível · no pipe hoje", estoque.base, { estoque: true })}
              className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {INT.format(estoque.base.length)}
            </button>
          ) : (
            "0"
          ),
          "na Base elegível, abertos agora",
          estoque.base.length > 0 ? quebraPorProduto(estoque.base) : undefined,
        )}
        {linha(
          INT.format(estoque.uteisRestantes),
          `${estoque.uteisRestantes === 1 ? "dia útil" : "dias úteis"} até ${ddmm(fim)}, contando hoje`,
          feriados.length
            ? `${feriados.map(ddmm).join(", ")} ${feriados.length === 1 ? "é feriado" : "são feriados"}`
            : undefined,
        )}
        {estoque.meta === null
          ? linha(
              "—",
              "abordagens por dia útil",
              "A meta de abordagens é da frente inteira; limpe o filtro de produto para ver o ritmo.",
            )
          : linha(
              estoque.porDiaUtil === null ? "—" : INT.format(estoque.porDiaUtil),
              `abordagens por dia útil para chegar a ${INT.format(estoque.meta)}`,
              estoque.metaDoPlano
                ? "meta do plano do mês, em Capacidade e alocação"
                : "120 por closer: o mês não tem plano cadastrado",
            )}
      </ul>
      {estoque.meta !== null && (
        <p className="mt-auto pt-3 text-[13px] text-muted-foreground">
          {INT.format(abordados)} abordados + {INT.format(estoque.base.length)} na Base ={" "}
          {INT.format(abordados + estoque.base.length)}.{" "}
          {estoque.faltamContas > 0
            ? `Mesmo esgotando a Base, faltam ${INT.format(estoque.faltamContas)} ${estoque.faltamContas === 1 ? "conta" : "contas"} para ${INT.format(estoque.meta)} abordagens.`
            : `A Base cobre as ${INT.format(estoque.meta)} abordagens do mês.`}
        </p>
      )}
    </section>
  );
}

const FAIXAS: { v: FiltroAtencao; rotulo: string; vale: (i: ItemAtencao) => boolean }[] = [
  { v: "todos", rotulo: "Todos", vale: () => true },
  {
    v: "10mais",
    rotulo: `${DIAS_UTEIS_ALERTA_ALTO} dias úteis ou mais`,
    vale: (i) => i.diasUteis >= DIAS_UTEIS_ALERTA_ALTO,
  },
  {
    v: "3a9",
    rotulo: `${DIAS_UTEIS_SEM_CONEXAO} a ${DIAS_UTEIS_ALERTA_ALTO - 1}`,
    vale: (i) => i.diasUteis < DIAS_UTEIS_ALERTA_ALTO,
  },
];

/**
 * Lista de atenção (Fila de trabalho num Sheet): abordados sem Qualificação há 3 dias úteis ou mais, com os sócios da
 * unidade (todos: não há sócio de referência, decisão do Pedro em 01/10). Filtro de idade na URL (`atencao`).
 */
function ListaAtencao({
  lista,
  aberta,
  filtro,
  mudar,
  apoio,
  hoje,
  recorte,
  quem,
  measuredAt,
}: {
  lista: ItemAtencao[] | null;
  aberta: boolean;
  filtro: FiltroAtencao;
  mudar: (v: FiltroAtencao | undefined) => void;
  apoio: UseQueryResult<ApoioAcompanhamento>;
  hoje: string;
  recorte: string;
  quem: string;
  measuredAt: string | null;
}) {
  const todos = lista ?? [];
  const faixa = FAIXAS.find((x) => x.v === filtro) ?? FAIXAS[0];
  const visiveis = todos.filter(faixa.vale);
  const sociosDa = new Map<number, string[]>();
  for (const s of apoio.data?.socios.linhas ?? [])
    sociosDa.set(s.unidade_id, [...(sociosDa.get(s.unidade_id) ?? []), s.nome]);
  // Texto da coluna de sócios, com cada ausência dizendo o porquê (N4).
  const socios = (i: ItemAtencao): { texto: string; ausente: boolean } => {
    if (apoio.isPending) return { texto: "carregando…", ausente: true };
    if (apoio.isError) return { texto: "sócios indisponíveis", ausente: true };
    if (!apoio.data.socios.acesso) return { texto: "sem acesso aos sócios", ausente: true };
    if (!i.unidade_ids.length) return { texto: "sem unidade", ausente: true };
    const nomes = i.unidade_ids.flatMap((id) => sociosDa.get(id) ?? []);
    return nomes.length
      ? { texto: nomes.join(", "), ausente: false }
      : { texto: "sem sócio cadastrado", ausente: true };
  };
  const exportar = () =>
    downloadCsv(`monetizacao-atencao-${hoje}.csv`, [
      ["Empresa", "Card", "Produto", "Unidade", "Sócios da unidade", "Abordado em", "Dias úteis"],
      ...visiveis.map((i) => [
        i.card.title,
        i.card.url,
        NOMES[i.card.route],
        i.unidade,
        socios(i).texto,
        i.abordadoEm,
        i.diasUteis,
      ]),
    ]);
  return (
    <Sheet open={aberta} onOpenChange={(o) => !o && mudar(undefined)}>
      <SheetContent className="flex w-full flex-col gap-4 overflow-y-auto sm:max-w-4xl">
        <SheetHeader className="pr-8">
          <SheetTitle>
            Abordados sem Qualificação há {DIAS_UTEIS_SEM_CONEXAO} dias úteis ou mais
          </SheetTitle>
          <SheetDescription>
            Abertos em Abordagem iniciada que nunca chegaram à Qualificação · dono atual: {quem} ·{" "}
            {recorte} · dias úteis desde a saída da Base, sem feriados
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            role="group"
            aria-label="Dias úteis desde a abordagem"
            className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-input bg-card p-0.5"
          >
            {FAIXAS.map((x) => (
              <button
                key={x.v}
                type="button"
                aria-pressed={filtro === x.v}
                onClick={() => mudar(x.v)}
                className={cn(
                  "h-full rounded-md px-3 text-[13px] font-medium outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
                  filtro === x.v
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {x.rotulo} <span className="num">({INT.format(todos.filter(x.vale).length)})</span>
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={exportar} disabled={!visiveis.length}>
            <Download className="size-4" strokeWidth={1.75} aria-hidden />
            Baixar CSV
          </Button>
        </div>
        {lista === null ? (
          <EstadoVazio
            titulo="Lista não apurada"
            descricao="O pipe não tem as etapas Abordagem iniciada e Qualificação (antes, Conexão)."
          />
        ) : visiveis.length === 0 ? (
          <EstadoVazio
            titulo="Nenhum abordado sem Qualificação nesta faixa"
            total={filtro === "todos" ? undefined : todos.length}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Sócios da unidade</TableHead>
                <TableHead>Abordado em</TableHead>
                <TableHead className="text-right">Dias úteis</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visiveis.map((i) => {
                const s = socios(i);
                return (
                  <TableRow key={i.card.id} className="align-top">
                    <TableCell>
                      <a
                        href={i.card.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary-text underline"
                      >
                        {i.card.title}
                      </a>
                    </TableCell>
                    <TableCell>{NOMES[i.card.route]}</TableCell>
                    <TableCell
                      className={cn(
                        i.unidade_ids.length ? "text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {i.unidade}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "max-w-64",
                        s.ausente ? "text-muted-foreground" : "text-foreground",
                      )}
                    >
                      {s.texto}
                    </TableCell>
                    <TableCell className="num">{ddmm(i.abordadoEm)}</TableCell>
                    <TableCell className="num text-right font-semibold">
                      {INT.format(i.diasUteis)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <Procedencia
          className="mt-auto"
          fonte={`${FONTE_MONETIZACAO}; sócios: cadastro de sócios das unidades`}
          atualizadoEm={measuredAt}
          regua={`abordado há ${DIAS_UTEIS_SEM_CONEXAO}+ dias úteis, sem nunca ficar 30 min na Qualificação ou além`}
        />
      </SheetContent>
    </Sheet>
  );
}
