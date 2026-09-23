import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  FileWarning,
  Info,
  Timer,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { KpiCard } from "@/components/audit/kpi-card";
import { brl } from "@/components/audit/format";
import { usePermissions } from "@/hooks/use-permissions";
import { AREAS, areaDoItem, partesDoLink } from "@/lib/areas";
import {
  carregarReceitaRepasses,
  type ReceitaRepassesOverview,
  type RepasseUnidade,
} from "@/lib/receita-repasses.functions";

/**
 * A abertura da área Receita e Repasses.
 *
 * A regra é a mesma do Overview da Rede: esta tela nunca duplica a tela de
 * detalhe. Ela responde "o mês fechou? a fatura saiu? a unidade pagou?" e
 * manda para a página dona do assunto. Quem quer a apuração cliente a cliente
 * continua indo para /unidades/royalties.
 *
 * Duas réguas convivem aqui e cada bloco diz a sua, porque confundi-las é o
 * erro clássico da área: o repasse é caixa (o que a unidade recebeu de fato,
 * com os ajustes da apuração); a receita da rede é competência e bruto de nota.
 */

const CORES = {
  royalties: "var(--chart-1)",
  csc: "var(--chart-2)",
  outras: "var(--chart-4)",
  cac: "var(--chart-5)",
  faturado: "var(--chart-2)",
  recebido: "var(--chart-1)",
};

function defaultMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMes(mes: string, delta: number): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function rotuloMes(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rotuloCurto(mes: string): string {
  const [y, m] = mes.split("-");
  return `${m}/${y.slice(2)}`;
}

/** `YYYY-MM-DD` do banco em `dd/MM`, sem passar por Date: `new Date("2026-09-10")`
 *  é meia-noite UTC e no fuso de casa vira o dia 09. */
function rotuloDia(iso?: string | null): string | null {
  if (!iso) return null;
  const [, m, d] = iso.slice(0, 10).split("-");
  return m && d ? `${d}/${m}` : null;
}

function mesEmAndamento(mes: string): boolean {
  const d = new Date();
  return mes >= `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const APURADA = new Set(["confirmado", "faturado"]);

/** Eixo de dinheiro em milhares: 12 meses de rótulo inteiro não cabem. */
const eixoBRL = (v: number) =>
  Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : `${Math.round(v / 1000)}k`;

function TooltipBRL({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + Number(p.value ?? 0), 0);
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span
              className="inline-block h-2 w-2 rounded-[2px]"
              style={{ background: p.color }}
              aria-hidden
            />
            {p.name}
          </span>
          <span className="tabular-nums text-popover-foreground">{brl(p.value)}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
          <span className="text-muted-foreground">Total</span>
          <span className="tabular-nums">{brl(total)}</span>
        </div>
      )}
    </div>
  );
}

/**
 * Selo de régua de data ao lado do título do bloco. Existe porque o mês do
 * seletor significa coisas diferentes em cada bloco, e essa é a confusão que
 * mais cara custa na área (ver DATA-RULES, decisão de 20/07/2026).
 */
function SeloRegime({ regime, children }: { regime: string; children: React.ReactNode }) {
  return (
    <TooltipProvider>
      <UiTooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="cursor-help font-normal text-muted-foreground">
            {regime}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{children}</TooltipContent>
      </UiTooltip>
    </TooltipProvider>
  );
}

/** Lista de unidades de uma pendência. Nome resolve; contagem sozinha não. */
function ChipsUnidades({ itens }: { itens: { nome: string; detalhe?: string | null }[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {itens.map((i) => (
        <Badge key={i.nome} variant="outline" className="font-normal">
          {i.nome}
          {i.detalhe && (
            <span className="ml-1 text-muted-foreground tabular-nums">· {i.detalhe}</span>
          )}
        </Badge>
      ))}
    </div>
  );
}

function CardPendencia({
  icone,
  titulo,
  quantidade,
  valor,
  explicacao,
  itens,
  destino,
}: {
  icone: React.ReactNode;
  titulo: string;
  quantidade: number;
  valor?: number;
  explicacao: string;
  itens: { nome: string; detalhe?: string | null }[];
  destino: { to: string; search: Record<string, string> };
}) {
  const limpo = quantidade === 0;
  return (
    <Card className={limpo ? "p-4" : "border-amber-300 p-4 dark:border-amber-900"}>
      <div className="flex items-start gap-2">
        <span className={limpo ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}>
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{titulo}</div>
          <div className="mt-1 text-2xl font-bold tabular-nums">
            {limpo ? "Nenhuma" : quantidade}
            {!limpo && valor != null && valor > 0 && (
              <span className="ml-2 align-middle text-sm font-normal text-muted-foreground">
                {brl(valor)}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{explicacao}</p>
          <ChipsUnidades itens={itens} />
          <Link
            to={destino.to}
            search={destino.search}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Resolver <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </Card>
  );
}

export function ReceitaOverviewContent() {
  const perms = usePermissions();
  const [mes, setMes] = useState(defaultMes());

  const fn = useServerFn(carregarReceitaRepasses);
  const { data, isLoading, error } = useQuery<ReceitaRepassesOverview>({
    queryKey: ["receita-overview", mes],
    queryFn: () => fn({ data: { mes } }),
    staleTime: 60_000,
  });

  const mesAtual = useMemo(
    () => data?.meses.find((m) => m.mes === mes) ?? null,
    [data, mes],
  );

  // O take rate é o da definição do DATA-RULES: royalties + CSC sobre a receita
  // apurada, sem mídia. Só entra mês com apuração fechada, senão a régua cai
  // junto com o calendário e parece queda de negócio.
  const takeRate =
    mesAtual && mesAtual.receitaBaseConfirmada > 0
      ? (mesAtual.takeConfirmado / mesAtual.receitaBaseConfirmada) * 100
      : null;

  const serieTake = useMemo(
    () =>
      (data?.meses ?? [])
        .filter((m) => m.receitaBaseConfirmada > 0)
        .map((m) => ({
          mes: rotuloCurto(m.mes),
          take: (m.takeConfirmado / m.receitaBaseConfirmada) * 100,
        })),
    [data],
  );

  const serieComposicao = useMemo(
    () =>
      (data?.meses ?? []).map((m) => ({
        mes: rotuloCurto(m.mes),
        royalties: m.royalties,
        csc: m.csc,
        outras: m.outras,
      })),
    [data],
  );

  const serieCac = useMemo(
    () => (data?.meses ?? []).map((m) => ({ mes: rotuloCurto(m.mes), cac: m.cac })),
    [data],
  );

  const serieReceita = useMemo(
    () =>
      (data?.receita ?? []).map((r) => ({
        mes: rotuloCurto(r.mes),
        faturado: r.faturado,
        recebido: r.recebido,
      })),
    [data],
  );

  const receitaDoMes = useMemo(
    () => (data?.receita ?? []).find((r) => r.mes === mes) ?? null,
    [data, mes],
  );

  const pendencias = useMemo(() => {
    const us = data?.unidadesDoMes ?? [];
    const semFechar = us.filter((u) => !u.status || !APURADA.has(u.status));
    const semFatura = us.filter((u) => u.status && APURADA.has(u.status) && !u.fatura);
    const naoRecebidas = us.filter(
      (u) => u.fatura && u.fatura.recebimento?.status !== "RECEBIDO" && u.fatura.status !== "erro",
    );
    const somaFatura = (lista: RepasseUnidade[]) => lista.reduce((s, u) => s + u.total, 0);
    return {
      semFechar,
      semFatura,
      naoRecebidas,
      valorSemFatura: somaFatura(semFatura),
      valorNaoRecebido: naoRecebidas.reduce((s, u) => s + (u.fatura?.valor_total ?? 0), 0),
      atrasadas: naoRecebidas.filter((u) => u.fatura?.recebimento?.status === "ATRASADO").length,
    };
  }, [data]);

  // Os atalhos saem do próprio menu da área: página nova aparece aqui sozinha,
  // e o que a pessoa não pode abrir não é oferecido.
  const atalhos = useMemo(() => {
    const area = AREAS.find((a) => a.slug === "receita");
    if (!area) return [];
    return area.grupos.flatMap((g) =>
      g.items
        .filter(
          (i) =>
            i.url !== "/receita-overview" &&
            perms.temArea(areaDoItem(area, i)) &&
            (!i.chave || perms.can(i.chave)),
        )
        .map((i) => ({ ...i, grupo: g.label })),
    );
  }, [perms]);

  const destinoApuracao = partesDoLink("/unidades/royalties");

  return (
    <div className="space-y-5 p-4 md:p-6">
      {/* ---- o mês, e o que ele quer dizer em cada bloco ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          O mês que a tela está mostrando. A apuração de um mês só fecha depois que ele termina.
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => setMes(shiftMes(mes, -1))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[160px] rounded-md border bg-card px-3 py-1.5 text-center text-sm font-medium">
            {rotuloMes(mes)}
          </div>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMes(shiftMes(mes, 1))}
            disabled={mesEmAndamento(shiftMes(mes, 1))}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* O mesmo mês significa coisas diferentes nos dois blocos. Dizer isso uma
          vez, sempre visível, é mais barato que explicar depois por que o
          repasse de um mês não bate com a receita do mesmo mês. */}
      <div className="flex items-start gap-2 rounded-md border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <strong className="text-foreground">Duas réguas de data nesta tela.</strong> O repasse de{" "}
          <strong>{rotuloMes(mes)}</strong> é por <strong>caixa</strong>: conta o que o Omie baixou
          como recebido dentro do mês, pela data de pagamento. A receita da rede é por{" "}
          <strong>competência</strong>: cada nota conta no mês a que se refere, mesmo que o dinheiro
          entre depois. Os dois blocos usam o mês do seletor e não têm por que dar o mesmo número.
        </span>
      </div>

      {mesEmAndamento(mes) && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          Mês em andamento. Os números ainda vão mudar até a virada.
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive">
          Não foi possível carregar: {(error as Error).message}
        </Card>
      )}

      {isLoading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {/* ================= REPASSE ================= */}
      {data?.podeRepasse && mesAtual && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Repasse das unidades para a matriz</h2>
              <SeloRegime regime="caixa">
                O mês da apuração é de caixa: entra o que o Omie baixou como recebido dentro de{" "}
                {rotuloMes(mes)}, pela data de pagamento. A competência do título do cliente pode
                ser outro mês, e ela aparece na tela de apuração, coluna "Competência".
              </SeloRegime>
            </div>
            <span className="text-xs text-muted-foreground">
              {mesAtual.confirmadas} de {data.totalUnidades} unidades com o mês fechado · fonte:
              apuração de royalties · caixa de {rotuloMes(mes)}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiCard
              label="Total do repasse"
              value={brl(mesAtual.total)}
              sub={`${mesAtual.comApuracao} unidade(s) com apuração aberta`}
              tone="indigo"
              help={`Soma do total da fatura de cada apuração do mês: royalties + CSC + CAC + mídia + outras receitas. A nota de débito que cobra isso sai com competência ${rotuloMes(mes)} e costuma ser emitida no mês seguinte. O que já foi emitido e ainda não entrou está no card "Faturado e não recebido".`}
            />
            <KpiCard
              label="Royalties"
              value={brl(mesAtual.royalties)}
              sub="% sobre o recebido do cliente"
              tone="emerald"
              help={`Percentual sobre o que o cliente pagou à unidade dentro de ${rotuloMes(mes)}, por caixa e sobre o valor líquido de retenção. A competência da nota do cliente pode ser outro mês: fatura atrasada entra no mês em que foi paga, não no mês a que se refere.`}
            />
            <KpiCard
              label="CSC"
              value={brl(mesAtual.csc)}
              sub="Fixo + percentual da base antiga"
              help={`Duas parcelas com réguas diferentes: o valor fixo é da competência ${rotuloMes(mes)} e não depende de recebimento nenhum; o percentual da base antiga incide sobre o que os clientes antigos pagaram dentro do mês (caixa).`}
            />
            <KpiCard
              label="CAC"
              value={brl(mesAtual.cac)}
              sub="Clientes vendidos pela matriz"
              tone="purple"
              help={`Cobrança pelos clientes que a matriz vendeu, lançada na competência ${rotuloMes(mes)}. Não é caixa: o gatilho é a fila do broker e o primeiro honorário do cliente, não o pagamento da unidade.`}
            />
            <KpiCard
              label="Mídia"
              value={brl(mesAtual.midia)}
              sub="Reembolso de tráfego pago"
              help={`Reembolso do tráfego pago da competência ${rotuloMes(mes)}, valor acordado por unidade. Não é caixa e fica fora do take rate: é repasse de custo, não remuneração da matriz.`}
            />
            <KpiCard
              label="Take rate"
              value={takeRate == null ? "—" : `${takeRate.toFixed(1)}%`}
              sub={
                takeRate == null
                  ? "sem mês fechado"
                  : `sobre ${brl(mesAtual.receitaBaseConfirmada)} apurados`
              }
              help="Royalties + CSC dividido pela receita apurada das unidades, só dos meses fechados. As duas pontas saem da mesma apuração, por caixa. Nunca dividir por faturamento de competência do Omie, que é bruto e de outro regime. Mídia e CAC ficam de fora: são reembolso de custo, não remuneração da matriz."
            />
          </div>

          {/* ---- o que trava o fechamento ---- */}
          <div className="grid gap-3 md:grid-cols-3">
            <CardPendencia
              icone={<Timer className="h-4 w-4" />}
              titulo="Apuração não fechada"
              quantidade={pendencias.semFechar.length}
              explicacao={`Unidade sem apuração aberta ou ainda em rascunho em ${rotuloMes(mes)}. Enquanto não fecha, não vira fatura.`}
              itens={pendencias.semFechar.map((u) => ({ nome: u.unidade }))}
              destino={destinoApuracao}
            />
            <CardPendencia
              icone={<FileWarning className="h-4 w-4" />}
              titulo="Fechada sem fatura"
              quantidade={pendencias.semFatura.length}
              valor={pendencias.valorSemFatura}
              explicacao={`O mês fechou e a nota de competência ${rotuloMes(mes)} não foi emitida no Omie. É dinheiro apurado que ninguém cobrou.`}
              itens={pendencias.semFatura.map((u) => ({ nome: u.unidade }))}
              destino={destinoApuracao}
            />
            {/* Aqui a data que resolve é a de vencimento do título na Partners,
                não o mês da apuração: é ela que diz se já passou do prazo. */}
            <CardPendencia
              icone={<AlertTriangle className="h-4 w-4" />}
              titulo="Faturado e não recebido"
              quantidade={pendencias.naoRecebidas.length}
              valor={pendencias.valorNaoRecebido}
              explicacao={
                pendencias.atrasadas > 0
                  ? `${pendencias.atrasadas} título(s) já vencido(s) na conta da Partners. A data ao lado da unidade é o vencimento.`
                  : "Títulos emitidos que ainda não foram baixados no Omie. A data ao lado da unidade é o vencimento."
              }
              itens={pendencias.naoRecebidas.map((u) => ({
                nome: u.unidade,
                detalhe: rotuloDia(u.fatura?.recebimento?.vencimento ?? u.fatura?.vence_em),
              }))}
              destino={destinoApuracao}
            />
          </div>

          {/* ---- séries ---- */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4">
              <div className="text-sm font-medium">Do que o repasse é feito</div>
              <p className="mb-2 text-xs text-muted-foreground">
                Remuneração da matriz, mês a mês pelo mês da apuração (caixa). CAC e mídia ficam no
                gráfico ao lado: são reembolso de custo, não receita de franquia.
              </p>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serieComposicao} margin={{ top: 4, right: 4, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={eixoBRL}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip content={<TooltipBRL />} cursor={{ fill: "hsl(0 0% 50% / 0.08)" }} />
                    <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                    {/* stroke da cor da superfície = o respiro de 2px entre as
                        fatias empilhadas, que recharts não tem nativo. */}
                    <Bar
                      dataKey="royalties"
                      stackId="r"
                      name="Royalties"
                      fill={CORES.royalties}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                    <Bar
                      dataKey="csc"
                      stackId="r"
                      name="CSC"
                      fill={CORES.csc}
                      stroke="var(--card)"
                      strokeWidth={2}
                    />
                    <Bar
                      dataKey="outras"
                      stackId="r"
                      name="Outras receitas"
                      fill={CORES.outras}
                      stroke="var(--card)"
                      strokeWidth={2}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="text-sm font-medium">CAC cobrado das unidades</div>
              <p className="mb-2 text-xs text-muted-foreground">
                O que a matriz cobrou pelos clientes que vendeu, na competência de cada apuração.
                Varia com a fila do broker, não com o tamanho da carteira.
              </p>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={serieCac} margin={{ top: 4, right: 4, left: 4 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                    <YAxis
                      tickFormatter={eixoBRL}
                      tick={{ fontSize: 11 }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                    />
                    <Tooltip content={<TooltipBRL />} cursor={{ fill: "hsl(0 0% 50% / 0.08)" }} />
                    <Bar dataKey="cac" name="CAC" fill={CORES.cac} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card className="p-4">
            <div className="text-sm font-medium">Take rate da rede</div>
            <p className="mb-2 text-xs text-muted-foreground">
              Quanto da receita das unidades fica com a matriz, com as duas pontas por caixa. Só
              meses com apuração fechada aparecem: mês aberto ainda não tem base apurada.
            </p>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={serieTake} margin={{ top: 4, right: 8, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                    // Zero na base porque a régua é contratual e a mensagem é a
                    // estabilidade; a folga no topo evita o ponto do último mês
                    // encostar na borda do cartão.
                    domain={[0, "dataMax + 3"]}
                  />
                  <Tooltip
                    formatter={(v: number) => [`${v.toFixed(1)}%`, "Take rate"]}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="take"
                    name="Take rate"
                    stroke={CORES.royalties}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>
      )}

      {/* ================= RECEITA DA REDE ================= */}
      {data?.podeReceita && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Receita da rede</h2>
              <SeloRegime regime="competência">
                Aqui o mês é o da competência do título no Omie: cada nota conta em {rotuloMes(mes)}
                se é a esse mês que ela se refere, mesmo que tenha sido paga antes ou depois. É
                outra régua do bloco de repasse, que é caixa.
              </SeloRegime>
            </div>
            <span className="text-xs text-muted-foreground">
              fonte: Omie · competência de {rotuloMes(mes)} e bruto de nota · a mesma régua do Funil
              de Receita
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              label="MRR contratado"
              value={brl(receitaDoMes?.mrrContratado)}
              sub="Contratos ativos hoje (Pipedrive)"
              help="Soma dos contratos que estão ativos hoje no Pipedrive. É foto do momento, sem data de corte: não muda ao trocar o mês do seletor, e por isso não serve para comparar com o faturado de um mês passado."
            />
            <KpiCard
              label="Faturado"
              value={brl(receitaDoMes?.faturado)}
              sub={`Competência ${rotuloCurto(mes)}, bruto de nota`}
              help={`Títulos cuja competência no Omie cai em ${rotuloMes(mes)}, independentemente de quando foram emitidos ou pagos. Valor bruto de nota: antes de retenção de imposto, ao contrário da base de royalties, que é líquida.`}
            />
            <KpiCard
              label="Recebido"
              value={brl(receitaDoMes?.recebido)}
              sub={
                receitaDoMes && receitaDoMes.faturado > 0
                  ? `${((receitaDoMes.recebido / receitaDoMes.faturado) * 100).toFixed(0)}% do faturado`
                  : "—"
              }
              tone="emerald"
              help={`Quanto das notas de competência ${rotuloMes(mes)} já foi baixado no Omie, em qualquer data de pagamento. Não é o caixa do mês: dinheiro que entrou em ${rotuloMes(mes)} por nota de outra competência fica de fora daqui, e é justamente esse dinheiro, o que entrou no mês, que o bloco de repasse mede.`}
            />
            <KpiCard
              label="Em atraso"
              value={brl(receitaDoMes?.emAtraso)}
              sub={`A vencer: ${brl(receitaDoMes?.aVencer)}`}
              tone={receitaDoMes && receitaDoMes.emAtraso > 0 ? "red" : "default"}
              help={`Títulos de competência ${rotuloMes(mes)} pelo status atual no Omie, que segue a data de vencimento. Para medir inadimplência, a régua é a safra de vencimento em Contas a Receber: a competência de título antigo no Omie é pouco confiável e joga vencido velho em mês recente.`}
            />
          </div>

          <Card className="p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Faturado × recebido</div>
                <p className="mb-2 text-xs text-muted-foreground">
                  Cada nota no mês da sua competência. A diferença entre as duas barras é o que a
                  rede emitiu naquela competência e ainda não entrou. A barra de recebido conta o
                  pagamento em qualquer data, não o caixa do mês.
                </p>
              </div>
              <Link
                to="/funil-receita"
                className="shrink-0 text-xs font-medium text-primary hover:underline"
              >
                Ver o funil
              </Link>
            </div>
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={serieReceita} margin={{ top: 4, right: 4, left: 4 }}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" className="stroke-border/60" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tickFormatter={eixoBRL}
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={44}
                  />
                  <Tooltip content={<TooltipBRL />} cursor={{ fill: "hsl(0 0% 50% / 0.08)" }} />
                  <Legend iconType="square" wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="faturado" name="Faturado" fill={CORES.faturado} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="recebido" name="Recebido" fill={CORES.recebido} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </section>
      )}

      {/* ================= ATALHOS ================= */}
      {atalhos.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-base font-semibold">As telas da área</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {atalhos.map((item) => {
              const destino = partesDoLink(item.url);
              return (
                <Link
                  key={item.url}
                  to={destino.to}
                  search={destino.search}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-primary/50 hover:bg-accent"
                >
                  <item.icon className="h-4 w-4 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{item.grupo}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
