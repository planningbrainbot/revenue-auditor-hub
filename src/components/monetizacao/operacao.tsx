// Aba Operação da Monetização, no molde do painel do Recon (Metas do SDR + funil do anúncio à
// venda + leads por dia), com a identidade da Planning: tokens de src/styles.css, KpiCard do
// design system, status sempre com ícone e palavra. Nada é calculado aqui; os números vêm de
// `operacao`, `funil` e `metasOperacao` em src/lib/monetizacao/model.ts.
import type { ReactNode } from "react";
import {
  Building2,
  CalendarCheck,
  CalendarClock,
  CirclePause,
  Download,
  FileSignature,
  Info,
  MessagesSquare,
  Scale,
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
import type { EtapaFunil, QuadroMeta, StatusMeta, funil, operacao } from "@/lib/monetizacao/model";
import { NOMES } from "@/lib/monetizacao/types";
import type { Metrica, Negocio, Produto } from "@/lib/monetizacao/types";
import { downloadCsv } from "./common";

type Abrir = (title: string, rows: Negocio[]) => void;

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
  rows,
  abrir,
  onComoContamos,
}: {
  quadros: QuadroMeta[];
  uteis: number;
  from: string;
  to: string;
  rows: Record<Metrica, Negocio[]>;
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
            {uteis} {uteis === 1 ? "dia útil" : "dias úteis"}, de {ddmm(from)} a {ddmm(to)} ·{" "}
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
          const ritmo = q.chave === "started" || q.chave === "scheduled" || q.chave === "meeting";
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
                      valor: ritmo ? `${DEC.format(q.meta)} por dia` : DEC.format(q.meta),
                      rotulo: ritmo ? "meta" : "meta no período",
                      progresso: q.meta ? q.valor / q.meta : undefined,
                    }
              }
              tom={tom}
              tomRotulo={palavra}
              abrir={{
                onClick: () => abrir(METRICAS.find((m) => m.key === q.chave)!.label, rows[q.chave]),
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
            Metas do plano do mês, salvas em Capacidade e alocação. São decisão humana: não saem de
            fonte nenhuma.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Verbete titulo="Ritmo por dia útil">
            <p>
              Leads e reuniões mostram o total do período dividido pelos dias úteis (segunda a
              sexta, sem calendário de feriados). O ritmo não depende do tamanho do período.
            </p>
            <p>
              Contratos contam o total, contra a meta do mês proporcional aos dias úteis do período.
              Abaixo da meta num período que é só hoje aparece como dia em curso, não como fora.
            </p>
          </Verbete>
          {quadros.map((q) => (
            <Verbete key={q.chave} titulo={q.rotulo}>
              <p>{q.formula}</p>
              {q.meta === null && (
                <p>Sem meta no plano do mês: o quadro mostra o número, sem selo.</p>
              )}
            </Verbete>
          ))}
          <Verbete titulo="Quem recebe o crédito">
            <p>
              O movimento conta para quem moveu o card no Pipedrive. A Operação mede o {FARMER.nome}
              , único farmer da frente; movimentos feitos por outro usuário (a API do Ops, por
              exemplo) ficam fora dos quadros e do funil.
            </p>
          </Verbete>
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
  [/gatilho/i, Zap],
  [/reuni.*(agend|marc)/i, CalendarClock],
  [/reuni.*realiz/i, CalendarCheck],
  [/negocia/i, Scale],
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

// ícone | entraram | etapa | hoje | conversão
const GRADE =
  "grid grid-cols-[1.5rem_3rem_minmax(0,1fr)_3rem_5rem] items-center gap-x-3 sm:grid-cols-[1.5rem_3.5rem_minmax(0,1fr)_3.5rem_5.5rem]";

/** Seta curva da etapa de cima para a de baixo: a conversão é a passagem, não a linha. */
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

function Linha({
  etapa,
  passo,
  total,
  conversao,
  abrir,
}: {
  etapa: EtapaFunil;
  passo: number;
  total: number;
  conversao?: number | null;
  abrir: Abrir;
}) {
  const entraram = etapa.entraram;
  return (
    <div className={cn(GRADE, "h-10")}>
      <button
        type="button"
        disabled={!entraram}
        onClick={() => entraram && abrir(`${etapa.nome} · entraram no período`, entraram)}
        className="col-span-3 grid grid-cols-subgrid items-center rounded-md text-left outline-none transition-colors duration-[120ms] ease-out enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
        title={entraram ? undefined : "A carga do CRM ainda não mede a entrada nesta etapa"}
      >
        <Rampa passo={passo} total={total} icone={iconeDa(etapa.nome)} />
        <span
          className={cn(
            "num text-right text-base font-semibold",
            entraram ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {entraram ? INT.format(entraram.length) : "—"}
        </span>
        <span className="truncate text-sm text-foreground">
          {etapa.nome.replace(/^\d+\s*·\s*/, "")}
        </span>
      </button>
      {etapa.parados ? (
        <button
          type="button"
          onClick={() => abrir(`${etapa.nome} · no pipe hoje`, etapa.parados!)}
          className="num rounded-md text-right text-sm text-muted-foreground outline-none transition-colors duration-[120ms] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          {INT.format(etapa.parados.length)}
        </button>
      ) : (
        <span />
      )}
      {/* a conversão pertence à passagem entre esta linha e a de cima: sobe meia linha */}
      <span className="relative self-stretch">
        {conversao !== undefined && (
          <span className="absolute inset-y-0 right-0 flex -translate-y-1/2 items-center gap-1.5">
            <Conector />
            <span className="num w-12 text-right text-[13px] font-semibold text-foreground">
              {conversao === null ? "—" : PCT.format(conversao)}
            </span>
          </span>
        )}
      </span>
    </div>
  );
}

export function FunilOperacao({ dados, abrir }: { dados: ReturnType<typeof funil>; abrir: Abrir }) {
  const { etapas, espera, perdidos, porEtapa, abertos } = dados;
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
        Entraram: cards movidos para a etapa no período. Hoje: o pipe inteiro agora,{" "}
        {INT.format(abertos)} abertos.
      </p>
      <div className="mt-3">
        <div
          className={cn(
            GRADE,
            "h-6 text-xs font-semibold uppercase tracking-wider text-muted-foreground",
          )}
        >
          <span className="col-span-2 text-right">Entraram</span>
          <span>Etapa</span>
          <span className="text-right">Hoje</span>
          <span className="text-right">Conversão</span>
        </div>
        {etapas.map((e, i) => (
          <Linha
            key={e.key}
            etapa={e}
            passo={i}
            total={etapas.length}
            abrir={abrir}
            conversao={
              i === 0
                ? undefined
                : e.entraram && etapas[i - 1].entraram
                  ? taxa(e.entraram.length, etapas[i - 1].entraram!.length)
                  : null
            }
          />
        ))}
        {espera.length > 0 && (
          <div className="mt-2 border-t pt-2">
            {espera.map((e) => (
              <div key={e.key} className={cn(GRADE, "h-10")}>
                <button
                  type="button"
                  disabled={!e.entraram}
                  onClick={() => e.entraram && abrir(`${e.nome} · entraram no período`, e.entraram)}
                  className="col-span-3 grid grid-cols-subgrid items-center rounded-md text-left outline-none transition-colors duration-[120ms] enabled:hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                >
                  <span
                    aria-hidden
                    className="grid size-6 place-items-center rounded-md bg-muted text-muted-foreground"
                  >
                    <CirclePause className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="num text-right text-sm text-muted-foreground">
                    {e.entraram ? INT.format(e.entraram.length) : "—"}
                  </span>
                  <span className="truncate text-sm text-muted-foreground">
                    {e.nome.replace(/^\d+\s*·\s*/, "")} · fora da sequência
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => abrir(`${e.nome} · no pipe hoje`, e.parados!)}
                  className="num rounded-md text-right text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {INT.format(e.parados!.length)}
                </button>
                <span />
              </div>
            ))}
          </div>
        )}
      </div>
      {!porEtapa && (
        <p className="mt-auto pt-3 text-xs text-muted-foreground">
          Etapas com "—" passam a ser contadas quando a carga do CRM gravar a entrada por etapa.
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
  const abrirDia = (date: string) => {
    const doDia = (k: Metrica) =>
      view.rows[k].filter((c) => c.events[k].some((e) => e.date === date));
    const ids = new Set<number>();
    const rows = [...doDia("started"), ...doDia("scheduled"), ...doDia("meeting")].filter(
      (c) => !ids.has(c.id) && ids.add(c.id),
    );
    abrir(`Movimentos de ${ddmm(date)}`, rows);
  };
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

const GRUPOS: { titulo: string; chaves: Metrica[] }[] = [
  { titulo: "Esforço", chaves: ["loaded", "started"] },
  { titulo: "Reuniões", chaves: ["scheduled", "meeting"] },
  { titulo: "Resultado", chaves: ["validated", "signed"] },
];
const CURTO: Record<Metrica, string> = {
  loaded: "Fila carregada",
  started: "Trabalhados",
  scheduled: "Marcadas",
  meeting: "Realizadas",
  validated: "Validadas",
  signed: "Ganhos",
};

/**
 * Uma linha por produto, colunas agrupadas pelo que medem (esforço, reuniões, resultado). Cada
 * célula traz o número, a barra contra o maior valor da coluna e a passagem da coluna anterior,
 * para o olho ler a linha como um funil curto. Zero sai apagado, sem passagem, e não abre nada.
 */
export function PorProduto({ view, abrir }: { view: ReturnType<typeof operacao>; abrir: Abrir }) {
  const chaves = GRUPOS.flatMap((g) => g.chaves);
  const linhas = view.products
    .filter((p) => p.product !== "sem_produto" || chaves.some((k) => p[k] > 0))
    .sort((a, b) =>
      a.product === "sem_produto" ? 1 : b.product === "sem_produto" ? -1 : b.started - a.started,
    );
  const maximo = Object.fromEntries(
    chaves.map((k) => [k, Math.max(1, ...linhas.map((p) => p[k]))]),
  );
  const total = Object.fromEntries(chaves.map((k) => [k, view.rows[k].length])) as Record<
    Metrica,
    number
  >;
  const celula = (
    k: Metrica,
    i: number,
    valores: Record<Metrica, number>,
    rows: Negocio[],
    titulo: string,
    destaque = false,
  ) => {
    const v = valores[k];
    const anterior = i > 0 ? valores[chaves[i - 1]] : null;
    // Passagem só quando as duas pontas têm movimento: "0% da anterior" e "—" em série viravam ruído.
    const passagem = anterior && v ? taxa(v, anterior) : null;
    return (
      <td key={k} className="px-3 py-2.5 align-top">
        {v > 0 ? (
          <button
            type="button"
            onClick={() => abrir(titulo, rows)}
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
          {passagem === null ? "\u00a0" : `${PCT.format(passagem)} da anterior`}
        </span>
      </td>
    );
  };
  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-end justify-between gap-2 px-4 pt-4">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">Qual produto avança na base?</h2>
          <p className="text-[13px] text-muted-foreground">
            Movimentos do período por produto. A barra compara os produtos na mesma coluna; a
            porcentagem é a passagem da coluna anterior. Clique no número para abrir os negócios.
          </p>
        </div>
      </div>
      <div className="overflow-x-auto p-2">
        <table className="w-full min-w-[760px] table-fixed text-left">
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
            {linhas.map((p) => (
              <tr key={p.product} className="border-t">
                <th
                  className={cn(
                    "px-3 py-2.5 align-top text-sm font-semibold",
                    p.product === "sem_produto" ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {NOMES[p.product as Produto | "sem_produto"]}
                </th>
                {chaves.map((k, i) =>
                  celula(
                    k,
                    i,
                    p,
                    view.rows[k].filter((c) => c.route === p.product),
                    `${NOMES[p.product]} · ${METRICAS.find((m) => m.key === k)!.label}`,
                  ),
                )}
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/40">
              <th className="px-3 py-2.5 align-top text-sm font-bold text-foreground">Total</th>
              {chaves.map((k, i) =>
                celula(k, i, total, view.rows[k], METRICAS.find((m) => m.key === k)!.label, true),
              )}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
