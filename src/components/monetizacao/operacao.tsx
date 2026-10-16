// Aba Operação da Monetização, no molde do painel do Recon (quadros do SDR + funil do anúncio à
// venda + leads por dia), com a identidade da Planning: tokens de src/styles.css, KpiCard do
// design system, status sempre com ícone e palavra. Nada é calculado aqui: o funil, os quadros da
// pré-venda e as tabelas por produto vêm da régua cumulativa (`funilCumulativo`, 01/10/2026) e a
// série diária de `operacao`, em src/lib/monetizacao. Sem meta desde 09/10/2026: o realizado, sem alvo.
import { Fragment, type ReactNode } from "react";
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CirclePause,
  Download,
  FileSignature,
  Info,
  MessageCircleReply,
  MessagesSquare,
  Presentation,
  Scale,
  TriangleAlert,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KpiCard } from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import { METRICAS, taxa } from "@/lib/monetizacao/model";
import { primeiroNome } from "@/lib/monetizacao/responsavel";
import type { QuadroOperacao, cadastroACorrigir, operacao } from "@/lib/monetizacao/model";
import { chaveDaEtapa, chegaramAoNivel, linhaDa } from "@/lib/monetizacao/funil-cumulativo";
import { SEM_UNIDADE, type FunilDaUnidade } from "@/lib/monetizacao/acompanhamento";
import type {
  ChaveEtapa,
  ChaveNivel,
  FunilCumulativo,
  LinhaCumulativa,
} from "@/lib/monetizacao/funil-cumulativo";
import { NOMES } from "@/lib/monetizacao/types";
import type { Negocio, Produto } from "@/lib/monetizacao/types";
import { downloadCsv } from "./common";

type Abrir = (
  title: string,
  rows: Negocio[],
  /** Lista que não é o recorte do período (estoque, cadastro): diz o recorte próprio. */
  opcoes?: { estoque?: boolean; recorte?: string },
) => void;

const INT = new Intl.NumberFormat("pt-BR");
const DEC = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const PCT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });
const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

// ---------------------------------------------------------------------------
// Quadros da pré-venda (sem meta desde 09/10/2026)
// ---------------------------------------------------------------------------

export function QuadrosPreVenda({
  quem,
  quadros,
  uteis,
  from,
  to,
  abrir,
  onComoContamos,
}: {
  /** Pessoa do recorte, ou a pré-venda inteira (`nomeDoRecorte`). */
  quem: string;
  quadros: QuadroOperacao[];
  uteis: number;
  from: string;
  to: string;
  abrir: Abrir;
  onComoContamos: () => void;
}) {
  return (
    <section className="space-y-3" aria-label={`Quadros: ${quem}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">
            {quem.startsWith("Pré-venda")
              ? "Até onde a pré-venda levou os abordados do período?"
              : `Até onde ${primeiroNome(quem)} levou os abordados do período?`}
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Abordados de {ddmm(from)} a {ddmm(to)}, {uteis}{" "}
            {uteis === 1 ? "dia útil" : "dias úteis"} · sem meta por enquanto: o realizado, sem alvo
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onComoContamos}>
          <Info className="size-4" strokeWidth={1.75} aria-hidden />
          Como contamos
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {quadros.map((q) => {
          // Só os trabalhados são ritmo (abordados ÷ dias úteis); o resto é contagem da coorte.
          const ritmo = q.chave === "started";
          return (
            <KpiCard
              key={q.chave}
              rotulo={q.rotulo}
              valor={ritmo ? DEC.format(q.valor) : INT.format(q.valor)}
              nota={q.nota}
              abrir={{
                onClick: () => abrir(ritmo ? "Leads trabalhados no período" : q.rotulo, q.cards),
              }}
            />
          );
        })}
      </div>
    </section>
  );
}

function Verbete({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3.5">
      <h3 className="mb-1.5 text-sm font-semibold text-foreground">{titulo}</h3>
      <div className="space-y-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

/** A régua cumulativa, uma frase por regra (spec de 01/10/2026). */
const REGRAS: [string, string][] = [
  [
    "Coorte",
    "O funil e os quadros, menos o de contratos, contam os cards que a pré-venda (ou o pré-vendedor escolhido) tirou da Base elegível no período.",
  ],
  [
    "Abordagem anterior",
    "Card abordado antes do período que agendou, realizou ou validou no período aparece na nota do quadro e na lista, fora da taxa. Contrato ganho no período conta sempre, de qualquer mês de abordagem.",
  ],
  [
    "Etapa alcançada",
    "Cada card conta até a etapa mais adiantada a que chegou no período, e a etapa só vale se ele ficou nela 30 minutos ou mais, avançou a partir dela ou terminou nela.",
  ],
  [
    "Contagem e taxa",
    "Cada etapa conta os cards que chegaram a ela ou além, então as contagens só descem e a taxa é a etapa dividida pela etapa de cima.",
  ],
  [
    "Etapas somadas",
    "O Gatilho, encerrado em 01/10, conta como Qualificação (a antiga Conexão). O Stand by conta como Levantamento com sócio realizado só se o card passou por Agendado antes (desde 14/10).",
  ],
  ["Fila", "A fila são os cards que estiveram na Base elegível em algum momento do período."],
  [
    "Re-abordagem",
    "Card que volta para a Base e sai de novo conta como abordado de novo no ritmo e no gráfico (desde 14/10). A volta desfeita em menos de 30 minutos não conta.",
  ],
  [
    "Gráfico por dia",
    "Reunião marcada e realizada só contam quando o card ficou 30 minutos na etapa, avançou ou terminou nela. Voltar para a mesma etapa depois de um toque não é marcação nova.",
  ],
  [
    "Hoje",
    "A coluna Hoje mostra quantos estão na etapa agora, no pipe inteiro, e não entra na taxa.",
  ],
  [
    "Dias úteis",
    "O ritmo divide os abordados pelos dias úteis, de segunda a sexta, sem os feriados nacionais.",
  ],
  [
    "Quem recebe o crédito",
    "A abordagem é de quem tirou o card da Base, e a saída feita pela integração do Ops não é de nenhum pré-vendedor.",
  ],
];

export function ComoContamos({
  open,
  onOpenChange,
  quadros,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  quadros: QuadroOperacao[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Como contamos</DialogTitle>
          <DialogDescription>
            Régua cumulativa, a mesma do funil. Sem meta por enquanto (09/10/2026): os quadros
            mostram o realizado do período, sem alvo.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Verbete titulo="A régua">
            <ul className="list-disc space-y-1 pl-4">
              {REGRAS.map(([titulo, frase]) => (
                <li key={titulo}>
                  <span className="font-medium text-foreground">{titulo}.</span> {frase}
                </li>
              ))}
            </ul>
          </Verbete>
          {quadros.map((q) => (
            <Verbete key={q.chave} titulo={q.rotulo}>
              <p>{q.formula}</p>
            </Verbete>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------

// Um ícone por papel da etapa, lido do nome antigo ou novo (a ordem no pipe muda, e o nome mudou em 01/10 e 09/10).
const ICONES: Record<ChaveEtapa, LucideIcon> = {
  base: Building2,
  abordagem: MessagesSquare,
  conexao: MessageCircleReply,
  gatilho: Zap,
  agendada: CalendarClock,
  realizada: CalendarCheck,
  negociacao: Scale,
  reuniaoProposta: Presentation,
  propostaEnviada: FileSignature,
  standby: CirclePause,
};
const iconeDa = (nome: string) => {
  if (/^ganho$/i.test(nome)) return Trophy;
  const papel = chaveDaEtapa(nome);
  if (papel) return ICONES[papel];
  return /proposta/i.test(nome) ? FileSignature : Building2;
};

// Rampa sequencial de uma cor (DESIGN.md §5, funil): o verde da marca em texto (`primary-text`)
// misturado ao `muted`, do claro ao escuro conforme o negócio avança. O ícone troca para a cor do
// card quando o fundo passa da metade, nos dois temas.
function Rampa({
  passo,
  total,
  icone: Icone,
}: {
  passo: number;
  total: number;
  icone: LucideIcon;
}) {
  const pct = Math.round(22 + (78 * passo) / Math.max(1, total - 1));
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-6 place-items-center rounded-md",
        pct >= 55 ? "text-card" : "text-foreground",
      )}
      style={{ backgroundColor: `color-mix(in oklab, var(--primary-text) ${pct}%, var(--muted))` }}
    >
      <Icone className="size-4" strokeWidth={1.75} />
    </span>
  );
}

// ícone | cards | etapa | hoje | taxa
const GRADE =
  "grid grid-cols-[1.5rem_3rem_minmax(0,1fr)_3rem_5rem] items-center gap-x-3 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_3.5rem_5.5rem]";

/** Seta curva da etapa de cima para a de baixo: a taxa é a etapa ÷ a de cima. */
function Conector() {
  return (
    <svg
      viewBox="0 0 9 18"
      className="h-[18px] w-[9px] shrink-0 overflow-visible text-muted-foreground"
      aria-hidden
    >
      <path
        d="M1 1 Q7.5 1 7.5 6 L7.5 11 Q7.5 16.5 1.5 16.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M4 14 L1.5 16.5 L4 19"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** "inclui Gatilho" · "inclui Stand by (6 hoje)": as etapas somadas ao nível. */
const incluiTexto = (l: LinhaCumulativa) =>
  l.somadasHoje.length
    ? `inclui ${l.somadasHoje.map((x) => (x.hoje ? `${x.nome} (${INT.format(x.hoje)} hoje)` : x.nome)).join(", ")}`
    : null;

/** Título do detalhe de uma linha: a fila é estoque do período; as demais, a coorte. */
const tituloDaLinha = (l: LinhaCumulativa, prefixo = "") =>
  `${prefixo}${l.nome} · ${l.nivel === 0 ? "na fila no período" : "abordados que chegaram aqui ou além"}`;

function Linha({
  linha,
  passo,
  total,
  abrir,
  anteriores = [],
}: {
  linha: LinhaCumulativa;
  passo: number;
  total: number;
  abrir: Abrir;
  /**
   * Cards abordados antes do período que chegaram a esta etapa no período, fora da coorte e da taxa. Era só o Ganho
   * (14/10/2026); desde 16/10/2026 vale para toda etapa, a pedido do Pedro (a Qualificação de 15–16/10 mostrava 1 e
   * outros 4 cards tinham entrado nela vindos de abordagens de 13 e 14/10).
   */
  anteriores?: Negocio[];
}) {
  const inclui = incluiTexto(linha);
  return (
    <div className={cn(GRADE, "h-10")}>
      {/* A linha inteira abre a coorte (botão esticado); o "+N de abordagem anterior" é um botão próprio por cima. */}
      <div className="relative col-span-3 grid grid-cols-subgrid items-center rounded-md transition-colors duration-[120ms] ease-out hover:bg-muted/60">
        <button
          type="button"
          onClick={() => abrir(tituloDaLinha(linha), linha.cards)}
          aria-label={`${tituloDaLinha(linha)}: ${INT.format(linha.contagem)}`}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <Rampa passo={passo} total={total} icone={iconeDa(linha.nome)} />
        <span className="num text-right text-base font-semibold text-foreground">
          {INT.format(linha.contagem)}
        </span>
        {/* O "+N de abordagem anterior" vem antes do "inclui …" e não encolhe: o texto que corta é o "inclui". */}
        <span className="flex min-w-0 items-baseline gap-1.5 text-sm text-foreground">
          <span className="truncate">
            {linha.nivel === 0 ? `Fila · ${linha.nome}` : linha.nome}
          </span>
          {anteriores.length > 0 && (
            <button
              type="button"
              onClick={() =>
                abrir(`${linha.nome} · de abordagem anterior, chegaram no período`, anteriores)
              }
              className="relative z-10 shrink-0 whitespace-nowrap rounded-sm text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              +{INT.format(anteriores.length)} de abordagem anterior
            </button>
          )}
          {inclui && (
            <span
              title={inclui}
              className="min-w-0 shrink-[100] truncate text-xs text-muted-foreground"
            >
              {inclui}
            </span>
          )}
        </span>
      </div>
      {linha.hoje ? (
        <button
          type="button"
          onClick={() => abrir(`${linha.nome} · no pipe hoje`, linha.hoje!, { estoque: true })}
          className="num rounded-md text-right text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {INT.format(linha.hoje.length)}
        </button>
      ) : (
        <span />
      )}
      {/* a taxa pertence à passagem entre esta linha e a de cima: sobe meia linha */}
      <span className="relative self-stretch">
        {linha.taxa !== undefined && (
          <span className="absolute inset-y-0 right-0 flex -translate-y-1/2 items-center gap-1.5">
            <Conector />
            <span className="num w-12 text-right text-[13px] font-semibold text-foreground">
              {linha.taxa === null ? "—" : PCT.format(linha.taxa)}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

export function FunilOperacao({
  dados,
  abrir,
  recorte,
}: {
  dados: FunilCumulativo;
  abrir: Abrir;
  /**
   * O recorte que a barra do topo aplicou, em palavras ("Cella · Heloá · Goiânia"). Os filtros que o funil teve
   * dentro dele (15/10/2026) saíram em 16/10/2026: a barra é o filtro único da tela.
   */
  recorte?: string;
}) {
  const { linhas, perdidos, abertos, regua, ganhosForaDaCoorte, avancosAnteriores } = dados;
  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          Onde a base avança e onde trava?
        </h2>
        {perdidos && perdidos.length > 0 && (
          <button
            type="button"
            onClick={() => abrir("Perdidos no período", perdidos)}
            className="shrink-0 rounded-sm text-[13px] text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {INT.format(perdidos.length)} {perdidos.length === 1 ? "perdido" : "perdidos"}
          </button>
        )}
      </div>
      <p className="mt-0.5 text-[13px] text-muted-foreground">
        Cards abordados no período, cada um contado até a etapa mais adiantada a que chegou. Taxa: a
        etapa ÷ a de cima. Hoje: o pipe inteiro agora, {INT.format(abertos)} abertos, fora da taxa.
        "+N de abordagem anterior": cards abordados antes que chegaram à etapa no período, fora da
        conta.
      </p>
      {recorte && (
        <p className="mt-2 text-xs font-medium text-foreground">
          Recorte: <span className="text-muted-foreground">{recorte}</span>
        </p>
      )}
      <div className="mt-3">
        <div
          className={cn(
            GRADE,
            "h-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
          )}
        >
          <span className="col-span-2 text-right">Cards</span>
          <span>Etapa</span>
          <span className="text-right">Hoje</span>
          <span className="text-right">Taxa</span>
        </div>
        {linhas.map((l, i) => (
          <Linha
            key={l.key}
            linha={l}
            passo={i}
            total={linhas.length}
            abrir={abrir}
            anteriores={
              l.chave === "ganho"
                ? ganhosForaDaCoorte
                : l.nivel > 1
                  ? chegaramAoNivel(avancosAnteriores, l.nivel)
                  : []
            }
          />
        ))}
      </div>
      {regua.semNivel.length > 0 && (
        <p className="mt-auto pt-3 text-xs text-muted-foreground">
          Fora da conta, porque a régua não soube onde pôr: {regua.semNivel.join(", ")}.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leads e reuniões por dia
// ---------------------------------------------------------------------------

export function SerieDiaria({ view, abrir }: { view: ReturnType<typeof operacao>; abrir: Abrir }) {
  const abrirDia = (date: string) =>
    abrir(`Movimentos de ${ddmm(date)}`, view.movimentosDoDia(date));
  return (
    <section className="flex h-full flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">
            Quantos leads e reuniões por dia?
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Barra: leads trabalhados no dia. Linhas: reuniões marcadas e realizadas, no dia em que o
            card foi movido. Clique num dia para ver os negócios.
          </p>
        </div>
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
          <Download className="size-4" strokeWidth={1.75} aria-hidden />
          Baixar dados
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-muted-foreground">
        {(["started", "scheduled", "meeting"] as const).map((k) => (
          <span key={k}>
            {METRICAS.find((m) => m.key === k)!.label}{" "}
            <strong className="num ml-1 font-semibold text-foreground">
              {INT.format(view.rows[k].length)}
            </strong>
          </span>
        ))}
      </div>
      <div className="mt-2 min-h-[260px] flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={view.series}
            margin={{ top: 12, right: 8, bottom: 0, left: -20 }}
            onClick={(s) => {
              const date = (s?.activePayload?.[0]?.payload as { date?: string } | undefined)?.date;
              if (date) abrirDia(date);
            }}
            className="cursor-pointer"
          >
            <CartesianGrid {...gradeProps} />
            <XAxis {...eixoProps} dataKey="label" minTickGap={18} />
            <YAxis {...eixoProps} allowDecimals={false} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendaProps} />
            <Bar
              dataKey="started"
              name="Leads trabalhados"
              fill={CORES_SERIE[0]}
              radius={[2, 2, 0, 0]}
            />
            <Line
              dataKey="scheduled"
              name="Reuniões marcadas"
              stroke={CORES_SERIE[1]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
            />
            <Line
              dataKey="meeting"
              name="Reuniões realizadas"
              stroke={CORES_SERIE[2]}
              strokeWidth={2}
              strokeDasharray="4 3"
              dot={{ r: 2.5 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Por produto
// ---------------------------------------------------------------------------

/** Funil cumulativo de cada recorte de produto, mais o total (todos os produtos, inclusive sem produto). */
export type FunisPorProduto = Record<Produto | "sem_produto" | "total", FunilCumulativo>;

type ColunaProduto = ChaveNivel | "fila" | "ganho";
const GRUPOS: { titulo: string; chaves: ColunaProduto[] }[] = [
  { titulo: "Esforço", chaves: ["fila", "abordagem"] },
  { titulo: "Resposta", chaves: ["conexao"] },
  { titulo: "Levantamentos com sócio", chaves: ["agendada", "realizada"] },
  { titulo: "Resultado", chaves: ["negociacao", "ganho"] },
];
const CURTO: Record<ColunaProduto, string> = {
  fila: "Fila",
  abordagem: "Abordados",
  conexao: "Qualificação",
  agendada: "Agendados",
  realizada: "Realizados",
  negociacao: "Validadas",
  reuniaoProposta: "Reunião de proposta",
  propostaEnviada: "Proposta enviada",
  ganho: "Ganhos",
};
const PRODUTOS_LINHA = ["cella", "finance", "consultoria"] as const;

/**
 * Funil por unidade (16/10/2026, pedido do Pedro: "funil por unidade, semelhante ao de produto"). Substitui a tabela
 * "Qual produto avança na base?" e a Qualificação por unidade do mês, com o mesmo desenho da tabela de produto: uma
 * linha por unidade, na régua cumulativa, com a fila do período e, dos abordados, quantos chegaram a cada etapa ou
 * além. Cada célula traz o número, a barra contra o maior valor da coluna e a taxa sobre a coluna da esquerda. Zero
 * sai apagado e não abre nada; etapa que o pipe não tem sai "—". Cada card conta numa unidade só: as linhas somam o
 * Total.
 */
export function PorUnidade({
  unidades,
  total,
  abrir,
}: {
  /** `funisPorUnidade` no recorte da barra; `null` quando a carga não trouxe a unidade dos cards. */
  unidades: FunilDaUnidade[] | null;
  /** O funil do topo (mesmo recorte), para a linha Total. */
  total: FunilCumulativo;
  abrir: Abrir;
}) {
  const chaves = GRUPOS.flatMap((g) => g.chaves);
  const valor = (fc: FunilCumulativo, k: ColunaProduto) => linhaDa(fc, k);
  const linhas = unidades ?? [];
  const maximo = Object.fromEntries(
    chaves.map((k) => [k, Math.max(1, ...linhas.map((l) => valor(l.funil, k)?.contagem ?? 0))]),
  );
  const celula = (
    k: ColunaProduto,
    i: number,
    fc: FunilCumulativo,
    titulo: string,
    destaque = false,
  ) => {
    const l = valor(fc, k);
    if (!l)
      return (
        <td key={k} className="px-3 py-2.5 text-right align-top">
          <span className="num text-base text-muted-foreground">—</span>
        </td>
      );
    const v = l.contagem;
    const anterior = i > 0 ? valor(fc, chaves[i - 1])?.contagem : undefined;
    // Taxa só quando as duas pontas têm card: "0% da anterior" e "—" em série viravam ruído.
    const t = anterior && v ? taxa(v, anterior) : null;
    return (
      <td key={k} className="px-3 py-2.5 align-top">
        {v > 0 ? (
          <button
            type="button"
            onClick={() => abrir(titulo, l.cards)}
            className={cn(
              "num block w-full rounded-sm text-right text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
              destaque ? "text-base font-bold" : "text-base font-semibold",
            )}
          >
            {INT.format(v)}
          </button>
        ) : (
          <span className="num block text-right text-base text-muted-foreground">0</span>
        )}
        {!destaque && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
            <span
              className="block h-full rounded-full bg-primary-text"
              style={{ width: `${(v / maximo[k]) * 100}%` }}
            />
          </span>
        )}
        <span className="num mt-1 block text-right text-xs text-muted-foreground">
          {t === null ? "\u00a0" : `${PCT.format(t)} da anterior`}
        </span>
      </td>
    );
  };
  const tituloDe = (nome: string, k: ColunaProduto, fc: FunilCumulativo) => {
    const l = valor(fc, k);
    return l ? tituloDaLinha(l, `${nome} · `) : nome;
  };
  return (
    <section className="rounded-xl border bg-card">
      <div className="space-y-0.5 px-4 pt-4">
        <h2 className="text-base font-semibold text-foreground">Em que unidade a base avança?</h2>
        <p className="text-[13px] text-muted-foreground">
          Abordados no período pela unidade da conta na Base, cada um até a etapa mais adiantada. A
          barra compara as unidades na mesma coluna; a porcentagem é a coluna ÷ a da esquerda. Cada
          card conta numa unidade só, então as linhas somam o Total. Clique no número para abrir os
          negócios.
        </p>
      </div>
      {unidades === null ? (
        <p className="px-4 pb-4 pt-3 text-sm text-muted-foreground">
          Não apurado: a carga não trouxe a unidade dos cards.
        </p>
      ) : !linhas.length ? (
        <p className="px-4 pb-4 pt-3 text-sm text-muted-foreground">
          Nenhum card na fila nem abordado no período.
        </p>
      ) : (
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[860px] table-fixed text-left">
            <colgroup>
              <col className="w-44" />
              {chaves.map((k) => (
                <col key={k} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th rowSpan={2} className="px-3 pb-2 align-bottom">
                  Unidade
                </th>
                {GRUPOS.map((g) => (
                  <th key={g.titulo} colSpan={g.chaves.length} className="px-3 pt-1">
                    <span className="block border-b pb-1 text-center">{g.titulo}</span>
                  </th>
                ))}
              </tr>
              <tr className="text-xs font-medium text-muted-foreground">
                {chaves.map((k) => (
                  <th key={k} className="px-3 pb-2 pt-1.5 text-right">
                    {CURTO[k]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map(({ unidade, funil }) => (
                <tr key={unidade} className="border-t">
                  <th
                    className={cn(
                      "truncate px-3 py-2.5 align-top text-sm font-semibold",
                      unidade === SEM_UNIDADE ? "text-muted-foreground" : "text-foreground",
                    )}
                    title={unidade}
                  >
                    {unidade}
                  </th>
                  {chaves.map((k, i) => celula(k, i, funil, tituloDe(unidade, k, funil)))}
                </tr>
              ))}
              {linhas.length > 1 && (
                <tr className="border-t-2 bg-muted/40">
                  <th className="px-3 py-2.5 align-top text-sm font-bold text-foreground">Total</th>
                  {chaves.map((k, i) => celula(k, i, total, tituloDe("Total", k, total), true))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <p className="px-4 pb-4 text-xs text-muted-foreground">
        Com 1 ou 2 abordagens, a taxa ainda não diz nada. Card sem unidade na conta entra em “Sem
        unidade”; a unidade não é deduzida pelo dono do card.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funil por produto, lado a lado
// ---------------------------------------------------------------------------

/** Rótulo curto de cada etapa no lado a lado (o nome inteiro fica no detalhe). */
const NOME_CURTO: Partial<Record<ChaveNivel | "fila" | "ganho", string>> = {
  fila: "Fila",
  abordagem: "Abordados",
  conexao: "Qualificação",
  agendada: "Levantamento agendado",
  realizada: "Levantamento realizado",
  reuniaoProposta: "Reunião de proposta",
  negociacao: "Em negociação",
  propostaEnviada: "Proposta enviada",
  ganho: "Ganho",
};

/**
 * A passagem que mais perde em cada funil: a menor taxa entre etapas, da Qualificação em diante (a saída da fila é
 * ritmo, não conversão) e só quando a etapa de cima tem 3 cards ou mais, para um card não virar gargalo.
 */
function gargaloDe(fc: FunilCumulativo): number {
  let pior = -1;
  let menor = Infinity;
  fc.linhas.forEach((l, i) => {
    if (i < 2 || l.taxa == null || fc.linhas[i - 1].contagem < 3) return;
    if (l.taxa < menor) {
      menor = l.taxa;
      pior = i;
    }
  });
  return pior;
}

/**
 * Comparativo lado a lado (15/10/2026, "mais sexy", pedido do Pedro): um funil desenhado por produto e o total, com a
 * mesma régua do funil de cima. A barra é centrada e proporcional à fila do produto, a taxa fica na passagem entre
 * etapas e a pior passagem de cada produto ganha a marca de gargalo. Stand by e perdidos ficam no rodapé.
 */
export function FunilLadoALado({
  funis,
  produtos,
  abrir,
}: {
  funis: FunisPorProduto;
  /** Produtos marcados na barra; vazio = os três (16/10/2026, seleção múltipla). */
  produtos: readonly (Produto | "sem_produto")[];
  abrir: Abrir;
}) {
  // A cor segue o produto, não a posição: com dois produtos marcados, cada um mantém a sua.
  const colunas = [
    ...PRODUTOS_LINHA.map((p, i) => ({
      k: p,
      nome: NOMES[p],
      cor: CORES_SERIE[i],
      fc: funis[p],
    })).filter((c) => !produtos.length || produtos.includes(c.k)),
    { k: "total", nome: "Total", cor: CORES_SERIE[5], fc: funis.total },
  ];
  // Com menos de dois dos três produtos marcados, não há o que comparar lado a lado.
  const daLinha = PRODUTOS_LINHA.filter((p) => !produtos.length || produtos.includes(p));
  const etapas = funis.total.linhas;
  const realizada = funis.total.regua.nivelDe.realizada;
  const espera = new Set(
    realizada === undefined ? [] : funis.total.regua.niveis[realizada].somadas.map((x) => x.id),
  );
  const standBy = (fc: FunilCumulativo) =>
    (linhaDa(fc, "realizada")?.hoje ?? []).filter((c) => espera.has(c.stage_id));
  const gargalos = new Map(colunas.map((c) => [c.k, gargaloDe(c.fc)]));
  const rodape = (n: number, titulo: string, rows: Negocio[], estoque = false) =>
    n > 0 ? (
      <button
        type="button"
        onClick={() => abrir(titulo, rows, estoque ? { estoque: true } : undefined)}
        className="num rounded-sm font-semibold text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {INT.format(n)}
      </button>
    ) : (
      <span className="num text-muted-foreground">0</span>
    );

  return (
    <section className="rounded-xl border bg-card">
      <div className="space-y-0.5 px-4 pt-4">
        <h2 className="text-base font-semibold text-foreground">
          Em que etapa cada produto trava?
        </h2>
        <p className="text-[13px] text-muted-foreground">
          O funil de cima desenhado por produto. A barra mede contra a fila do produto, a
          porcentagem é a passagem da etapa de cima e o vermelho marca a passagem que mais perde. O
          card conta na rota e em cada produto ofertado no levantamento, então a soma pode passar do
          total.
        </p>
      </div>
      {daLinha.length < 2 ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
          {daLinha.length === 1
            ? `Com ${NOMES[daLinha[0]]} marcado, o funil de cima já é o desse produto.`
            : "Sem produto não tem funil próprio aqui."}{" "}
          Marque dois produtos ou mais no filtro do topo para comparar.
        </p>
      ) : (
        <div className="overflow-x-auto px-3 pb-4 pt-3">
          <div
            className="grid min-w-[760px] gap-x-3"
            style={{ gridTemplateColumns: `10rem repeat(${colunas.length}, minmax(0, 1fr))` }}
          >
            <div />
            {colunas.map((c) => {
              const ganhos = c.fc.linhas.at(-1)?.contagem ?? 0;
              return (
                <div
                  key={c.k}
                  className="mb-2 rounded-lg px-3 py-2"
                  style={{ backgroundColor: `color-mix(in oklab, ${c.cor} 12%, var(--card))` }}
                >
                  <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: c.cor }}
                    />
                    {c.nome}
                  </div>
                  <div className="num text-2xl font-semibold leading-tight text-foreground">
                    {INT.format(c.fc.linhas[0].contagem)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    na fila · {INT.format(ganhos)} {ganhos === 1 ? "ganho" : "ganhos"} da coorte
                  </div>
                </div>
              );
            })}
            {etapas.map((e, i) => (
              <Fragment key={e.key}>
                <div className="flex min-h-12 flex-col justify-center pr-2 text-sm text-foreground">
                  <span>{(e.chave && NOME_CURTO[e.chave]) ?? e.nome}</span>
                  {incluiTexto(e) && (
                    <span className="text-xs text-muted-foreground">{incluiTexto(e)}</span>
                  )}
                </div>
                {colunas.map((c) => {
                  const l = c.fc.linhas[i];
                  const topo = c.fc.linhas[0].contagem || 1;
                  const frac = l.contagem ? Math.max(0.08, Math.min(1, l.contagem / topo)) : 0;
                  const gargalo = gargalos.get(c.k) === i;
                  return (
                    <div key={c.k} className="flex min-h-12 flex-col items-center justify-center">
                      {i > 0 && (
                        <span
                          className={cn(
                            "num text-xs leading-none",
                            gargalo ? "font-semibold text-danger" : "text-muted-foreground",
                          )}
                        >
                          {l.taxa == null ? "—" : PCT.format(l.taxa)}
                          {gargalo && " · gargalo"}
                        </span>
                      )}
                      <button
                        type="button"
                        disabled={!l.contagem}
                        onClick={() => abrir(`${c.nome} · ${tituloDaLinha(l)}`, l.cards)}
                        aria-label={`${c.nome}, ${e.nome}: ${INT.format(l.contagem)} cards`}
                        className="group relative mt-1 flex h-7 w-full items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "absolute inset-y-0 rounded-md transition-[filter] duration-150 group-hover:brightness-95",
                            gargalo && "ring-2 ring-danger",
                          )}
                          style={{
                            left: `${(1 - frac) * 50}%`,
                            width: `${frac * 100}%`,
                            backgroundColor: `color-mix(in oklab, ${c.cor} ${Math.max(28, 72 - i * 5)}%, var(--card))`,
                          }}
                        />
                        <span
                          className={cn(
                            "num relative text-sm font-semibold",
                            l.contagem ? "text-foreground" : "text-muted-foreground",
                          )}
                        >
                          {INT.format(l.contagem)}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </Fragment>
            ))}
            <div className="mt-3 border-t pt-2 text-sm font-semibold text-foreground">
              Em Stand by hoje
              <span className="block text-xs font-normal text-muted-foreground">
                pediu tempo depois da reunião
              </span>
            </div>
            {colunas.map((c) => {
              const parados = standBy(c.fc);
              return (
                <div key={c.k} className="mt-3 border-t pt-2 text-center text-base">
                  {rodape(parados.length, `${c.nome} · em Stand by hoje`, parados, true)}
                </div>
              );
            })}
            <div className="pt-2 text-sm font-semibold text-foreground">
              Perdidos no período
              <span className="block text-xs font-normal text-muted-foreground">
                o motivo está na lista
              </span>
            </div>
            {colunas.map((c) => (
              <div key={c.k} className="pt-2 text-center text-base">
                {c.fc.perdidos ? (
                  rodape(c.fc.perdidos.length, `${c.nome} · perdidos no período`, c.fc.perdidos)
                ) : (
                  <span className="num text-muted-foreground">—</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cadastro a corrigir
// ---------------------------------------------------------------------------

const LINK_DISCRETO =
  "rounded-sm text-left underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring";

/**
 * O que contradiz o próprio card no Pipedrive e distorce a contagem por produto. A tela conta pelo
 * campo Caixa · Produto; esta faixa diz onde ele diverge do título e onde a mesma oportunidade
 * está em dois cards, para a operação corrigir na fonte. Some quando não há nada a corrigir.
 */
export function CadastroACorrigir({
  dados,
  abrir,
}: {
  dados: ReturnType<typeof cadastroACorrigir>;
  abrir: Abrir;
}) {
  const { produtoDivergente: div, semProduto, duplicados: dup, oportunidadesDuplicadas: n } = dados;
  if (!div.length && !semProduto.length && !dup.length) return null;
  const recorte = "Pipe 39 inteiro, qualquer data · corrigir no Pipedrive";
  return (
    <section
      aria-label="Cadastro a corrigir no Pipedrive"
      className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-xl border bg-card px-4 py-2.5 text-[13px] text-muted-foreground"
    >
      <span className="inline-flex items-center gap-1.5 self-center font-semibold text-foreground">
        <TriangleAlert className="size-4 text-warning" strokeWidth={1.75} aria-hidden />
        Cadastro a corrigir no Pipedrive
      </span>
      {div.length > 0 && (
        <button
          type="button"
          className={LINK_DISCRETO}
          onClick={() =>
            abrir("Produto do título diferente do campo Caixa · Produto", div, {
              estoque: true,
              recorte,
            })
          }
        >
          <strong className="num font-semibold text-foreground">{INT.format(div.length)}</strong>{" "}
          {div.length === 1 ? "negócio" : "negócios"} com o produto do título diferente do campo
          Caixa · Produto (a tela conta pelo campo)
        </button>
      )}
      {semProduto.length > 0 && (
        <button
          type="button"
          className={LINK_DISCRETO}
          onClick={() =>
            abrir("Abertos sem Caixa · Produto", semProduto, { estoque: true, recorte })
          }
        >
          <strong className="num font-semibold text-foreground">
            {INT.format(semProduto.length)}
          </strong>{" "}
          {semProduto.length === 1 ? "negócio aberto" : "negócios abertos"} sem Caixa · Produto
          (fora de todas as linhas de produto)
        </button>
      )}
      {dup.length > 0 && (
        <button
          type="button"
          className={LINK_DISCRETO}
          onClick={() =>
            abrir("Mesma empresa e produto em mais de um negócio", dup, {
              estoque: true,
              recorte,
            })
          }
        >
          <strong className="num font-semibold text-foreground">{INT.format(n)}</strong>{" "}
          {n === 1 ? "oportunidade repetida" : "oportunidades repetidas"} em{" "}
          {INT.format(dup.length)} negócios da mesma empresa e produto
        </button>
      )}
    </section>
  );
}
