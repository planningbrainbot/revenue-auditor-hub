import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleX, Info, Trophy, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
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
import { nomeDoRecorte } from "@/lib/monetizacao/responsavel";
import { PRE_VENDEDORES } from "@/lib/monetizacao/types";
import {
  cadastroACorrigir,
  hoje,
  METRICAS,
  operacao,
  quadrosDaOperacao,
  produtoDoTitulo,
  situacaoDoNegocio,
} from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { funilCumulativo } from "@/lib/monetizacao/funil-cumulativo";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Negocio } from "@/lib/monetizacao/types";
import { Analysis } from "./analysis";
import { VisaoHoje } from "./hoje";
import { FONTE_GRAVACOES } from "./gravacoes";
import {
  FONTE_PRE_VENDA,
  PERGUNTAS_PRE_VENDA,
  SeletorVisaoPreVenda,
  VisaoPreVenda,
  visaoDa,
} from "./pre-venda";
import {
  ABAS,
  avisoDaAposentada,
  DATA_APOSENTADORIA,
  filtroDaBusca,
  periodoParaBusca,
  type Aba,
  type BuscaMonetizacao,
  type ProdutoRoteiroUrl,
  type ProdutoUrl,
} from "./busca";
import {
  date,
  estadoDaCarga,
  Field,
  Freshness,
  inputClass,
  money,
  number,
  podeEscrever,
  procedenciaMonetizacao,
} from "./common";
import {
  CadastroACorrigir,
  ComoContamos,
  FunilLadoALado,
  FunilOperacao,
  PorProduto,
  QuadrosPreVenda,
  SerieDiaria,
  type FunisPorProduto,
} from "./operacao";
import {
  BarraFiltros,
  Carregando,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  StatusBadge,
  useFocoDeVolta,
} from "@/components/planning";
import { cn } from "@/lib/utils";

export { ABAS };
export type { Aba };

/** Título = rótulo do item do menu (`areas.ts`); pergunta = contrato de cada aba (N1). */
const TITULOS: Record<Aba, string> = {
  operacao: "Operação diária",
  "pre-venda": "Pré-venda",
  "handoff-consultoria": "Consultoria",
  funil: "Funil comercial",
  roteiros: "Abordagens",
  distribuicao: "Distribuição",
};
const PERGUNTAS: Record<Exclude<Aba, "pre-venda">, string> = {
  operacao: "A pré-venda está no ritmo, e onde a base trava?",
  "handoff-consultoria": "Quanto a Consultoria deve à Expansão pelos clientes do onboarding?",
  funil: "Quantas reuniões marcadas acontecem, e quantas validadas viram contrato?",
  roteiros: "O que eu digo para este produto e este segmento?",
  distribuicao: "A carga está bem dividida entre os responsáveis, ou alguém está sem base?",
};
/** Pré-venda › Ficha › Reuniões é a antiga tela Gravações: pergunta, fonte, universo e barra próprios dela. */
const ehReunioes = (b: BuscaMonetizacao) =>
  b.aba === "pre-venda" && visaoDa(b) === "ficha" && b.ficha === "reunioes";
/** A pergunta da tela (N1): na Pré-venda, a da visão aberta. */
const perguntaDa = (b: BuscaMonetizacao) =>
  b.aba !== "pre-venda"
    ? PERGUNTAS[b.aba]
    : PERGUNTAS_PRE_VENDA[ehReunioes(b) ? "reunioes" : visaoDa(b)];

/**
 * O que a barra de filtros mostra em cada aba (moldura, "Filtros na URL").
 * Abordagens não tem barra da moldura. O seletor de responsável voltou em 08/10/2026, com os dois
 * pré-vendedores (Matheus e Heloá): sem escolha, o recorte é a pré-venda inteira.
 */
const BARRA: Record<Aba, { periodo: boolean; produto: boolean; responsavel: boolean } | null> = {
  operacao: { periodo: true, produto: true, responsavel: true },
  funil: { periodo: true, produto: true, responsavel: true },
  // Pré-venda: período e pessoa nas três visões; sem produto (a cadência e a ligação não têm produto). Ficha ›
  // Reuniões tem barra própria (mês da reunião, situação da gravação e busca), a da antiga tela Gravações.
  "pre-venda": { periodo: true, produto: false, responsavel: true },
  distribuicao: { periodo: true, produto: true, responsavel: false },
  roteiros: null,
  // Tela própria (consultoria.tsx: Handoff e Cruzamento), com barra e leitura dela; a rota desvia antes daqui.
  "handoff-consultoria": null,
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "01/09 a 24/09"; com o ano quando o período atravessa anos. */
const rotuloPeriodo = (from: string, to: string) =>
  from.slice(0, 4) === to.slice(0, 4)
    ? `${diaMes(from)} a ${diaMes(to)}`
    : `${diaMes(from)}/${from.slice(0, 4)} a ${diaMes(to)}/${to.slice(0, 4)}`;
const rotuloProduto = (p: ProdutoRoteiroUrl | undefined) =>
  !p || p === "caixa" ? "Todos os produtos" : p === "sem_produto" ? "Sem produto" : NOMES[p];

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
  const [comoContamos, setComoContamos] = useState(false);

  // O menu lateral leva a `?aba=x` sem os filtros, inclusive na aba em que já se está. Antes,
  // o recorte vivia no componente e sobrevivia a isso; aqui a referência guarda a última
  // intenção de filtro da página e a repõe quando a URL chega sem nenhuma chave de filtro.
  // Toda mudança feita pela própria barra (inclusive "Limpar filtros", que grava a referência
  // vazia) passa por `mudarFiltros`, então só a navegação de fora dispara a reposição.
  const compartilhados = {
    de: busca.de,
    ate: busca.ate,
    produto: busca.produto,
    responsavel: busca.responsavel,
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
  const pergunta = perguntaDa(busca);

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
  // A assinatura da Caixa de Oportunidade continua ao lado do frescor do CRM.
  const acoes = (
    <>
      <img
        src="/brand/caixa/assinatura-horizontal.svg"
        alt="Caixa de Oportunidade"
        className="h-8 w-auto dark:brightness-0 dark:invert"
      />
      <Freshness
        data={data}
        refreshing={refreshing}
        onRefresh={refresh}
        motivoAtualizar={podeEscrever(data) ? null : MOTIVO_ATUALIZAR_SEM_ESCOPO}
      />
    </>
  );
  const procedencia = ehReunioes(busca)
    ? { fonte: FONTE_GRAVACOES, atualizadoEm: data.measured_at }
    : aba === "pre-venda"
      ? { fonte: FONTE_PRE_VENDA, atualizadoEm: data.measured_at }
      : procedenciaMonetizacao(data);

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

  const view = operacao(data.cards, filter);
  // Régua cumulativa (01/10/2026): o funil, os quadros e as tabelas por produto contam a mesma coorte.
  // `funis.total` é o recorte da barra; os produtos ignoram o filtro de produto para poder comparar.
  const funis: FunisPorProduto | null =
    aba === "operacao"
      ? {
          total: funilCumulativo(data.cards, data.stages, filter),
          cella: funilCumulativo(data.cards, data.stages, { ...filter, product: "cella" }),
          finance: funilCumulativo(data.cards, data.stages, { ...filter, product: "finance" }),
          consultoria: funilCumulativo(data.cards, data.stages, {
            ...filter,
            product: "consultoria",
          }),
          sem_produto: funilCumulativo(data.cards, data.stages, {
            ...filter,
            product: "sem_produto" as Filtro["product"],
          }),
        }
      : null;
  // Sem meta desde 09/10/2026: os quadros mostram o realizado do período.
  const quadros = funis ? quadrosDaOperacao(funis.total, filter) : null;
  const responsavel = nomeDoRecorte(filter);
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
    ate: diaMes(filter.to),
    mesGravacoes: busca.mes,
    busca,
  });

  const menosDias = (n: number) =>
    new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
  const presets = [
    { nome: "Hoje", from: today },
    { nome: "7 dias", from: menosDias(6) },
    { nome: "30 dias", from: menosDias(29) },
    { nome: "Mês", from: today.slice(0, 7) + "-01" },
  ];
  const presetAtivo = filter.to === today ? presets.find((p) => p.from === filter.from) : undefined;

  const barra = ehReunioes(busca) ? null : BARRA[aba];
  // Só as chaves que a barra desta aba mostra: filtro escondido não acende "Limpar".
  const chavesDaBarra = barra
    ? ([
        ...(barra.periodo ? (["de", "ate"] as const) : []),
        ...(barra.produto ? (["produto"] as const) : []),
        ...(barra.responsavel ? (["responsavel"] as const) : []),
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
          <div
            role="group"
            aria-label="Período"
            className="inline-flex h-9 items-center gap-0.5 rounded-lg border border-input bg-card p-0.5"
          >
            {presets.map((p) => (
              <button
                key={p.nome}
                type="button"
                aria-pressed={presetAtivo?.nome === p.nome}
                onClick={() => aplicarPeriodo(p.from, today)}
                className={cn(
                  "h-full rounded-md px-3 text-[13px] font-medium outline-none transition-colors duration-[120ms] focus-visible:ring-2 focus-visible:ring-ring",
                  presetAtivo?.nome === p.nome
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {p.nome}
              </button>
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
        <Field label="Pré-vendedor">
          <select
            className={inputClass}
            value={busca.responsavel ?? ""}
            onChange={(e) => mudarFiltros({ responsavel: Number(e.target.value) || undefined })}
          >
            <option value="">Pré-venda (os dois)</option>
            {PRE_VENDEDORES.map(([id, nome]) => (
              <option key={id} value={id}>
                {nome}
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
  const ignoraResponsavel = aba === "distribuicao" || aba === "roteiros";
  const abrir = (title: string, rows: Negocio[], opcoes?: OpcoesDetalhe) =>
    setDetail({ title, rows, ...opcoes });
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
        {aba === "pre-venda" && <SeletorVisaoPreVenda busca={busca} mudarBusca={mudarBusca} />}
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
              <span title={data.sync_error ?? undefined}>{carga.porque}</span> Os números de
              reuniões, oportunidades e contratos abaixo são dessa última carga concluída, não de
              agora.
              {!!data.catalog_at &&
                (!data.measured_at || Date.parse(data.catalog_at) > Date.parse(data.measured_at)) &&
                " A lista de empresas não foi afetada: ela vem de outra carga, que concluiu normalmente."}
            </>
          }
        />
      )}
      {(aba === "operacao" || aba === "pre-venda") && busca.aposentada && (
        <AvisoTelaAposentada
          {...avisoDaAposentada(busca.aposentada)}
          fechar={() => mudarBusca({ aposentada: undefined })}
        />
      )}
      {data.measured_at && aba === "operacao" && funis && quadros && (
        <>
          {/* Visão "Hoje": a primeira seção quando o período inclui hoje (spec de 01/10/2026). */}
          {filter.from <= today && today <= filter.to && (
            <VisaoHoje
              data={data}
              filter={filter}
              hoje={today}
              rotuloProduto={produto}
              atencao={busca.atencao}
              mudarAtencao={(atencao) => mudarBusca({ atencao })}
              abrir={abrir}
            />
          )}
          <QuadrosPreVenda
            quem={responsavel}
            quadros={quadros.quadros}
            uteis={quadros.uteis}
            from={filter.from}
            to={filter.to}
            abrir={abrir}
            onComoContamos={() => setComoContamos(true)}
          />
          <ComoContamos
            open={comoContamos}
            onOpenChange={setComoContamos}
            quadros={quadros.quadros}
          />
          <div className="grid gap-3 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.3fr)]">
            <FunilOperacao dados={funis.total} abrir={abrir} />
            <SerieDiaria view={view} abrir={abrir} />
          </div>
          <CadastroACorrigir dados={cadastroACorrigir(data.cards, filter.product)} abrir={abrir} />
          <PorProduto funis={funis} produto={filter.product} abrir={abrir} />
          <FunilLadoALado funis={funis} produto={filter.product} abrir={abrir} />
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Critérios e campos a preencher</summary>
            <p className="mt-2">
              Produto canônico: Caixa · Produto no Pipedrive (Cella, Consultoria, Finance).
              Validação: primeiro avanço a Negociação ou etapa posterior, atribuído a quem registrou
              o movimento. Receita prevista: total, Partners e unidade, nos campos próprios do
              negócio. Os valores não representam caixa recebido.
            </p>
            <p className="mt-1">
              {data.cards.filter((c) => c.route === "sem_produto").length} negócios sem produto ·{" "}
              {data.cards.filter((c) => !c.org_id).length} sem organização ·{" "}
              {data.cards.filter((c) => !c.history_known).length} sem histórico lido.
            </p>
          </details>
        </>
      )}

      {aba === "pre-venda" && (
        <VisaoPreVenda
          data={data}
          busca={busca}
          mudarBusca={mudarBusca}
          periodo={{ de: filter.from, ate: filter.to, hoje: today }}
          quem={responsavel}
        />
      )}

      {data.measured_at && aba !== "operacao" && aba !== "pre-venda" && (
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
        estoque={detail?.estoque ?? false}
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
    ate: string;
    mesGravacoes?: string;
    busca: BuscaMonetizacao;
  },
): string {
  switch (aba) {
    case "operacao":
      return `Pipe Monetização (39) no Pipedrive · pré-venda: ${v.responsavel} · ${v.produto} · ${v.periodo} · coorte: cards abordados no período, cada um contado até a etapa mais adiantada`;
    case "funil":
      return `Coortes do período ${v.periodo} · ${v.responsavel} · ${v.produto} · negócio; realização e ganho contam até ${v.ate} · base instalada, pipeline 39`;
    case "roteiros": {
      const roteiros = data.records.filter((r) => r.kind === "roteiro");
      const aprovadas = roteiros.filter((r) => r.body.status === "aprovado").length;
      return `Biblioteca de abordagens da equipe · ${roteiros.length} ${roteiros.length === 1 ? "salva" : "salvas"}, ${aprovadas} ${aprovadas === 1 ? "aprovada" : "aprovadas"}`;
    }
    case "pre-venda": {
      if (ehReunioes(v.busca))
        return `Reuniões de levantamento com sócio e de proposta dos cards do pipe 39 · ${v.mesGravacoes ? rotuloMes(v.mesGravacoes) : "todos os meses"} · data da reunião em São Paulo · reunião`;
      const visao = visaoDa(v.busca);
      if (visao === "ritmo")
        return `Pipe 39 · pré-venda: ${v.responsavel} · ${v.periodo} · abordagem = card que começou no dia; atividade = item da cadência pelo vencimento; ligação = discada pelo ramal Api4Com`;
      if (visao === "aderencia")
        return `Ligações avaliadas, a atendida mais longa de cada card (60 s ou mais) · ${v.responsavel} · ${v.periodo} · % de aderência ao script de 09/10`;
      return `Uma ligação por card do pipe 39, a atendida mais longa (60 s ou mais) · ${v.responsavel} · ${v.periodo} · ligação`;
    }
    case "distribuicao":
      return `Responsáveis com negócio aberto hoje (quem só fez movimento e não é dono de nada não aparece) · ${v.produto} · movimentos de ${v.periodo} · negócio`;
    case "handoff-consultoria":
      return "Onboarding Cliente da Expansão · cliente (CNPJ)";
  }
}

/**
 * Link antigo de uma tela que saiu do menu (NAVEGACAO.md N14): a Operação diária (ou a Pré-venda, para Gravações e
 * Pessoas e PDI) abre com um aviso discreto, em vez de trocar de tela em silêncio. Fechar tira a chave da URL.
 */
function AvisoTelaAposentada({
  tela,
  onde,
  fechar,
}: {
  tela: string;
  onde: string;
  fechar: () => void;
}) {
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg border bg-card px-3 py-2 text-[13px] text-muted-foreground"
    >
      <p className="flex min-w-0 items-start gap-2">
        <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
        <span>
          <span className="font-medium text-foreground">{tela}</span>: esta tela saiu do menu em{" "}
          {DATA_APOSENTADORIA}. Você está na {onde}.
        </span>
      </p>
      <Button
        variant="ghost"
        size="sm"
        className="size-8 shrink-0 p-0"
        onClick={fechar}
        aria-label="Fechar o aviso"
      >
        <X className="size-4" strokeWidth={1.75} aria-hidden />
      </Button>
    </div>
  );
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
  // Fechar devolve o foco ao número que abriu o detalhe (guardado quando o conteúdo monta).
  const foco = useFocoDeVolta();
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
    PRE_VENDEDORES.find(([p]) => p === id)?.[1] ||
    data.cards.find((d) => d.owner_id === id)?.owner ||
    `Usuário ${id}`;
  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && close()}>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-[min(1250px,95vw)]"
        onOpenAutoFocus={foco.onOpenAutoFocus}
        onCloseAutoFocus={foco.onCloseAutoFocus}
      >
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
                    const situacao = situacaoDoNegocio(c);
                    const titulo = produtoDoTitulo(c.title);
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
                        <TableCell>
                          {NOMES[c.route]}
                          {titulo && titulo !== c.route && (
                            <span className="block text-xs text-warning">
                              Título diz {NOMES[titulo]}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{c.owner}</TableCell>
                        <TableCell>
                          {situacao.rotulo ? (
                            <>
                              <StatusBadge
                                tom={situacao.encerrado === "won" ? "sucesso" : "neutro"}
                                icone={situacao.encerrado === "won" ? Trophy : CircleX}
                              >
                                {situacao.rotulo}
                              </StatusBadge>
                              <span className="mt-1 block text-xs text-muted-foreground">
                                {situacao.etapa}
                              </span>
                            </>
                          ) : (
                            situacao.etapa
                          )}
                        </TableCell>
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
