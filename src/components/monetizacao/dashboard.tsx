import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
import type { BaseMonetizacao, Metrica, Negocio } from "@/lib/monetizacao/types";
import { Analysis } from "./analysis";
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
  Field,
  Freshness,
  inputClass,
  Kpi,
  money,
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

  const currentStages = data.stages.map((s) => ({
    ...s,
    cards: view.current.filter((c) => c.stage_id === s.id),
  }));
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
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {["started", "meeting", "validated", "conversion", "signed"].map((key) => {
              if (key === "conversion")
                return (
                  <Kpi
                    key={key}
                    label="Reunião → oportunidade"
                    value={view.conversion === null ? "—" : number(view.conversion * 100) + "%"}
                    hint={`${view.convertedMeetings.length} de ${view.rows.meeting.length} reuniões do período`}
                    onClick={() =>
                      setDetail({
                        title: "Reuniões que viraram oportunidade",
                        rows: view.convertedMeetings,
                        ordenarPor: ultimoEvento("meeting", filter),
                      })
                    }
                    accent
                  />
                );
              const k = key as "started" | "meeting" | "validated" | "signed";
              return (
                <Kpi
                  key={k}
                  label={METRICAS.find((m) => m.key === k)!.label}
                  value={view.rows[k].length}
                  hint={
                    k === "started"
                      ? `Meta mensal: ${plan?.capacity ?? "a definir"}`
                      : k === "meeting"
                        ? "Entrada em Reunião realizada"
                        : k === "validated"
                          ? "Entrou em Negociação ou etapa posterior"
                          : `Meta mensal: ${plan?.target_contracts ?? "a definir"}`
                  }
                  onClick={() =>
                    setDetail({
                      title: METRICAS.find((m) => m.key === k)!.label,
                      rows: view.rows[k],
                      ordenarPor: ultimoEvento(k, filter),
                    })
                  }
                />
              );
            })}
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
            <SecaoCartao
              titulo="Funil agora"
              acoes={
                <span className="text-xs text-muted-foreground">{view.current.length} abertos</span>
              }
            >
              <div className="space-y-3">
                {currentStages.map((s) => (
                  <button
                    key={s.id}
                    className="block w-full text-left"
                    onClick={() => setDetail({ title: s.name, rows: s.cards, estoque: true })}
                  >
                    <span className="mb-1 flex justify-between text-xs">
                      <span>{s.name}</span>
                      <strong className="tabular-nums">{s.cards.length}</strong>
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
              <p className="mt-3 text-xs text-muted-foreground">
                Carteira do responsável atual. O filtro de datas vale para os movimentos; o funil
                mostra a posição de hoje.
              </p>
            </SecaoCartao>
            <SecaoCartao
              titulo="Dia a dia"
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
              <div className="mb-1 flex flex-wrap gap-5 text-xs">
                {["started", "scheduled", "meeting"].map((k) => (
                  <span key={k} className="text-muted-foreground">
                    {METRICAS.find((m) => m.key === k)!.label}{" "}
                    <strong className="ml-1 text-foreground">
                      {view.rows[k as "started"].length}
                    </strong>
                  </span>
                ))}
              </div>
              <ResponsiveContainer width="100%" height={235}>
                <ComposedChart
                  data={view.series}
                  margin={{ top: 15, right: 4, bottom: 0, left: -20 }}
                >
                  <CartesianGrid {...gradeProps} />
                  <XAxis {...eixoProps} dataKey="label" minTickGap={18} />
                  <YAxis {...eixoProps} allowDecimals={false} />
                  <YAxis
                    {...eixoProps}
                    yAxisId="ratio"
                    orientation="right"
                    unit="%"
                    domain={[0, "auto"]}
                  />
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
                    fill={CORES_SERIE[0]}
                    fillOpacity={0.65}
                    radius={[2, 2, 0, 0]}
                  />
                  <Bar
                    dataKey="meeting"
                    name="Realizadas"
                    fill={CORES_SERIE[0]}
                    fillOpacity={0.35}
                    radius={[2, 2, 0, 0]}
                  />
                  <Line
                    yAxisId="ratio"
                    dataKey="conversion"
                    name="Marcadas / trabalhados"
                    stroke={CORES_SERIE[3]}
                    dot={false}
                    strokeWidth={2}
                    connectNulls={false}
                  />
                  {plan?.daily_target ? (
                    <ReferenceLine
                      y={plan.daily_target}
                      {...linhaMetaProps}
                      label={{
                        value: `meta ${plan.daily_target}/dia`,
                        fontSize: 12,
                        fill: "var(--muted-foreground)",
                      }}
                    />
                  ) : null}
                </ComposedChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground">
                Cards distintos por dia. Um card que volta à etapa em dias diferentes aparece em
                ambos os dias; no indicador do período conta uma vez. A linha é uma razão diária,
                não uma conversão de coorte.
              </p>
            </SecaoCartao>
          </div>
          <SecaoCartao
            titulo="Por produto"
            acoes={
              <span className="text-xs text-muted-foreground">
                Clique para abrir as oportunidades
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-muted-foreground">
                    <th className="pb-2">Produto</th>
                    {METRICAS.map((m) => (
                      <th key={m.key} className="pb-2 text-right">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.products.map((p) => (
                    <tr className="border-t" key={p.product}>
                      <th className="py-2 text-sm">{NOMES[p.product]}</th>
                      {METRICAS.map((m) => (
                        <td key={m.key} className="text-right">
                          <button
                            className="font-semibold tabular-nums text-primary-text underline underline-offset-2"
                            onClick={() =>
                              setDetail({
                                title: `${NOMES[p.product]} · ${m.label}`,
                                rows: view.rows[m.key].filter((c) => c.route === p.product),
                                ordenarPor: ultimoEvento(m.key, filter),
                              })
                            }
                          >
                            {p[m.key]}
                          </button>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SecaoCartao>
          <details className="text-xs text-muted-foreground">
            <summary>Critérios e campos a preencher</summary>
            <p className="mt-2">
              Produto canônico: Caixa · Produto no Pipedrive (Cella, Consultoria, Finance).
              Validação: primeiro avanço a Negociação ou etapa posterior, atribuído a quem registrou
              o movimento. Receita prevista: total, Partners e unidade, nos campos próprios do
              negócio. Os valores não representam caixa recebido.
            </p>
            <p className="mt-1">
              {data.cards.filter((c) => c.route === "sem_produto").length} cards sem produto ·{" "}
              {data.cards.filter((c) => !c.org_id).length} sem organização ·{" "}
              {data.cards.filter((c) => !c.history_known).length} históricos indisponíveis.
            </p>
          </details>
        </>
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
      const fonte = [...data.forecasts].sort((a, b) =>
        b.source_date.localeCompare(a.source_date),
      )[0];
      const corte = data.measured_at ? date(data.measured_at) : null;
      return [
        "Toda a frente",
        rotuloMes(v.mesForecast),
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
            {total === 1 ? "oportunidade" : "oportunidades"} · {recorte.responsavel} ·{" "}
            {recorte.produto} ·{" "}
            {estoque ? "abertas hoje" : `${date(filter.from)} a ${date(filter.to)}`}
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
