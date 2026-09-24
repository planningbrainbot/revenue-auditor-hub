import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAtualizarMonetizacao, useMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import { hoje, METRICAS, operacao } from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Metrica, Negocio, Plano } from "@/lib/monetizacao/types";
import { Analysis } from "./analysis";
import { fonteDoForecast, mesDoForecast } from "./forecast";
import {
  ABAS,
  DIAS_PADRAO,
  RESPONSAVEL_PADRAO,
  filtroDaBusca,
  periodoParaBusca,
  type Aba,
  type BuscaMonetizacao,
  type ProdutoUrl,
} from "./busca";
import {
  date,
  downloadCsv,
  estadoDaCarga,
  estadoKpiEvento,
  Field,
  FOCO_VISIVEL,
  Freshness,
  inputClass,
  money,
  NotaApoio,
  number,
  podeEscrever,
  procedenciaMonetizacao,
  SecaoCartao,
} from "./common";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  PageHeader,
} from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  tooltipProps,
} from "@/lib/planning/grafico";

export { ABAS };
export type { Aba };

/** Título = rótulo do item do menu (`areas.ts`); pergunta = contrato de cada aba (N1). */
const TITULOS: Record<Aba, string> = {
  operacao: "Operação diária",
  forecast: "Projetado × realizado",
  temporal: "Temporal e previsão",
  capacidade: "Capacidade e alocação",
  "follow-day": "Follow Day",
  funil: "Funil comercial",
  pessoas: "Pessoas e PDI",
  roteiros: "Abordagens",
  distribuicao: "Distribuição",
};
const PERGUNTAS: Record<Aba, string> = {
  operacao: "O ritmo de hoje leva à meta do mês?",
  "follow-day": "Qual negócio aberto eu destravo hoje?",
  temporal: "Quando as oportunidades abertas devem virar contrato, e quanto valem?",
  forecast: "O mês está acima ou abaixo do que a planilha projetou?",
  capacidade: "A base disponível cobre o que planejamos trabalhar em cada produto neste mês?",
  funil: "Quantas reuniões marcadas acontecem, e quantas validadas viram contrato?",
  pessoas:
    "Como o hunter está nos cinco critérios, e qual é o próximo passo de desenvolvimento dele?",
  roteiros: "O que eu digo para este produto e este segmento?",
  distribuicao: "A carga está bem dividida entre os responsáveis, ou alguém está sem base?",
};

/**
 * O que a barra de filtros mostra em cada aba (moldura, "Filtros na URL"). `responsavel` é o
 * rótulo, que diz o sentido do filtro na visão: autor do evento ou dono atual.
 * Follow Day é estoque (sem De/Até); Abordagens e Projetado × realizado não têm barra da
 * moldura (o mês do forecast é seletor da própria visão); Distribuição já é por responsável.
 */
const BARRA: Record<
  Aba,
  { periodo: boolean; responsavel: string | null; produto: boolean } | null
> = {
  operacao: { periodo: true, responsavel: "Quem fez o movimento", produto: true },
  funil: { periodo: true, responsavel: "Quem fez o movimento", produto: true },
  "follow-day": { periodo: false, responsavel: "Dono atual", produto: true },
  temporal: { periodo: true, responsavel: "Dono atual", produto: true },
  capacidade: { periodo: true, responsavel: "Responsável", produto: false },
  pessoas: { periodo: true, responsavel: "Responsável", produto: false },
  distribuicao: { periodo: true, responsavel: null, produto: true },
  forecast: null,
  roteiros: null,
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "01/09 a 24/09"; com o ano quando o período atravessa anos. */
const rotuloPeriodo = (from: string, to: string) =>
  from.slice(0, 4) === to.slice(0, 4)
    ? `${diaMes(from)} a ${diaMes(to)}`
    : `${diaMes(from)}/${from.slice(0, 4)} a ${diaMes(to)}/${to.slice(0, 4)}`;
const rotuloProduto = (p: ProdutoUrl | undefined) =>
  !p ? "Todos os produtos" : p === "sem_produto" ? "Sem produto" : NOMES[p];

const MOTIVO_ATUALIZAR_SEM_ESCOPO = "Relê a tela; disparar a carga do CRM exige escopo geral";
const ACESSO_NEGADO = /^Seu acesso não inclui/;

/** Opções do detalhe: estoque ("abertas hoje", sem período) e a data que ordena as linhas. */
export type OpcoesDetalhe = {
  estoque?: boolean;
  /** Data (aaaa-mm-dd) do evento que o número conta; linhas mais recentes primeiro. */
  ordenarPor?: (c: Negocio) => string | null | undefined;
  /**
   * Recorte do cabeçalho quando a lista não é o recorte da barra (ex.: negócios sem histórico
   * sobre toda a carga): substitui "responsável · produto · período".
   */
  recorte?: string;
};
type Detalhe = {
  title: string;
  rows: Negocio[];
  period?: { from: string; to: string };
} & OpcoesDetalhe;

/** Data mais recente do evento `k` no período, pelo autor filtrado: ordena o detalhe. */
const ultimoEvento = (k: Metrica, f: Filtro) => (c: Negocio) =>
  c.events[k]
    .filter((e) => e.date >= f.from && e.date <= f.to && (!f.owner || e.actor_id === f.owner))
    .map((e) => e.date)
    .sort()
    .at(-1);

export function DashboardMonetizacao({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const aba = busca.aba;
  const q = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  const today = hoje();
  const filter = filtroDaBusca(busca);
  // Rascunho de De/Até: as datas só valem ao "Aplicar"; relê a URL quando ela muda por fora.
  const [dates, setDates] = useState({ from: filter.from, to: filter.to });
  useEffect(() => setDates({ from: filter.from, to: filter.to }), [filter.from, filter.to]);
  const [refreshing, setRefreshing] = useState(false),
    [detail, setDetail] = useState<Detalhe | null>(null);

  // O menu lateral leva a `?aba=x` sem os filtros, inclusive na aba em que já se está. Antes,
  // o recorte vivia no componente e sobrevivia a isso; aqui a referência guarda a última
  // intenção de filtro da página e a repõe quando a URL chega sem nenhuma chave de filtro.
  // Toda mudança feita pela própria barra (inclusive "Limpar filtros", que grava a referência
  // vazia) passa por `mudarFiltros`, então só a navegação de fora dispara a reposição.
  const compartilhados = {
    de: busca.de,
    ate: busca.ate,
    responsavel: busca.responsavel,
    produto: busca.produto,
  };
  type Compartilhados = typeof compartilhados;
  const assinatura = JSON.stringify(compartilhados);
  const intencao = useRef<Compartilhados>(compartilhados);
  const mudarFiltros = (patch: Partial<Compartilhados>) => {
    intencao.current = { ...compartilhados, ...patch };
    mudarBusca(patch);
  };
  useEffect(() => {
    const vazio = Object.values(compartilhados).every((v) => v === undefined);
    const tinha = Object.values(intencao.current).some((v) => v !== undefined);
    // Repor preenche a URL, então o efeito seguinte cai no `else` e não há laço.
    if (vazio && tinha) mudarBusca(intencao.current);
    else intencao.current = compartilhados;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aba, assinatura]);

  const titulo = TITULOS[aba];
  const pergunta = PERGUNTAS[aba];

  if (!q.data) {
    const erro = q.error;
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={titulo} pergunta={pergunta} />
        {!erro ? (
          <Carregando variante="kpis" />
        ) : ACESSO_NEGADO.test(erro.message) ? (
          <EstadoSemAcesso oQueFalta="view.monetizacao" />
        ) : (
          <EstadoErro
            detalhe={`Fonte: carga da Monetização. ${erro.message}`}
            tentarNovamente={() => void q.refetch()}
          />
        )}
      </main>
    );
  }
  const data = q.data;
  const carga = estadoDaCarga(data);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const disparou = podeEscrever(data);
      if (disparou) await sync({ data: { action: "sync" } });
      await invalidate();
      toast.success(disparou ? "Carga pedida" : "Tela relida");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const acoes = (
    <Freshness
      data={data}
      refreshing={refreshing}
      onRefresh={refresh}
      motivoAtualizar={podeEscrever(data) ? null : MOTIVO_ATUALIZAR_SEM_ESCOPO}
    />
  );
  const procedencia = procedenciaMonetizacao(data);

  if (!data.permissions.view)
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={titulo} pergunta={pergunta} />
        <EstadoSemAcesso oQueFalta="view.monetizacao" />
        <p className="text-sm text-muted-foreground">
          Seu acesso permite consultar a Base de clientes.{" "}
          <Button asChild variant="outline" size="sm" className="ml-1">
            <Link to="/clientes" search={{ view: "produtos" }}>
              Abrir Produtos e listas
            </Link>
          </Button>
        </p>
      </main>
    );
  if (!data.permissions.all_units && !data.units.length)
    return (
      <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
        <PageHeader titulo={titulo} pergunta={pergunta} procedencia={procedencia} />
        <EstadoVazio
          titulo="Nenhuma unidade liberada para você"
          descricao="Seu acesso está ativo, mas nenhuma unidade foi liberada para você. A administração precisa definir suas carteiras."
        />
      </main>
    );

  const view = operacao(data.cards, filter),
    plan = data.plans.find((p) => p.month === filter.to.slice(0, 7) && p.owner_id === filter.owner);
  const owners = [
    ...new Map([
      [28381245, "Matheus Carvalho"],
      [27369179, "Samira Vieira"],
      ...data.cards
        .filter((c) => c.owner_id)
        .map((c) => [c.owner_id!, c.owner] as [number, string]),
    ]).entries(),
  ];
  const nomeDe = (id: number | null) =>
    id === null ? "Toda a frente" : (owners.find(([o]) => o === id)?.[1] ?? `Usuário ${id}`);
  const responsavel = nomeDe(filter.owner);
  const produto = rotuloProduto(busca.produto);
  const periodo = rotuloPeriodo(filter.from, filter.to);

  const aplicarPeriodo = (from: string, to: string) => {
    try {
      operacao([], { ...filter, from, to });
      mudarFiltros(periodoParaBusca(from, to));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const descricao = descricaoDaAba(aba, data, {
    responsavel,
    produto,
    periodo,
    mes: filter.to.slice(0, 7),
    mesForecast: busca.mes ?? filter.to.slice(0, 7),
    dias: busca.dias ?? DIAS_PADRAO,
    donoPlano: filter.owner === null ? nomeDe(RESPONSAVEL_PADRAO) : responsavel,
    ate: diaMes(filter.to),
  });

  const barra = BARRA[aba];
  // Só as chaves que a barra desta aba mostra: filtro escondido não acende "Limpar".
  const chavesDaBarra = barra
    ? ([
        ...(barra.periodo ? (["de", "ate"] as const) : []),
        ...(barra.responsavel ? (["responsavel"] as const) : []),
        ...(barra.produto ? (["produto"] as const) : []),
      ] as (keyof Compartilhados)[])
    : [];
  const temFiltro = chavesDaBarra.some((k) => busca[k] !== undefined);
  const filtros = barra && (
    <BarraFiltros
      className="items-end"
      aoLimpar={
        temFiltro
          ? () => mudarFiltros(Object.fromEntries(chavesDaBarra.map((k) => [k, undefined])))
          : undefined
      }
    >
      {barra.periodo && (
        <>
          <div className="flex gap-1">
            {["Hoje", "7 dias", "Mês"].map((name, i) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                onClick={() =>
                  aplicarPeriodo(
                    i === 0
                      ? today
                      : i === 1
                        ? new Date(Date.parse(today) - 6 * 86400000).toISOString().slice(0, 10)
                        : today.slice(0, 7) + "-01",
                    today,
                  )
                }
              >
                {name}
              </Button>
            ))}
          </div>
          <Field label="De">
            <input
              type="date"
              className={inputClass}
              value={dates.from}
              onChange={(e) => setDates({ ...dates, from: e.target.value })}
            />
          </Field>
          <Field label="Até">
            <input
              type="date"
              className={inputClass}
              value={dates.to}
              onChange={(e) => setDates({ ...dates, to: e.target.value })}
            />
          </Field>
          <Button size="sm" variant="outline" onClick={() => aplicarPeriodo(dates.from, dates.to)}>
            Aplicar
          </Button>
        </>
      )}
      {barra.responsavel && (
        <Field label={barra.responsavel}>
          <select
            className={inputClass}
            value={filter.owner ?? "todos"}
            onChange={(e) => {
              const v = e.target.value === "todos" ? "todos" : Number(e.target.value);
              mudarFiltros({ responsavel: v === RESPONSAVEL_PADRAO ? undefined : v });
            }}
          >
            <option value="todos">Toda a frente</option>
            {filter.owner !== null && !owners.some(([id]) => id === filter.owner) && (
              <option value={filter.owner}>{responsavel}</option>
            )}
            {owners.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {barra.produto && (
        <Field label="Produto">
          <select
            className={inputClass}
            value={busca.produto ?? ""}
            onChange={(e) => mudarFiltros({ produto: (e.target.value || undefined) as ProdutoUrl })}
          >
            <option value="">Todos os produtos</option>
            {PRODUTOS.map((p) => (
              <option key={p} value={p}>
                {NOMES[p]}
              </option>
            ))}
            <option value="sem_produto">Sem produto</option>
          </select>
        </Field>
      )}
    </BarraFiltros>
  );

  // O recorte que o detalhe declara no cabeçalho: abas que ignoram um filtro não o repetem.
  const ignoraResponsavel = aba === "forecast" || aba === "distribuicao" || aba === "roteiros";
  const ignoraProduto = !BARRA[aba]?.produto;
  const recorte = {
    responsavel: ignoraResponsavel ? "Toda a frente" : responsavel,
    produto: ignoraProduto ? "Todos os produtos" : produto,
  };

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-4 md:px-6">
      <PageHeader
        titulo={titulo}
        pergunta={pergunta}
        descricao={descricao}
        procedencia={procedencia}
        acoes={acoes}
      >
        {filtros}
      </PageHeader>
      {carga.nuncaSincronizou && (
        <EstadoVazio
          titulo="O CRM ainda não concluiu a primeira carga"
          descricao={
            <>
              Os indicadores comerciais são liberados depois da primeira sincronização; a lista de
              empresas não depende dela.
              {carga.motivo && (
                <>
                  {" "}
                  A última tentativa falhou porque{" "}
                  <span title={data.sync_error ?? undefined}>{carga.motivo}</span>.
                </>
              )}
            </>
          }
        />
      )}
      {carga.parada && (
        <EstadoErro
          titulo={`Os indicadores comerciais estão parados desde ${carga.desde}`}
          detalhe={
            <>
              A última tentativa falhou porque{" "}
              <span title={data.sync_error ?? undefined}>{carga.motivo}</span>. Os números de
              reuniões, oportunidades e contratos abaixo são dessa última carga concluída, não de
              agora.
              {!!data.catalog_at &&
                (!data.measured_at || Date.parse(data.catalog_at) > Date.parse(data.measured_at)) &&
                " A lista de empresas não foi afetada: ela vem de outra carga, que concluiu normalmente."}
            </>
          }
        />
      )}
      {data.measured_at && aba === "operacao" && (
        <OperacaoDiaria
          data={data}
          view={view}
          plan={plan}
          filter={filter}
          busca={busca}
          responsavel={responsavel}
          produto={produto}
          abrir={setDetail}
        />
      )}

      {data.measured_at && aba !== "operacao" && (
        <Analysis
          aba={aba}
          data={data}
          filter={filter}
          busca={busca}
          mudarBusca={mudarBusca}
          openDeals={(title, rows, period, opcoes) => setDetail({ title, rows, period, ...opcoes })}
        />
      )}
      <DealDetails
        detail={detail}
        close={() => setDetail(null)}
        filter={{ ...filter, ...detail?.period }}
        estoque={detail?.estoque ?? aba === "follow-day"}
        recorte={recorte}
        data={data}
      />
    </main>
  );
}

const pct = (n: number, d: number) => (d ? `${number((n / d) * 100)}%` : "—");
const rotuloMetrica = (k: Metrica) => METRICAS.find((m) => m.key === k)!.label;
const FOCO = FOCO_VISIVEL;

/**
 * Operação diária (contrato `monetizacao-operacao.md`, arquétipo Lista/Relatório): quatro KPIs
 * do período com meta ao lado, o dia a dia num eixo só, a tabela por produto e o funil de hoje.
 * Só apresentação: todos os números vêm de `operacao()` e do plano do mês, como antes.
 */
function OperacaoDiaria({
  data,
  view,
  plan,
  filter,
  busca,
  responsavel,
  produto,
  abrir,
}: {
  data: BaseMonetizacao;
  view: ReturnType<typeof operacao>;
  plan: Plano | undefined;
  filter: Filtro;
  busca: BuscaMonetizacao;
  responsavel: string;
  produto: string;
  abrir: (d: Detalhe) => void;
}) {
  const procedencia = procedenciaMonetizacao(data);
  const mes = rotuloMes(filter.to.slice(0, 7));
  // Z2 sobre o recorte da barra: produto filtrado e, com responsável, a carteira dele (negócio
  // sem histórico não tem autor de movimento; o dono atual é o único vínculo que ele tem). E o
  // período: carregado até `ate` e, no dia de `de`, ainda aberto ou fechado depois dele. Ganho
  // usa a data do ganho; outro fechamento não tem data no card, então vale o evento no período.
  const noPeriodo = (c: Negocio) => {
    const carregado =
      c.events.loaded.map((e) => e.date).sort()[0] ?? c.created_at?.slice(0, 10) ?? "";
    if (carregado > filter.to) return false;
    if (c.status === "open") return true;
    const ganhoEm = c.status === "won" ? (c.won_on ?? c.signed_on) : null;
    if (ganhoEm) return ganhoEm >= filter.from;
    return Object.values(c.events).some((es) =>
      es.some((e) => e.date >= filter.from && e.date <= filter.to),
    );
  };
  const semHistoricoRecorte = data.cards.filter(
    (c) =>
      !c.history_known &&
      (!filter.product || c.route === filter.product) &&
      (!filter.owner || c.owner_id === filter.owner) &&
      noPeriodo(c),
  );
  const evento = estadoKpiEvento(data, semHistoricoRecorte);
  // O ganho existe mesmo sem histórico lido (`signed` vem do status): só a carga pesa (Z1).
  const eventoGanho = estadoKpiEvento(data, []);
  const juntar = (...partes: (string | undefined | false)[]) =>
    partes.filter(Boolean).join(" · ") || undefined;
  const semPlano = plan
    ? undefined
    : filter.owner === null
      ? `sem plano da frente para ${mes}; os planos são por responsável`
      : `sem plano para ${mes}`;
  const abrirMetrica = (k: Metrica) =>
    abrir({ title: rotuloMetrica(k), rows: view.rows[k], ordenarPor: ultimoEvento(k, filter) });

  const reunioes = view.rows.meeting.length;
  const convertidas = view.convertedMeetings.length;
  const trabalhados = view.rows.started.length;
  const marcadas = view.rows.scheduled.length;

  const etapas = data.stages.map((s) => ({
    ...s,
    cards: view.current.filter((c) => c.stage_id === s.id),
  }));
  const produtos = busca.produto
    ? view.products.filter((p) => p.product === busca.produto)
    : view.products;
  const semHistoricoCarga = data.cards.filter((c) => !c.history_known);

  return (
    <>
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo={rotuloMetrica("started")}
          valor={trabalhados}
          estado={evento.estado}
          nota={juntar(evento.nota, semPlano)}
          meta={plan ? { valor: plan.capacity, rotulo: "meta do mês" } : undefined}
          procedencia={procedencia}
          abrir={{ onClick: () => abrirMetrica("started") }}
        />
        <KpiCard
          rotulo={rotuloMetrica("meeting")}
          valor={reunioes}
          estado={evento.estado}
          nota={juntar(
            evento.nota,
            view.conversion === null
              ? "Reunião → oportunidade: sem reunião no período"
              : `Reunião → oportunidade ${number(view.conversion * 100)}% · ${convertidas} de ${reunioes}`,
          )}
          procedencia={procedencia}
          abrir={{ onClick: () => abrirMetrica("meeting") }}
        />
        <KpiCard
          rotulo={rotuloMetrica("validated")}
          valor={view.rows.validated.length}
          estado={evento.estado}
          nota={juntar(evento.nota, "Entrou em Negociação ou etapa posterior")}
          procedencia={procedencia}
          abrir={{ onClick: () => abrirMetrica("validated") }}
        />
        <KpiCard
          rotulo={rotuloMetrica("signed")}
          valor={view.rows.signed.length}
          estado={eventoGanho.estado}
          nota={juntar(eventoGanho.nota, semPlano)}
          meta={plan ? { valor: plan.target_contracts, rotulo: "meta do mês" } : undefined}
          procedencia={procedencia}
          abrir={{ onClick: () => abrirMetrica("signed") }}
        />
      </KpiGrade>
      {/* A conversão mora na nota do card de reuniões (4 KPIs, Lista/Relatório); o card abre
          as reuniões, e as convertidas continuam a um clique daqui. */}
      {evento.estado !== "indisponivel" && convertidas > 0 && (
        <p className="-mt-1 text-xs text-muted-foreground">
          <button
            type="button"
            className={`text-primary-text underline underline-offset-2 ${FOCO}`}
            onClick={() =>
              abrir({
                title: "Reuniões que viraram oportunidade",
                rows: view.convertedMeetings,
                ordenarPor: ultimoEvento("meeting", filter),
              })
            }
          >
            Abrir as {convertidas} {convertidas === 1 ? "reunião" : "reuniões"} que{" "}
            {convertidas === 1 ? "virou" : "viraram"} oportunidade →
          </button>
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.8fr)]">
        <SecaoCartao
          titulo="Como o trabalho andou dia a dia?"
          descricao={`Negócios por dia · ${responsavel} · ${produto}`}
          acoes={
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                downloadCsv("monetizacao-dia-a-dia.csv", [
                  ["Data", "Leads trabalhados", "Reuniões marcadas", "Reuniões realizadas"],
                  ...view.series.map((s) => [s.date, s.started, s.scheduled, s.meeting]),
                ])
              }
            >
              Baixar dados
            </Button>
          }
        >
          <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            {(["started", "scheduled", "meeting"] as const).map((k) => (
              <span key={k} className="text-muted-foreground">
                {rotuloMetrica(k)}{" "}
                <strong className="num ml-1 text-foreground">{view.rows[k].length}</strong>
              </span>
            ))}
            <span className="text-muted-foreground">
              Marcadas ÷ trabalhados no período{" "}
              <strong className="num ml-1 text-foreground">{pct(marcadas, trabalhados)}</strong>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={235}>
            <ComposedChart data={view.series} margin={{ top: 15, right: 4, bottom: 0, left: -20 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="label" minTickGap={18} />
              <YAxis {...eixoProps} allowDecimals={false} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendaProps} />
              <Bar
                dataKey="started"
                name="Trabalhados"
                fill={CORES_SERIE[0]}
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="scheduled"
                name="Marcadas"
                fill={CORES_SERIE[1]}
                radius={[2, 2, 0, 0]}
              />
              <Bar
                dataKey="meeting"
                name="Realizadas"
                fill={CORES_SERIE[2]}
                radius={[2, 2, 0, 0]}
              />
              {plan?.daily_target ? (
                <ReferenceLine
                  y={plan.daily_target}
                  {...linhaMetaProps}
                  label={{
                    value: `Meta de trabalhados ${plan.daily_target}/dia`,
                    fontSize: 12,
                    fill: "var(--muted-foreground)",
                    position: "insideTopRight",
                  }}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
          <NotaApoio>
            Negócios distintos por dia. Um negócio que volta à etapa em dias diferentes aparece nos
            dois dias; no total do período conta uma vez. Marcadas ÷ trabalhados é razão do período,
            não conversão de coorte, e pode passar de 100%.
            {semPlano && ` Sem meta diária: ${semPlano}.`}
          </NotaApoio>
        </SecaoCartao>

        <SecaoCartao
          titulo="Onde estão os negócios abertos hoje?"
          descricao={`${number(view.current.length)} abertos · dono atual: ${responsavel} · ${produto} · posição de hoje, ignora o período`}
        >
          <div className="space-y-3">
            {etapas.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`block w-full text-left ${FOCO}`}
                onClick={() => abrir({ title: s.name, rows: s.cards, estoque: true })}
              >
                <span className="mb-1 flex justify-between text-xs">
                  <span>{s.name}</span>
                  <strong className="num">{s.cards.length}</strong>
                </span>
                <span className="block h-1.5 rounded-full bg-muted">
                  <span
                    style={{
                      width: `${view.current.length ? (s.cards.length / view.current.length) * 100 : 0}%`,
                    }}
                    className="block h-1.5 rounded-full bg-primary"
                  />
                </span>
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs">
            <Link
              to="/monetizacao"
              search={{
                aba: "follow-day",
                de: busca.de,
                ate: busca.ate,
                responsavel: busca.responsavel,
                produto: busca.produto,
              }}
              className={`font-medium text-primary-text underline underline-offset-2 ${FOCO}`}
            >
              Quem está parado? → Follow Day
            </Link>
          </p>
        </SecaoCartao>
      </div>

      <SecaoCartao
        titulo="Em que produto o período andou?"
        descricao={`Negócios por produto · ${produto} · clique no número para abrir os negócios`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              {METRICAS.map((m) => (
                <TableHead key={m.key} className="text-right num">
                  {m.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {produtos.map((p) => (
              <TableRow key={p.product}>
                <TableCell className="font-medium">{NOMES[p.product]}</TableCell>
                {METRICAS.map((m) => (
                  <TableCell key={m.key} className="text-right num">
                    <button
                      type="button"
                      aria-label={`${NOMES[p.product]} · ${m.label}: ${p[m.key]}, abrir negócios`}
                      className={`font-semibold text-primary-text underline underline-offset-2 ${FOCO}`}
                      onClick={() =>
                        abrir({
                          title: `${NOMES[p.product]} · ${m.label}`,
                          rows: view.rows[m.key].filter((c) => c.route === p.product),
                          ordenarPor: ultimoEvento(m.key, filter),
                        })
                      }
                    >
                      {p[m.key]}
                    </button>
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </SecaoCartao>

      <details className="text-xs text-muted-foreground">
        <summary className={`cursor-pointer ${FOCO}`}>Critérios e campos a preencher</summary>
        <p className="mt-2">
          Produto canônico: Caixa · Produto no Pipedrive (Cella, Consultoria, Finance). Validação:
          primeiro avanço a Negociação ou etapa posterior, atribuído a quem registrou o movimento.
          Receita prevista: total, Partners e unidade, nos campos próprios do negócio. Os valores
          não representam caixa recebido.
        </p>
        <p className="mt-1">
          Sobre toda a carga: {data.cards.filter((c) => c.route === "sem_produto").length} negócios
          sem produto · {data.cards.filter((c) => !c.org_id).length} sem organização ·{" "}
          {semHistoricoCarga.length} sem histórico lido. No recorte ({responsavel} · {produto} ·{" "}
          {rotuloPeriodo(filter.from, filter.to)}):{" "}
          {semHistoricoRecorte.length ? (
            <button
              type="button"
              className={`text-primary-text underline underline-offset-2 ${FOCO}`}
              onClick={() =>
                abrir({
                  title: "Negócios sem histórico lido no recorte",
                  rows: semHistoricoRecorte,
                  estoque: true,
                  recorte: `${responsavel} · ${produto} · ${rotuloPeriodo(filter.from, filter.to)} · sem histórico lido`,
                })
              }
            >
              {semHistoricoRecorte.length} no recorte
            </button>
          ) : (
            "0 no recorte"
          )}
          .
        </p>
      </details>
    </>
  );
}

/** Universo medido de cada aba (`descricao` do PageHeader, contrato `monetizacao-<aba>.md`). */
function descricaoDaAba(
  aba: Aba,
  data: BaseMonetizacao,
  v: {
    responsavel: string;
    produto: string;
    periodo: string;
    mes: string;
    mesForecast: string;
    dias: number;
    donoPlano: string;
    ate: string;
  },
): string {
  switch (aba) {
    case "operacao":
      return `Negócios do pipeline 39 · ${v.responsavel} · ${v.produto} · ${v.periodo} · contagem por negócio, pelo autor do movimento`;
    case "follow-day":
      return `Negócios abertos do pipeline 39 · dono atual: ${v.responsavel} · ${v.produto} · sem movimento há ${v.dias}+ dias · estoque de hoje, não usa período`;
    case "temporal":
      return `Oportunidades validadas em aberto · dono atual: ${v.responsavel} · ${v.produto} · estoque de hoje; ciclo e cenário no período ${v.periodo} · receita declarada no CRM, não é MRR nem caixa`;
    case "forecast": {
      const fonte = fonteDoForecast(data);
      const corte = data.measured_at ? date(data.measured_at) : null;
      return [
        "Toda a frente",
        rotuloMes(fonte ? mesDoForecast(fonte, v.mesForecast) : v.mesForecast),
        fonte
          ? `projetado: planilha ${fonte.version} de ${date(fonte.source_date)}`
          : "sem planilha importada",
        corte ? `realizado: CRM até ${corte}` : "realizado: CRM após a primeira carga",
      ].join(" · ");
    }
    case "capacidade":
      return `Plano de ${v.donoPlano} para ${rotuloMes(v.mes)} · base: contas elegíveis por produto · trabalho: negócios do mês`;
    case "funil":
      return `Coortes do período ${v.periodo} · ${v.responsavel} · ${v.produto} · negócio; realização e ganho contam até ${v.ate} · base instalada, pipeline 39`;
    case "pessoas":
      return `Avaliação de ${v.responsavel} · amostra do período ${v.periodo} · 5 critérios, nota 1–5 · PDI comercial do hunter; o PDI de carreira está em Planning People`;
    case "roteiros": {
      const roteiros = data.records.filter((r) => r.kind === "roteiro");
      const aprovadas = roteiros.filter((r) => r.body.status === "aprovado").length;
      return `Biblioteca de abordagens da equipe · ${roteiros.length} ${roteiros.length === 1 ? "salva" : "salvas"}, ${aprovadas} ${aprovadas === 1 ? "aprovada" : "aprovadas"}`;
    }
    case "distribuicao":
      return `Responsáveis com negócio aberto hoje (quem só fez movimento e não é dono de nada não aparece) · ${v.produto} · movimentos de ${v.periodo} · negócio`;
  }
}

function DealDetails({
  detail,
  close,
  filter,
  estoque,
  recorte,
  data,
}: {
  detail: Detalhe | null;
  close: () => void;
  filter: Filtro;
  /** Estoque: diz "abertas hoje" e não mostra o período, que não vale para a lista. */
  estoque: boolean;
  recorte: { responsavel: string; produto: string };
  data: BaseMonetizacao;
}) {
  const [search, setSearch] = useState("");
  useEffect(() => setSearch(""), [detail]);
  const total = detail?.rows.length ?? 0;
  const ordenadas = detail?.ordenarPor
    ? [...detail.rows].sort((a, b) =>
        (detail.ordenarPor!(b) ?? "").localeCompare(detail.ordenarPor!(a) ?? ""),
      )
    : (detail?.rows ?? []);
  const rows = ordenadas.filter((c) =>
    [c.title, c.owner, NOMES[c.route]].join(" ").toLowerCase().includes(search.toLowerCase()),
  );
  const nomeAtor = (id: number | null) =>
    data.cards.find((d) => d.owner_id === id)?.owner ||
    (id === 28381245 ? "Matheus Carvalho" : `Usuário ${id}`);
  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[min(1250px,95vw)]">
        <DialogHeader>
          <DialogTitle>{detail?.title}</DialogTitle>
          <DialogDescription>
            <span className="num">{number(total)}</span>{" "}
            {total === 1 ? "oportunidade" : "oportunidades"} ·{" "}
            {detail?.recorte ??
              `${recorte.responsavel} · ${recorte.produto} · ${
                estoque ? "abertas hoje" : `${date(filter.from)} a ${date(filter.to)}`
              }`}
          </DialogDescription>
          {!estoque && (
            <p className="text-xs text-muted-foreground">
              Resultado atribuído a quem registrou o movimento; “Dono atual” é o responsável de hoje
              no CRM.
            </p>
          )}
        </DialogHeader>
        {total === 0 ? (
          <EstadoVazio titulo="Nenhuma oportunidade neste recorte." />
        ) : (
          <>
            <input
              aria-label="Buscar oportunidades"
              className={inputClass}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar empresa, produto ou responsável"
            />
            {rows.length === 0 ? (
              <EstadoVazio titulo="Nenhuma oportunidade com essa busca." total={total} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa / card</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Dono atual</TableHead>
                    <TableHead>Etapa atual</TableHead>
                    <TableHead>Data prevista</TableHead>
                    <TableHead className="text-right num">Receita prevista</TableHead>
                    <TableHead className="text-right num">Partners</TableHead>
                    <TableHead className="text-right num">Unidade</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => {
                    // Estoque não tem período: mostra os últimos movimentos, mais recente primeiro.
                    const historico = Object.entries(c.events)
                      .flatMap(([kind, events]) =>
                        events
                          .filter((e) => estoque || (e.date >= filter.from && e.date <= filter.to))
                          .map((e) => ({ kind, e })),
                      )
                      .sort((a, b) => b.e.date.localeCompare(a.e.date));
                    return (
                      <TableRow key={c.id} className="align-top">
                        <TableCell>
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-text underline"
                          >
                            {c.title}
                          </a>
                          {!c.org_id && (
                            <span className="block text-xs text-warning">
                              Sem organização vinculada
                            </span>
                          )}
                          <details className="mt-2 text-xs">
                            <summary className="cursor-pointer text-muted-foreground">
                              {estoque
                                ? "Últimos movimentos"
                                : `Histórico de ${date(filter.from)} a ${date(filter.to)}`}
                            </summary>
                            {historico.length ? (
                              historico.map(({ kind, e }, i) => (
                                <p key={`${kind}-${i}`}>
                                  {date(e.date)} · {METRICAS.find((m) => m.key === kind)?.label} ·{" "}
                                  {nomeAtor(e.actor_id)}
                                </p>
                              ))
                            ) : (
                              <p className="text-muted-foreground">
                                {estoque
                                  ? "Sem movimento registrado."
                                  : "Sem movimento no período."}
                              </p>
                            )}
                          </details>
                        </TableCell>
                        <TableCell>{NOMES[c.route]}</TableCell>
                        <TableCell>{c.owner}</TableCell>
                        <TableCell>{c.stage}</TableCell>
                        <TableCell>{date(c.expected_close)}</TableCell>
                        <TableCell className="text-right num">
                          {money(c.revenue.total.amount ?? c.revenue.sum, c.revenue.total.currency)}
                          <span className="block text-xs text-muted-foreground">
                            {c.revenue.status === "ok"
                              ? "Split conferido"
                              : c.revenue.status === "missing"
                                ? "Falta preencher"
                                : c.revenue.status === "mismatch"
                                  ? "Split diverge do total"
                                  : "Conferir preenchimento"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right num">
                          {money(c.revenue.partners.amount, c.revenue.partners.currency)}
                        </TableCell>
                        <TableCell className="text-right num">
                          {money(c.revenue.unit.amount, c.revenue.unit.currency)}
                          <span className="block text-xs text-muted-foreground">
                            {c.revenue.unit_name}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
