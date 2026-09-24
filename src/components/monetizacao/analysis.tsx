import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Briefcase, Plus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarraFiltros,
  ChipFiltro,
  EstadoVazio,
  KpiGrade,
  Secao,
  StatusBadge,
  type EstadoKpi,
  type TomStatus,
} from "@/components/planning";
import {
  capacidade,
  distancia,
  hoje,
  METRICAS,
  operacao,
  receitaSomada,
  temporal,
} from "@/lib/monetizacao/model";
import type { Filtro } from "@/lib/monetizacao/model";
import { salvarPlanoMonetizacao, salvarRegistroMonetizacao } from "@/lib/monetizacao/functions";
import { NOMES, PRODUTOS } from "@/lib/monetizacao/types";
import type {
  BaseMonetizacao,
  Metrica,
  Negocio,
  Plano,
  Produto,
  Registro,
  RegistroValor,
} from "@/lib/monetizacao/types";
import { useAtualizarMonetizacao } from "@/hooks/use-monetizacao";
import type { Aba, OpcoesDetalhe } from "./dashboard";
import { DIAS_PADRAO, SITUACOES } from "./busca";
import type { BuscaMonetizacao, ProdutoUrl, Sinal, Situacao } from "./busca";
import { Forecast } from "./forecast";
import {
  BotaoComMotivo,
  date,
  FOCO_VISIVEL,
  estadoKpiEvento,
  Field,
  inputClass,
  Kpi,
  money,
  motivoSemEscopo,
  NotaApoio,
  number,
  procedenciaMonetizacao,
  SecaoCartao,
} from "./common";

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
/**
 * Foco de volta ao fechar `Sheet`, `Dialog` ou `AlertDialog`: volta ao controle que abriu
 * (guardado ao abrir); se ele saiu da tela (linha arquivada), vai para `reserva`.
 */
export function useFocoDeVolta(reserva?: RefObject<HTMLElement | null>) {
  const origem = useRef<HTMLElement | null>(null);
  return {
    /** Guarda quem abriu; sem argumento, o elemento com foco agora. */
    guardar: (el?: Element | null) => {
      origem.current = (el ?? document.activeElement) as HTMLElement | null;
    },
    /** Para quem abre por estado: o foco ainda está no gatilho quando o conteúdo monta. */
    onOpenAutoFocus: () => {
      if (!origem.current) origem.current = document.activeElement as HTMLElement | null;
    },
    onCloseAutoFocus: (e: Event) => {
      e.preventDefault();
      const o = origem.current;
      origem.current = null;
      const alvo = o && o.isConnected && o !== document.body ? o : reserva?.current;
      alvo?.focus?.();
    },
  };
}

export function Analysis(props: Props) {
  const { aba, data, filter, openDeals } = props;
  if (aba === "forecast")
    return (
      <Forecast
        data={data}
        month={filter.to.slice(0, 7)}
        openDeals={openDeals}
        busca={props.busca}
        mudarBusca={props.mudarBusca}
      />
    );
  if (aba === "temporal")
    return <Temporal data={data} filter={filter} openDeals={openDeals} busca={props.busca} />;
  // Os planos são por responsável: com "Toda a frente" não há plano a mostrar nem a editar
  // (salvar os padrões aqui gravaria sobre o plano de outra pessoa).
  if (aba === "capacidade" && filter.owner === null)
    return (
      <EstadoVazio
        titulo="Escolha um responsável para ver e editar o plano"
        descricao="Os planos de capacidade e alocação são por responsável. Escolha um no filtro Responsável acima; com Toda a frente não há plano a mostrar."
      />
    );
  if (aba === "capacidade")
    return (
      <Capacity
        key={`${filter.to.slice(0, 7)}-${filter.owner}`}
        data={data}
        filter={filter}
        openDeals={openDeals}
      />
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
  if (aba === "pessoas")
    return <People data={data} filter={filter} busca={props.busca} mudarBusca={props.mudarBusca} />;
  if (aba === "roteiros")
    return <Scripts data={data} busca={props.busca} mudarBusca={props.mudarBusca} />;
  return <Distribution data={data} filter={filter} openDeals={openDeals} busca={props.busca} />;
}

type Cut = Pick<Props, "data" | "filter" | "openDeals">;
type CutBusca = Cut & Pick<Props, "busca" | "mudarBusca">;
const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];
/** "set/2026" a partir de "2026-09". */
const rotuloMes = (m: string) => `${MESES_CURTOS[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
const FOCO_LINK = `text-primary-text underline underline-offset-2 ${FOCO_VISIVEL}`;
/** Nome do responsável da barra: "Toda a frente" sem filtro. */
const nomeDoDono = (data: BaseMonetizacao, owner: number | null) =>
  owner === null
    ? "Toda a frente"
    : (data.cards.find((c) => c.owner_id === owner)?.owner ??
      (owner === 28381245 ? "Matheus Carvalho" : `Usuário ${owner}`));
const juntarNotas = (...partes: (string | undefined | false | null)[]) =>
  partes.filter(Boolean).join(" · ") || undefined;

function Temporal({ data, filter, openDeals, busca }: Cut & Pick<Props, "busca">) {
  const t = temporal(data.cards, filter),
    revenue = receitaSomada(t.open);
  const today = hoje();
  const stale = t.open.filter((c) => c.expected_close && c.expected_close < today);
  const plan = data.plans.find(
    (p) => p.month === filter.to.slice(0, 7) && p.owner_id === filter.owner,
  );
  const procedencia = procedenciaMonetizacao(data);
  const dono = nomeDoDono(data, filter.owner);
  // Z3: split completo por negócio, com a mesma régua de `receitaSomada` (sem recalcular nada).
  const comSplit = t.open.filter((c) => receitaSomada([c]).known === 1);
  const aPreencher = t.open.filter((c) => receitaSomada([c]).known === 0);
  const n = t.open.length,
    k = revenue.known;
  // Z2: negócio sem histórico lido não tem `validated_at` nem `started_at`, então some das
  // validadas e do ciclo. Recorte: dono atual e produto da barra, aberto hoje ou ganho no período.
  const semHistoricoRecorte = data.cards.filter(
    (c) =>
      !c.history_known &&
      (!filter.product || c.route === filter.product) &&
      (!filter.owner || c.owner_id === filter.owner) &&
      (c.status === "open" ||
        (c.status === "won" && !!c.won_on && c.won_on >= filter.from && c.won_on <= filter.to)),
  );
  const evento = estadoKpiEvento(data, semHistoricoRecorte);
  const estadoReceita: EstadoKpi =
    n === 0 ? evento.estado : k === 0 ? "nao-apurado" : k < n ? "parcial" : evento.estado;
  const procedenciaReceita = {
    ...procedencia,
    fonte: `${procedencia.fonte} · total = split quando o CRM não traz o total`,
  };
  const porData = (c: Negocio) => c.expected_close;
  return (
    <div className="space-y-4">
      <KpiGrade colunas={4}>
        <Kpi
          label="Validadas em aberto"
          value={number(n)}
          estado={evento.estado}
          nota={juntarNotas(
            evento.nota,
            stale.length
              ? `${stale.length} com data vencida`
              : n
                ? "nenhuma com data vencida"
                : "estoque de hoje",
          )}
          procedencia={procedencia}
          onClick={() =>
            openDeals("Validadas em aberto", t.open, undefined, {
              estoque: true,
              ordenarPor: (c) => c.validated_at,
            })
          }
        />
        <Kpi
          label="Ciclo mediano até assinatura"
          value={t.median === null ? "—" : `${number(t.median)} dias`}
          estado={t.median === null ? "nao-apurado" : evento.estado}
          nota={
            t.median === null
              ? juntarNotas(evento.nota, "nenhum ganho com trabalho registrado no período")
              : juntarNotas(
                  evento.nota,
                  `p90 ${number(t.p90)} dias · ${t.signed.length} ${t.signed.length === 1 ? "ganho" : "ganhos"}`,
                )
          }
          procedencia={procedencia}
        />
        <Kpi
          label="Receita prevista conciliada"
          value={money(revenue.total)}
          estado={estadoReceita}
          nota={
            n === 0
              ? "nenhuma validada em aberto no recorte"
              : juntarNotas(
                  evento.nota,
                  estadoReceita !== "nao-apurado" &&
                    `Partners ${money(revenue.partners)} · unidades ${money(revenue.unit)}`,
                  `${k} de ${n} com split completo`,
                  n - k > 0 && `${n - k} a preencher`,
                )
          }
          procedencia={procedenciaReceita}
          onClick={
            k
              ? () =>
                  openDeals("Receita prevista · com split completo", comSplit, undefined, {
                    estoque: true,
                    ordenarPor: porData,
                  })
              : undefined
          }
        />
        <Kpi
          label="Data prevista vencida"
          value={number(stale.length)}
          estado={evento.estado}
          nota={juntarNotas(evento.nota, "conferir a data com o dono")}
          procedencia={procedencia}
          onClick={() =>
            openDeals("Data prevista vencida", stale, undefined, {
              estoque: true,
              ordenarPor: porData,
            })
          }
        />
      </KpiGrade>
      {/* Notas clicáveis moram fora do card: o card inteiro já é botão (HTML válido). */}
      {(stale.length > 0 || aPreencher.length > 0) && (
        <p className="-mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {stale.length > 0 && (
            <button
              type="button"
              className={FOCO_LINK}
              onClick={() =>
                openDeals("Validadas com data prevista vencida", stale, undefined, {
                  estoque: true,
                  ordenarPor: porData,
                })
              }
            >
              Abrir as {stale.length} com data vencida →
            </button>
          )}
          {aPreencher.length > 0 && (
            <button
              type="button"
              className={FOCO_LINK}
              onClick={() =>
                openDeals("Receita prevista a preencher", aPreencher, undefined, {
                  estoque: true,
                  ordenarPor: porData,
                })
              }
            >
              Abrir as {aPreencher.length} com receita a preencher →
            </button>
          )}
        </p>
      )}
      <SecaoCartao
        titulo="Em que semana as validadas devem fechar?"
        descricao={`Validadas em aberto por semana da data prevista · dono atual: ${dono} · estoque de hoje`}
      >
        {!t.weeks.length ? (
          <EstadoVazio titulo="Nenhuma oportunidade validada em aberto neste recorte." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Semana a partir de</TableHead>
                  <TableHead className="num text-right">Oportunidades</TableHead>
                  <TableHead className="num text-right">Receita prevista conciliada</TableHead>
                  <TableHead className="num text-right">Pendências de receita</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {t.weeks.map((w) => {
                  const semana = w.week === "Sem data" ? w.week : date(w.week);
                  return (
                    <TableRow key={w.week}>
                      <TableCell className="num">{semana}</TableCell>
                      <TableCell className="num text-right">
                        <button
                          type="button"
                          aria-label={`Semana ${semana}: ${w.rows.length} oportunidades, abrir`}
                          className={`font-semibold ${FOCO_LINK}`}
                          onClick={() =>
                            openDeals(`Previsão · semana ${semana}`, w.rows, undefined, {
                              estoque: true,
                              ordenarPor: porData,
                            })
                          }
                        >
                          {w.rows.length}
                        </button>
                      </TableCell>
                      <TableCell className="num text-right">
                        {w.revenue.known ? money(w.revenue.total) : "A preencher"}
                        {w.revenue.known > 0 && w.revenue.missing > 0 && (
                          <span className="block text-xs text-muted-foreground">
                            parcial · {w.revenue.known} de {w.rows.length}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">{w.revenue.missing}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </SecaoCartao>
      <SecaoCartao
        titulo="Quantas validadas têm data no período, e que cenário elas dão?"
        descricao={
          <>
            Meta mensal:{" "}
            {plan ? (
              <span className="num">{plan.target_contracts} contratos</span>
            ) : (
              `sem plano de ${dono} para ${rotuloMes(filter.to.slice(0, 7))}`
            )}{" "}
            · o cenário é hipótese × volume, não é previsão, e não soma com a meta
          </>
        }
        acoes={
          <Link
            to="/monetizacao"
            search={{
              aba: "capacidade",
              de: busca?.de,
              ate: busca?.ate,
              responsavel: busca?.responsavel,
            }}
            className={`text-xs font-medium ${FOCO_LINK}`}
          >
            Hipóteses → Capacidade e alocação
          </Link>
        }
      >
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
                <p className="mt-2 text-sm">
                  <button
                    type="button"
                    className={`num font-semibold ${FOCO_LINK}`}
                    aria-label={`${NOMES[p]}: ${dated.length} validadas com data no período, conferir`}
                    onClick={() =>
                      openDeals(`${NOMES[p]} · data prevista no período`, dated, undefined, {
                        estoque: true,
                        ordenarPor: porData,
                        recorte: `${dono} · ${NOMES[p]} · abertas hoje com data prevista de ${date(filter.from)} a ${date(filter.to)}`,
                      })
                    }
                  >
                    {dated.length}
                  </button>{" "}
                  validadas com data no período
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {rate === null || rate === undefined ? (
                    "Sem hipótese configurada"
                  ) : (
                    <>
                      Cenário (hipótese {number(rate * 100)}%):{" "}
                      <span className="num">{number(dated.length * rate)}</span> contratos
                    </>
                  )}
                </p>
              </div>
            );
          })}
        </div>
        <div className="mt-4">
          <NotaApoio>
            O cenário usa só oportunidades validadas e datadas no período, com a hipótese do plano.
            As taxas do Growth não são aplicadas à Monetização.
          </NotaApoio>
        </div>
      </SecaoCartao>
      <NotaApoio>
        Receita prevista é o valor informado para a oportunidade no CRM. O total conciliado soma só
        os negócios com split completo em reais; quando o CRM não traz o total, ele é Partners +
        unidade. Não é MRR, faturamento nem caixa: esses moram em Receita e Repasses e no
        Financeiro.
      </NotaApoio>
    </div>
  );
}

/** Campo do plano (Configuração §5): rótulo acima, ajuda abaixo, erro no próprio campo. */
function CampoPlano({
  rotulo,
  ajuda,
  erro,
  anunciar = false,
  children,
}: {
  rotulo: string;
  ajuda?: string;
  erro?: string | null;
  /** Anuncia o erro ao leitor de tela (`role="alert"`): só um campo por erro, para não repetir. */
  anunciar?: boolean;
  children: (a11y: { id: string; "aria-describedby"?: string; "aria-invalid"?: true }) => ReactNode;
}) {
  const id = useId();
  const ajudaId = `${id}-ajuda`,
    erroId = `${id}-erro`;
  const descritoPor = [erro ? erroId : null, ajuda ? ajudaId : null].filter(Boolean).join(" ");
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {rotulo}
      </Label>
      {children({
        id,
        "aria-describedby": descritoPor || undefined,
        "aria-invalid": erro ? true : undefined,
      })}
      {erro && (
        <p
          id={erroId}
          role={anunciar ? "alert" : undefined}
          className="text-xs font-medium text-danger"
        >
          {erro}
        </p>
      )}
      {ajuda && (
        <p id={ajudaId} className="text-xs text-muted-foreground">
          {ajuda}
        </p>
      )}
    </div>
  );
}

const LEADS_TRABALHADOS = METRICAS.find((m) => m.key === "started")!.label;

function Capacity({ data, filter, openDeals }: Cut) {
  const month = filter.to.slice(0, 7),
    mes = rotuloMes(month),
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
    [editing, setEditing] = useState(!saved),
    [confirmar, setConfirmar] = useState<string[] | null>(null);
  const fn = useServerFn(salvarPlanoMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const doMes: Filtro = {
    ...filter,
    from: month + "-01",
    to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
      .toISOString()
      .slice(0, 10),
    owner: plan.owner_id,
    product: "",
  };
  const rows = capacidade(plan, data.accounts, data.cards, doMes, data.reservations),
    allocated = PRODUTOS.reduce((n, p) => n + plan.allocation[p], 0);
  // Os negócios que o "Leads trabalhados" conta: o mesmo `operacao()` que `capacidade()` usa,
  // só os três produtos (a tabela não tem "Sem produto").
  const trabalhados = operacao(data.cards, doMes).rows.started.filter((c) =>
    (PRODUTOS as readonly string[]).includes(c.route),
  );
  const totalTrabalhado = rows.reduce((n, r) => n + r.started, 0);
  const ultimoInicio = (c: Negocio) =>
    c.events.started
      .filter((e) => e.date >= doMes.from && e.date <= doMes.to && e.actor_id === doMes.owner)
      .map((e) => e.date)
      .sort()
      .at(-1);
  const abrirTrabalhados = (titulo: string, lista: Negocio[], produto: string) =>
    openDeals(
      titulo,
      lista,
      { from: doMes.from, to: doMes.to },
      {
        ordenarPor: ultimoInicio,
        recorte: `${plan.owner_name} · ${produto} · ${date(doMes.from)} a ${date(doMes.to)}`,
      },
    );
  // Z2: sem histórico lido não há `started`; o dono do plano é o único vínculo do negócio.
  const semHistoricoRecorte = data.cards.filter(
    (c) =>
      !c.history_known &&
      c.owner_id === plan.owner_id &&
      (c.status === "open" ||
        Object.values(c.events).some((es) =>
          es.some((e) => e.date >= doMes.from && e.date <= doMes.to),
        )),
  );
  const evento = estadoKpiEvento(data, semHistoricoRecorte);
  const procedencia = procedenciaMonetizacao(data);
  const procedenciaPlano = { fonte: "Plano da Monetização (ops.monetizacao_planos)" };
  const semPlano = `plano de ${mes} não salvo`;
  const excesso =
    allocated > plan.capacity
      ? `Alocação ${number(allocated)} supera a capacidade ${number(plan.capacity)}`
      : null;
  const motivoEscrita = motivoSemEscopo(data);

  const mudancas = () => {
    const linhas: string[] = [];
    const antes = saved?.target_contracts;
    if (antes !== plan.target_contracts)
      linhas.push(
        antes === undefined
          ? `Meta de ${mes} passa a ser ${plan.target_contracts} contratos (não havia plano salvo).`
          : `Meta de ${mes} passa de ${antes} para ${plan.target_contracts} contratos.`,
      );
    for (const p of PRODUTOS) {
      const depois = plan.allocation[p];
      if (!saved) linhas.push(`Alocação de ${NOMES[p]} passa a ser ${depois} ofertas.`);
      else if (saved.allocation[p] !== depois)
        linhas.push(
          `Alocação de ${NOMES[p]} passa de ${saved.allocation[p]} para ${depois} ofertas.`,
        );
    }
    return linhas;
  };
  const save = async () => {
    setConfirmar(null);
    setBusy(true);
    try {
      await fn({ data: plan });
      await invalidate();
      setEditing(false);
      toast.success(`Plano de ${mes} salvo para ${plan.owner_name}.`);
    } catch (e) {
      toast.error(`O plano não foi salvo: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const pedirSalvar = () => {
    const m = mudancas();
    if (m.length) setConfirmar(m);
    else void save();
  };
  const linkBase = (
    <Link
      to="/clientes"
      search={{ view: "produtos" }}
      className={`text-sm font-medium ${FOCO_LINK}`}
    >
      Preparar a base em Produtos e listas →
    </Link>
  );

  return (
    <div className="space-y-4">
      {!saved && (
        <NotaApoio>
          O plano de {mes} de {plan.owner_name} ainda não foi salvo. O editor abre com os valores
          padrão; eles só orientam os indicadores, a Operação e a previsão depois de salvar.
        </NotaApoio>
      )}
      <KpiGrade colunas={4}>
        <Kpi
          label="Capacidade mensal proposta"
          value={`${number(plan.capacity)}`}
          estado={saved ? "ok" : "nao-apurado"}
          nota={saved ? `leads/mês · ${plan.owner_name}` : semPlano}
          procedencia={procedenciaPlano}
        />
        <Kpi
          label="Alocada entre produtos"
          value={number(allocated)}
          estado={saved ? "ok" : "nao-apurado"}
          nota={
            !saved
              ? semPlano
              : allocated > plan.capacity
                ? "Supera a capacidade"
                : `${number(plan.capacity - allocated)} vagas sem alocação`
          }
          procedencia={procedenciaPlano}
        />
        <Kpi
          label={LEADS_TRABALHADOS}
          value={number(totalTrabalhado)}
          estado={evento.estado}
          nota={juntarNotas(evento.nota, `negócios com trabalho iniciado em ${mes}`)}
          procedencia={procedencia}
          onClick={() =>
            abrirTrabalhados(LEADS_TRABALHADOS, trabalhados, "Cella, Consultoria e Finance")
          }
        />
        <Kpi
          label="Falta de base na alocação"
          value={number(rows.reduce((n, r) => n + r.gap, 0))}
          estado={saved ? "ok" : "nao-apurado"}
          nota={saved ? "alocação restante acima da base disponível no mês" : semPlano}
          procedencia={{
            fonte: "Plano + Base + carga do CRM",
            atualizadoEm: data.measured_at,
          }}
        />
      </KpiGrade>
      <SecaoCartao
        titulo="Em que produto a base disponível não cobre a alocação?"
        descricao={`Contas da Base por produto · plano de ${plan.owner_name} para ${mes} · negócios do mês`}
        acoes={linkBase}
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="num text-right">Perfil aderente</TableHead>
                <TableHead className="num text-right">Disponível no mês</TableHead>
                <TableHead className="num text-right">Alocação mensal</TableHead>
                <TableHead className="num text-right">{LEADS_TRABALHADOS}</TableHead>
                <TableHead className="num text-right">Base faltante</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.product}>
                  <TableCell className="font-medium">{NOMES[r.product]}</TableCell>
                  <TableCell className="num text-right">
                    <Link
                      to="/clientes"
                      search={{ view: "produtos" }}
                      aria-label={`${NOMES[r.product]}: ${r.eligible} contas com perfil aderente, abrir Produtos e listas`}
                      className={FOCO_LINK}
                    >
                      {number(r.eligible)}
                    </Link>
                  </TableCell>
                  <TableCell className="num text-right">
                    <Link
                      to="/clientes"
                      search={{ view: "produtos" }}
                      aria-label={`${NOMES[r.product]}: ${r.available} contas disponíveis no mês, abrir Produtos e listas`}
                      className={FOCO_LINK}
                    >
                      {number(r.available)}
                    </Link>
                  </TableCell>
                  <TableCell className="num text-right">
                    {saved ? number(r.planned) : "—"}
                  </TableCell>
                  <TableCell className="num text-right">
                    <button
                      type="button"
                      aria-label={`${NOMES[r.product]}: ${r.started} leads trabalhados, abrir negócios`}
                      className={`font-semibold ${FOCO_LINK}`}
                      onClick={() =>
                        abrirTrabalhados(
                          `${NOMES[r.product]} · ${LEADS_TRABALHADOS}`,
                          trabalhados.filter((c) => c.route === r.product),
                          NOMES[r.product],
                        )
                      }
                    >
                      {number(r.started)}
                    </button>
                  </TableCell>
                  <TableCell className="num text-right">
                    {!saved ? (
                      "—"
                    ) : r.gap ? (
                      <StatusBadge tom="atencao">{number(r.gap)} faltam</StatusBadge>
                    ) : (
                      number(r.gap)
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3">
          <NotaApoio>
            Perfil aderente e Disponível abrem Produtos e listas sem o filtro de produto (o destino
            ainda não recebe produto no link); escolha o produto lá. Os totais não batem com a Base:
            ela conta a disponibilidade no dia, esta tela no mês do plano. Base faltante = alocação
            menos o trabalho já iniciado, acima do disponível. Há empresas em mais de um produto:
            coordene as abordagens da mesma empresa antes de distribuir a carga.
            {!saved &&
              ` Alocação e base faltante ficam em "—" até o ${semPlano.replace(" não salvo", "")} ser salvo.`}
          </NotaApoio>
        </div>
      </SecaoCartao>
      <SecaoCartao
        titulo={`Qual é o plano de ${mes} de ${plan.owner_name}?`}
        descricao="Capacidade, metas, alocação por produto e hipóteses · alimenta a Operação diária e o cenário de Temporal e previsão"
        acoes={
          <BotaoComMotivo
            size="sm"
            variant="outline"
            onClick={() => setEditing(!editing)}
            disabled={!!motivoEscrita}
            motivo={motivoEscrita}
          >
            {editing ? "Fechar editor" : "Editar plano"}
          </BotaoComMotivo>
        }
      >
        {editing ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(
                [
                  [
                    "capacity",
                    "Leads / mês",
                    "Capacidade mensal do responsável; a alocação não passa dela.",
                  ],
                  [
                    "meetings_capacity",
                    "Teto de reuniões / mês",
                    "Quantas reuniões cabem na agenda do mês.",
                  ],
                  [
                    "target_contracts",
                    "Meta de contratos / mês",
                    "Meta de contratos ganhos que a Operação diária mostra.",
                  ],
                  [
                    "daily_target",
                    "Leads / dia útil",
                    "Linha de meta do dia a dia na Operação diária.",
                  ],
                ] as const
              ).map(([key, label, ajuda]) => (
                <CampoPlano
                  key={key}
                  rotulo={label}
                  ajuda={ajuda}
                  erro={key === "capacity" ? excesso : null}
                  anunciar={key === "capacity"}
                >
                  {(a11y) => (
                    <Input
                      {...a11y}
                      type="number"
                      min="0"
                      className="num"
                      value={plan[key]}
                      onChange={(e) => setPlan({ ...plan, [key]: Number(e.target.value) })}
                    />
                  )}
                </CampoPlano>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {PRODUTOS.map((p) => (
                <div key={p} className="space-y-3 rounded-lg border p-3">
                  <h3 className="text-sm font-semibold">{NOMES[p]}</h3>
                  <CampoPlano
                    rotulo="Ofertas a trabalhar no mês"
                    ajuda="Parte da capacidade reservada a este produto."
                    erro={excesso}
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        type="number"
                        min="0"
                        className="num"
                        value={plan.allocation[p]}
                        onChange={(e) =>
                          setPlan({
                            ...plan,
                            allocation: { ...plan.allocation, [p]: Number(e.target.value) },
                          })
                        }
                      />
                    )}
                  </CampoPlano>
                  <CampoPlano
                    rotulo="Hipótese de validada → contrato (%)"
                    ajuda="Vazio = sem hipótese; o cenário de Temporal e previsão não aparece."
                  >
                    {(a11y) => (
                      <Input
                        {...a11y}
                        type="number"
                        min="0"
                        max="100"
                        className="num"
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
                    )}
                  </CampoPlano>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <BotaoComMotivo
                disabled={busy || !!motivoEscrita || !!excesso}
                motivo={[motivoEscrita, excesso && `${excesso}.`, busy && "Salvando o plano…"]}
                onClick={pedirSalvar}
              >
                {busy ? "Salvando…" : "Salvar plano e hipóteses"}
              </BotaoComMotivo>
              <span className="text-xs text-muted-foreground">
                Alocado <span className="num">{number(allocated)}</span> de{" "}
                <span className="num">{number(plan.capacity)}</span>
              </span>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Plano salvo. As metas da Operação diária e o cenário de Temporal e previsão usam esta
            configuração. Capacidade de reuniões:{" "}
            <span className="num">{number(plan.meetings_capacity)}</span>/mês.
          </p>
        )}
      </SecaoCartao>
      <AlertDialog open={!!confirmar} onOpenChange={(o) => !o && setConfirmar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Salvar o plano de {mes}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-1 text-sm text-muted-foreground">
                {confirmar?.map((l) => (
                  <p key={l}>{l}</p>
                ))}
                <p className="pt-1">
                  A Operação diária e o cenário de Temporal e previsão passam a usar estes números
                  para {plan.owner_name}.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar ao editor</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save()}>Salvar plano</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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

/**
 * Z2 no recorte da barra (mesma régua da Operação diária): negócio sem histórico lido não tem
 * autor de movimento, então o vínculo é o dono atual; entra se foi carregado até `ate` e estava
 * aberto no período (aberto hoje, ganho a partir de `de` ou com evento no período).
 */
const semHistoricoNoRecorte = (data: BaseMonetizacao, f: Filtro) =>
  data.cards.filter((c) => {
    if (c.history_known) return false;
    if (f.product && c.route !== f.product) return false;
    if (f.owner && c.owner_id !== f.owner) return false;
    const carregado =
      c.events.loaded.map((e) => e.date).sort()[0] ?? c.created_at?.slice(0, 10) ?? "";
    if (carregado > f.to) return false;
    if (c.status === "open") return true;
    const ganhoEm = c.status === "won" ? (c.won_on ?? c.signed_on) : null;
    if (ganhoEm) return ganhoEm >= f.from;
    return Object.values(c.events).some((es) => es.some((e) => e.date >= f.from && e.date <= f.to));
  });

/** Data mais recente do evento `k` no período, pelo autor filtrado: ordena o detalhe. */
const ultimoEventoNoPeriodo = (k: Metrica, f: Filtro) => (c: Negocio) =>
  c.events[k]
    .filter((e) => e.date >= f.from && e.date <= f.to && (!f.owner || e.actor_id === f.owner))
    .map((e) => e.date)
    .sort()
    .at(-1);

/** Número de célula que abre o detalhe (N2): link com foco visível e rótulo completo. */
function CelulaQueAbre({
  valor,
  rotulo,
  onClick,
}: {
  valor: number;
  rotulo: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`${rotulo}: ${valor}, abrir negócios`}
      className={`font-semibold ${FOCO_LINK}`}
      onClick={onClick}
    >
      {number(valor)}
    </button>
  );
}

/**
 * Funil comercial (contrato `monetizacao-funil.md`, Lista/Relatório): duas coortes do período,
 * cada uma com a pergunta dela, e a conversão por produto com toda célula abrindo o detalhe.
 * Só apresentação: os conjuntos são os mesmos de antes (`operacao()` e os filtros da coorte).
 */
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
  // N11: agendada ganha sem passar por "Reunião realizada" não cai em nenhum dos três desfechos.
  const foraDosDesfechos = pending.length - lost.length - stillOpen.length;
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
    ),
    validatedOpen = validated.filter((c) => c.status === "open");
  const evento = estadoKpiEvento(data, semHistoricoNoRecorte(data, filter));
  const procedencia = procedenciaMonetizacao(data);
  const periodo = { from: filter.from, to: filter.to };
  const porAgendamento = ultimoEventoNoPeriodo("scheduled", filter),
    porReuniao = ultimoEventoNoPeriodo("meeting", filter),
    porValidacao = ultimoEventoNoPeriodo("validated", filter),
    porGanho = (c: Negocio) => c.won_on ?? c.signed_on;
  const abrir = (
    titulo: string,
    lista: Negocio[],
    ordenarPor: (c: Negocio) => string | null | undefined,
  ) => openDeals(titulo, lista, periodo, { ordenarPor });
  const kpi = (nota?: string) => ({
    estado: evento.estado,
    nota: juntarNotas(evento.nota, nota),
    procedencia,
  });
  // Com produto filtrado, só a linha dele (as outras seriam zero por estarem fora do recorte).
  const produtos = filter.product
    ? v.products.filter((p) => p.product === filter.product)
    : v.products;
  return (
    <div className="space-y-6">
      <Secao
        titulo="Das reuniões agendadas no período, quantas aconteceram?"
        descricao="Agendamento → reunião · mesma coorte; a realização conta até o fim do período"
      >
        <KpiGrade colunas={4}>
          <Kpi
            label="Agendadas no período"
            value={number(scheduled.length)}
            {...kpi(
              foraDosDesfechos > 0
                ? `${number(foraDosDesfechos)} fora dos três desfechos (ganhas sem reunião registrada)`
                : undefined,
            )}
            onClick={() => abrir("Coorte agendada", scheduled, porAgendamento)}
          />
          <Kpi
            label="Depois realizadas"
            value={number(realized.length)}
            {...kpi(
              scheduled.length
                ? `${number((realized.length / scheduled.length) * 100)}% desta coorte`
                : "Sem amostra",
            )}
            onClick={() => abrir("Agendadas depois realizadas", realized, porReuniao)}
          />
          <Kpi
            label="Sem realização · em aberto"
            value={number(stillOpen.length)}
            {...kpi("Ainda podem realizar")}
            onClick={() => abrir("Agendadas ainda em aberto", stillOpen, porAgendamento)}
          />
          <Kpi
            label="Sem realização · perdidas"
            value={number(lost.length)}
            {...kpi()}
            onClick={() => abrir("Agendadas perdidas sem realização", lost, porAgendamento)}
          />
        </KpiGrade>
        <NotaApoio>
          Uma oportunidade sem passagem em Reunião realizada não é automaticamente no-show. Para
          medir ausência, recuperação e motivo, é preciso registrar o resultado da atividade no CRM.
        </NotaApoio>
      </Secao>
      <Secao
        titulo="Das oportunidades validadas no período, quantas viraram contrato?"
        descricao="Oportunidade validada → assinatura · mesma coorte; o ganho conta até o fim do período"
      >
        <KpiGrade colunas={3}>
          <Kpi
            label="Validadas no período"
            value={number(validated.length)}
            {...kpi()}
            onClick={() => abrir("Coorte validada", validated, porValidacao)}
          />
          <Kpi
            label="Ganhos até o fim do período"
            value={number(signed.length)}
            {...kpi(
              validated.length
                ? `${number((signed.length / validated.length) * 100)}% · coorte ainda pode amadurecer`
                : "Sem amostra",
            )}
            onClick={() => abrir("Ganhos da coorte validada", signed, porGanho)}
          />
          <Kpi
            label="Ainda em aberto"
            value={number(validatedOpen.length)}
            {...kpi("Não entram como fracasso definitivo")}
            onClick={() => abrir("Validadas ainda em aberto", validatedOpen, porValidacao)}
          />
        </KpiGrade>
      </Secao>
      <SecaoCartao
        titulo="Como cada produto converte no período?"
        descricao="Reuniões realizadas, validadas e ganhos contam os próprios eventos no período · abertas são da coorte validada · clique no número para abrir os negócios"
      >
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead className="num text-right">Reuniões realizadas</TableHead>
                <TableHead className="num text-right">Validadas</TableHead>
                <TableHead className="num text-right">Ganhos</TableHead>
                <TableHead className="num text-right">Abertas da coorte validada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {produtos.map((p) => {
                const nome = NOMES[p.product];
                const doProduto = (lista: Negocio[]) => lista.filter((c) => c.route === p.product);
                const celulas: [string, Negocio[], (c: Negocio) => string | null | undefined][] = [
                  ["Reuniões realizadas", doProduto(v.rows.meeting), porReuniao],
                  ["Validadas", doProduto(v.rows.validated), porValidacao],
                  ["Ganhos", doProduto(v.rows.signed), ultimoEventoNoPeriodo("signed", filter)],
                  ["Abertas da coorte validada", doProduto(validatedOpen), porValidacao],
                ];
                return (
                  <TableRow key={p.product}>
                    <TableCell className="font-medium">{nome}</TableCell>
                    {celulas.map(([rotulo, lista, ordem]) => (
                      <TableCell key={rotulo} className="num text-right">
                        <CelulaQueAbre
                          valor={lista.length}
                          rotulo={`${nome} · ${rotulo}`}
                          onClick={() => abrir(`${nome} · ${rotulo}`, lista, ordem)}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-3">
          <NotaApoio>
            As três primeiras colunas contam seus próprios eventos no período. Use as coortes acima
            para calcular conversão sem misturar denominadores.
          </NotaApoio>
        </div>
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
/**
 * Pessoas e PDI (contrato `monetizacao-pessoas.md`, Ficha): avaliação da amostra do responsável
 * da barra e o histórico de PDI. Cada campo que falta diz, nele mesmo, que falta para salvar.
 */
function People({
  data,
  filter,
  busca,
  mudarBusca,
}: Pick<Props, "data" | "filter" | "busca" | "mudarBusca">) {
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
  const dono = nomeDoDono(data, filter.owner);
  const falta = {
    responsavel:
      filter.owner === null
        ? "Escolha um responsável na barra: com Toda a frente não há de quem seja o PDI."
        : null,
    title: title.trim().length < 3 ? "Falta o título (3 caracteres ou mais) para salvar." : null,
    sample: !sample.trim() ? "Falta a amostra revisada para salvar." : null,
    scores: !values.length ? "Falta dar nota a pelo menos um critério para salvar." : null,
    goal: !goal.trim() ? "Falta o objetivo para salvar." : null,
    action: !action.trim() ? "Falta a ação para salvar." : null,
    due: !due ? "Falta o prazo para salvar." : null,
  };
  const motivos = [motivoSemEscopo(data), ...Object.values(falta)];
  const limpar = () => {
    setTitle("");
    setSample("");
    setScores({});
    setGoal("");
    setAction("");
    setDue("");
  };
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "pdi",
          title: title.trim(),
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
      toast.success(`Avaliação e PDI de ${dono} registrados.`);
      limpar();
    } catch (e) {
      toast.error(`A avaliação não foi salva: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <SecaoCartao
        titulo={
          filter.owner === null
            ? "Como o hunter foi na amostra do período?"
            : `Como ${dono} foi na amostra do período?`
        }
        descricao={`Amostra de ${date(filter.from)} a ${date(filter.to)} · 5 critérios, nota 1–5`}
      >
        <div className="space-y-3">
          <NotaApoio>
            Avaliação registrada pelo gestor, com evidências. Volume de atividade e nota de
            qualidade são medidas separadas.
          </NotaApoio>
          {falta.responsavel && (
            <p className="text-xs font-medium text-muted-foreground">{falta.responsavel}</p>
          )}
          <CampoPlano rotulo="Título da avaliação / pessoa" ajuda={falta.title ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                className={inputClass}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano rotulo="Amostra e evidências revisadas" ajuda={falta.sample ?? undefined}>
            {(a11y) => (
              <textarea
                {...a11y}
                className={`${inputClass} h-20 py-2`}
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="IDs das oportunidades, calls ou links revisados"
              />
            )}
          </CampoPlano>
          {CRITERIOS.map((c) => (
            <CampoPlano key={c} rotulo={c}>
              {(a11y) => (
                <select
                  {...a11y}
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
              )}
            </CampoPlano>
          ))}
          <div>
            <p className="text-sm">
              Média da amostra: <strong className="num">{number(average)}</strong> · {values.length}{" "}
              de {CRITERIOS.length} critérios avaliados
            </p>
            {falta.scores && <p className="text-xs text-muted-foreground">{falta.scores}</p>}
          </div>
          <CampoPlano rotulo="Objetivo de desenvolvimento" ajuda={falta.goal ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                className={inputClass}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano
            rotulo="Ação observável para o próximo ciclo"
            ajuda={falta.action ?? undefined}
          >
            {(a11y) => (
              <textarea
                {...a11y}
                className={`${inputClass} h-20 py-2`}
                value={action}
                onChange={(e) => setAction(e.target.value)}
              />
            )}
          </CampoPlano>
          <CampoPlano rotulo="Revisar até" ajuda={falta.due ?? undefined}>
            {(a11y) => (
              <input
                {...a11y}
                type="date"
                className={inputClass}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            )}
          </CampoPlano>
          <BotaoComMotivo onClick={save} disabled={busy || motivos.some(Boolean)} motivo={motivos}>
            {busy ? "Salvando" : "Salvar avaliação e PDI"}
          </BotaoComMotivo>
        </div>
      </SecaoCartao>
      <RecordList
        data={data}
        kind="pdi"
        title="Quais PDIs estão registrados, e em que pé?"
        arquivados={busca?.arquivados === "mostrar"}
        mudarArquivados={(mostrar) => mudarBusca?.({ arquivados: mostrar ? "mostrar" : undefined })}
      />
    </div>
  );
}

const SITUACAO_ROTEIRO: Record<Situacao, { rotulo: string; tom: TomStatus }> = {
  rascunho: { rotulo: "Rascunho", tom: "info" },
  aprovado: { rotulo: "Aprovada", tom: "sucesso" },
  arquivado: { rotulo: "Arquivada", tom: "neutro" },
};
const situacaoDoRoteiro = (r: Registro): Situacao =>
  r.body.status === "aprovado" || r.body.status === "arquivado" ? r.body.status : "rascunho";
const produtoDoRoteiro = (r: Registro): Produto | "sem_produto" =>
  (PRODUTOS as readonly string[]).includes(String(r.body.product))
    ? (r.body.product as Produto)
    : "sem_produto";

/**
 * Abordagens (contrato `monetizacao-roteiros.md`, Lista/Relatório com edição em `Sheet`):
 * biblioteca em tabela com filtros de produto e situação na URL; "Nova abordagem" e a linha
 * abrem o mesmo `Sheet` (formulário ou a abordagem salva, com Copiar, Aprovar e Arquivar).
 */
function Scripts({
  data,
  busca,
  mudarBusca,
}: {
  data: BaseMonetizacao;
  busca?: BuscaMonetizacao;
  mudarBusca?: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  const [product, setProduct] = useState<Produto>("consultoria"),
    [segment, setSegment] = useState(""),
    [evidence, setEvidence] = useState(""),
    [text, setText] = useState(""),
    [title, setTitle] = useState(""),
    [busy, setBusy] = useState(false),
    [aberta, setAberta] = useState<{ modo: "nova" } | { modo: "ver"; id: string } | null>(null),
    [arquivar, setArquivar] = useState<Registro | null>(null);
  const novaRef = useRef<HTMLButtonElement>(null);
  const foco = useFocoDeVolta(novaRef);
  const abrirSheet = (
    estado: { modo: "nova" } | { modo: "ver"; id: string },
    origem?: Element | null,
  ) => {
    foco.guardar(origem);
    setAberta(estado);
  };
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const motivoEscrita = motivoSemEscopo(data);
  const filtroProduto = busca?.produto,
    filtroSituacao = busca?.situacao;
  const todas = data.records
    .filter((r) => r.kind === "roteiro")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  // Sem filtro de situação, as arquivadas ficam fora; "Arquivada" no filtro mostra só elas.
  const lista = todas.filter(
    (r) =>
      (!filtroProduto || produtoDoRoteiro(r) === filtroProduto) &&
      (filtroSituacao
        ? situacaoDoRoteiro(r) === filtroSituacao
        : situacaoDoRoteiro(r) !== "arquivado"),
  );
  const nArquivadas = todas.filter((r) => situacaoDoRoteiro(r) === "arquivado").length;
  const vista = aberta?.modo === "ver" ? todas.find((r) => r.id === aberta.id) : undefined;
  const compose = () =>
    setText(
      product === "consultoria"
        ? `Olá, [nome]. O sócio da unidade indicou conversarmos sobre a operação ${segment ? "de " + segment : "da empresa"}. Podemos confirmar o faturamento anual, o regime tributário e os principais desafios?\n\n${evidence ? "Ponto para investigar: " + evidence : "Investigar uma necessidade concreta antes de oferecer a consultoria."}\n\nPróximo passo: combinar uma conversa com o especialista e registrar responsável e data.`
        : product === "finance"
          ? `Olá, [nome]. Já temos um contrato da empresa na Planning. Gostaria de entender se existe uma necessidade de capital de giro, investimento ou troca de dívida.\n\n${evidence || "Confirmar objetivo, volume e prazo da necessidade, sem prometer aprovação."}\n\nPróximo passo: validar o cenário com o especialista de Finance e combinar a data de retorno.`
          : `Olá, [nome]. Queremos verificar se há uma oportunidade de revisão tributária que faça sentido para a empresa.\n\n${evidence || "Confirmar cenário, documentos disponíveis e disponibilidade para avaliação técnica."}\n\nPróximo passo: avaliar com o especialista, sem prometer crédito ou resultado antes da análise.`,
    );
  const limpar = () => {
    setProduct("consultoria");
    setSegment("");
    setEvidence("");
    setText("");
    setTitle("");
  };
  const copiar = (t: string) =>
    navigator.clipboard.writeText(t).then(
      () => toast.success("Copiado."),
      () => toast.error("Não foi possível copiar; selecione o texto e copie à mão."),
    );
  const save = async () => {
    setBusy(true);
    try {
      await fn({
        data: {
          kind: "roteiro",
          title: title.trim(),
          body: { product, segment, evidence, text, status: "rascunho", version: 1 },
        },
      });
      await invalidate();
      toast.success("Abordagem salva como rascunho para revisão e uso pela equipe.");
      limpar();
      setAberta(null);
    } catch (e) {
      toast.error(`A abordagem não foi salva: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const mudarSituacao = async (r: Registro, status: Situacao, mensagem: string) => {
    setBusy(true);
    try {
      await fn({ data: { id: r.id, kind: r.kind, title: r.title, body: { ...r.body, status } } });
      await invalidate();
      toast.success(mensagem);
      if (status === "arquivado") setAberta(null);
    } catch (e) {
      toast.error(`A abordagem não foi atualizada: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const motivosSalvar = [
    motivoEscrita,
    title.trim().length < 3 && "Dê um nome à abordagem (3 caracteres ou mais).",
    !text.trim() && "Monte ou escreva o texto antes de salvar.",
  ];
  const temFiltro = !!filtroProduto || !!filtroSituacao;
  return (
    <div className="space-y-4">
      <BarraFiltros
        className="items-end"
        aoLimpar={
          temFiltro ? () => mudarBusca?.({ produto: undefined, situacao: undefined }) : undefined
        }
      >
        <Field label="Produto">
          <select
            className={inputClass}
            value={filtroProduto ?? ""}
            onChange={(e) =>
              mudarBusca?.({ produto: (e.target.value || undefined) as ProdutoUrl | undefined })
            }
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
        <Field label="Situação">
          <select
            className={inputClass}
            value={filtroSituacao ?? ""}
            onChange={(e) =>
              mudarBusca?.({ situacao: (e.target.value || undefined) as Situacao | undefined })
            }
          >
            <option value="">Rascunho e aprovada</option>
            {SITUACOES.map((k) => (
              <option key={k} value={k}>
                {SITUACAO_ROTEIRO[k].rotulo}
              </option>
            ))}
          </select>
        </Field>
      </BarraFiltros>
      <SecaoCartao
        titulo="Qual abordagem usar para este produto e segmento?"
        descricao={`${number(lista.length)} de ${number(todas.length)} abordagens · ${number(nArquivadas)} ${nArquivadas === 1 ? "arquivada" : "arquivadas"}${filtroSituacao ? "" : " (fora da lista; filtre a situação Arquivada para vê-las)"} · clique na linha para abrir`}
        acoes={
          <Button
            ref={novaRef}
            size="sm"
            onClick={(e) => abrirSheet({ modo: "nova" }, e.currentTarget)}
          >
            <Plus />
            Nova abordagem
          </Button>
        }
      >
        {!todas.length ? (
          <EstadoVazio
            titulo="Nenhuma abordagem salva ainda."
            descricao="Monte a primeira a partir do modelo em Nova abordagem."
          />
        ) : !lista.length ? (
          <EstadoVazio titulo="Nenhuma abordagem neste filtro." total={todas.length} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="num text-right">Atualizada em</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lista.map((r) => {
                  const sit = SITUACAO_ROTEIRO[situacaoDoRoteiro(r)];
                  const abrir = (origem?: Element | null) =>
                    abrirSheet({ modo: "ver", id: r.id }, origem);
                  return (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer"
                      onClick={(e) => abrir(e.currentTarget.querySelector("button"))}
                    >
                      <TableCell>{NOMES[produtoDoRoteiro(r)]}</TableCell>
                      <TableCell>{String(r.body.segment || "—")}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          className={`text-left font-medium text-primary-text underline-offset-2 hover:underline ${FOCO_VISIVEL}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            abrir(e.currentTarget);
                          }}
                        >
                          {r.title}
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge tom={sit.tom}>{sit.rotulo}</StatusBadge>
                      </TableCell>
                      <TableCell className="num text-right">{date(r.updated_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <NotaApoio>Modelo editável. Nada é enviado automaticamente ao cliente.</NotaApoio>
        </div>
      </SecaoCartao>

      <Sheet open={!!aberta} onOpenChange={(o) => !o && setAberta(null)}>
        <SheetContent
          className="w-full overflow-y-auto sm:max-w-xl"
          onCloseAutoFocus={foco.onCloseAutoFocus}
        >
          {aberta?.modo === "nova" ? (
            <>
              <SheetHeader>
                <SheetTitle>Nova abordagem</SheetTitle>
                <SheetDescription>
                  Monte a partir do modelo, revise o texto e salve como rascunho.
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-3">
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
                <Button variant="outline" size="sm" onClick={compose}>
                  Montar a partir do modelo
                </Button>
                <Field label="Texto para revisar">
                  <textarea
                    className={`${inputClass} h-64 py-2`}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <BotaoComMotivo
                    onClick={save}
                    disabled={busy || motivosSalvar.some(Boolean)}
                    motivo={motivosSalvar}
                  >
                    {busy ? "Salvando" : "Salvar abordagem"}
                  </BotaoComMotivo>
                  <BotaoComMotivo
                    variant="outline"
                    disabled={!text}
                    motivo={text ? null : "Ainda não há texto para copiar."}
                    onClick={() => copiar(text)}
                  >
                    Copiar texto
                  </BotaoComMotivo>
                </div>
                <NotaApoio>Modelo editável. Nada é enviado automaticamente ao cliente.</NotaApoio>
              </div>
            </>
          ) : vista ? (
            <>
              <SheetHeader>
                <SheetTitle>{vista.title}</SheetTitle>
                <SheetDescription>
                  {NOMES[produtoDoRoteiro(vista)]}
                  {vista.body.segment ? ` · ${String(vista.body.segment)}` : ""} · atualizada em{" "}
                  {date(vista.updated_at)}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-4 space-y-4">
                <StatusBadge tom={SITUACAO_ROTEIRO[situacaoDoRoteiro(vista)].tom}>
                  {SITUACAO_ROTEIRO[situacaoDoRoteiro(vista)].rotulo}
                </StatusBadge>
                {vista.body.evidence ? (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">
                      Evidência / necessidade observada
                    </span>
                    <p className="whitespace-pre-wrap text-sm">{String(vista.body.evidence)}</p>
                  </div>
                ) : null}
                <div>
                  <span className="text-xs font-medium text-muted-foreground">Texto</span>
                  <p className="whitespace-pre-wrap rounded-lg border p-3 text-sm">
                    {String(vista.body.text || "—")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {situacaoDoRoteiro(vista) === "rascunho" && (
                    <BotaoComMotivo
                      disabled={busy || !!motivoEscrita}
                      motivo={motivoEscrita}
                      onClick={() => mudarSituacao(vista, "aprovado", "Abordagem aprovada.")}
                    >
                      Aprovar
                    </BotaoComMotivo>
                  )}
                  <BotaoComMotivo
                    variant="outline"
                    disabled={!vista.body.text}
                    motivo={vista.body.text ? null : "Esta abordagem não tem texto."}
                    onClick={() => copiar(String(vista.body.text))}
                  >
                    Copiar texto
                  </BotaoComMotivo>
                  {situacaoDoRoteiro(vista) !== "arquivado" && (
                    <BotaoComMotivo
                      variant="ghost"
                      disabled={busy || !!motivoEscrita}
                      motivo={motivoEscrita}
                      onClick={() => setArquivar(vista)}
                    >
                      Arquivar
                    </BotaoComMotivo>
                  )}
                </div>
              </div>
            </>
          ) : (
            <SheetHeader>
              <SheetTitle>Abordagem não encontrada</SheetTitle>
              <SheetDescription>Ela pode ter sido removida na última carga.</SheetDescription>
            </SheetHeader>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmarArquivar
        registro={arquivar}
        oQue="a abordagem"
        feminino
        comoVer="filtrando a situação Arquivada"
        onCancelar={() => setArquivar(null)}
        onConfirmar={(r) => {
          setArquivar(null);
          void mudarSituacao(r, "arquivado", "Abordagem arquivada.");
        }}
      />
    </div>
  );
}

/**
 * Distribuição (contrato `monetizacao-distribuicao.md`, Lista/Relatório com registro de
 * decisão): uma linha por dono atual, mais abertas primeiro; toda célula abre os negócios que
 * conta e a capacidade leva ao plano do responsável. Números iguais aos de antes (`operacao()`).
 */
function Distribution({ data, filter, openDeals, busca }: Cut & Pick<Props, "busca">) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false);
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const owners = [
    ...new Map(data.cards.filter((c) => c.owner_id).map((c) => [c.owner_id!, c.owner])).entries(),
  ];
  const produto = filter.product ? NOMES[filter.product] : "Todos os produtos";
  const linhas = owners
    .map(([id, name]) => {
      const f = { ...filter, owner: id };
      const v = operacao(data.cards, f),
        plan = data.plans.find((p) => p.month === filter.to.slice(0, 7) && p.owner_id === id);
      return { id, name, f, v, capacity: plan?.capacity ?? null };
    })
    .sort((a, b) => b.v.current.length - a.v.current.length || a.name.localeCompare(b.name));
  // A foto salva com a decisão: mesmas colunas de sempre, na ordem da tela.
  const rows = linhas.map(({ id, name, v, capacity }) => ({
    id,
    name,
    open: v.current.length,
    loaded: v.rows.loaded.length,
    started: v.rows.started.length,
    validated: v.rows.validated.length,
    capacity,
  }));
  const semHistorico = linhas.flatMap((l) => semHistoricoNoRecorte(data, l.f));
  const evento = estadoKpiEvento(data, semHistorico);
  const motivoEscrita = motivoSemEscopo(data);
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
      toast.success("Decisão de distribuição registrada; ela aparece no histórico.");
    } catch (e) {
      toast.error(`A decisão não foi registrada: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const colunas: [string, "loaded" | "started" | "validated"][] = [
    ["Carregadas", "loaded"],
    ["Trabalhadas", "started"],
    ["Validadas", "validated"],
  ];
  return (
    <div className="space-y-6">
      <SecaoCartao
        titulo="Quem está com carga demais, e quem está sem base?"
        descricao={`Uma linha por dono atual · abertas hoje ignoram o período · ${produto} · clique no número para abrir os negócios`}
      >
        {!linhas.length ? (
          <EstadoVazio titulo="Nenhum responsável com negócio aberto neste recorte." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Responsável</TableHead>
                  <TableHead className="num text-right">Abertas hoje</TableHead>
                  {colunas.map(([rotulo]) => (
                    <TableHead key={rotulo} className="num text-right">
                      {rotulo}
                    </TableHead>
                  ))}
                  <TableHead className="num text-right">Capacidade mensal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map(({ id, name, f, v, capacity }) => (
                  <TableRow key={id}>
                    <TableCell className="font-medium">{name}</TableCell>
                    <TableCell className="num text-right">
                      <CelulaQueAbre
                        valor={v.current.length}
                        rotulo={`${name} · Abertas hoje`}
                        onClick={() =>
                          openDeals(`${name} · Abertas hoje`, v.current, undefined, {
                            estoque: true,
                            recorte: `${name} · ${produto} · abertas hoje`,
                          })
                        }
                      />
                    </TableCell>
                    {colunas.map(([rotulo, k]) => (
                      <TableCell key={k} className="num text-right">
                        <CelulaQueAbre
                          valor={v.rows[k].length}
                          rotulo={`${name} · ${rotulo}`}
                          onClick={() =>
                            openDeals(
                              `${name} · ${rotulo}`,
                              v.rows[k],
                              { from: filter.from, to: filter.to },
                              {
                                ordenarPor: ultimoEventoNoPeriodo(k, f),
                                recorte: `${name} · ${produto} · ${date(filter.from)} a ${date(filter.to)}`,
                              },
                            )
                          }
                        />
                      </TableCell>
                    ))}
                    <TableCell className="num text-right">
                      <Link
                        to="/monetizacao"
                        search={{
                          aba: "capacidade",
                          responsavel: id,
                          de: busca?.de,
                          ate: busca?.ate ?? filter.to,
                        }}
                        aria-label={`${name}: capacidade mensal ${capacity ?? "a definir"}, abrir o plano em Capacidade e alocação`}
                        className={FOCO_LINK}
                      >
                        {capacity === null ? "A definir" : number(capacity)}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <div className="mt-3">
          <NotaApoio>
            {evento.nota && `Números parciais: ${evento.nota}. `}
            Carregadas, trabalhadas e validadas são movimentos do período feitos pelo responsável;
            quem fez movimento e não é dono de nenhum negócio hoje não aparece. Capacidade mensal é
            o plano de {rotuloMes(filter.to.slice(0, 7))}; &quot;A definir&quot; quando não há plano
            salvo.
          </NotaApoio>
        </div>
      </SecaoCartao>
      <div className="grid gap-6 xl:grid-cols-2">
        <SecaoCartao
          titulo="Qual é a decisão de distribuição deste período?"
          descricao={`${date(filter.from)} a ${date(filter.to)} · a tabela acima é salva junto com a decisão`}
          acoes={
            <Link
              to="/clientes"
              search={{ view: "produtos" }}
              className={`text-sm font-medium ${FOCO_LINK}`}
            >
              Abrir as listas em Produtos e listas →
            </Link>
          }
        >
          <div className="space-y-4">
            <NotaApoio>
              <span className="font-medium text-foreground">Regra de distribuição</span>
              <ol className="mt-1 list-inside list-decimal space-y-1">
                <li>Preservar o vínculo da empresa com a unidade.</li>
                <li>Priorizar Consultoria nas carteiras das unidades.</li>
                <li>Mostrar Finance quando o perfil também atende à regra.</li>
                <li>Validar com o sócio e conferir a capacidade do hunter.</li>
                <li>Enviar a oferta selecionada com produto e responsável explícitos.</li>
              </ol>
            </NotaApoio>
            <Field label="Decisão e motivo desta distribuição">
              <textarea
                className={`${inputClass} h-28 py-2`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: priorizar a carteira de Curitiba para Consultoria; sócio confirmou disponibilidade nesta semana."
              />
            </Field>
            <BotaoComMotivo
              onClick={save}
              disabled={busy || !!motivoEscrita || !reason.trim()}
              motivo={[motivoEscrita, !reason.trim() && "Escreva a decisão e o motivo."]}
            >
              {busy ? "Registrando" : "Registrar decisão"}
            </BotaoComMotivo>
          </div>
        </SecaoCartao>
        <RecordList data={data} kind="distribuicao" title="Histórico de decisões" />
      </div>
    </div>
  );
}

/** A tabela por responsável como estava quando a decisão foi registrada. */
function FotoDistribuicao({
  rows,
}: {
  rows: {
    id: number;
    name: string;
    open: number;
    loaded: number;
    started: number;
    validated: number;
    capacity: number | null;
  }[];
}) {
  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">
        Tabela no momento da decisão
      </span>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Responsável</TableHead>
              <TableHead className="num text-right">Abertas</TableHead>
              <TableHead className="num text-right">Carregadas</TableHead>
              <TableHead className="num text-right">Trabalhadas</TableHead>
              <TableHead className="num text-right">Validadas</TableHead>
              <TableHead className="num text-right">Capacidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((l) => (
              <TableRow key={l.id}>
                <TableCell>{l.name}</TableCell>
                <TableCell className="num text-right">{number(l.open)}</TableCell>
                <TableCell className="num text-right">{number(l.loaded)}</TableCell>
                <TableCell className="num text-right">{number(l.started)}</TableCell>
                <TableCell className="num text-right">{number(l.validated)}</TableCell>
                <TableCell className="num text-right">
                  {l.capacity === null ? "A definir" : number(l.capacity)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

const SITUACAO_PDI: Record<string, { rotulo: string; tom: TomStatus }> = {
  em_andamento: { rotulo: "Em andamento", tom: "info" },
  concluido: { rotulo: "Concluído", tom: "sucesso" },
  arquivado: { rotulo: "Arquivado", tom: "neutro" },
};

/**
 * Histórico de registros (PDI e decisões de distribuição). PDI mostra de quem é e o período
 * avaliado, esconde arquivados por padrão (`?arquivados=mostrar`) e arquiva com confirmação.
 */
function RecordList({
  data,
  kind,
  title,
  arquivados = false,
  mudarArquivados,
}: {
  data: BaseMonetizacao;
  kind: "pdi" | "distribuicao";
  title: string;
  arquivados?: boolean;
  mudarArquivados?: (mostrar: boolean) => void;
}) {
  const fn = useServerFn(salvarRegistroMonetizacao),
    invalidate = useAtualizarMonetizacao();
  const [arquivar, setArquivar] = useState<Registro | null>(null),
    [busy, setBusy] = useState<string | null>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const todos = data.records
    .filter((r) => r.kind === kind)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const nArquivados = todos.filter((r) => r.body.status === "arquivado").length;
  const records =
    kind === "pdi" && !arquivados ? todos.filter((r) => r.body.status !== "arquivado") : todos;
  const motivoEscrita = motivoSemEscopo(data);
  const changeStatus = async (r: Registro, status: string, mensagem: string) => {
    setBusy(r.id);
    try {
      await fn({ data: { id: r.id, kind: r.kind, title: r.title, body: { ...r.body, status } } });
      await invalidate();
      toast.success(mensagem);
      // O PDI arquivado some da lista: o foco que estava nele vai para "Mostrar arquivados".
      if (status === "arquivado")
        requestAnimationFrame(() => {
          if (!document.activeElement || document.activeElement === document.body)
            toggleRef.current?.focus();
        });
    } catch (e) {
      toast.error(`O registro não foi atualizado: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const fields: Record<string, string> = {
    sample: "Evidências",
    goal: "Objetivo",
    action: "Ação",
    due: "Prazo",
    reason: "Decisão",
    rule: "Regra",
  };
  const valorDoCampo = (k: string, v: RegistroValor) =>
    k === "due" && typeof v === "string" ? date(v) : String(v);
  return (
    <SecaoCartao
      titulo={title}
      acoes={
        kind === "pdi" &&
        (nArquivados > 0 || arquivados) && (
          <Button
            ref={toggleRef}
            size="sm"
            variant={arquivados ? "secondary" : "ghost"}
            aria-pressed={arquivados}
            onClick={() => mudarArquivados?.(!arquivados)}
          >
            Mostrar arquivados ({nArquivados})
          </Button>
        )
      }
    >
      <div className="space-y-3">
        {!todos.length ? (
          <EstadoVazio
            titulo="Nenhum registro ainda."
            descricao="As avaliações, evidências e decisões salvas ficam disponíveis à equipe com acesso à operação geral."
          />
        ) : !records.length ? (
          <EstadoVazio titulo="Todos os PDIs estão arquivados." total={todos.length} />
        ) : (
          records.map((r) => {
            const situacao =
              kind === "pdi"
                ? (SITUACAO_PDI[String(r.body.status)] ?? SITUACAO_PDI.em_andamento)
                : null;
            const ownerId = typeof r.body.owner_id === "number" ? r.body.owner_id : null;
            const periodo =
              typeof r.body.from === "string" && typeof r.body.to === "string"
                ? `${date(r.body.from)} a ${date(r.body.to)}`
                : null;
            const aberto = r.body.status !== "concluido" && r.body.status !== "arquivado";
            return (
              <details key={r.id} className="rounded-lg border p-3">
                <summary className={`cursor-pointer text-sm font-medium ${FOCO_VISIVEL}`}>
                  <span className="inline-flex flex-wrap items-center gap-2 align-middle">
                    {r.title}
                    {situacao && <StatusBadge tom={situacao.tom}>{situacao.rotulo}</StatusBadge>}
                  </span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {[
                      kind === "pdi" &&
                        `PDI de ${ownerId === null ? "responsável não registrado" : nomeDoDono(data, ownerId)}`,
                      periodo && (kind === "pdi" ? `amostra de ${periodo}` : `período ${periodo}`),
                      `atualizado em ${date(r.updated_at)}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </summary>
                <div className="mt-3 space-y-3">
                  {Object.entries(fields)
                    .filter(([k]) => r.body[k])
                    .map(([k, label]) => (
                      <div key={k}>
                        <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        <p className="whitespace-pre-wrap text-sm">{valorDoCampo(k, r.body[k])}</p>
                      </div>
                    ))}
                  {Array.isArray(r.body.rows) && <FotoDistribuicao rows={r.body.rows} />}
                  {r.body.scores && typeof r.body.scores === "object" ? (
                    <ul className="space-y-1 text-xs">
                      {Object.entries(r.body.scores).map(([c, n]) => (
                        <li key={c}>
                          {c}: {Number(n) || "Não avaliado"}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {kind === "pdi" && r.body.status !== "arquivado" && (
                    <div className="flex flex-wrap gap-2">
                      {aberto && (
                        <BotaoComMotivo
                          size="sm"
                          variant="outline"
                          disabled={!!motivoEscrita || busy === r.id}
                          motivo={motivoEscrita}
                          onClick={() =>
                            changeStatus(r, "concluido", "PDI marcado como concluído.")
                          }
                        >
                          Marcar concluído
                        </BotaoComMotivo>
                      )}
                      <BotaoComMotivo
                        size="sm"
                        variant="ghost"
                        disabled={!!motivoEscrita || busy === r.id}
                        motivo={motivoEscrita}
                        onClick={() => setArquivar(r)}
                      >
                        Arquivar
                      </BotaoComMotivo>
                    </div>
                  )}
                </div>
              </details>
            );
          })
        )}
      </div>
      <ConfirmarArquivar
        registro={arquivar}
        oQue="o PDI"
        onCancelar={() => setArquivar(null)}
        onConfirmar={(r) => {
          setArquivar(null);
          void changeStatus(r, "arquivado", "PDI arquivado.");
        }}
      />
    </SecaoCartao>
  );
}

/** Arquivar pede confirmação (V6): o registro sai da lista padrão. */
function ConfirmarArquivar({
  registro,
  oQue,
  feminino = false,
  comoVer = "em Mostrar arquivados",
  onCancelar,
  onConfirmar,
}: {
  registro: Registro | null;
  /** "o PDI", "a abordagem". */
  oQue: string;
  /** Concordância do texto: "ela continua salva" em vez de "ele continua salvo". */
  feminino?: boolean;
  /** Como ver o arquivado depois: "filtrando a situação Arquivada". */
  comoVer?: string;
  onCancelar: () => void;
  onConfirmar: (r: Registro) => void;
}) {
  const foco = useFocoDeVolta();
  const o = feminino ? "a" : "o";
  return (
    <AlertDialog open={!!registro} onOpenChange={(aberto) => !aberto && onCancelar()}>
      <AlertDialogContent
        onOpenAutoFocus={foco.onOpenAutoFocus}
        onCloseAutoFocus={foco.onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Arquivar {registro?.title}?</AlertDialogTitle>
          <AlertDialogDescription>
            Arquivar tira {oQue} da lista padrão; {feminino ? "ela" : "ele"} continua salv{o} e pode
            ser vist{o} {comoVer}.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => registro && onConfirmar(registro)}>
            Arquivar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
