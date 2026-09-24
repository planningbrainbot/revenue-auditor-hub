import { useState } from "react";
import { Link } from "@tanstack/react-router";
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
import { useAtualizarMonetizacao, useMonetizacao } from "@/hooks/use-monetizacao";
import { acionarMonetizacao } from "@/lib/monetizacao/functions";
import { FARMER, funil, hoje, METRICAS, metasOperacao, operacao } from "@/lib/monetizacao/model";
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
  LoadingState,
  money,
  Notice,
} from "./common";
import { ComoContamos, FunilOperacao, MetasFarmer, PorProduto, SerieDiaria } from "./operacao";
import { PageHeader } from "@/components/planning";
import { cn } from "@/lib/utils";

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
/** Filtros da tela na URL (N7): recarregar ou colar o link reproduz o recorte. */
export type BuscaMonetizacao = { aba: Aba; de?: string; ate?: string; produto?: Produto };
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const menosDias = (iso: string, n: number) =>
  new Date(Date.parse(iso) - n * 86400000).toISOString().slice(0, 10);
export function DashboardMonetizacao({
  busca,
  navegar,
}: {
  busca: BuscaMonetizacao;
  navegar: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const { aba } = busca;
  const setAba = (a: Aba) => navegar({ aba: a });
  const q = useMonetizacao(),
    invalidate = useAtualizarMonetizacao(),
    sync = useServerFn(acionarMonetizacao);
  const today = hoje();
  const inicioDoMes = today.slice(0, 7) + "-01";
  const filter: Filtro = {
    from: busca.de && ISO.test(busca.de) ? busca.de : inicioDoMes,
    to: busca.ate && ISO.test(busca.ate) ? busca.ate : today,
    // Único farmer da frente (24/09/2026): o seletor de responsável saiu da tela.
    owner: FARMER.id,
    product: busca.produto ?? "",
  };
  // Link colado com o início depois do fim não derruba a tela: vira o dia do fim.
  if (filter.from > filter.to) filter.from = filter.to;
  const [dates, setDates] = useState({ from: filter.from, to: filter.to });
  const [comoContamos, setComoContamos] = useState(false);
  const presets = [
    { nome: "Hoje", from: today },
    { nome: "7 dias", from: menosDias(today, 6) },
    { nome: "30 dias", from: menosDias(today, 29) },
    { nome: "Mês", from: inicioDoMes },
  ];
  const presetAtivo = filter.to === today ? presets.find((p) => p.from === filter.from) : undefined;
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
  const metas = metasOperacao(view, plan, filter, today);
  const abrir = (title: string, rows: Negocio[]) => setDetail({ title, rows });
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
  const choosePeriod = (from: string, to: string) => {
    setDates({ from, to });
    navegar({ de: from, ate: to });
  };
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 md:px-6">
      {/* Cada aba é um item do menu de Monetização, então o título é o da aba
          (o menu chama a primeira de "Operação diária"). A assinatura da Caixa de
          Oportunidade continua, agora ao lado do frescor do CRM. */}
      <PageHeader
        titulo={aba === "operacao" ? "Operação diária" : labels[aba]}
        pergunta={aba === "operacao" ? "O farmer está no ritmo, e onde a base trava?" : undefined}
        descricao={
          aba === "operacao"
            ? `Pipe Monetização no Pipedrive · farmer: ${FARMER.nome} · movimento contado no dia em que o card foi movido`
            : undefined
        }
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
        <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
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
                onClick={() => choosePeriod(p.from, today)}
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
          <Button
            size="sm"
            variant="outline"
            className="h-9"
            onClick={() => {
              try {
                operacao([], { ...filter, ...dates });
                choosePeriod(dates.from, dates.to);
              } catch (e) {
                toast.error((e as Error).message);
              }
            }}
          >
            Aplicar
          </Button>
          <Field label="Produto">
            <select
              className={inputClass}
              value={filter.product}
              onChange={(e) => navegar({ produto: (e.target.value as Produto | "") || undefined })}
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
          <MetasFarmer
            quadros={metas.quadros}
            uteis={metas.uteis}
            from={filter.from}
            to={filter.to}
            rows={view.rows}
            abrir={abrir}
            onComoContamos={() => setComoContamos(true)}
          />
          <ComoContamos
            open={comoContamos}
            onOpenChange={setComoContamos}
            quadros={metas.quadros}
          />
          <div className="grid gap-3 xl:grid-cols-[minmax(360px,0.85fr)_minmax(0,1.3fr)]">
            <FunilOperacao dados={funil(data.cards, data.stages, filter)} abrir={abrir} />
            <SerieDiaria view={view} metaDia={plan?.daily_target ?? null} abrir={abrir} />
          </div>
          <PorProduto view={view} abrir={abrir} />
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
