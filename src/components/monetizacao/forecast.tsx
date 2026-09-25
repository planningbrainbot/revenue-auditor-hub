import { Link } from "@tanstack/react-router";
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
import { ForecastModel } from "./forecast-model";
import { disponibilidade, oferta } from "@/lib/monetizacao/model";
import { forecastComparison } from "@/lib/monetizacao/forecast";
import { NOMES } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, ForecastSource, Metrica, Negocio } from "@/lib/monetizacao/types";
import {
  estadoKpiEvento,
  Field,
  FOCO_VISIVEL,
  inputClass,
  NotaApoio,
  number,
  procedenciaMonetizacao,
  SecaoCartao,
} from "./common";
import type { OpcoesDetalhe } from "./dashboard";
import type { BuscaMonetizacao } from "./busca";
import {
  BarraFiltros,
  EstadoSemAcesso,
  EstadoVazio,
  KpiCard,
  KpiGrade,
} from "@/components/planning";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  tooltipProps,
} from "@/lib/planning/grafico";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "set/2026". */
export const rotuloMesForecast = (m: string) =>
  `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
/** "set/26": eixo do gráfico. */
const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

/** A versão do forecast em uso: a de fonte mais recente. */
export const fonteDoForecast = (data: BaseMonetizacao): ForecastSource | undefined =>
  [...data.forecasts].sort((a, b) => b.source_date.localeCompare(a.source_date))[0];

/**
 * Mês comparado: `mes` da URL, senão o mês de `ate` (padrão da moldura); fora dos meses da fonte,
 * o primeiro mês dela. O cabeçalho (`descricaoDaAba`) usa a mesma regra para não divergir da tela.
 */
export const mesDoForecast = (source: ForecastSource, pedido: string) =>
  source.months.includes(pedido) ? pedido : source.months[0];

// "Leads trabalhados" é o nome do mesmo evento na Operação e em Capacidade (N11).
const METRICAS_FORECAST: [Metrica & ("started" | "meeting" | "validated" | "signed"), string][] = [
  ["started", "Leads trabalhados"],
  ["meeting", "Reuniões realizadas"],
  ["validated", "Oportunidades validadas"],
  ["signed", "Contratos ganhos"],
];

/**
 * Projetado × realizado (contrato `monetizacao-forecast.md`, arquétipo Lista/Relatório): o
 * realizado do CRM no mês, com a planilha como meta, por degrau e por produto, e a grade do
 * modelo. Só apresentação: os números vêm de `forecastComparison`, como antes.
 */
export function Forecast({
  data,
  month,
  openDeals,
  busca,
  mudarBusca,
}: {
  data: BaseMonetizacao;
  /** Mês padrão (mês de `ate`), quando a URL não traz `mes`. */
  month: string;
  openDeals: (
    title: string,
    rows: Negocio[],
    period?: { from: string; to: string },
    opcoes?: OpcoesDetalhe,
  ) => void;
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const source = fonteDoForecast(data);
  if (!source)
    return data.permissions.all_units ? (
      <EstadoVazio titulo="Ainda não há uma versão do forecast importada." />
    ) : (
      <EstadoSemAcesso oQueFalta="escopo de todas as unidades" />
    );
  const cutoff = data.measured_at
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(data.measured_at))
    : null;
  const comparisons = forecastComparison(source, data.cards, cutoff);
  const escolhido = mesDoForecast(source, busca?.mes ?? month);
  const selected = comparisons.find((c) => c.month === escolhido) || comparisons[0];
  const mesRotulo = rotuloMesForecast(selected.month);
  const periodo = { from: selected.month + "-01", to: selected.through };
  const procedencia = procedenciaMonetizacao(data);
  const recorteMes = `Toda a frente · ${dataBr(periodo.from)} a ${dataBr(periodo.to)}`;
  const ultimo = (k: Metrica) => (c: Negocio) =>
    c.events[k]
      .filter((e) => e.date >= periodo.from && e.date <= periodo.to)
      .map((e) => e.date)
      .sort()
      .at(-1);
  // O realizado só existe até o corte: mês futuro não tem registro para abrir.
  const show = (k: Metrica, label: string, rows: Negocio[]) =>
    openDeals(`${label} · ${mesRotulo}`, rows, periodo, {
      ordenarPor: ultimo(k),
      recorte: recorteMes,
    });
  const mudarMes = (m: string) =>
    mudarBusca?.({ mes: m === mesDoForecast(source, month) ? undefined : m });

  // Z1/Z2 sobre a frente inteira (a comparação não filtra dono nem produto).
  const evento = estadoKpiEvento(
    data,
    data.cards.filter((c) => !c.history_known),
  );
  const eventoGanho = estadoKpiEvento(data, []);
  const avisoParcial = selected.partial
    ? `mês em andamento, realizado até ${dataBr(selected.through)}; a meta é do mês inteiro`
    : undefined;
  const juntar = (...partes: (string | undefined)[]) => partes.filter(Boolean).join(" · ");

  const chart = comparisons.map((c) => ({
    name: mesCurto(c.month),
    meta: c.planned.signed,
    realizado: c.actual?.rows.signed.length ?? null,
  }));
  const fmt = (v: number | null) => (v === null ? "—" : number(v));
  const diferenca = (real: number, plan: number) => {
    const d = real - plan;
    return d > 0 ? `+${number(d)}` : d < 0 ? `−${number(-d)}` : "0";
  };

  // Z4: sem Base carregada (ou sem escopo geral, que não a recebe) a coluna não conta zero.
  const motivoSemBase =
    data.accounts.length > 0
      ? null
      : data.permissions.all_units
        ? "A Base de clientes não trouxe nenhuma conta nesta carga."
        : "A Base de clientes só carrega com escopo de todas as unidades.";

  return (
    <div className="space-y-4">
      <BarraFiltros
        className="items-end"
        aoLimpar={
          busca?.mes !== undefined || busca?.blocos !== undefined || busca?.totais !== undefined
            ? () => mudarBusca?.({ mes: undefined, blocos: undefined, totais: undefined })
            : undefined
        }
      >
        <Field label="Mês de comparação">
          <select
            className={`${inputClass} min-w-32`}
            value={selected.month}
            onChange={(e) => mudarMes(e.target.value)}
          >
            {source.months.map((m) => (
              <option key={m} value={m}>
                {rotuloMesForecast(m)}
              </option>
            ))}
          </select>
        </Field>
      </BarraFiltros>

      <NotaApoio>
        {source.note} O realizado acompanha o CRM
        {cutoff ? ` até ${dataBr(cutoff)}` : " após a primeira sincronização"}.
        {selected.partial ? " O mês está em andamento; a diferença usa a meta do mês inteiro." : ""}
      </NotaApoio>

      <KpiGrade colunas={4}>
        {METRICAS_FORECAST.map(([key, label]) => {
          const plan = selected.planned[key];
          const rows = selected.actual?.rows[key];
          const ev = key === "signed" ? eventoGanho : evento;
          const meta =
            plan === null
              ? undefined
              : {
                  valor: fmt(plan),
                  rotulo: "projetado",
                  progresso: rows && plan ? rows.length / plan : undefined,
                };
          if (!rows)
            return (
              <KpiCard
                key={key}
                rotulo={label}
                valor="—"
                estado="nao-apurado"
                nota={`Mês futuro: sem realizado · projetado ${fmt(plan)}`}
                procedencia={procedencia}
              />
            );
          return (
            <KpiCard
              key={key}
              rotulo={label}
              valor={rows.length}
              estado={ev.estado}
              nota={juntar(ev.nota, avisoParcial) || undefined}
              meta={meta}
              procedencia={procedencia}
              abrir={{ onClick: () => show(key, label, rows) }}
            />
          );
        })}
      </KpiGrade>

      <div className="grid gap-4 xl:grid-cols-2">
        <SecaoCartao
          titulo="Os contratos ganhos acompanham o projetado?"
          descricao={`Contratos por mês · ${rotuloMesForecast(source.months[0])} a ${rotuloMesForecast(source.months[source.months.length - 1])}`}
        >
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 10, right: 4, bottom: 0, left: -20 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} dataKey="name" />
                <YAxis {...eixoProps} allowDecimals={false} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendaProps} />
                <Bar
                  dataKey="realizado"
                  name="Realizado · CRM"
                  fill={CORES_SERIE[0]}
                  radius={[2, 2, 0, 0]}
                />
                <Line
                  dataKey="meta"
                  name={`Meta · planilha ${source.version}`}
                  type="linear"
                  {...linhaMetaProps}
                  dot={{ r: 2, fill: linhaMetaProps.stroke, strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Meses futuros ficam sem realizado. O mês corrente mostra o acumulado até a última carga.
          </p>
        </SecaoCartao>

        <SecaoCartao
          titulo="Em que degrau o mês descolou do plano?"
          descricao={`${mesRotulo} · negócios · realizado menos projetado${selected.partial ? " · mês parcial contra a meta cheia" : ""}`}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Indicador</TableHead>
                <TableHead className="text-right num">Realizado</TableHead>
                <TableHead className="text-right num">Projetado</TableHead>
                <TableHead className="text-right num">Diferença</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {METRICAS_FORECAST.map(([key, label]) => {
                const rows = selected.actual?.rows[key] ?? null,
                  real = rows?.length ?? null,
                  plan = selected.planned[key];
                const d = real === null || plan === null ? null : real - plan;
                return (
                  <TableRow key={key}>
                    <TableCell className="font-medium">{label}</TableCell>
                    <TableCell className="text-right num">
                      {rows === null ? (
                        "—"
                      ) : (
                        <button
                          type="button"
                          aria-label={`${label}: ${real}, abrir negócios`}
                          className={`font-semibold text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
                          onClick={() => show(key, label, rows)}
                        >
                          {real}
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="text-right num">{fmt(plan)}</TableCell>
                    <TableCell
                      className={`text-right num ${d !== null && d < 0 ? "text-danger" : ""}`}
                    >
                      {d === null ? "—" : diferenca(real!, plan!)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </SecaoCartao>
      </div>

      <SecaoCartao
        titulo="Qual produto está abaixo do projetado?"
        descricao={`${mesRotulo} · negócios; "Contas disponíveis" conta contas da Base, hoje`}
      >
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right num">Leads trabalhados · projetado</TableHead>
              <TableHead className="text-right num">Leads trabalhados</TableHead>
              <TableHead className="text-right num">Contratos projetados</TableHead>
              <TableHead className="text-right num">Contratos ganhos</TableHead>
              <TableHead className="text-right num">Validadas com data no mês</TableHead>
              <TableHead className="text-right num">Contas disponíveis</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {selected.products.map((p) => {
              const free = motivoSemBase
                ? null
                : data.accounts.filter(
                    (a) =>
                      oferta(a, p.product).status === "elegivel" &&
                      disponibilidade(a, p.product, data.cards, undefined, data.reservations).free,
                  ).length;
              return (
                <TableRow key={p.product}>
                  <TableCell className="font-medium">{NOMES[p.product]}</TableCell>
                  <TableCell className="text-right num">{fmt(p.plannedStarted)}</TableCell>
                  <TableCell className="text-right num">{p.actual?.started ?? "—"}</TableCell>
                  <TableCell className="text-right num">{fmt(p.plannedSigned)}</TableCell>
                  <TableCell className="text-right num">{p.actual?.signed ?? "—"}</TableCell>
                  <TableCell className="text-right num">
                    <button
                      type="button"
                      aria-label={`${NOMES[p.product]} · validadas com data prevista em ${mesRotulo}: ${p.scheduled.length}, abrir negócios`}
                      className={`font-semibold text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
                      onClick={() =>
                        openDeals(
                          `${NOMES[p.product]} · validadas com data prevista em ${mesRotulo}`,
                          p.scheduled,
                          undefined,
                          {
                            estoque: true,
                            ordenarPor: (c) => c.expected_close,
                            recorte: `Toda a frente · ${NOMES[p.product]} · data prevista em ${mesRotulo}`,
                          },
                        )
                      }
                    >
                      {p.scheduled.length}
                    </button>
                  </TableCell>
                  <TableCell className="text-right num">
                    {free === null ? (
                      <span title={motivoSemBase!}>
                        —<span className="sr-only"> ({motivoSemBase})</span>
                      </span>
                    ) : (
                      free
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <p className="mt-3 text-xs text-muted-foreground">
          As datas registradas no CRM representam expectativas das oportunidades em aberto. Não
          somamos esse estoque aos contratos ganhos para prometer um fechamento. “Contas
          disponíveis” usa a base atual, independentemente do mês do plano.
        </p>
        <Link
          to="/monetizacao"
          search={{ aba: "capacidade" }}
          className={`mt-3 inline-block text-sm text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`}
        >
          Ajustar a alocação e as hipóteses por produto →
        </Link>
      </SecaoCartao>

      {data.cards.some((c) => !c.history_known) && (
        <NotaApoio>
          {data.cards.filter((c) => !c.history_known).length} negócios estão sem histórico completo.
          Os movimentos desses negócios não são inferidos da etapa atual.
        </NotaApoio>
      )}
      <ForecastModel
        source={source}
        selectedMonth={selected.month}
        bloco={busca?.blocos}
        soTotais={!!busca?.totais}
        mudar={(patch) => mudarBusca?.(patch)}
      />
    </div>
  );
}
