// Aba Operação da Monetização, no molde do painel do Recon (Metas do SDR + funil do anúncio à
// venda + leads por dia), com a identidade da Planning: tokens de src/styles.css, KpiCard do
// design system, status sempre com ícone e palavra. Nada é calculado aqui: o funil, os quadros de
// meta e as tabelas por produto vêm da régua cumulativa (`funilCumulativo`, 01/10/2026) e a série
// diária de `operacao`, em src/lib/monetizacao.
import type { ReactNode } from "react";
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
  ReferenceLine,
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
import { KpiCard, type TomKpi } from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import { FARMER, METRICAS, taxa } from "@/lib/monetizacao/model";
import type { QuadroMeta, StatusMeta, cadastroACorrigir, operacao } from "@/lib/monetizacao/model";
import { linhaDa } from "@/lib/monetizacao/funil-cumulativo";
import type {
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
// Metas do farmer
// ---------------------------------------------------------------------------

const TOM: Record<StatusMeta, { tom?: TomKpi; palavra?: string }> = {
  "na-meta": { tom: "sucesso", palavra: "na meta" },
  fora: { tom: "perigo", palavra: "fora da meta" },
  "dia-em-curso": { tom: "atencao", palavra: "dia em curso" },
  "sem-meta": {},
};

export function MetasFarmer({
  quadros,
  uteis,
  from,
  to,
  abrir,
  onComoContamos,
}: {
  quadros: QuadroMeta[];
  uteis: number;
  from: string;
  to: string;
  abrir: Abrir;
  onComoContamos: () => void;
}) {
  const fora = quadros.filter((q) => q.status === "fora").length;
  return (
    <section className="space-y-3" aria-label={`Metas do ${FARMER.nome}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">
            O {FARMER.nome.split(" ")[0]} está no ritmo das metas?
          </h2>
          <p className="text-[13px] text-muted-foreground">
            Abordados de {ddmm(from)} a {ddmm(to)}, {uteis}{" "}
            {uteis === 1 ? "dia útil" : "dias úteis"} ·{" "}
            {fora === 0
              ? "nenhuma meta fora"
              : `${fora} ${fora === 1 ? "meta fora" : "metas fora"}`}
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
          const { tom, palavra } = TOM[q.status];
          return (
            <KpiCard
              key={q.chave}
              rotulo={q.rotulo}
              valor={ritmo ? DEC.format(q.valor) : INT.format(q.valor)}
              nota={q.nota}
              meta={
                q.meta === null
                  ? undefined
                  : {
                      valor: ritmo ? `${DEC.format(q.meta)} por dia` : INT.format(q.meta),
                      rotulo: ritmo ? "meta" : "meta no período",
                      progresso: q.meta ? q.valor / q.meta : undefined,
                    }
              }
              tom={tom}
              tomRotulo={palavra}
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
    "Todo número do funil e dos quadros conta os cards que o farmer tirou da Base elegível no período.",
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
    "O Gatilho, encerrado em 01/10, conta como Conexão, e o Stand by conta como Levantamento realizado.",
  ],
  ["Fila", "A fila são os cards que estiveram na Base elegível em algum momento do período."],
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
    "A abordagem é de quem tirou o card da Base, e a saída feita pela integração do Ops não é do farmer.",
  ],
];

export function ComoContamos({
  open,
  onOpenChange,
  quadros,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  quadros: QuadroMeta[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Como contamos</DialogTitle>
          <DialogDescription>
            Régua cumulativa, a mesma do forecast. As metas vêm do plano do mês, em Capacidade e
            alocação, e são decisão humana.
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
              {q.meta === null && (
                <p>Sem meta no plano do mês: o quadro mostra o número, sem selo.</p>
              )}
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

// Um ícone por etapa, pelo nome (a ordem no pipe muda; o nome da etapa, não).
const ICONES: [RegExp, LucideIcon][] = [
  [/base/i, Building2],
  [/abordag/i, MessagesSquare],
  [/conex/i, MessageCircleReply],
  [/gatilho/i, Zap],
  [/reuni.*(agend|marc)/i, CalendarClock],
  [/reuni.*realiz/i, CalendarCheck],
  [/negocia/i, Scale],
  [/reuni.*proposta/i, Presentation],
  [/proposta/i, FileSignature],
  [/stand ?by/i, CirclePause],
  [/^ganho$/i, Trophy],
];
const iconeDa = (nome: string) => ICONES.find(([re]) => re.test(nome))?.[1] ?? Building2;

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
}: {
  linha: LinhaCumulativa;
  passo: number;
  total: number;
  abrir: Abrir;
}) {
  const inclui = incluiTexto(linha);
  return (
    <div className={cn(GRADE, "h-10")}>
      <button
        type="button"
        onClick={() => abrir(tituloDaLinha(linha), linha.cards)}
        className="col-span-3 grid grid-cols-subgrid items-center rounded-md text-left outline-none transition-colors duration-[120ms] ease-out hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Rampa passo={passo} total={total} icone={iconeDa(linha.nome)} />
        <span className="num text-right text-base font-semibold text-foreground">
          {INT.format(linha.contagem)}
        </span>
        <span className="truncate text-sm text-foreground">
          {linha.nivel === 0 ? `Fila · ${linha.nome}` : linha.nome}
          {inclui && <span className="ml-1.5 text-xs text-muted-foreground">{inclui}</span>}
        </span>
      </button>
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

export function FunilOperacao({ dados, abrir }: { dados: FunilCumulativo; abrir: Abrir }) {
  const { linhas, perdidos, abertos, regua } = dados;
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
      </p>
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
          <Linha key={l.key} linha={l} passo={i} total={linhas.length} abrir={abrir} />
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

export function SerieDiaria({
  view,
  metaDia,
  abrir,
}: {
  view: ReturnType<typeof operacao>;
  metaDia: number | null;
  abrir: Abrir;
}) {
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
            {metaDia ? (
              <ReferenceLine
                y={metaDia}
                {...linhaMetaProps}
                label={{
                  value: `Meta ${metaDia}/dia`,
                  fontSize: 12,
                  fill: "var(--muted-foreground)",
                }}
              />
            ) : null}
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
  { titulo: "Levantamentos", chaves: ["agendada", "realizada"] },
  { titulo: "Resultado", chaves: ["negociacao", "ganho"] },
];
const CURTO: Record<ColunaProduto, string> = {
  fila: "Fila",
  abordagem: "Abordados",
  conexao: "Conexão",
  agendada: "Agendados",
  realizada: "Realizados",
  negociacao: "Validadas",
  reuniaoProposta: "Reunião de proposta",
  propostaEnviada: "Proposta enviada",
  ganho: "Ganhos",
};
const PRODUTOS_LINHA = ["cella", "finance", "consultoria"] as const;

/**
 * Uma linha por produto, na régua cumulativa: a fila do período e, dos abordados, quantos chegaram a cada etapa ou
 * além. Cada célula traz o número, a barra contra o maior valor da coluna e a taxa sobre a coluna da esquerda, para
 * o olho ler a linha como um funil curto. Zero sai apagado e não abre nada; etapa que o pipe não tem sai "—".
 */
export function PorProduto({
  funis,
  produto,
  abrir,
}: {
  funis: FunisPorProduto;
  produto: Produto | "sem_produto" | "";
  abrir: Abrir;
}) {
  const chaves = GRUPOS.flatMap((g) => g.chaves);
  const valor = (fc: FunilCumulativo, k: ColunaProduto) => linhaDa(fc, k);
  const candidatas = [...PRODUTOS_LINHA, "sem_produto" as const].filter((p) =>
    produto ? p === produto : p !== "sem_produto" || funis.sem_produto.coorte.length > 0,
  );
  const linhas = candidatas
    .map((p) => ({ p, fc: funis[p] }))
    .sort((a, b) =>
      a.p === "sem_produto"
        ? 1
        : b.p === "sem_produto"
          ? -1
          : b.fc.coorte.length - a.fc.coorte.length,
    );
  const maximo = Object.fromEntries(
    chaves.map((k) => [k, Math.max(1, ...linhas.map((l) => valor(l.fc, k)?.contagem ?? 0))]),
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
      <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">Qual produto avança na base?</h2>
          <p className="text-[13px] text-muted-foreground">
            Abordados no período por produto, cada um até a etapa mais adiantada. A barra compara os
            produtos na mesma coluna; a porcentagem é a coluna ÷ a da esquerda. Clique no número
            para abrir os negócios.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[860px] table-fixed text-left">
          <colgroup>
            <col className="w-40" />
            {chaves.map((k) => (
              <col key={k} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th rowSpan={2} className="px-3 pb-2 align-bottom">
                Produto
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
            {linhas.map(({ p, fc }) => (
              <tr key={p} className="border-t">
                <th
                  className={cn(
                    "px-3 py-2.5 align-top text-sm font-semibold",
                    p === "sem_produto" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {NOMES[p]}
                </th>
                {chaves.map((k, i) => celula(k, i, fc, tituloDe(NOMES[p], k, fc)))}
              </tr>
            ))}
            {!produto && (
              <tr className="border-t-2 bg-muted/40">
                <th className="px-3 py-2.5 align-top text-sm font-bold text-foreground">Total</th>
                {chaves.map((k, i) =>
                  celula(k, i, funis.total, tituloDe("Total", k, funis.total), true),
                )}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Funil por produto, lado a lado
// ---------------------------------------------------------------------------

/**
 * O funil da dobra de cima com os produtos lado a lado (dono, 30/09/2026), na régua cumulativa (01/10/2026): as
 * mesmas etapas, a mesma coorte e a mesma taxa de `funilCumulativo`, uma coluna por produto e o total. Complementa
 * "Qual produto avança na base?", que resume em sete colunas; aqui estão todas as etapas do pipe. Fecha com o que
 * parou (Stand by hoje, que conta como levantamento realizado) e o que saiu (perdidos no período), fora da taxa. Com
 * filtro de produto não há o que comparar: o funil de cima já é o do produto.
 */
export function FunilLadoALado({
  funis,
  produto,
  abrir,
}: {
  funis: FunisPorProduto;
  produto: Produto | "sem_produto" | "";
  abrir: Abrir;
}) {
  const colunas = [
    ...PRODUTOS_LINHA.map((p, i) => ({ k: p, nome: NOMES[p], cor: CORES_SERIE[i], fc: funis[p] })),
    { k: "total", nome: "Total", cor: CORES_SERIE[5], fc: funis.total },
  ];
  const etapas = funis.total.linhas;
  const realizada = funis.total.regua.nivelDe.realizada;
  const espera = new Set(
    realizada === undefined ? [] : funis.total.regua.niveis[realizada].somadas.map((x) => x.id),
  );
  const standBy = (fc: FunilCumulativo) =>
    (linhaDa(fc, "realizada")?.hoje ?? []).filter((c) => espera.has(c.stage_id));
  const numero = (n: number, titulo: string, rows: Negocio[], estoque = false) =>
    n > 0 ? (
      <button
        type="button"
        onClick={() => abrir(titulo, rows, estoque ? { estoque: true } : undefined)}
        className="num rounded-sm text-base font-semibold text-foreground underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
      >
        {INT.format(n)}
      </button>
    ) : (
      <span className="num text-base text-muted-foreground">0</span>
    );

  return (
    <section className="rounded-xl border bg-card">
      <div className="space-y-0.5 px-4 pt-4">
        <h2 className="text-base font-semibold text-foreground">
          Em que etapa cada produto trava?
        </h2>
        <p className="text-[13px] text-muted-foreground">
          O funil de cima, um produto por coluna: abordados no período, cada um até a etapa mais
          adiantada. A porcentagem é a etapa ÷ a de cima; a barra compara com a fila do produto.
        </p>
      </div>
      {produto ? (
        <p className="px-4 pb-4 pt-2 text-sm text-muted-foreground">
          Com o filtro de {NOMES[produto]}, o funil de cima já é o do produto. Limpe o filtro de
          produto para comparar os três.
        </p>
      ) : (
        <div className="overflow-x-auto p-2">
          <table className="w-full min-w-[760px] table-fixed text-left">
            <colgroup>
              <col className="w-44" />
              {colunas.map((c) => (
                <col key={c.k} />
              ))}
            </colgroup>
            <thead>
              <tr className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="px-3 pb-2">Etapa</th>
                {colunas.map((c) => (
                  <th key={c.k} className="px-3 pb-2 text-right">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: c.cor }}
                      />
                      {c.nome}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {etapas.map((e, i) => (
                <tr key={e.key} className="border-t">
                  <th className="px-3 py-2 align-top text-sm font-normal text-foreground">
                    {e.nivel === 0 ? `Fila · ${e.nome}` : e.nome}
                    {incluiTexto(e) && (
                      <span className="block text-xs text-muted-foreground">{incluiTexto(e)}</span>
                    )}
                  </th>
                  {colunas.map((c) => {
                    const l = c.fc.linhas[i];
                    const topo = c.fc.linhas[0].contagem;
                    return (
                      <td key={c.k} className="px-3 py-2 align-top">
                        <div className="flex items-baseline justify-between gap-2">
                          <span
                            className={cn(
                              "num text-xs",
                              l.taxa != null && l.taxa < 0.2
                                ? "font-semibold text-danger"
                                : "text-muted-foreground",
                            )}
                          >
                            {l.taxa === undefined
                              ? "fila"
                              : l.taxa === null
                                ? "—"
                                : PCT.format(l.taxa)}
                          </span>
                          {numero(l.contagem, `${c.nome} · ${tituloDaLinha(l)}`, l.cards)}
                        </div>
                        <span
                          className="mt-1 block h-1 overflow-hidden rounded-full bg-muted"
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${topo ? Math.min(1, l.contagem / topo) * 100 : 0}%`,
                              backgroundColor: c.cor,
                            }}
                          />
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40">
                <th className="px-3 py-2 align-top text-sm font-semibold text-foreground">
                  Em Stand by hoje
                  <span className="block text-xs font-normal text-muted-foreground">
                    pediu tempo depois da reunião; não é perda
                  </span>
                </th>
                {colunas.map((c) => {
                  const parados = standBy(c.fc);
                  return (
                    <td key={c.k} className="px-3 py-2 text-right align-top">
                      {numero(parados.length, `${c.nome} · em Stand by hoje`, parados, true)}
                    </td>
                  );
                })}
              </tr>
              <tr className="border-t bg-muted/40">
                <th className="px-3 py-2 align-top text-sm font-semibold text-foreground">
                  Perdidos no período
                  <span className="block text-xs font-normal text-muted-foreground">
                    fechados como perdidos; o motivo está na lista
                  </span>
                </th>
                {colunas.map((c) => (
                  <td key={c.k} className="px-3 py-2 text-right align-top">
                    {c.fc.perdidos ? (
                      numero(c.fc.perdidos.length, `${c.nome} · perdidos no período`, c.fc.perdidos)
                    ) : (
                      <span className="num text-base text-muted-foreground">—</span>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
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
