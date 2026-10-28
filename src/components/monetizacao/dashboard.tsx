import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { CircleX, Info, Trophy, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
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
import { acionarMonetizacao, carregarApoioAcompanhamento } from "@/lib/monetizacao/functions";
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
import { funisPorUnidade, nomesDasUnidades } from "@/lib/monetizacao/acompanhamento";
import { Fechamentos } from "./fechamentos";
import { funilCumulativo } from "@/lib/monetizacao/funil-cumulativo";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import { diaUtilAnterior, segundaDaSemana } from "@/lib/monetizacao/feriados";
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
import { SeletorBase } from "./seletor-base";
import {
  ABAS,
  ABAS_COM_BASE,
  avisoDaAposentada,
  DATA_APOSENTADORIA,
  filtroDaBusca,
  periodoParaBusca,
  produtosDaBusca,
  produtosParaBusca,
  unidadesDaBusca,
  unidadesParaBusca,
  type Aba,
  type BuscaMonetizacao,
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
  PorUnidade,
  QuadrosPreVenda,
  SerieDiaria,
  type FunisPorProduto,
} from "./operacao";
import {
  BarraFiltros,
  Carregando,
  ChipFiltro,
  EstadoErro,
  EstadoSemAcesso,
  EstadoVazio,
  PageHeader,
  SelecaoMultipla,
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
  fechamentos: "Forecast",
  "handoff-consultoria": "Consultoria",
  cella: "Cella",
  funil: "Funil comercial",
  roteiros: "Abordagens",
  distribuicao: "Distribuição",
};
const PERGUNTAS: Record<Exclude<Aba, "pre-venda">, string> = {
  operacao: "A pré-venda está no ritmo, e onde a base trava?",
  fechamentos: "O que fazer hoje para o mês fechar?",
  "handoff-consultoria": "Quanto a Consultoria deve à Expansão pelos clientes do onboarding?",
  cella: "Onde está cada contrato da Cella, e quanto vale cada tese?",
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
  // Forecast olha para a frente, a partir de hoje: sem período; pessoa = dono do card.
  fechamentos: { periodo: false, produto: true, responsavel: true },
  distribuicao: { periodo: true, produto: true, responsavel: false },
  roteiros: null,
  // Tela própria (consultoria.tsx: Handoff e Cruzamento), com barra e leitura dela; a rota desvia antes daqui.
  "handoff-consultoria": null,
  // Tela própria (cella.tsx), com leitura dela; a rota desvia antes daqui.
  cella: null,
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rotuloMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
/** "01/09 a 24/09"; com o ano quando o período atravessa anos. */
const rotuloPeriodo = (from: string, to: string) =>
  from.slice(0, 4) === to.slice(0, 4)
    ? `${diaMes(from)} a ${diaMes(to)}`
    : `${diaMes(from)}/${from.slice(0, 4)} a ${diaMes(to)}/${to.slice(0, 4)}`;
const nomeDoProduto = (p: ProdutoUrl) => (p === "sem_produto" ? "Sem produto" : NOMES[p]);
/** "Todos os produtos", "Cella", "Cella e Finance", "Cella, Finance e Sem produto". */
const juntarNomes = (nomes: string[]) =>
  nomes.length < 2 ? (nomes[0] ?? "") : `${nomes.slice(0, -1).join(", ")} e ${nomes.at(-1)}`;
const rotuloProdutos = (ps: ProdutoUrl[]) =>
  ps.length ? juntarNomes(ps.map(nomeDoProduto)) : "Todos os produtos";
const OPCOES_PRODUTO = [...PRODUTOS, "sem_produto" as const].map((p) => ({
  valor: p,
  rotulo: nomeDoProduto(p),
}));

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
  // Operação, Pré-venda e Forecast não usam a carteira da Base: abrem com os cards, sem esperar as ~10 mil contas.
  // Nome das unidades: o de `monetizacao_unidades` manda e o cadastro da rede completa as que faltam (Construção
  // Civil não está na tabela da Monetização). A mesma consulta da visão Hoje (mesma chave, uma ida ao banco).
  const { user } = useAuth();
  const apoioFn = useServerFn(carregarApoioAcompanhamento);
  const apoio = useQuery({
    queryKey: ["monetizacao-apoio-hoje", user?.id],
    queryFn: () => apoioFn(),
    enabled: !!user && aba === "operacao",
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const q = useMonetizacao({
      esperarCarteira: aba !== "operacao" && aba !== "pre-venda" && aba !== "fechamentos",
    }),
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
            <Link to="/clientes">Abrir a Base de clientes</Link>
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

  // Filtro por unidade, só na Operação (call com o Paulo, 14/10/2026: produto, pré-vendedor e unidade no mesmo
  // funil). O card entra quando a conta dele é da unidade (`unidade_ids`, da carga). A chave `unidade` da URL é a mesma
  // da Consultoria, que guarda o nome; aqui ela guarda o id, e por isso fica fora dos filtros compartilhados.
  // Desde 16/10/2026 a unidade aceita várias (`unidade=9,10`): o card entra se a conta for de qualquer uma delas.
  const unidadeIds = aba === "operacao" ? unidadesDaBusca(busca) : [];
  const unidadesComNome = [
    ...data.units,
    ...(apoio.data?.unidades ?? [])
      .filter((u) => !data.units.some((x) => x.id === u.id))
      .map((u) => ({ id: u.id, name: u.nome })),
  ];
  const nomeDaUnidade = nomesDasUnidades(unidadesComNome);
  const nomeDaUnidadeId = (id: number) => nomeDaUnidade.get(id) ?? `Unidade ${id}`;
  const unidadesNoPipe = [...new Set(data.cards.flatMap((c) => c.unidade_ids ?? []))]
    .map((id) => ({ id, nome: nomeDaUnidadeId(id) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const cards = !unidadeIds.length
    ? data.cards
    : data.cards.filter((c) => (c.unidade_ids ?? []).some((u) => unidadeIds.includes(u)));
  const dadosDoRecorte = !unidadeIds.length ? data : { ...data, cards };
  const produtosMarcados = produtosDaBusca(busca);
  const rotuloUnidades = unidadeIds.length
    ? juntarNomes(unidadesNoPipe.filter((u) => unidadeIds.includes(u.id)).map((u) => u.nome))
    : undefined;
  // Um filtro só (16/10/2026, pedido do Pedro): os controles que o funil ganhou em 15/10 saíram; o quadro diz o
  // recorte que a barra do topo aplicou.
  const recorteDoFunil = [
    produtosMarcados.length ? rotuloProdutos(produtosMarcados) : "todos os produtos",
    busca.responsavel
      ? (PRE_VENDEDORES.find(([id]) => id === busca.responsavel)?.[1] ?? "pré-vendedor")
      : "os dois pré-vendedores",
    rotuloUnidades ?? "todas as unidades",
  ].join(" · ");
  const view = operacao(cards, filter);
  // Régua cumulativa (01/10/2026): o funil, os quadros e as tabelas por produto contam a mesma coorte.
  // `funis.total` é o recorte da barra; os produtos ignoram o filtro de produto para poder comparar.
  const funis: FunisPorProduto | null =
    aba === "operacao"
      ? {
          total: funilCumulativo(cards, data.stages, filter),
          cella: funilCumulativo(cards, data.stages, { ...filter, product: "cella" }),
          finance: funilCumulativo(cards, data.stages, { ...filter, product: "finance" }),
          consultoria: funilCumulativo(cards, data.stages, {
            ...filter,
            product: "consultoria",
          }),
          sem_produto: funilCumulativo(cards, data.stages, {
            ...filter,
            product: "sem_produto" as Filtro["product"],
          }),
        }
      : null;
  // Sem meta desde 09/10/2026: os quadros mostram o realizado do período.
  const quadros = funis ? quadrosDaOperacao(funis.total, filter) : null;
  const responsavel = nomeDoRecorte(filter);
  const produto = rotuloProdutos(produtosMarcados);
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
    unidade: rotuloUnidades,
  });

  const menosDias = (n: number) =>
    new Date(Date.parse(today) - n * 86400000).toISOString().slice(0, 10);
  // Ontem e Semana entraram em 22/10/2026, a pedido do Pedro, para a daily: Ontem é o dia útil anterior.
  const ontem = diaUtilAnterior(today);
  const presets = [
    { nome: "Hoje", from: today, to: today },
    { nome: "Ontem", from: ontem, to: ontem },
    { nome: "Semana", from: segundaDaSemana(today), to: today },
    { nome: "7 dias", from: menosDias(6), to: today },
    { nome: "30 dias", from: menosDias(29), to: today },
    { nome: "Mês", from: today.slice(0, 7) + "-01", to: today },
  ];
  const presetAtivo = presets.find((p) => p.from === filter.from && p.to === filter.to);

  const barra = ehReunioes(busca) ? null : BARRA[aba];
  // Só as chaves que a barra desta aba mostra: filtro escondido não acende "Limpar".
  const chavesDaBarra = barra
    ? ([
        ...(barra.periodo ? (["de", "ate"] as const) : []),
        ...(barra.produto ? (["produto"] as const) : []),
        ...(barra.responsavel ? (["responsavel"] as const) : []),
      ] as (keyof Compartilhados)[])
    : [];
  const temFiltro = chavesDaBarra.some((k) => busca[k] !== undefined) || unidadeIds.length > 0;
  const filtros = barra && (
    <BarraFiltros
      className="items-end"
      aoLimpar={
        temFiltro
          ? () => {
              mudarFiltros(Object.fromEntries(chavesDaBarra.map((k) => [k, undefined])));
              if (unidadeIds.length) mudarBusca({ unidade: undefined });
            }
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
                onClick={() => aplicarPeriodo(p.from, p.to)}
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
        // Dois pré-vendedores: os dois marcados (ou nenhum) = a pré-venda inteira, que fica fora da URL; um marcado =
        // `?responsavel=<id>`. Com um terceiro, `responsavel` vira lista como produto e unidade.
        <SelecaoMultipla
          rotulo="Pré-vendedor"
          todos="Pré-venda (os dois)"
          plural="pré-vendedores"
          so="Só este"
          opcoes={PRE_VENDEDORES.map(([id, nome]) => ({ valor: String(id), rotulo: nome }))}
          valor={
            busca.responsavel
              ? [String(busca.responsavel)]
              : PRE_VENDEDORES.map(([id]) => String(id))
          }
          aoMudar={(v) => mudarFiltros({ responsavel: v.length === 1 ? Number(v[0]) : undefined })}
        />
      )}
      {barra.produto && (
        <SelecaoMultipla
          rotulo="Produto"
          todos="Todos os produtos"
          plural="produtos"
          so="Só este"
          opcoes={OPCOES_PRODUTO}
          valor={produtosMarcados}
          aoMudar={(v) => mudarFiltros({ produto: produtosParaBusca(v as ProdutoUrl[]) })}
        />
      )}
      {aba === "operacao" && unidadesNoPipe.length > 0 && (
        <SelecaoMultipla
          rotulo="Unidade"
          todos="Todas as unidades"
          plural="unidades"
          opcoes={unidadesNoPipe.map((u) => ({ valor: String(u.id), rotulo: u.nome }))}
          valor={unidadeIds.map(String)}
          aoMudar={(v) => mudarBusca({ unidade: unidadesParaBusca(v.map(Number)) })}
        />
      )}
    </BarraFiltros>
  );
  // Cada opção aplicada vira um chip removível logo abaixo da barra (16/10/2026).
  const chips = barra
    ? [
        ...(barra.responsavel && busca.responsavel
          ? [
              {
                chave: `r${busca.responsavel}`,
                rotulo: "Pré-vendedor",
                valor:
                  PRE_VENDEDORES.find(([id]) => id === busca.responsavel)?.[1] ?? "pré-vendedor",
                remover: () => mudarFiltros({ responsavel: undefined }),
              },
            ]
          : []),
        ...(barra.produto
          ? produtosMarcados.map((p) => ({
              chave: `p${p}`,
              rotulo: "Produto",
              valor: nomeDoProduto(p),
              remover: () =>
                mudarFiltros({
                  produto: produtosParaBusca(produtosMarcados.filter((x) => x !== p)),
                }),
            }))
          : []),
        ...unidadeIds.map((id) => ({
          chave: `u${id}`,
          rotulo: "Unidade",
          valor: nomeDaUnidadeId(id),
          remover: () =>
            mudarBusca({ unidade: unidadesParaBusca(unidadeIds.filter((x) => x !== id)) }),
        })),
      ]
    : [];
  const faixaDeFiltros = filtros && (
    <div className="space-y-2">
      {filtros}
      {chips.length > 0 && (
        <div
          role="list"
          aria-label="Filtros aplicados"
          className="flex flex-wrap items-center gap-1.5"
        >
          {chips.map((c) => (
            <span role="listitem" key={c.chave}>
              <ChipFiltro rotulo={c.rotulo} valor={c.valor} aoRemover={c.remover} />
            </span>
          ))}
        </div>
      )}
    </div>
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
        {ABAS_COM_BASE.includes(aba) ? (
          <div className="flex flex-wrap items-center gap-2">
            <SeletorBase busca={busca} mudarBusca={mudarBusca} />
            {aba === "pre-venda" && <SeletorVisaoPreVenda busca={busca} mudarBusca={mudarBusca} />}
          </div>
        ) : null}
        {faixaDeFiltros}
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
      {(data.catalogo_indisponivel ||
        data.carteira_carregando ||
        !!data.leituras_incompletas?.length) &&
        aba !== "operacao" &&
        aba !== "pre-venda" &&
        aba !== "fechamentos" && (
          <div
            role="status"
            className="flex items-start gap-2 rounded-lg border bg-card px-3 py-2 text-[13px] text-muted-foreground"
          >
            <Info className="mt-0.5 size-4 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
            <span>
              {data.carteira_carregando && !data.catalogo_indisponivel
                ? "Carregando a carteira da Base em segundo plano. Os cards do pipe já estão atualizados; a lista de empresas aparece em seguida."
                : "A carteira da Base não respondeu a tempo nesta leitura (banco carregado). Os cards do pipe estão atualizados; a lista de empresas volta sozinha na próxima leitura."}
            </span>
          </div>
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
          {/* A coorte do período (quadros, funil e leads por dia) abre a tela desde 14/10/2026, a
              pedido do Pedro; a Visão "Hoje" vem logo depois (era a primeira seção pela spec de 01/10). */}
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
            <FunilOperacao dados={funis.total} abrir={abrir} recorte={recorteDoFunil} />
            <SerieDiaria view={view} abrir={abrir} />
          </div>
          <CadastroACorrigir dados={cadastroACorrigir(cards, filter.product)} abrir={abrir} />
          {filter.from <= today && today <= filter.to && (
            <VisaoHoje
              data={dadosDoRecorte}
              filter={filter}
              hoje={today}
              rotuloProduto={produto}
              atencao={busca.atencao}
              mudarAtencao={(atencao) => mudarBusca({ atencao })}
              abrir={abrir}
            />
          )}
          {/* 16/10/2026: o funil por unidade toma o lugar da tabela por produto (pedido do Pedro). */}
          <PorUnidade
            unidades={funisPorUnidade(cards, data.stages, filter, unidadesComNome)}
            total={funis.total}
            abrir={abrir}
          />
          <FunilLadoALado funis={funis} produtos={produtosMarcados} abrir={abrir} />
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

      {data.measured_at && aba === "fechamentos" && (
        <Fechamentos
          cards={data.cards}
          stages={data.stages}
          hoje={today}
          filtro={filter}
          previsoes={data.previsoes_jev ?? []}
          fila={data.fila_jev ?? null}
          filtroFila={busca.fila ?? "hoje"}
          mudarFiltroFila={(f) => mudarBusca({ fila: f === "hoje" ? undefined : f })}
          abrir={abrir}
        />
      )}

      {data.measured_at && aba !== "operacao" && aba !== "pre-venda" && aba !== "fechamentos" && (
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
    unidade?: string;
  },
): string {
  switch (aba) {
    case "operacao":
      return `Pipe Monetização (39) no Pipedrive · pré-venda: ${v.responsavel} · ${v.produto} · ${v.unidade ?? "todas as unidades"} · ${v.periodo} · coorte: cards abordados no período, cada um contado até a etapa mais adiantada`;
    case "fechamentos":
      return `Pipe 39 · dono: ${v.responsavel} · ${v.produto} · abertos da Reunião de proposta em diante, sem Stand by · data esperada de fechamento do Pipedrive · contrato`;
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
        return `Pipe 39 · pré-venda: ${v.responsavel} · ${v.periodo} · abordagem = card que saiu da Base no dia; atividades feitas = pelo dia em que foram marcadas, sem o e-mail de apresentação; cadência em dia = pelo vencimento; ligação = discada pelo ramal Api4Com`;
      if (visao === "aderencia")
        return `Ligações avaliadas, a atendida mais longa de cada card (60 s ou mais) · ${v.responsavel} · ${v.periodo} · % de aderência ao script de 09/10`;
      return `Uma ligação por card do pipe 39, a atendida mais longa (60 s ou mais) · ${v.responsavel} · ${v.periodo} · ligação`;
    }
    case "distribuicao":
      return `Responsáveis com negócio aberto hoje (quem só fez movimento e não é dono de nada não aparece) · ${v.produto} · movimentos de ${v.periodo} · negócio`;
    case "handoff-consultoria":
      return "Onboarding Cliente da Expansão · cliente (CNPJ)";
    case "cella":
      return "Funil Projeto Planning da Diehl & Cella · contrato e tese";
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
