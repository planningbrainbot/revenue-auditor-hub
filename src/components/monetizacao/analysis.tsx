import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  capacidade,
  distancia,
  hoje,
  operacao,
  receitaSomada,
  temporal,
} from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { salvarPlanoMonetizacao, salvarRegistroMonetizacao } from "@/lib/monetizacao/functions";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type { BaseMonetizacao, Negocio, Plano, Produto } from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import type { Aba } from "./dashboard";
import { date, Field, inputClass, Kpi, money, Notice, number, Panel } from "./common";

type Props = {
  aba: Aba;
  data: BaseMonetizacao;
  filter: Filtro;
  openDeals: (title: string, rows: Negocio[]) => void;
};
export function Analysis(props: Props) {
  const { aba, data, filter, openDeals } = props;
  if (aba === "temporal") return <Temporal data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "capacidade")
    return (
      <Capacity key={`${filter.to.slice(0, 7)}-${filter.owner}`} data={data} filter={filter} />
    );
  if (aba === "follow-day") return <FollowDay data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "funil") return <Funnel data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "pessoas") return <People data={data} filter={filter} />;
  if (aba === "roteiros") return <Scripts data={data} />;
  return <Distribution data={data} filter={filter} />;
}

type Cut = Pick<Props, "data" | "filter" | "openDeals">;
function Temporal({ data, filter, openDeals }: Cut) {
  const t = temporal(data.cards, filter),
    revenue = receitaSomada(t.open);
  const stale = t.open.filter((c) => c.expected_close && c.expected_close < hoje());
  const plan = data.plans.find(
    (p) => p.month === filter.to.slice(0, 7) && p.owner_id === filter.owner,
  );
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi
          label="Validadas em aberto"
          value={t.open.length}
          hint="Estoque atual, com passagem registrada"
          onClick={() => openDeals("Validadas em aberto", t.open)}
        />
        <Kpi
          label="Ciclo mediano até assinatura"
          value={t.median === null ? "—" : number(t.median) + " dias"}
          hint={`${t.signed.length} contratos assinados no período`}
        />
        <Kpi
          label="90% das assinaturas até"
          value={t.p90 === null ? "—" : number(t.p90) + " dias"}
          hint="Inclui contratos fechados no mesmo dia"
        />
        <Kpi
          label="Data prevista vencida"
          value={stale.length}
          hint="Conferir a data com o responsável"
          onClick={() => openDeals("Data prevista vencida", stale)}
        />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <Kpi
          label="Receita prevista · total conciliado"
          value={revenue.known ? money(revenue.total) : "A preencher"}
          hint={`${revenue.known} de ${t.open.length} oportunidades com split completo`}
        />
        <Kpi
          label="Receita prevista · Partners"
          value={revenue.known ? money(revenue.partners) : "A preencher"}
          hint="Somente a parcela preenchida e conciliada"
        />
        <Kpi
          label="Receita prevista · unidades"
          value={revenue.known ? money(revenue.unit) : "A preencher"}
          hint="Valores previstos; ainda não são recebimentos"
        />
      </div>
      <Panel title="Quando as oportunidades estão previstas">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th>Semana a partir de</th>
              <th>Oportunidades</th>
              <th>Receita prevista conciliada</th>
              <th>Pendências de receita</th>
            </tr>
          </thead>
          <tbody>
            {t.weeks.map((w) => (
              <tr className="border-t" key={w.week}>
                <td className="py-3">{w.week === "Sem data" ? w.week : date(w.week)}</td>
                <td>
                  <button
                    className="text-primary underline"
                    onClick={() => openDeals(`Previsão · ${w.week}`, w.rows)}
                  >
                    {w.rows.length}
                  </button>
                </td>
                <td>{w.revenue.known ? money(w.revenue.total) : "A preencher"}</td>
                <td>{w.revenue.missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!t.weeks.length && (
          <p className="py-6 text-sm text-muted-foreground">
            Nenhuma oportunidade validada em aberto para este responsável/produto.
          </p>
        )}
      </Panel>
      <Panel title="Meta, cenário e previsão do CRM">
        <div className="grid gap-3 md:grid-cols-3">
          {PRODUTOS.map((p) => {
            const dated = t.open.filter(
                (c) =>
                  c.route === p &&
                  c.expected_close &&
                  c.expected_close >= filter.from &&
                  c.expected_close <= filter.to,
              ),
              rate = plan?.rates[p];
            return (
              <div key={p} className="rounded-lg border p-3">
                <h3 className="text-sm font-semibold">{NOMES[p]}</h3>
                <p className="mt-2 text-sm">{dated.length} validadas com data neste período</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rate === null || rate === undefined
                    ? "Sem hipótese de conversão configurada"
                    : `Cenário: ${number(dated.length * rate)} contratos · hipótese ${number(rate * 100)}%`}
                </p>
                <button
                  className="mt-2 text-xs text-primary underline"
                  onClick={() => openDeals(`${NOMES[p]} · previstas no período`, dated)}
                >
                  Conferir oportunidades
                </button>
              </div>
            );
          })}
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Meta mensal: {plan?.target_contracts ?? "a definir"} contratos. O cenário usa apenas
          oportunidades realmente validadas e datadas, com hipótese declarada. As taxas do Growth
          não são aplicadas à Monetização.
        </p>
      </Panel>
      <Notice>
        Receita prevista é o valor informado para a oportunidade. Total deve fechar com Partners +
        unidade, na mesma moeda. A base de cobrança e a competência precisam estar definidas no
        contrato; este painel não transforma esses valores em MRR ou caixa.
      </Notice>
    </div>
  );
}

function Capacity({ data, filter }: Pick<Props, "data" | "filter">) {
  const month = filter.to.slice(0, 7),
    saved = data.plans.find((p) => p.month === month && p.owner_id === filter.owner);
  const [plan, setPlan] = useState<Plano>(
    saved || {
      month,
      owner_id: filter.owner || 28381245,
      owner_name: data.cards.find((c) => c.owner_id === filter.owner)?.owner || "Matheus Carvalho",
      capacity: 120,
      meetings_capacity: 60,
      target_contracts: 8,
      daily_target: 7,
      allocation: { consultoria: 0, finance: 0, cella: 0 },
      rates: { cella: null, consultoria: null, finance: null },
    },
  );
  const [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(!saved);
  const fn = useServerFn(salvarPlanoMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const rows = capacidade(
      plan,
      data.accounts,
      data.cards,
      {
        ...filter,
        from: month + "-01",
        to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
          .toISOString()
          .slice(0, 10),
        owner: plan.owner_id,
        product: "",
      },
      data.reservations,
    ),
    allocated = PRODUTOS.reduce((n, p) => n + plan.allocation[p], 0);
  const save = async () => {
    setBusy(true);
    try {
      await fn({ data: plan });
      await invalidate();
      setEditing(false);
      toast.success("Capacidade e hipóteses salvas para este mês e responsável.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {!saved && (
        <Notice>
          Parâmetros ainda não salvos para este mês/responsável. Os valores no editor são uma
          proposta baseada na régua conhecida; só passam a orientar os indicadores depois de salvar.
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Capacidade mensal proposta" value={plan.capacity} hint={plan.owner_name} />
        <Kpi
          label="Alocada entre produtos"
          value={allocated}
          hint={
            allocated > plan.capacity
              ? "Supera a capacidade"
              : `${plan.capacity - allocated} vagas sem alocação`
          }
        />
        <Kpi
          label="Trabalho realizado no mês"
          value={rows.reduce((n, r) => n + r.started, 0)}
          hint="Cards com trabalho iniciado no mês"
        />
        <Kpi
          label="Falta de base na alocação"
          value={rows.reduce((n, r) => n + r.gap, 0)}
          hint="Alocação restante acima da base disponível"
        />
      </div>
      <Panel title="Estoque, esforço e capacidade por produto">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                {[
                  "Produto",
                  "Perfil aderente",
                  "Disponível hoje",
                  "Alocação mensal",
                  "Trabalhadas no mês",
                  "Base faltante",
                ].map((s) => (
                  <th key={s} className="pb-2">
                    {s}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.product} className="border-t">
                  <th className="py-3">{NOMES[r.product]}</th>
                  <td>{r.eligible}</td>
                  <td>{r.available}</td>
                  <td>{r.planned}</td>
                  <td>{r.started}</td>
                  <td className={r.gap ? "text-amber-600" : ""}>{r.gap}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          A base faltante considera a alocação mensal menos o trabalho já iniciado. Esta tela usa o
          mês inteiro e todos os produtos. Há empresas em mais de uma coluna. Antes de distribuir a
          carga, valide as listas no Aquário e coordene as abordagens da mesma empresa.
        </p>
        <Link to="/aquario" className="mt-3 inline-block text-sm text-primary underline">
          Preparar a base nas carteiras dos clientes →
        </Link>
      </Panel>
      <Panel
        title={`Plano · ${month} · ${plan.owner_name}`}
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setEditing(!editing)}
            disabled={!(data.permissions.view && data.permissions.all_units)}
          >
            {editing ? "Fechar editor" : "Editar plano"}
          </Button>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-4">
              {(
                [
                  ["capacity", "Leads / mês"],
                  ["meetings_capacity", "Teto de reuniões / mês"],
                  ["target_contracts", "Meta de contratos / mês"],
                  ["daily_target", "Leads / dia útil"],
                ] as const
              ).map(([key, label]) => (
                <Field label={label} key={key}>
                  <input
                    type="number"
                    min="0"
                    className={inputClass}
                    value={plan[key]}
                    onChange={(e) => setPlan({ ...plan, [key]: Number(e.target.value) })}
                  />
                </Field>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {PRODUTOS.map((p) => (
                <div key={p} className="space-y-2 rounded-lg border p-3">
                  <h3 className="text-sm font-semibold">{NOMES[p]}</h3>
                  <Field label="Ofertas a trabalhar no mês">
                    <input
                      type="number"
                      min="0"
                      className={inputClass}
                      value={plan.allocation[p]}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          allocation: { ...plan.allocation, [p]: Number(e.target.value) },
                        })
                      }
                    />
                  </Field>
                  <Field label="Hipótese de validada → contrato (%)">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      className={inputClass}
                      value={plan.rates[p] === null ? "" : plan.rates[p]! * 100}
                      placeholder="Sem hipótese"
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          rates: {
                            ...plan.rates,
                            [p]: e.target.value === "" ? null : Number(e.target.value) / 100,
                          },
                        })
                      }
                    />
                  </Field>
                </div>
              ))}
            </div>
            <Button
              disabled={
                busy ||
                !(data.permissions.view && data.permissions.all_units) ||
                allocated > plan.capacity
              }
              onClick={save}
            >
              Salvar plano e hipóteses
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Plano salvo. As metas da Operação e os cenários da previsão usam esta configuração.
            Capacidade de reuniões: {plan.meetings_capacity}/mês.
          </p>
        )}
      </Panel>
    </div>
  );
}

function FollowDay({ data, filter, openDeals }: Cut) {
  const [days, setDays] = useState(7);
  const view = operacao(data.cards, filter),
    today = hoje();
  const rows = view.current
    .map((c) => {
      const movementDates = Object.values(c.events)
          .flat()
          .map((e) => e.date),
        latest = [c.created_at.slice(0, 10), c.last_activity_date, ...movementDates]
          .filter(Boolean)
          .sort()
          .at(-1)!;
      const age = distancia(latest, today),
        overdue = !!c.next_activity && c.next_activity < today;
      return {
        c,
        age,
        issue: overdue
          ? "Atividade vencida"
          : !c.next_activity
            ? "Sem próximo passo"
            : age >= days
              ? "Sem movimento recente"
              : "Acompanhamento em dia",
      };
    })
    .filter((r) => r.issue !== "Acompanhamento em dia")
    .sort((a, b) => b.age - a.age);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {["Atividade vencida", "Sem próximo passo", "Sem movimento recente"].map((label) => (
          <Kpi
            key={label}
            label={label}
            value={rows.filter((r) => r.issue === label).length}
            hint="Oportunidades abertas do responsável atual"
            onClick={() =>
              openDeals(
                label,
                rows.filter((r) => r.issue === label).map((r) => r.c),
              )
            }
          />
        ))}
      </div>
      <Panel
        title="O que precisa acontecer hoje"
        action={
          <Field label="Dias sem movimento">
            <input
              className={`${inputClass} max-w-24`}
              type="number"
              min="1"
              max="180"
              value={days}
              onChange={(e) => setDays(Math.max(1, Number(e.target.value)))}
            />
          </Field>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th>Empresa</th>
                <th>Produto / etapa</th>
                <th>Sinal</th>
                <th>Sem movimento</th>
                <th>Próxima atividade</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, age, issue }) => (
                <tr className="border-t" key={c.id}>
                  <td className="py-3 pr-3">
                    <a
                      className="text-primary underline"
                      href={c.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.title}
                    </a>
                    <span className="block text-xs text-muted-foreground">{c.owner}</span>
                  </td>
                  <td className="text-xs">
                    {NOMES[c.route]}
                    <span className="block text-muted-foreground">{c.stage}</span>
                  </td>
                  <td className="text-xs text-amber-600">{issue}</td>
                  <td>{age} dias</td>
                  <td>{date(c.next_activity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="py-6 text-sm text-muted-foreground">
            Nenhum alerta com a régua selecionada.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Sinais para organizar a daily. O último movimento considera atividade concluída ou
          passagem de etapa disponível no CRM; não equivale automaticamente à última conversa com o
          cliente.
        </p>
      </Panel>
    </div>
  );
}

function Funnel({ data, filter, openDeals }: Cut) {
  const v = operacao(data.cards, filter);
  const scheduled = v.rows.scheduled,
    realized = scheduled.filter((c) =>
      c.events.meeting.some(
        (m) =>
          m.date <= filter.to &&
          c.events.scheduled.some(
            (s) =>
              s.date >= filter.from &&
              s.date <= m.date &&
              (!filter.owner || s.actor_id === filter.owner),
          ),
      ),
    );
  const pending = scheduled.filter((c) => !realized.some((r) => r.id === c.id)),
    lost = pending.filter((c) => c.status === "lost"),
    stillOpen = pending.filter((c) => c.status === "open");
  const validated = v.rows.validated,
    signed = validated.filter(
      (c) =>
        c.signed_on &&
        c.signed_on <= filter.to &&
        c.events.validated.some(
          (e) =>
            e.date >= filter.from &&
            e.date <= c.signed_on! &&
            (!filter.owner || e.actor_id === filter.owner),
        ),
    );
  return (
    <div className="space-y-4">
      <Panel title="Agendamento → reunião · mesma coorte">
        <div className="grid gap-3 sm:grid-cols-4">
          <Kpi
            label="Agendadas no período"
            value={scheduled.length}
            onClick={() => openDeals("Coorte agendada", scheduled)}
          />
          <Kpi
            label="Depois realizadas"
            value={realized.length}
            hint={
              scheduled.length
                ? `${number((realized.length / scheduled.length) * 100)}% desta coorte`
                : "Sem amostra"
            }
            onClick={() => openDeals("Agendadas depois realizadas", realized)}
          />
          <Kpi
            label="Sem realização · em aberto"
            value={stillOpen.length}
            hint="Ainda podem realizar"
            onClick={() => openDeals("Agendadas ainda em aberto", stillOpen)}
          />
          <Kpi
            label="Sem realização · perdidas"
            value={lost.length}
            onClick={() => openDeals("Agendadas perdidas sem realização", lost)}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Uma oportunidade sem passagem em Reunião realizada não é automaticamente no-show. Para
          medir ausência, recuperação e motivo, é preciso registrar o resultado da atividade no CRM.
        </p>
      </Panel>
      <Panel title="Oportunidade validada → assinatura · mesma coorte">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="Validadas no período"
            value={validated.length}
            onClick={() => openDeals("Coorte validada", validated)}
          />
          <Kpi
            label="Assinadas até o fim do período"
            value={signed.length}
            hint={
              validated.length
                ? `${number((signed.length / validated.length) * 100)}% · coorte ainda pode amadurecer`
                : "Sem amostra"
            }
            onClick={() => openDeals("Assinadas da coorte validada", signed)}
          />
          <Kpi
            label="Ainda em aberto"
            value={validated.filter((c) => c.status === "open").length}
            hint="Não entram como fracasso definitivo"
          />
        </div>
      </Panel>
      <Panel title="Conversão por produto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th>Produto</th>
              <th>Reuniões realizadas</th>
              <th>Validadas</th>
              <th>Assinadas</th>
              <th>Abertas da coorte validada</th>
            </tr>
          </thead>
          <tbody>
            {v.products.map((p) => (
              <tr key={p.product} className="border-t">
                <th className="py-3">{NOMES[p.product]}</th>
                <td>{p.meeting}</td>
                <td>{p.validated}</td>
                <td>{p.signed}</td>
                <td>
                  {validated.filter((c) => c.route === p.product && c.status === "open").length}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted-foreground">
          As três primeiras métricas contam seus próprios eventos no período. Use as coortes acima
          para calcular conversão sem misturar denominadores.
        </p>
      </Panel>
    </div>
  );
}

const CRITERIOS = [
  "Investigou faturamento e segmento",
  "Conectou a necessidade ao produto",
  "Validou oportunidade com o especialista",
  "Combinou próximo passo e prazo",
  "Preencheu produto, receita prevista e split",
];
function People({ data, filter }: Pick<Props, "data" | "filter">) {
  const [title, setTitle] = useState(""),
    [sample, setSample] = useState(""),
    [scores, setScores] = useState<Record<string, number>>({}),
    [goal, setGoal] = useState(""),
    [action, setAction] = useState(""),
    [due, setDue] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const values = Object.values(scores).filter((n) => n > 0),
    average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "pdi",
          title,
          body: {
            owner_id: filter.owner,
            from: filter.from,
            to: filter.to,
            sample,
            scores,
            goal,
            action,
            due,
            status: "em_andamento",
            rubric_version: 1,
          },
        },
      });
      await invalidate();
      toast.success("Avaliação e PDI registrados.");
      setTitle("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Avaliar evidências e definir desenvolvimento">
        <div className="space-y-3">
          <Notice>
            Avaliação registrada pelo gestor, com evidências. Volume de atividade e nota de
            qualidade são medidas separadas.
          </Notice>
          <Field label="Título da avaliação / pessoa">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Amostra e evidências revisadas">
            <textarea
              className={`${inputClass} h-20 py-2`}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
              placeholder="IDs das oportunidades, calls ou links revisados"
            />
          </Field>
          {CRITERIOS.map((c) => (
            <Field key={c} label={c}>
              <select
                className={inputClass}
                value={scores[c] || 0}
                onChange={(e) => setScores({ ...scores, [c]: Number(e.target.value) })}
              >
                <option value="0">Não avaliado</option>
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n} ·{" "}
                    {n === 1
                      ? "Não demonstrado"
                      : n === 3
                        ? "Parcial"
                        : n === 5
                          ? "Consistente"
                          : "Intermediário"}
                  </option>
                ))}
              </select>
            </Field>
          ))}
          <p className="text-sm">
            Média da amostra: <strong>{number(average)}</strong> · {values.length} de{" "}
            {CRITERIOS.length} critérios avaliados
          </p>
          <Field label="Objetivo de desenvolvimento">
            <input className={inputClass} value={goal} onChange={(e) => setGoal(e.target.value)} />
          </Field>
          <Field label="Ação observável para o próximo ciclo">
            <textarea
              className={`${inputClass} h-20 py-2`}
              value={action}
              onChange={(e) => setAction(e.target.value)}
            />
          </Field>
          <Field label="Revisar até">
            <input
              type="date"
              className={inputClass}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </Field>
          <Button
            onClick={save}
            disabled={
              busy ||
              !(data.permissions.view && data.permissions.all_units) ||
              !filter.owner ||
              !title ||
              !sample ||
              !goal ||
              !action ||
              !due ||
              !values.length
            }
          >
            Salvar avaliação e PDI
          </Button>
        </div>
      </Panel>
      <RecordList data={data} kind="pdi" title="PDIs e avaliações registrados" />
    </div>
  );
}

function Scripts({ data }: { data: BaseMonetizacao }) {
  const [product, setProduct] = useState<Produto>("consultoria"),
    [segment, setSegment] = useState(""),
    [evidence, setEvidence] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const compose = () =>
    setText(
      product === "consultoria"
        ? `Olá, [nome]. O sócio da unidade indicou conversarmos sobre a operação ${segment ? "de " + segment : "da empresa"}. Podemos confirmar o faturamento anual, o regime tributário e os principais desafios?\n\n${evidence ? "Ponto para investigar: " + evidence : "Investigar uma necessidade concreta antes de oferecer a consultoria."}\n\nPróximo passo: combinar uma conversa com o especialista e registrar responsável e data.`
        : product === "finance"
          ? `Olá, [nome]. Já temos um contrato da empresa na Planning. Gostaria de entender se existe uma necessidade de capital de giro, investimento ou troca de dívida.\n\n${evidence || "Confirmar objetivo, volume e prazo da necessidade, sem prometer aprovação."}\n\nPróximo passo: validar o cenário com o especialista de Finance e combinar a data de retorno.`
          : `Olá, [nome]. Queremos verificar se há uma oportunidade de revisão tributária que faça sentido para a empresa.\n\n${evidence || "Confirmar cenário, documentos disponíveis e disponibilidade para avaliação técnica."}\n\nPróximo passo: avaliar com o especialista, sem prometer crédito ou resultado antes da análise.`,
    );
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "roteiro",
          title,
          body: { product, segment, evidence, text, status: "rascunho", version: 1 },
        },
      });
      await invalidate();
      toast.success("Abordagem salva para revisão e uso pela equipe.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel title="Biblioteca de abordagens">
        <div className="space-y-3">
          <Field label="Nome da abordagem">
            <input
              className={inputClass}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Produto">
              <select
                className={inputClass}
                value={product}
                onChange={(e) => setProduct(e.target.value as Produto)}
              >
                {PRODUTOS.map((p) => (
                  <option key={p} value={p}>
                    {NOMES[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Segmento">
              <input
                className={inputClass}
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Evidência / necessidade observada">
            <textarea
              className={`${inputClass} h-20 py-2`}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </Field>
          <Button variant="outline" onClick={compose}>
            Montar roteiro a partir do modelo
          </Button>
          <Field label="Texto para revisar">
            <textarea
              className={`${inputClass} h-64 py-2`}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              onClick={save}
              disabled={
                busy ||
                !(data.permissions.view && data.permissions.all_units) ||
                title.trim().length < 3 ||
                !text
              }
            >
              Salvar abordagem
            </Button>
            <Button
              variant="outline"
              disabled={!text}
              onClick={() =>
                navigator.clipboard.writeText(text).then(() => toast.success("Texto copiado."))
              }
            >
              Copiar texto
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Modelo editável. Nada é enviado automaticamente ao cliente.
          </p>
        </div>
      </Panel>
      <RecordList data={data} kind="roteiro" title="Abordagens da equipe" />
    </div>
  );
}

function Distribution({ data, filter }: Pick<Props, "data" | "filter">) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const owners = [
    ...new Map(data.cards.filter((c) => c.owner_id).map((c) => [c.owner_id!, c.owner])).entries(),
  ];
  const rows = owners.map(([id, name]) => {
    const v = operacao(data.cards, { ...filter, owner: id }),
      plan = data.plans.find((p) => p.month === filter.to.slice(0, 7) && p.owner_id === id);
    return {
      id,
      name,
      open: v.current.length,
      loaded: v.rows.loaded.length,
      started: v.rows.started.length,
      validated: v.rows.validated.length,
      capacity: plan?.capacity ?? null,
    };
  });
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "distribuicao",
          title: `Decisão de distribuição · ${filter.from} a ${filter.to}`,
          body: {
            from: filter.from,
            to: filter.to,
            rows,
            reason,
            rule: "Consultoria primeiro nas unidades; preservar vínculo da conta; capacidade por hunter; produto explícito",
          },
        },
      });
      await invalidate();
      setReason("");
      toast.success("Critério e decisão registrados.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <Panel title="Carga e resultado por responsável">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              {[
                "Responsável",
                "Abertas hoje",
                "Carregadas",
                "Trabalhadas",
                "Validadas",
                "Capacidade mensal",
              ].map((s) => (
                <th key={s}>{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr className="border-t" key={r.id}>
                <th className="py-3 text-left font-medium">{r.name}</th>
                <td>{r.open}</td>
                <td>{r.loaded}</td>
                <td>{r.started}</td>
                <td>{r.validated}</td>
                <td>{r.capacity ?? "A definir"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Regra de distribuição">
          <ol className="list-inside list-decimal space-y-3 text-sm">
            <li>Preservar o vínculo da empresa com a unidade.</li>
            <li>Priorizar Consultoria nas carteiras das unidades.</li>
            <li>Mostrar Finance quando o perfil também atende à regra.</li>
            <li>Validar com o sócio e conferir a capacidade do hunter.</li>
            <li>Enviar a oferta selecionada com produto e responsável explícitos.</li>
          </ol>
          <div className="mt-5 space-y-3">
            <Field label="Decisão e motivo desta distribuição">
              <textarea
                className={`${inputClass} h-28 py-2`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: priorizar a carteira de Curitiba para Consultoria; sócio confirmou disponibilidade nesta semana."
              />
            </Field>
            <Button
              disabled={
                busy || !(data.permissions.view && data.permissions.all_units) || !reason.trim()
              }
              onClick={save}
            >
              Registrar decisão
            </Button>
            <Link to="/aquario" className="ml-3 text-sm text-primary underline">
              Abrir as listas no Aquário
            </Link>
          </div>
        </Panel>
        <RecordList data={data} kind="distribuicao" title="Histórico de decisões" />
      </div>
    </div>
  );
}

function RecordList({ data, kind, title }: { data: BaseMonetizacao; kind: string; title: string }) {
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const records = data.records.filter((r) => r.kind === kind).reverse();
  const changeStatus = async (id: string, status: string) => {
    const r = records.find((r) => r.id === id)!;
    try {
      await fn({ data: { ...r, body: { ...r.body, status } } });
      await invalidate();
      toast.success("Registro atualizado.");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const fields: Record<string, string> = {
    sample: "Evidências",
    goal: "Objetivo",
    action: "Ação",
    due: "Prazo",
    text: "Abordagem",
    evidence: "Evidência",
    reason: "Decisão",
    rule: "Regra",
    segment: "Segmento",
  };
  return (
    <Panel title={title}>
      <div className="space-y-3">
        {records.length ? (
          records.map((r) => (
            <details key={r.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {r.title}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {date(r.updated_at)} · {String(r.body.status || "Registrado")}
                </span>
              </summary>
              <div className="mt-3 space-y-3">
                {Object.entries(fields)
                  .filter(([k]) => r.body[k])
                  .map(([k, label]) => (
                    <div key={k}>
                      <span className="text-xs font-medium text-muted-foreground">{label}</span>
                      <p className="whitespace-pre-wrap text-sm">{String(r.body[k])}</p>
                    </div>
                  ))}
                {r.body.scores && typeof r.body.scores === "object" ? (
                  <ul className="space-y-1 text-xs">
                    {Object.entries(r.body.scores).map(([c, n]) => (
                      <li key={c}>
                        {c}: {Number(n) || "Não avaliado"}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {data.permissions.view && data.permissions.all_units && kind !== "distribuicao" && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => changeStatus(r.id, kind === "pdi" ? "concluido" : "aprovado")}
                    >
                      {kind === "pdi" ? "Marcar concluído" : "Aprovar abordagem"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => changeStatus(r.id, "arquivado")}
                    >
                      Arquivar
                    </Button>
                  </div>
                )}
              </div>
            </details>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum registro ainda. As avaliações, evidências e decisões salvas ficam disponíveis à
            equipe com acesso à operação geral.
          </p>
        )}
      </div>
    </Panel>
  );
}
