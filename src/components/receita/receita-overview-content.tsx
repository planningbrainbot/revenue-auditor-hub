import { useMemo } from "react";
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
import { AlertTriangle, ArrowRight, FileWarning, Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Carregando,
  EstadoSemAcesso,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type EstadoKpi,
} from "@/components/planning";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { usePermissions } from "@/hooks/use-permissions";
import { AREAS, areaDoItem, partesDoLink } from "@/lib/areas";
import {
  carregarReceitaRepasses,
  type ReceitaRepassesOverview,
  type RepasseUnidade,
} from "@/lib/receita-repasses.functions";
import {
  brlOuTraco,
  eixoMoeda,
  ErroDaConsulta,
  hrefComMes,
  mesAnterior,
  mesEmAndamento,
  MolduraReceita,
  ComoLer,
  NotaComAjuda,
  pctOuTraco,
  rotuloDia,
  rotuloMes,
  rotuloMesCurto,
  SeletorMes,
  SeloRegua,
  TooltipMoeda,
  useMesNaUrl,
} from "./moldura";
import { FunilRepasse } from "./funil-repasse";

/**
 * A abertura da área Receita e Repasses (Visão geral; contrato
 * `docs/design/contratos/receita-e-repasses.md` §1).
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

/** Quem não tem nenhuma das chaves dos dois blocos (o servidor devolve "Acesso negado"). */
const CHAVES_DA_TELA =
  "view.unidades_rede (repasse) ou view.contas_receber / view.funil_receita (receita da rede)";

// Ordem fixa da marca (DESIGN §5): a pilha tem quatro séries; gráfico de uma
// série só usa a primeira cor.
const COR = {
  royalties: CORES_SERIE[0],
  csc: CORES_SERIE[1],
  outras: CORES_SERIE[2],
  cac: CORES_SERIE[3],
  unica: CORES_SERIE[0],
  faturado: CORES_SERIE[0],
  recebido: CORES_SERIE[1],
};

const APURADA = new Set(["confirmado", "faturado"]);

/** Lista de unidades de uma pendência. Nome resolve; contagem sozinha não. */
function ChipsUnidades({ itens }: { itens: { nome: string; detalhe?: string | null }[] }) {
  if (itens.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {itens.map((i) => (
        <Badge key={i.nome} variant="outline" className="font-normal">
          {i.nome}
          {i.detalhe && <span className="num ml-1 text-muted-foreground">· {i.detalhe}</span>}
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
  base,
  itens,
  destino,
  tom = "atencao",
}: {
  icone: React.ReactNode;
  titulo: string;
  quantidade: number;
  valor?: number;
  explicacao: string;
  /** De onde sai o valor em R$ (N11): as pendências somam bases diferentes. */
  base?: string;
  itens: { nome: string; detalhe?: string | null }[];
  destino: string;
  /** Tom do selo quando há pendência: "perigo" quando já passou do prazo. */
  tom?: "atencao" | "perigo";
}) {
  const limpo = quantidade === 0;
  const link = partesDoLink(destino);
  return (
    // O sinal da pendência é um só, o selo (ícone + palavra, V7): borda e ícone
    // ficam neutros para não repetir a mesma cor três vezes.
    <Card className="p-4">
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground" aria-hidden>
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-medium">{titulo}</h4>
            {limpo ? (
              <StatusBadge tom="sucesso">Nenhuma</StatusBadge>
            ) : (
              <StatusBadge tom={tom}>
                {quantidade} {quantidade === 1 ? "unidade" : "unidades"}
              </StatusBadge>
            )}
          </div>
          {!limpo && valor != null && valor > 0 && (
            <div className="num mt-1 text-2xl font-bold">{brlOuTraco(valor)}</div>
          )}
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
            {explicacao}
            {!limpo && base && <> {base}</>}
          </p>
          <ChipsUnidades itens={itens} />
          {!limpo && (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link to={link.to as never} search={link.search as never}>
                Resolver <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** Cartão de gráfico dentro de um bloco: título em forma de pergunta e a unidade. */
function CartaoGrafico({
  titulo,
  descricao,
  acao,
  altura = 240,
  children,
}: {
  titulo: string;
  descricao: React.ReactNode;
  acao?: React.ReactNode;
  altura?: number;
  children: React.ReactElement;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{titulo}</h3>
          <p className="mb-2 text-[13px] text-muted-foreground">{descricao}</p>
        </div>
        {acao}
      </div>
      <div style={{ height: altura }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

export function ReceitaOverviewContent() {
  const perms = usePermissions();
  // A seta para frente para no mês anterior: a apuração de um mês só fecha
  // depois que ele termina. Mês corrente só entra por link colado, e aí os
  // cards saem como "parcial".
  const maximo = mesAnterior();
  const [mes, setMes] = useMesNaUrl(maximo);
  const emAndamento = mesEmAndamento(mes);
  const estadoValor: EstadoKpi = emAndamento ? "parcial" : "ok";

  const fn = useServerFn(carregarReceitaRepasses);
  const { data, isLoading, error, refetch } = useQuery<ReceitaRepassesOverview>({
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
  // O servidor devolve todo mês da janela, com zeros onde não há apuração:
  // sem nenhuma apuração aberta, o mês é "não apurado", não R$ 0 (N4).
  const repasseApurado = !!mesAtual && mesAtual.comApuracao > 0;

  const takeRate =
    mesAtual && mesAtual.receitaBaseConfirmada > 0
      ? (mesAtual.takeConfirmado / mesAtual.receitaBaseConfirmada) * 100
      : null;

  const serieTake = useMemo(
    () =>
      (data?.meses ?? [])
        .filter((m) => m.receitaBaseConfirmada > 0)
        .map((m) => ({
          mes: rotuloMesCurto(m.mes),
          take: (m.takeConfirmado / m.receitaBaseConfirmada) * 100,
        })),
    [data],
  );

  const serieComposicao = useMemo(
    () =>
      (data?.meses ?? []).map((m) => ({
        mes: rotuloMesCurto(m.mes),
        royalties: m.royalties,
        csc: m.csc,
        outras: m.outras,
        cac: m.cac,
      })),
    [data],
  );

  const serieCac = useMemo(
    () => (data?.meses ?? []).map((m) => ({ mes: rotuloMesCurto(m.mes), cac: m.cac })),
    [data],
  );

  const serieReceita = useMemo(
    () =>
      (data?.receita ?? []).map((r) => ({
        mes: rotuloMesCurto(r.mes),
        faturado: r.faturado,
        recebido: r.recebido,
      })),
    [data],
  );

  const receitaDoMes = useMemo(
    () => (data?.receita ?? []).find((r) => r.mes === mes) ?? null,
    [data, mes],
  );
  // Mesma coisa na receita: linha do mês com os cinco campos zerados é mês sem
  // título, não receita zero.
  const receitaApurada =
    !!receitaDoMes &&
    [
      receitaDoMes.mrrContratado,
      receitaDoMes.faturado,
      receitaDoMes.recebido,
      receitaDoMes.aVencer,
      receitaDoMes.emAtraso,
    ].some((v) => v !== 0);

  const pendencias = useMemo(() => {
    const us = data?.unidadesDoMes ?? [];
    const semFechar = us.filter((u) => !u.status || !APURADA.has(u.status));
    const semFatura = us.filter((u) => u.status && APURADA.has(u.status) && !u.fatura);
    const naoRecebidas = us.filter(
      (u) => u.fatura && u.fatura.recebimento?.status !== "RECEBIDO" && u.fatura.status !== "erro",
    );
    const somaRepasse = (lista: RepasseUnidade[]) => lista.reduce((s, u) => s + u.total, 0);
    return {
      semFechar,
      semFatura,
      naoRecebidas,
      valorSemFatura: somaRepasse(semFatura),
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

  // "Resolver" abre a apuração no MESMO mês do seletor: sem o mês, o destino
  // abria no mês padrão dele e o total não batia com o da pendência (N2).
  const destinoApuracao = hrefComMes("/unidades/royalties", mes);
  // Os cards abrem a tela dona no mesmo mês (N2). O CSC da apuração é "fixo
  // ou base antiga" e pode não bater com a soma daqui: a explicação diz isso.
  const hrefApuracao = destinoApuracao;
  const hrefFunil = hrefComMes("/funil-receita", mes);
  const nomeMes = rotuloMes(mes);

  return (
    <MolduraReceita
      titulo="Visão geral"
      pergunta="O mês de repasses fechou, a fatura saiu, a unidade pagou?"
      descricao={
        <>
          {data ? `${data.totalUnidades} unidades regionais` : "Unidades regionais"} · {nomeMes}
          {emAndamento && " (em andamento, parcial)"} · repasse por <strong>caixa</strong> (pago
          dentro do mês), receita da rede por <strong>competência</strong> (mês da nota): os dois
          blocos usam o mesmo mês e não têm por que dar o mesmo número.
        </>
      }
      procedencia={{
        fonte: "Apuração de royalties, faturas e títulos do Omie",
        regua: "caixa no repasse, competência na receita",
      }}
      filtros={<SeletorMes mes={mes} aoMudar={setMes} maximo={maximo} />}
    >
      <div className="space-y-6 p-4 md:p-6">
        {isLoading && <Carregando variante="kpis" />}

        {error && (
          <ErroDaConsulta
            erro={error}
            chaves={CHAVES_DA_TELA}
            tentarNovamente={() => void refetch()}
          />
        )}

        {/* ================= REPASSE ================= */}
        {data && !data.podeRepasse && (
          <EstadoSemAcesso oQueFalta="view.unidades_rede (repasse das unidades)" />
        )}
        {data?.podeRepasse && (
          <Secao
            titulo="Quanto as unidades repassam à matriz neste mês?"
            descricao={
              mesAtual
                ? `${mesAtual.confirmadas} de ${data.totalUnidades} unidades com o mês fechado · fonte: apuração de royalties · caixa de ${nomeMes}`
                : `fonte: apuração de royalties · caixa de ${nomeMes}`
            }
            acoes={
              <SeloRegua regua="caixa">
                O mês da apuração é de caixa: entra o que o Omie baixou como recebido dentro de{" "}
                {nomeMes}, pela data de pagamento. A competência do título do cliente pode ser outro
                mês, e ela aparece na tela de apuração, coluna "Competência".
              </SeloRegua>
            }
          >
            <KpiGrade colunas={6}>
              <KpiCard
                rotulo="Total do repasse"
                valor={brlOuTraco(mesAtual?.total)}
                estado={repasseApurado ? estadoValor : "nao-apurado"}
                nota={
                  repasseApurado
                    ? `${mesAtual.comApuracao} unidade(s) com apuração aberta`
                    : "nenhuma apuração aberta no mês"
                }
                abrir={{ href: hrefApuracao, rotulo: "Abrir apuração" }}
              />
              <KpiCard
                rotulo="Royalties"
                valor={brlOuTraco(mesAtual?.royalties)}
                estado={repasseApurado ? estadoValor : "nao-apurado"}
                nota="% sobre o recebido do cliente"
                abrir={{ href: hrefApuracao, rotulo: "Abrir apuração" }}
              />
              <KpiCard
                rotulo="CSC"
                valor={brlOuTraco(mesAtual?.csc)}
                estado={repasseApurado ? estadoValor : "nao-apurado"}
                nota="Fixo + percentual da base antiga"
                abrir={{ href: hrefApuracao, rotulo: "Abrir apuração" }}
              />
              <KpiCard
                rotulo="CAC"
                valor={brlOuTraco(mesAtual?.cac)}
                estado={repasseApurado ? estadoValor : "nao-apurado"}
                nota="Clientes vendidos pela matriz"
                abrir={{ href: hrefApuracao, rotulo: "Abrir apuração" }}
              />
              <KpiCard
                rotulo="Mídia"
                valor={brlOuTraco(mesAtual?.midia)}
                estado={repasseApurado ? estadoValor : "nao-apurado"}
                nota="Reembolso de tráfego pago"
                abrir={{ href: hrefApuracao, rotulo: "Abrir apuração" }}
              />
              <KpiCard
                rotulo="Take rate"
                valor={pctOuTraco(takeRate)}
                estado={takeRate == null ? "nao-apurado" : estadoValor}
                nota={
                  <NotaComAjuda
                    nota={
                      takeRate == null || !mesAtual
                        ? "sem mês fechado"
                        : `sobre ${brlOuTraco(mesAtual.receitaBaseConfirmada)} apurados`
                    }
                    ajuda="Royalties + CSC dividido pela receita apurada das unidades, só dos meses fechados. Os royalties e a receita apurada são por caixa; o CSC fixo entra pela competência. Nunca dividir por faturamento de competência do Omie, que é bruto e de outro regime. Mídia e CAC ficam de fora: são reembolso de custo, não remuneração da matriz."
                  />
                }
              />
            </KpiGrade>
            <ComoLer
              itens={[
                { rotulo: "Total do repasse", texto: `Soma do total da fatura de cada apuração do mês: royalties + CSC + CAC + mídia + outras receitas. A nota de débito que cobra isso sai com competência ${nomeMes} e costuma ser emitida no mês seguinte. O que já foi emitido e ainda não entrou está em "Faturado e não recebido".` },
                { rotulo: "Royalties", texto: `Percentual sobre o que o cliente pagou à unidade dentro de ${nomeMes}, por caixa e sobre o valor líquido de retenção. A competência da nota do cliente pode ser outro mês: fatura atrasada entra no mês em que foi paga, não no mês a que se refere.` },
                { rotulo: "CSC", texto: `Duas parcelas com réguas diferentes: o valor fixo é da competência ${nomeMes} e não depende de recebimento nenhum; o percentual da base antiga incide sobre o que os clientes antigos pagaram dentro do mês (caixa). Na Apuração de Royalties a coluna é "CSC (fixo ou base antiga)" e o total pode não bater com este (defeito de dado 4 do contrato).` },
                { rotulo: "CAC", texto: `Cobrança pelos clientes que a matriz vendeu, lançada na competência ${nomeMes}. Não é caixa: o gatilho é a fila do broker e o primeiro honorário do cliente, não o pagamento da unidade.` },
                { rotulo: "Mídia", texto: `Reembolso do tráfego pago da competência ${nomeMes}, valor acordado por unidade. Não é caixa e fica fora do take rate: é repasse de custo, não remuneração da matriz.` },
              ]}
            />

            {/* ---- o que trava o fechamento ---- */}
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">O que pede atenção</h3>
              <div className="grid gap-3 md:grid-cols-3">
                <CardPendencia
                  icone={<Timer className="size-4" />}
                  titulo="Apuração não fechada"
                  quantidade={pendencias.semFechar.length}
                  explicacao={`Unidade sem apuração aberta ou ainda em rascunho em ${nomeMes}. Enquanto não fecha, não vira fatura.`}
                  itens={pendencias.semFechar.map((u) => ({ nome: u.unidade }))}
                  destino={destinoApuracao}
                />
                <CardPendencia
                  icone={<FileWarning className="size-4" />}
                  titulo="Fechada sem fatura"
                  quantidade={pendencias.semFatura.length}
                  valor={pendencias.valorSemFatura}
                  explicacao={`O mês fechou e a nota de competência ${nomeMes} não foi emitida no Omie. É dinheiro apurado que ninguém cobrou.`}
                  base="O valor é o total do repasse apurado (royalties, CSC, CAC, mídia e outras)."
                  itens={pendencias.semFatura.map((u) => ({ nome: u.unidade }))}
                  destino={destinoApuracao}
                />
                {/* Aqui a data que resolve é a de vencimento do título na Partners,
                    não o mês da apuração: é ela que diz se já passou do prazo. */}
                <CardPendencia
                  icone={<AlertTriangle className="size-4" />}
                  titulo="Faturado e não recebido"
                  quantidade={pendencias.naoRecebidas.length}
                  valor={pendencias.valorNaoRecebido}
                  explicacao={
                    pendencias.atrasadas > 0
                      ? `${pendencias.atrasadas} título(s) já vencido(s) na conta da Partners. A data ao lado da unidade é o vencimento.`
                      : "Títulos emitidos que ainda não foram baixados no Omie. A data ao lado da unidade é o vencimento."
                  }
                  tom={pendencias.atrasadas > 0 ? "perigo" : "atencao"}
                  base="O valor é o da fatura emitida no Omie, que não inclui CSC fixo nem tráfego pago: não se soma com o card ao lado."
                  itens={pendencias.naoRecebidas.map((u) => ({
                    nome: u.unidade,
                    detalhe: rotuloDia(u.fatura?.recebimento?.vencimento ?? u.fatura?.vence_em),
                  }))}
                  destino={destinoApuracao}
                />
              </div>
            </div>

            {/* ---- apurado → faturado → recebido ---- */}
            <FunilRepasse unidades={data.unidadesDoMes} nomeMes={nomeMes} destino={destinoApuracao} />

            {/* ---- séries ---- */}
            <div className="grid gap-3 lg:grid-cols-2">
              <CartaoGrafico
                titulo="Do que o repasse é feito, mês a mês? (R$)"
                descricao="Royalties, CSC e outras pelo mês da apuração (caixa); CAC na competência da apuração. O CAC é reembolso de custo, não remuneração da matriz, e fica fora do take rate. Mídia não entra."
                acao={
                  <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
                    <Link to="/unidades/royalties" search={{ mes } as never}>
                      Ver detalhe
                    </Link>
                  </Button>
                }
              >
                <BarChart data={serieComposicao} margin={{ top: 4, right: 4, left: 4 }}>
                  <CartesianGrid {...gradeProps} />
                  <XAxis dataKey="mes" {...eixoProps} />
                  <YAxis tickFormatter={eixoMoeda} {...eixoProps} width={44} />
                  <Tooltip content={<TooltipMoeda />} cursor={tooltipProps.cursor} />
                  <Legend {...legendaProps} />
                  {/* stroke da cor da superfície = o respiro de 2px entre as
                      fatias empilhadas, que recharts não tem nativo. */}
                  <Bar
                    dataKey="royalties"
                    stackId="r"
                    name="Royalties"
                    fill={COR.royalties}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                  <Bar
                    dataKey="csc"
                    stackId="r"
                    name="CSC"
                    fill={COR.csc}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                  <Bar
                    dataKey="outras"
                    stackId="r"
                    name="Outras receitas"
                    fill={COR.outras}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                  <Bar
                    dataKey="cac"
                    stackId="r"
                    name="CAC"
                    fill={COR.cac}
                    stroke="var(--card)"
                    strokeWidth={2}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </CartaoGrafico>

              <CartaoGrafico
                titulo="Quanto de CAC a matriz cobrou das unidades? (R$)"
                descricao="Pelos clientes que a matriz vendeu, na competência de cada apuração. Varia com a fila do broker, não com o tamanho da carteira."
              >
                <BarChart data={serieCac} margin={{ top: 4, right: 4, left: 4 }}>
                  <CartesianGrid {...gradeProps} />
                  <XAxis dataKey="mes" {...eixoProps} />
                  <YAxis tickFormatter={eixoMoeda} {...eixoProps} width={44} />
                  <Tooltip content={<TooltipMoeda />} cursor={tooltipProps.cursor} />
                  <Bar dataKey="cac" name="CAC" fill={COR.unica} radius={[4, 4, 0, 0]} />
                </BarChart>
              </CartaoGrafico>
            </div>

            <CartaoGrafico
              titulo="Quanto da receita das unidades fica com a matriz? (take rate, %)"
              descricao="Royalties e receita apurada por caixa, CSC fixo por competência. Só meses com apuração fechada aparecem: mês aberto ainda não tem base apurada."
              altura={200}
            >
              <LineChart data={serieTake} margin={{ top: 4, right: 8, left: 4 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="mes" {...eixoProps} />
                <YAxis
                  tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                  {...eixoProps}
                  width={44}
                  // Zero na base porque a régua é contratual e a mensagem é a
                  // estabilidade; a folga no topo evita o ponto do último mês
                  // encostar na borda do cartão.
                  domain={[0, "dataMax + 3"]}
                />
                <Tooltip
                  {...tooltipProps}
                  cursor={{ stroke: "var(--border)" }}
                  formatter={(v: number) => [pctOuTraco(v), "Take rate"]}
                />
                <Line
                  type="monotone"
                  dataKey="take"
                  name="Take rate"
                  stroke={COR.unica}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                />
              </LineChart>
            </CartaoGrafico>
          </Secao>
        )}

        {/* ================= RECEITA DA REDE ================= */}
        {data && !data.podeReceita && (
          <EstadoSemAcesso oQueFalta="view.contas_receber ou view.funil_receita (receita da rede)" />
        )}
        {data?.podeReceita && (
          <Secao
            titulo="Quanto a rede faturou e recebeu na competência?"
            descricao={`fonte: Omie · competência de ${nomeMes} e bruto de nota · a mesma régua do Funil de Receita`}
            acoes={
              <SeloRegua regua="competência">
                Aqui o mês é o da competência do título no Omie: cada nota conta em {nomeMes} se é a
                esse mês que ela se refere, mesmo que tenha sido paga antes ou depois. É outra régua
                do bloco de repasse, que é caixa.
              </SeloRegua>
            }
          >
            <KpiGrade colunas={4}>
              <KpiCard
                rotulo="MRR contratado"
                valor={brlOuTraco(receitaDoMes?.mrrContratado)}
                estado={receitaApurada ? "ok" : "nao-apurado"}
                nota={receitaApurada ? "Contratos ativos hoje (Pipedrive)" : "sem títulos no mês"}
                abrir={{ href: hrefFunil, rotulo: "Abrir funil" }}
              />
              <KpiCard
                rotulo="Faturado"
                valor={brlOuTraco(receitaDoMes?.faturado)}
                estado={receitaApurada ? estadoValor : "nao-apurado"}
                nota={
                  receitaApurada
                    ? `Competência ${rotuloMesCurto(mes)}, bruto de nota`
                    : "sem títulos no mês"
                }
                abrir={{ href: hrefFunil, rotulo: "Abrir funil" }}
              />
              <KpiCard
                rotulo="Recebido"
                valor={brlOuTraco(receitaDoMes?.recebido)}
                estado={receitaApurada ? estadoValor : "nao-apurado"}
                nota={
                  !receitaApurada
                    ? "sem títulos no mês"
                    : receitaDoMes && receitaDoMes.faturado > 0
                      ? `${((receitaDoMes.recebido / receitaDoMes.faturado) * 100).toFixed(0)}% do faturado`
                      : "sem faturado na competência"
                }
                abrir={{ href: hrefFunil, rotulo: "Abrir funil" }}
              />
              <KpiCard
                rotulo="Em atraso"
                valor={brlOuTraco(receitaDoMes?.emAtraso)}
                estado={receitaApurada ? estadoValor : "nao-apurado"}
                tom={receitaDoMes && receitaDoMes.emAtraso > 0 ? "perigo" : undefined}
                tomRotulo={receitaDoMes && receitaDoMes.emAtraso > 0 ? "vencido" : undefined}
                nota={
                  <NotaComAjuda
                    nota={
                      receitaApurada
                        ? `A vencer: ${brlOuTraco(receitaDoMes?.aVencer)}`
                        : "sem títulos no mês"
                    }
                    ajuda={`Títulos de competência ${nomeMes} pelo status atual no Omie, que segue a data de vencimento. Para medir inadimplência, a régua é a safra de vencimento em Contas a Receber: a competência de título antigo no Omie é pouco confiável e joga vencido velho em mês recente.`}
                  />
                }
              />
            </KpiGrade>
            <ComoLer
              itens={[
                { rotulo: "MRR contratado", texto: "Soma dos contratos que estão ativos hoje no Pipedrive. É foto do momento, sem data de corte: não muda ao trocar o mês do seletor, e por isso não serve para comparar com o faturado de um mês passado." },
                { rotulo: "Faturado", texto: `Títulos cuja competência no Omie cai em ${nomeMes}, independentemente de quando foram emitidos ou pagos. Valor bruto de nota: antes de retenção de imposto, ao contrário da base de royalties, que é líquida.` },
                { rotulo: "Recebido", texto: `Quanto das notas de competência ${nomeMes} já foi baixado no Omie, em qualquer data de pagamento. Não é o caixa do mês: dinheiro que entrou em ${nomeMes} por nota de outra competência fica de fora daqui, e é justamente esse dinheiro, o que entrou no mês, que o bloco de repasse mede.` },
              ]}
            />

            <CartaoGrafico
              titulo="Quanto do faturado de cada competência já foi recebido? (R$)"
              descricao="Cada nota no mês da sua competência. A diferença entre as duas barras é o que a rede emitiu naquela competência e ainda não entrou. A barra de recebido conta o pagamento em qualquer data, não o caixa do mês."
              acao={
                <Button asChild variant="link" size="sm" className="h-auto shrink-0 p-0">
                  <Link
                    to={partesDoLink(hrefFunil).to as never}
                    search={partesDoLink(hrefFunil).search as never}
                  >
                    Ver o funil
                  </Link>
                </Button>
              }
            >
              <BarChart data={serieReceita} margin={{ top: 4, right: 4, left: 4 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="mes" {...eixoProps} />
                <YAxis tickFormatter={eixoMoeda} {...eixoProps} width={44} />
                <Tooltip content={<TooltipMoeda />} cursor={tooltipProps.cursor} />
                <Legend {...legendaProps} />
                <Bar dataKey="faturado" name="Faturado" fill={COR.faturado} radius={[4, 4, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill={COR.recebido} radius={[4, 4, 0, 0]} />
              </BarChart>
            </CartaoGrafico>
          </Secao>
        )}

        {/* ================= ATALHOS ================= */}
        {atalhos.length > 0 && (
          <Secao titulo="Para onde ir na área?">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {atalhos.map((item) => {
                const destino = partesDoLink(item.url);
                return (
                  <Link
                    key={item.url}
                    to={destino.to as never}
                    search={destino.search as never}
                    className="flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-input hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <item.icon className="size-4 shrink-0 text-primary-text" aria-hidden />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.title}</div>
                      <div className="truncate text-xs text-muted-foreground">{item.grupo}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </Secao>
        )}
      </div>
    </MolduraReceita>
  );
}
