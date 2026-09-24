import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Briefcase } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChipFiltro, EstadoVazio, StatusBadge, type TomStatus } from "@/components/planning";
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
import type { Aba, OpcoesDetalhe } from "./dashboard";
import { DIAS_PADRAO } from "./busca";
import type { BuscaMonetizacao, Sinal } from "./busca";
import { Forecast } from "./forecast";
import { date, Field, inputClass, Kpi, money, NotaApoio, number, SecaoCartao } from "./common";

type Props = {
  aba: Aba;
  data: BaseMonetizacao;
  filter: Filtro;
  openDeals: (
    title: string,
    rows: Negocio[],
    period?: { from: string; to: string },
    opcoes?: OpcoesDetalhe,
  ) => void;
  /** Estado da tela na URL (`dias`, `mes`, `sinal`, `blocos`, `totais`, `arquivados`, `situacao`): as visões passam a usar nas T3–T8. */
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
};
export function Analysis(props: Props) {
  const { aba, data, filter, openDeals } = props;
  if (aba === "forecast")
    return <Forecast data={data} month={filter.to.slice(0, 7)} openDeals={openDeals} />;
  if (aba === "temporal") return <Temporal data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "capacidade")
    return (
      <Capacity key={`${filter.to.slice(0, 7)}-${filter.owner}`} data={data} filter={filter} />
    );
  if (aba === "follow-day")
    return (
      <FollowDay
        data={data}
        filter={filter}
        openDeals={openDeals}
        busca={props.busca}
        mudarBusca={props.mudarBusca}
      />
    );
  if (aba === "funil") return <Funnel data={data} filter={filter} openDeals={openDeals} />;
  if (aba === "pessoas") return <People data={data} filter={filter} />;
  if (aba === "roteiros") return <Scripts data={data} />;
  return <Distribution data={data} filter={filter} />;
}

type Cut = Pick<Props, "data" | "filter" | "openDeals">;
type CutBusca = Cut & Pick<Props, "busca" | "mudarBusca">;
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
          hint={`${t.signed.length} contratos ganhos no período`}
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
      <SecaoCartao titulo="Quando as oportunidades estão previstas">
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
                    className="text-primary-text underline"
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
      </SecaoCartao>
      <SecaoCartao titulo="Meta, cenário e previsão do CRM">
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
                  className="mt-2 text-xs text-primary-text underline"
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
      </SecaoCartao>
      <NotaApoio>
        Receita prevista é o valor informado para a oportunidade. Total deve fechar com Partners +
        unidade, na mesma moeda. A base de cobrança e a competência precisam estar definidas no
        contrato; este painel não transforma esses valores em MRR ou caixa.
      </NotaApoio>
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
        <NotaApoio>
          Parâmetros ainda não salvos para este mês/responsável. Os valores no editor são uma
          proposta baseada na régua conhecida; só passam a orientar os indicadores depois de salvar.
        </NotaApoio>
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
      <SecaoCartao titulo="Estoque, esforço e capacidade por produto">
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
                  <td className={r.gap ? "text-warning" : ""}>{r.gap}</td>
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
        <Link to="/aquario" className="mt-3 inline-block text-sm text-primary-text underline">
          Preparar a base nas carteiras dos clientes →
        </Link>
      </SecaoCartao>
      <SecaoCartao
        titulo={`Plano · ${month} · ${plan.owner_name}`}
        acoes={
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
      </SecaoCartao>
    </div>
  );
}

/** Os três sinais do Follow Day, na ordem de trabalho (contrato, F5). */
const SINAIS_FOLLOW: { chave: Sinal; rotulo: string; tom: TomStatus }[] = [
  { chave: "vencida", rotulo: "Atividade vencida", tom: "perigo" },
  { chave: "sem_passo", rotulo: "Sem próximo passo", tom: "atencao" },
  { chave: "sem_movimento", rotulo: "Sem movimento recente", tom: "atencao" },
];
const ORDEM_SINAL: Record<Sinal, number> = { vencida: 0, sem_passo: 1, sem_movimento: 2 };

function FollowDay({ data, filter, openDeals, busca, mudarBusca }: CutBusca) {
  const days = busca?.dias ?? DIAS_PADRAO;
  const sinal = busca?.sinal;
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
      const issue: Sinal | null = overdue
        ? "vencida"
        : !c.next_activity
          ? "sem_passo"
          : age >= days
            ? "sem_movimento"
            : null;
      return { c, age, issue };
    })
    .filter((r): r is { c: Negocio; age: number; issue: Sinal } => r.issue !== null)
    // Ordem de trabalho: vencida (a mais antiga no topo), sem próximo passo, sem movimento;
    // dentro de cada grupo, mais dias sem movimento primeiro.
    .sort(
      (a, b) =>
        ORDEM_SINAL[a.issue] - ORDEM_SINAL[b.issue] ||
        (a.issue === "vencida"
          ? (a.c.next_activity ?? "").localeCompare(b.c.next_activity ?? "")
          : 0) ||
        b.age - a.age,
    );
  const ativo = SINAIS_FOLLOW.find((s) => s.chave === sinal);
  const lista = ativo ? rows.filter((r) => r.issue === ativo.chave) : rows;
  // Rascunho local da régua: grava na URL só no blur ou Enter (apagar o campo não vira 1).
  const [rascunho, setRascunho] = useState(String(days));
  const [diasBase, setDiasBase] = useState(days);
  if (diasBase !== days) {
    setDiasBase(days);
    setRascunho(String(days));
  }
  const gravarDias = () => {
    const n = Number(rascunho);
    if (!rascunho.trim() || !Number.isFinite(n)) {
      setRascunho(String(days));
      return;
    }
    const v = Math.min(180, Math.max(1, Math.round(n)));
    setRascunho(String(v));
    if (v !== days) mudarBusca?.({ dias: v === DIAS_PADRAO ? undefined : v });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Higiene da fila:</span>
        {SINAIS_FOLLOW.map((s) => {
          const n = rows.filter((r) => r.issue === s.chave).length;
          const on = sinal === s.chave;
          return (
            <Button
              key={s.chave}
              variant={on ? "secondary" : "outline"}
              size="sm"
              aria-pressed={on}
              onClick={() => mudarBusca?.({ sinal: on ? undefined : s.chave })}
            >
              {s.rotulo}
              <span className="num rounded-full bg-muted px-1.5 text-xs">{n}</span>
            </Button>
          );
        })}
        {ativo && (
          <ChipFiltro
            rotulo="Sinal"
            valor={ativo.rotulo}
            aoRemover={() => mudarBusca?.({ sinal: undefined })}
          />
        )}
      </div>
      <SecaoCartao
        titulo="O que precisa acontecer hoje"
        acoes={
          <Field label="Dias sem movimento">
            <input
              className={`${inputClass} max-w-24`}
              type="number"
              min="1"
              max="180"
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onBlur={gravarDias}
              onKeyDown={(e) => {
                if (e.key === "Enter") gravarDias();
              }}
            />
          </Field>
        }
      >
        {!rows.length ? (
          <EstadoVazio
            titulo={`Nenhum negócio fora da régua de ${days} dias.`}
            descricao={
              <>
                <span className="num">{number(view.current.length)}</span> abertos no total.
              </>
            }
          />
        ) : !lista.length ? (
          <EstadoVazio
            titulo={`Nenhum negócio com o sinal "${ativo?.rotulo}".`}
            total={rows.length}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Produto / etapa</TableHead>
                  <TableHead>Sinal</TableHead>
                  <TableHead className="text-right">Sem movimento</TableHead>
                  <TableHead>Próxima atividade</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map(({ c, age, issue }) => {
                  const s = SINAIS_FOLLOW.find((x) => x.chave === issue)!;
                  const abrir = () => openDeals(c.title, [c], undefined, { estoque: true });
                  return (
                    <TableRow
                      key={c.id}
                      className="cursor-pointer outline-none focus-visible:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      tabIndex={0}
                      aria-label={`Abrir detalhe de ${c.title}`}
                      onClick={abrir}
                      onKeyDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          abrir();
                        }
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{c.title}</div>
                        <div className="text-xs text-muted-foreground">{c.owner}</div>
                      </TableCell>
                      <TableCell className="text-[13px]">
                        {NOMES[c.route]}
                        <div className="text-xs text-muted-foreground">{c.stage}</div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tom={s.tom}>{s.rotulo}</StatusBadge>
                      </TableCell>
                      <TableCell className="num text-right">{number(age)} dias</TableCell>
                      <TableCell className="num">{date(c.next_activity)}</TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                          >
                            <Briefcase />
                            Abrir no Pipedrive
                          </a>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <NotaApoio>
            Sinais para organizar a daily. O último movimento considera atividade concluída ou
            passagem de etapa disponível no CRM; não equivale automaticamente à última conversa com
            o cliente. A próxima atividade é marcada no Pipedrive.
          </NotaApoio>
        </div>
      </SecaoCartao>
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
        c.won_on &&
        c.won_on <= filter.to &&
        c.events.validated.some(
          (e) =>
            e.date >= filter.from &&
            e.date <= c.won_on! &&
            (!filter.owner || e.actor_id === filter.owner),
        ),
    );
  return (
    <div className="space-y-4">
      <SecaoCartao titulo="Agendamento → reunião · mesma coorte">
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
      </SecaoCartao>
      <SecaoCartao titulo="Oportunidade validada → assinatura · mesma coorte">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi
            label="Validadas no período"
            value={validated.length}
            onClick={() => openDeals("Coorte validada", validated)}
          />
          <Kpi
            label="Ganhos até o fim do período"
            value={signed.length}
            hint={
              validated.length
                ? `${number((signed.length / validated.length) * 100)}% · coorte ainda pode amadurecer`
                : "Sem amostra"
            }
            onClick={() => openDeals("Ganhos da coorte validada", signed)}
          />
          <Kpi
            label="Ainda em aberto"
            value={validated.filter((c) => c.status === "open").length}
            hint="Não entram como fracasso definitivo"
          />
        </div>
      </SecaoCartao>
      <SecaoCartao titulo="Conversão por produto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr>
              <th>Produto</th>
              <th>Reuniões realizadas</th>
              <th>Validadas</th>
              <th>Ganhos</th>
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
      </SecaoCartao>
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
      <SecaoCartao titulo="Avaliar evidências e definir desenvolvimento">
        <div className="space-y-3">
          <NotaApoio>
            Avaliação registrada pelo gestor, com evidências. Volume de atividade e nota de
            qualidade são medidas separadas.
          </NotaApoio>
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
      </SecaoCartao>
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
      <SecaoCartao titulo="Biblioteca de abordagens">
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
      </SecaoCartao>
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
      <SecaoCartao titulo="Carga e resultado por responsável">
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
      </SecaoCartao>
      <div className="grid gap-4 xl:grid-cols-2">
        <SecaoCartao titulo="Regra de distribuição">
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
            <Link to="/aquario" className="ml-3 text-sm text-primary-text underline">
              Abrir as listas no Aquário
            </Link>
          </div>
        </SecaoCartao>
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
    <SecaoCartao titulo={title}>
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
    </SecaoCartao>
  );
}
