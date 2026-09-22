import { useState } from "react";
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
import { useAtualizarMonetizacao, useMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import { hoje, METRICAS, operacao } from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Negocio, Produto } from "@/lib/monetizacao/types";
import { Analysis } from "./analysis";
import {
  date,
  downloadCsv,
  Field,
  FalhaDeCarga,
  Freshness,
  inputClass,
  Kpi,
  LoadingState,
  money,
  Notice,
  number,
  Panel,
} from "./common";
import { PageHeader } from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaMetaProps,
  tooltipProps,
} from "@/lib/planning/grafico";

export const ABAS = [
  "operacao",
  "forecast",
  "temporal",
  "capacidade",
  "follow-day",
  "funil",
  "pessoas",
  "roteiros",
  "distribuicao",
] as const;
export type Aba = (typeof ABAS)[number];
const labels: Record<Aba, string> = {
  operacao: "Operação",
  forecast: "Projetado × realizado",
  temporal: "Temporal e previsão",
  capacidade: "Capacidade e alocação",
  "follow-day": "Follow Day",
  funil: "Funil comercial",
  pessoas: "Pessoas e PDI",
  roteiros: "Abordagens",
  distribuicao: "Distribuição",
};
// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
export function DashboardMonetizacao({ aba, setAba }: { aba: Aba; setAba: (a: Aba) => void }) {
  const q = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  const today = hoje();
  const [filter, setFilter] = useState<Filtro>({
    from: today.slice(0, 7) + "-01",
    to: today,
    owner: 28381245,
    product: "",
  });
  const [dates, setDates] = useState({ from: filter.from, to: filter.to });
  const [refreshing, setRefreshing] = useState(false),
    [detail, setDetail] = useState<{
      title: string;
      rows: Negocio[];
      period?: { from: string; to: string };
    } | null>(null);
  if (!q.data) return <LoadingState error={q.error} retry={() => q.refetch()} />;
  const data = q.data;
  if (!data.permissions.all_units && !data.units.length)
    return (
      <div className="p-6">
        <Notice>
          Seu acesso está ativo, mas nenhuma unidade foi liberada para você. A administração precisa
          definir suas carteiras.
        </Notice>
      </div>
    );
  if (!data.permissions.view)
    return (
      <div className="p-6">
        <Notice>
          Seu acesso permite consultar o Aquário. A área de Monetização é habilitada pela
          administração da plataforma.
        </Notice>
        <Link to="/aquario" className="text-primary-text underline">
          Abrir Aquário
        </Link>
      </div>
    );
  const view = operacao(data.cards, filter),
    plan = data.plans.find((p) => p.month === filter.to.slice(0, 7) && p.owner_id === filter.owner);
  const refresh = async () => {
    setRefreshing(true);
    try {
      if (data.permissions.view && data.permissions.all_units)
        await sync({ data: { action: "sync" } });
      await invalidate();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const owners = [
    ...new Map([
      [28381245, "Matheus Carvalho"],
      [27369179, "Samira Vieira"],
      ...data.cards
        .filter((c) => c.owner_id)
        .map((c) => [c.owner_id!, c.owner] as [number, string]),
    ]).entries(),
  ];
  const choosePeriod = (from: string, to: string) => {
    setDates({ from, to });
    setFilter({ ...filter, from, to });
  };
  const currentStages = data.stages.map((s) => ({
    ...s,
    cards: view.current.filter((c) => c.stage_id === s.id),
  }));
  return (
    <main className="mx-auto max-w-[1600px] space-y-3 p-4 md:px-6">
      {/* Cada aba é um item do menu de Monetização, então o título é o da aba
          (o menu chama a primeira de "Operação diária"). A assinatura da Caixa de
          Oportunidade continua, agora ao lado do frescor do CRM. */}
      <PageHeader
        titulo={aba === "operacao" ? "Operação diária" : labels[aba]}
        acoes={
          <>
            <img
              src="/brand/caixa/assinatura-horizontal.svg"
              alt="Caixa de Oportunidade"
              className="h-8 w-auto dark:brightness-0 dark:invert"
            />
            <Freshness data={data} refreshing={refreshing} onRefresh={refresh} />
          </>
        }
      />
      <div
        className="flex gap-1 overflow-x-auto border-b"
        role="tablist"
        aria-label="Análises de Monetização"
      >
        {ABAS.map((a) => (
          <button
            role="tab"
            aria-selected={aba === a}
            onClick={() => setAba(a)}
            key={a}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-xs font-medium ${aba === a ? "border-primary text-primary-text" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {labels[a]}
          </button>
        ))}
        <Link to="/aquario" className="ml-auto shrink-0 px-3 py-2.5 text-xs text-primary-text">
          Clientes → Aquário ↗
        </Link>
      </div>
      {aba !== "forecast" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex gap-1">
            {["Hoje", "7 dias", "Mês"].map((name, i) => (
              <Button
                key={name}
                variant="outline"
                size="sm"
                onClick={() =>
                  choosePeriod(
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
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              try {
                operacao([], { ...filter, ...dates });
                setFilter({ ...filter, ...dates });
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Aplicar
          </Button>
          <Field label="Responsável pelo movimento">
            <select
              className={inputClass}
              value={filter.owner || ""}
              onChange={(e) => setFilter({ ...filter, owner: Number(e.target.value) || null })}
            >
              <option value="">Toda a frente</option>
              {owners.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Produto">
            <select
              className={inputClass}
              value={filter.product}
              onChange={(e) => setFilter({ ...filter, product: e.target.value as Produto | "" })}
            >
              <option value="">Todos os produtos</option>
              {PRODUTOS.map((p) => (
                <option key={p} value={p}>
                  {NOMES[p]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}
      <FalhaDeCarga data={data} />
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
                    })
                  }
                />
              );
            })}
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.4fr)]">
            <Panel
              title="Funil agora"
              action={
                <span className="text-xs text-muted-foreground">{view.current.length} abertos</span>
              }
            >
              <div className="space-y-3">
                {currentStages.map((s) => (
                  <button
                    key={s.id}
                    className="block w-full text-left"
                    onClick={() => setDetail({ title: s.name, rows: s.cards })}
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
            </Panel>
            <Panel
              title="Dia a dia"
              action={
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
            </Panel>
          </div>
          <Panel
            title="Por produto"
            action={
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
          </Panel>
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
          openDeals={(title, rows, period) => setDetail({ title, rows, period })}
        />
      )}
      <DealDetails
        detail={detail}
        close={() => setDetail(null)}
        filter={{ ...filter, ...detail?.period }}
        data={data}
      />
    </main>
  );
}

function DealDetails({
  detail,
  close,
  filter,
  data,
}: {
  detail: { title: string; rows: Negocio[] } | null;
  close: () => void;
  filter: Filtro;
  data: BaseMonetizacao;
}) {
  const [search, setSearch] = useState("");
  const rows =
    detail?.rows.filter((c) =>
      [c.title, c.owner, NOMES[c.route]].join(" ").toLowerCase().includes(search.toLowerCase()),
    ) || [];
  return (
    <Dialog open={!!detail} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[min(1250px,95vw)]">
        <DialogHeader>
          <DialogTitle>{detail?.title}</DialogTitle>
          <DialogDescription>
            {detail?.rows.length} oportunidades · {date(filter.from)} a {date(filter.to)}. Resultado
            atribuído a quem registrou o movimento; responsável mostra o dono atual.
          </DialogDescription>
        </DialogHeader>
        <input
          aria-label="Buscar oportunidades"
          className={inputClass}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar empresa, produto ou responsável"
        />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                {[
                  "Empresa / card",
                  "Produto",
                  "Responsável",
                  "Etapa atual",
                  "Data prevista",
                  "Receita prevista",
                  "Partners",
                  "Unidade",
                ].map((s) => (
                  <th key={s} className="p-3">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b align-top">
                  <td className="p-3">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary-text underline"
                    >
                      {c.title}
                    </a>
                    {!c.org_id && (
                      <span className="block text-warning">Sem organização vinculada</span>
                    )}
                    <details className="mt-2">
                      <summary>Histórico no período</summary>
                      {Object.entries(c.events).flatMap(([kind, events]) =>
                        events
                          .filter((e) => e.date >= filter.from && e.date <= filter.to)
                          .map((e, i) => (
                            <p key={`${kind}-${i}`}>
                              {date(e.date)} · {METRICAS.find((m) => m.key === kind)?.label} ·{" "}
                              {data.cards.find((d) => d.owner_id === e.actor_id)?.owner ||
                                (e.actor_id === 28381245
                                  ? "Matheus Carvalho"
                                  : `Usuário ${e.actor_id}`)}
                            </p>
                          )),
                      )}
                    </details>
                  </td>
                  <td className="p-3">{NOMES[c.route]}</td>
                  <td className="p-3">{c.owner}</td>
                  <td className="p-3">{c.stage}</td>
                  <td className="p-3">{date(c.expected_close)}</td>
                  <td className="p-3">
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
                  </td>
                  <td className="p-3">
                    {money(c.revenue.partners.amount, c.revenue.partners.currency)}
                  </td>
                  <td className="p-3">
                    {money(c.revenue.unit.amount, c.revenue.unit.currency)}
                    <span className="block text-muted-foreground">{c.revenue.unit_name}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
