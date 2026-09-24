import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
import { Secao, StatusBadge } from "@/components/planning";
import { formatarNumero } from "@/lib/cockpit-ceo/contrato";
import type { Frente } from "@/lib/cockpit-ceo/contrato";
import type { Empresa, LinhaFrescor, Motor } from "@/lib/cockpit-ceo/empresa";
import type { Ponte, PonteMes } from "@/lib/cockpit-ceo/financeiro";
import {
  EXIGENCIAS_INVESTIDOR,
  ORDEM_PILARES,
  PERGUNTAS,
  PILARES,
  situacaoDaPergunta,
} from "@/lib/cockpit-ceo/perguntas";
import { mesBr } from "@/lib/cockpit-ceo/receita";
import { trimestreDe } from "@/lib/cockpit-ceo/aquisicao";
import {
  CORES_SERIE,
  COR_NEGATIVO,
  COR_NEUTRA,
  eixoProps,
  gradeProps,
  legendaProps,
  linhaZeroProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { EstadoBadge, valorCurto } from "./estado";

// Painéis da empresa inteira no Cockpit do CEO. Só leitura do que `empresa.ts` montou: nenhum
// cálculo aqui além de arrumar séries para o gráfico. Cada painel diz a régua e o que não cobre.

const reais = (v: number | null) => formatarNumero(v, "reais");
const curto = (v: number | null) => valorCurto(v, "reais");
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(0)}%`);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dataHora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

/** Aviso de painel sem número: diz o motivo, nunca desenha zero. */
export function SemPainel({ texto }: { texto: string }) {
  return (
    <p className="rounded-xl border border-dashed bg-card px-4 py-6 text-sm text-muted-foreground">
      {texto}
    </p>
  );
}

function Numero({ rotulo, valor, nota }: { rotulo: string; valor: string; nota?: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card px-3 py-2">
      <p className="text-xs text-muted-foreground">{rotulo}</p>
      <p className="num text-sm font-semibold">{valor}</p>
      {nota && <p className="text-xs text-muted-foreground">{nota}</p>}
    </div>
  );
}

function Quadro({ children, altura = "h-64" }: { children: ReactNode; altura?: string }) {
  return <div className={`${altura} rounded-xl border bg-card p-4`}>{children}</div>;
}

// ── Motores ──────────────────────────────────────────────────────────────────

export function Motores({
  motores,
  irParaFrente,
}: {
  motores: Motor[];
  irParaFrente: (f: Frente) => void;
}) {
  return (
    <ul aria-label="Motores" className="divide-y rounded-xl border bg-card">
      {motores.map((m) => (
        <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="w-32 shrink-0">
            <EstadoBadge estado={m.estado} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {m.titulo}
              <span className="num ml-2 font-normal text-muted-foreground">
                {m.realizado}
                {m.referencia ? ` · ${m.referencia}` : ""}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">{m.nota}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => irParaFrente(m.frente)}>
            Abrir frente
            <ArrowRight className="size-4" aria-hidden />
          </Button>
        </li>
      ))}
    </ul>
  );
}

// ── Ponte ────────────────────────────────────────────────────────────────────

const MOVIMENTOS: { chave: keyof PonteMes; rotulo: string }[] = [
  { chave: "novos", rotulo: "Novos" },
  { chave: "retornos", rotulo: "Retornos" },
  { chave: "expansao", rotulo: "Expansão" },
  { chave: "contracao", rotulo: "Contração" },
  { chave: "semFaturamento", rotulo: "Sem faturamento" },
];

/** A ponte de um mês: cada barra é um movimento, com o sinal. Soma exata em `composicaoDaPonte`. */
export function PonteDoMes({ mes }: { mes: PonteMes }) {
  const dados = MOVIMENTOS.map((m) => {
    const mov = mes[m.chave] as { valor: number; clientes: number };
    return { rotulo: m.rotulo, valor: mov.valor, clientes: mov.clientes };
  });
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Numero
          rotulo={`Faturamento de ${mesBr(mesAnteriorDe(mes.mes))}`}
          valor={reais(mes.anterior)}
        />
        <Numero
          rotulo="Variação"
          valor={`${mes.atual - mes.anterior >= 0 ? "+" : "−"}${reais(Math.abs(mes.atual - mes.anterior))}`}
          nota={
            mes.semCliente ? `inclui ${reais(mes.semCliente)} sem cliente identificado` : undefined
          }
        />
        <Numero rotulo={`Faturamento de ${mesBr(mes.mes)}`} valor={reais(mes.atual)} />
      </div>
      <Quadro altura="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" {...eixoProps} tickFormatter={(v: number) => curto(v)} />
            <YAxis type="category" dataKey="rotulo" width={112} {...eixoProps} />
            <ReferenceLine x={0} {...linhaZeroProps} />
            <Tooltip
              {...tooltipProps}
              formatter={(v, _n, p) => [
                `${reais(Number(v))} · ${plural(p?.payload?.clientes ?? 0, "cliente", "clientes")}`,
                "Movimento",
              ]}
            />
            <Bar isAnimationActive={false} dataKey="valor" name="Movimento">
              {dados.map((d) => (
                <Cell key={d.rotulo} fill={d.valor < 0 ? COR_NEGATIVO : CORES_SERIE[0]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Quadro>
    </div>
  );
}

const mesAnteriorDe = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

/** A ponte mês a mês: o que entrou (acima de zero) e o que saiu (abaixo). */
export function PonteMensal({ ponte }: { ponte: Ponte }) {
  const dados = ponte.meses.map((m) => ({
    rotulo: mesBr(m.mes),
    entradas: m.novos.valor + m.retornos.valor,
    expansao: m.expansao.valor,
    contracao: m.contracao.valor,
    saidas: m.semFaturamento.valor,
    fecha: m.fecha,
  }));
  return (
    <Quadro>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} stackOffset="sign" margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid {...gradeProps} />
          <XAxis dataKey="rotulo" {...eixoProps} />
          <YAxis {...eixoProps} width={76} tickFormatter={(v: number) => curto(v)} />
          <ReferenceLine y={0} {...linhaZeroProps} />
          <Tooltip {...tooltipProps} formatter={(v, n) => [reais(Number(v)), n]} />
          <Legend {...legendaProps} />
          <Bar
            isAnimationActive={false}
            stackId="p"
            dataKey="entradas"
            name="Novos e retornos"
            fill={CORES_SERIE[0]}
          />
          <Bar
            isAnimationActive={false}
            stackId="p"
            dataKey="expansao"
            name="Expansão"
            fill={CORES_SERIE[1]}
          />
          <Bar
            isAnimationActive={false}
            stackId="p"
            dataKey="contracao"
            name="Contração"
            fill={CORES_SERIE[3]}
          />
          <Bar
            isAnimationActive={false}
            stackId="p"
            dataKey="saidas"
            name="Sem faturamento"
            fill={COR_NEGATIVO}
          />
        </BarChart>
      </ResponsiveContainer>
    </Quadro>
  );
}

// ── Aquisição ────────────────────────────────────────────────────────────────

export function AquisicaoPainel({ empresa }: { empresa: Empresa }) {
  const a = empresa.aquisicao;
  if (!a)
    return <SemPainel texto={empresa.aquisicaoAviso ?? "Dados de aquisição não carregados."} />;
  const dados = a.meses.map((m) => ({
    rotulo: mesBr(m.mes) + (m.emAndamento ? "*" : ""),
    mrr: m.mrrNovo,
    plano: m.plano?.mrrNovo ?? null,
  }));
  const ultimo = [...a.meses].reverse().find((m) => !m.emAndamento) ?? null;
  const fc = a.forecast;
  return (
    <div className="space-y-4">
      <Quadro>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={dados} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="rotulo" {...eixoProps} />
            <YAxis {...eixoProps} width={76} tickFormatter={(v: number) => curto(v)} />
            <Tooltip
              {...tooltipProps}
              formatter={(v, n) => [v === null ? "sem plano" : reais(Number(v)), n]}
            />
            <Legend {...legendaProps} />
            <Bar
              isAnimationActive={false}
              dataKey="mrr"
              name="MRR novo vendido"
              fill={CORES_SERIE[0]}
            />
            <Line
              isAnimationActive={false}
              dataKey="plano"
              name="Plano do Growth"
              stroke={COR_NEUTRA}
              strokeDasharray="4 4"
              dot={false}
              connectNulls={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </Quadro>
      <p className="text-xs text-muted-foreground">
        * mês em andamento. Plano cadastrado pelo Growth desde jun/2026; mês sem plano fica sem
        linha.
      </p>
      {ultimo && (
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Numero
            rotulo={`Investimento em mídia · ${mesBr(ultimo.mes)}`}
            valor={reais(ultimo.investimento)}
            nota={
              ultimo.plano?.investimento != null
                ? `plano ${curto(ultimo.plano.investimento)}`
                : undefined
            }
          />
          <Numero rotulo="Leads" valor={formatarNumero(ultimo.leads, "eventos")} />
          <Numero
            rotulo="MQL"
            valor={formatarNumero(ultimo.mql, "eventos")}
            nota={ultimo.plano?.mql != null ? `plano ${ultimo.plano.mql}` : undefined}
          />
          <Numero
            rotulo="Vendas"
            valor={formatarNumero(ultimo.vendas, "negócios")}
            nota={ultimo.plano?.vendas != null ? `plano ${ultimo.plano.vendas}` : undefined}
          />
          <Numero
            rotulo="Custo de mídia por venda"
            valor={reais(ultimo.custoMidiaPorVenda)}
            nota="só mídia paga, não é o CAC completo"
          />
        </div>
      )}
      {fc && (
        <ul aria-label="Forecast do mês" className="divide-y rounded-xl border bg-card">
          <LinhaSimples
            titulo={`Realizado em ${mesBr(fc.mes)} até hoje`}
            valor={reais(fc.realizado)}
            nota={
              fc.vendasRealizadas !== null
                ? plural(fc.vendasRealizadas, "venda", "vendas")
                : undefined
            }
          />
          <LinhaSimples
            titulo="Meta do mês (Growth)"
            valor={reais(fc.meta)}
            nota={fc.vendasMeta !== null ? `${fc.vendasMeta} vendas` : undefined}
          />
          <LinhaSimples
            titulo="Forecast pelo ritmo (modelo do Growth)"
            valor={reais(fc.porRitmo)}
            nota="ritmo de dias úteis"
          />
          <LinhaSimples
            titulo="Forecast pelo pipeline (modelo do Growth)"
            valor={reais(fc.porPipeline)}
            nota={fc.winRate !== null ? `win rate ${pct(fc.winRate)}` : undefined}
          />
        </ul>
      )}
    </div>
  );
}

function LinhaSimples({ titulo, valor, nota }: { titulo: string; valor: string; nota?: string }) {
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="text-sm">{titulo}</span>
      <span className="num text-sm font-semibold">
        {valor}
        {nota && <span className="ml-2 font-normal text-muted-foreground">{nota}</span>}
      </span>
    </li>
  );
}

export function PipelinePainel({ empresa }: { empresa: Empresa }) {
  const p = empresa.aquisicao?.pipeline;
  if (!p) return <SemPainel texto={empresa.aquisicaoAviso ?? "Pipeline não carregado."} />;
  const dados = p.porMes
    .slice(0, 6)
    .map((m) => ({ rotulo: mesBr(m.mes), mrr: m.mrr, negocios: m.negocios }));
  return (
    <div className="space-y-2">
      <Quadro altura="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dados} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="rotulo" {...eixoProps} />
            <YAxis {...eixoProps} width={76} tickFormatter={(v: number) => curto(v)} />
            <Tooltip
              {...tooltipProps}
              formatter={(v, _n, x) => [
                `${reais(Number(v))} · ${plural(x?.payload?.negocios ?? 0, "negócio", "negócios")}`,
                "MRR em aberto",
              ]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="mrr"
              name="MRR em aberto"
              fill={CORES_SERIE[1]}
            />
          </BarChart>
        </ResponsiveContainer>
      </Quadro>
      <p className="text-sm text-muted-foreground">
        {plural(p.negocios, "negócio aberto", "negócios abertos")} no Inside Sales, {reais(p.mrr)}{" "}
        de MRR sem ponderação (nenhuma fonte tem probabilidade por etapa). Sem data de fechamento:{" "}
        {plural(p.semData.negocios, "negócio", "negócios")} ({reais(p.semData.mrr)}). Com data já
        vencida: {plural(p.vencidos.negocios, "negócio", "negócios")} ({reais(p.vencidos.mrr)}).
      </p>
    </div>
  );
}

// ── Unidades ─────────────────────────────────────────────────────────────────

export function MetasUnidade({ empresa, hoje }: { empresa: Empresa; hoje: string }) {
  const a = empresa.aquisicao;
  if (!a)
    return <SemPainel texto={empresa.aquisicaoAviso ?? "Metas por unidade não carregadas."} />;
  const tri = trimestreDe(hoje);
  const doTri = a.unidades.filter((u) => u.trimestre === tri);
  if (!doTri.length)
    return (
      <SemPainel
        texto={
          empresa.unidadesLidas
            ? `Sem meta por unidade cadastrada para ${tri.replace("-T", " T")}.`
            : "A meta por unidade tem leitura restrita à diretoria comercial do Growth: sua conta não lê a tabela."
        }
      />
    );
  const dados = doTri.map((u) => ({ rotulo: u.unidade, meta: u.meta, vendido: u.vendido }));
  return (
    <Quadro altura="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid {...gradeProps} horizontal={false} vertical />
          <XAxis type="number" {...eixoProps} tickFormatter={(v: number) => curto(v)} />
          <YAxis type="category" dataKey="rotulo" width={120} {...eixoProps} />
          <Tooltip {...tooltipProps} formatter={(v, n) => [reais(Number(v)), n]} />
          <Legend {...legendaProps} />
          <Bar
            isAnimationActive={false}
            dataKey="vendido"
            name={`Vendido ${tri.replace("-T", " T")}`}
            fill={CORES_SERIE[0]}
          />
          <Bar
            isAnimationActive={false}
            dataKey="meta"
            name="Meta do trimestre"
            fill={COR_NEUTRA}
          />
        </BarChart>
      </ResponsiveContainer>
    </Quadro>
  );
}

// ── Caixa e margem ───────────────────────────────────────────────────────────

export function CaixaPainel({ empresa }: { empresa: Empresa }) {
  const cx = empresa.caixa;
  if (!cx) return <SemPainel texto={empresa.caixaAviso ?? "Caixa e margem não carregados."} />;
  const er = cx.emitidoRecebido;
  const dados = (er?.meses ?? []).map((m) => ({
    rotulo: mesBr(m.mes),
    emitido: m.emitido,
    recebido: m.leitura === "sem_foto" ? null : m.recebido,
    leitura: m.leitura,
  }));
  const semFoto = (er?.meses ?? [])
    .filter((m) => m.leitura === "sem_foto")
    .map((m) => mesBr(m.mes));
  const piso = (er?.meses ?? []).filter((m) => m.leitura === "piso").map((m) => mesBr(m.mes));
  const ina = cx.inadimplencia;
  const caixa = cx.indicadores?.caixa;
  return (
    <div className="space-y-4">
      {cx.avisos.map((a) => (
        <SemPainel key={a} texto={a} />
      ))}
      <div className="grid gap-2 sm:grid-cols-3">
        <Numero
          rotulo={
            caixa?.mesReferencia
              ? `Caixa livre no fim de ${mesBr(caixa.mesReferencia)}`
              : "Caixa livre"
          }
          valor={caixa ? reais(caixa.valor) : "—"}
          nota={
            caixa?.empresasSemSaldo.length
              ? `sem saldo: ${caixa.empresasSemSaldo.join(", ")}`
              : "saldo bancário (régua da Controladoria)"
          }
        />
        <Numero
          rotulo="Em aberto a receber (ao vivo)"
          valor={ina ? reais(ina.emAberto) : "—"}
          nota={ina ? `sincronizado ${dataHora(ina.sincronizadoEm)}` : undefined}
        />
        <Numero
          rotulo="Vencido e não recebido"
          valor={ina ? reais(ina.atrasado) : "—"}
          nota={ina ? plural(ina.titulosAtrasados, "título", "títulos") : undefined}
        />
      </div>
      {er && (
        <>
          <Quadro>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dados} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="rotulo" {...eixoProps} />
                <YAxis {...eixoProps} width={76} tickFormatter={(v: number) => curto(v)} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(v, n) => [v === null ? "sem foto de títulos" : reais(Number(v)), n]}
                />
                <Legend {...legendaProps} />
                <Bar
                  isAnimationActive={false}
                  dataKey="emitido"
                  name="Emitido"
                  fill={CORES_SERIE[1]}
                />
                <Bar
                  isAnimationActive={false}
                  dataKey="recebido"
                  name="Recebido até a foto"
                  fill={CORES_SERIE[0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </Quadro>
          <p className="text-xs text-muted-foreground">
            Recebido por mês de emissão, acumulado até a foto de títulos de{" "}
            {er.foto ? mesBr(er.foto) : "data desconhecida"}.
            {piso.length
              ? ` ${piso.join(", ")}: a foto cobre só parte do mês, o não recebido é piso.`
              : ""}
            {semFoto.length ? ` ${semFoto.join(", ")}: sem foto, recebido não medido.` : ""}
          </p>
        </>
      )}
      {ina && ina.faixas.length > 0 && (
        <Quadro altura="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={ina.faixas}
              layout="vertical"
              margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
            >
              <CartesianGrid {...gradeProps} horizontal={false} vertical />
              <XAxis type="number" {...eixoProps} tickFormatter={(v: number) => curto(v)} />
              <YAxis type="category" dataKey="faixa" width={112} {...eixoProps} />
              <Tooltip
                {...tooltipProps}
                formatter={(v, _n, x) => [
                  `${reais(Number(v))} · ${plural(x?.payload?.titulos ?? 0, "título", "títulos")}`,
                  "Vencido",
                ]}
              />
              <Bar isAnimationActive={false} dataKey="valor" name="Vencido" fill={COR_NEGATIVO} />
            </BarChart>
          </ResponsiveContainer>
        </Quadro>
      )}
    </div>
  );
}

export function MargemPainel({ empresa }: { empresa: Empresa }) {
  const ind = empresa.caixa?.indicadores;
  if (!ind)
    return <SemPainel texto={empresa.caixaAviso ?? "Indicadores do Financeiro não carregados."} />;
  const dados = ind.porGrupo.map((g) => ({
    rotulo: g.grupo,
    receita: g.receitaBruta,
    lucro: g.lucroBruto,
    margem: g.receitaBruta ? g.lucroBruto / g.receitaBruta : null,
  }));
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Numero
          rotulo="Receita bruta no ano"
          valor={reais(ind.receitaBruta)}
          nota={ind.de && ind.ate ? `${mesBr(ind.de)} a ${mesBr(ind.ate)}` : undefined}
        />
        <Numero rotulo="Lucro bruto (margem de contribuição)" valor={reais(ind.lucroBruto)} />
        <Numero
          rotulo="Margem bruta"
          valor={pct(ind.margem)}
          nota="sobre a receita bruta (régua da Controladoria)"
        />
      </div>
      <Quadro altura="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" {...eixoProps} tickFormatter={(v: number) => curto(v)} />
            <YAxis type="category" dataKey="rotulo" width={112} {...eixoProps} />
            <Tooltip
              {...tooltipProps}
              formatter={(v, n, x) => [
                n === "Lucro bruto"
                  ? `${reais(Number(v))} · margem ${pct(x?.payload?.margem ?? null)}`
                  : reais(Number(v)),
                n,
              ]}
            />
            <Legend {...legendaProps} />
            <Bar
              isAnimationActive={false}
              dataKey="receita"
              name="Receita bruta"
              fill={CORES_SERIE[1]}
            />
            <Bar
              isAnimationActive={false}
              dataKey="lucro"
              name="Lucro bruto"
              fill={CORES_SERIE[0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </Quadro>
      <p className="text-xs text-muted-foreground">
        Por grupo de apuração do Financeiro (entidades faturadoras), meses fechados do ano. Não é
        receita por produto nem por vertical: a receita não é classificada assim na fonte.
      </p>
    </div>
  );
}

// ── Operação e cadeia ────────────────────────────────────────────────────────

export function OnboardingPainel({ empresa }: { empresa: Empresa }) {
  const o = empresa.onboarding;
  if (!o)
    return <SemPainel texto={empresa.onboardingAviso ?? "Fila de onboarding não carregada."} />;
  const dados = o.fases
    .filter((f) => f.fase !== "Concluído" && f.fase !== "Churn no Onboarding")
    .map((f) => ({
      rotulo: f.fase,
      recentes: f.cards - f.acima30,
      acima30: f.acima30 - f.acima60,
      acima60: f.acima60,
    }));
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Numero
          rotulo="Em onboarding"
          valor={String(o.emCurso)}
          nota={o.desde ? `pipe desde ${o.desde.split("-").reverse().join("/")}` : undefined}
        />
        <Numero
          rotulo="Concluídos"
          valor={String(o.concluidos)}
          nota={`${o.concluidosNoPeriodo} neste mês`}
        />
        <Numero rotulo="Churn no onboarding" valor={String(o.churnNoOnboarding)} />
        <Numero
          rotulo="Do ganho à conclusão (mediana)"
          valor={
            o.ganhoAteConclusao.mediana === null
              ? "—"
              : `${Math.round(o.ganhoAteConclusao.mediana)} dias`
          }
          nota={`${plural(o.ganhoAteConclusao.casos, "caso ligado", "casos ligados")} ao contrato; inclui a espera antes do pipe`}
        />
        <Numero
          rotulo="Do card à conclusão (mediana)"
          valor={
            o.criacaoAteConclusao.mediana === null
              ? "—"
              : `${Math.round(o.criacaoAteConclusao.mediana)} dias`
          }
          nota={plural(
            o.criacaoAteConclusao.casos,
            "onboarding concluído",
            "onboardings concluídos",
          )}
        />
      </div>
      <Quadro>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dados}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" allowDecimals={false} {...eixoProps} />
            <YAxis type="category" dataKey="rotulo" width={140} {...eixoProps} />
            <Tooltip {...tooltipProps} />
            <Legend {...legendaProps} />
            <Bar
              isAnimationActive={false}
              stackId="o"
              dataKey="recentes"
              name="Até 30 dias na fase"
              fill={CORES_SERIE[0]}
            />
            <Bar
              isAnimationActive={false}
              stackId="o"
              dataKey="acima30"
              name="31 a 60 dias"
              fill={CORES_SERIE[3]}
            />
            <Bar
              isAnimationActive={false}
              stackId="o"
              dataKey="acima60"
              name="Mais de 60 dias"
              fill={COR_NEGATIVO}
            />
          </BarChart>
        </ResponsiveContainer>
      </Quadro>
      <p className="text-xs text-muted-foreground">
        Faixas de leitura, não SLA: nenhum prazo de onboarding foi decidido. {o.semEmpresa} cards
        sem empresa vinculada ficam fora do tempo até a conclusão.
      </p>
    </div>
  );
}

export function CadeiaPainel({ empresa }: { empresa: Empresa }) {
  const c = empresa.cadeia;
  if (!c) return <SemPainel texto={empresa.cadeiaAviso ?? "Cadeia não carregada."} />;
  const elos = [
    { rotulo: "Contratos ganhos", valor: c.vendas },
    { rotulo: "Onboarding iniciado", valor: c.ativacaoIniciada },
    { rotulo: "Onboarding concluído", valor: c.ativacaoConcluida },
    { rotulo: "Faturado no Financeiro", valor: c.faturadas },
    { rotulo: "Saída registrada", valor: c.saidas },
  ];
  return (
    <div className="space-y-3">
      <Quadro altura="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={elos}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 8, bottom: 0 }}
          >
            <CartesianGrid {...gradeProps} horizontal={false} vertical />
            <XAxis type="number" allowDecimals={false} {...eixoProps} />
            <YAxis type="category" dataKey="rotulo" width={150} {...eixoProps} />
            <Tooltip
              {...tooltipProps}
              formatter={(v) => [v === null ? "elo não lido" : String(v), "Contratos da safra"]}
            />
            <Bar isAnimationActive={false} dataKey="valor" name="Contratos da safra">
              {elos.map((e, i) => (
                <Cell key={e.rotulo} fill={i === 4 ? COR_NEGATIVO : CORES_SERIE[i === 3 ? 1 : 0]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Quadro>
      <ul aria-label="O que não liga" className="divide-y rounded-xl border bg-card text-sm">
        <LinhaSimples
          titulo="Safra"
          valor={
            c.safra.de && c.safra.ate
              ? `${c.safra.de.split("-").reverse().join("/")} a ${c.safra.ate.split("-").reverse().join("/")}`
              : "—"
          }
          nota="ganhos no Inside Sales desde o início do pipe de Onboarding"
        />
        <LinhaSimples
          titulo="Sem empresa vinculada (não liga ao onboarding)"
          valor={String(c.semEmpresa)}
        />
        <LinhaSimples
          titulo="Sem CNPJ no contrato (não liga ao faturamento)"
          valor={String(c.semCnpj)}
        />
        <LinhaSimples
          titulo="CNPJ fora do cadastro de contrapartes do Omie"
          valor={c.semContraparte === null ? "—" : String(c.semContraparte)}
        />
        <LinhaSimples
          titulo="Nome ambíguo no cadastro (não conta como faturado)"
          valor={c.faturamentoAmbiguo === null ? "—" : String(c.faturamentoAmbiguo)}
        />
        <LinhaSimples
          titulo="Recebimento por cliente"
          valor="não lido"
          nota="só agregado mensal, em Caixa e margem"
        />
      </ul>
      {empresa.cadeiaFaturamentoAviso && (
        <SemPainel texto={`Elo do faturamento sem leitura: ${empresa.cadeiaFaturamentoAviso}`} />
      )}
    </div>
  );
}

// ── Governança: frescor e pilares ────────────────────────────────────────────

export function FrescorPainel({ frescor }: { frescor: LinhaFrescor[] }) {
  return (
    <ul aria-label="Frescor das fontes" className="divide-y rounded-xl border bg-card">
      {frescor.map((f) => (
        <li key={f.fonte} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
          <div className="w-32 shrink-0">
            <StatusBadge
              tom={f.estado === "em_dia" ? "sucesso" : f.estado === "parada" ? "perigo" : "neutro"}
            >
              {f.estado === "em_dia" ? "Em dia" : f.estado === "parada" ? "Parada" : "Sem data"}
            </StatusBadge>
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{f.fonte}</p>
            <p className="text-sm text-muted-foreground">
              Última carga {dataHora(f.atualizadoEm)}
              {f.cobreAte ? ` · dado até ${f.cobreAte.split("-").reverse().join("/")}` : ""} ·{" "}
              {f.nota}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}

const SITUACAO: Record<ReturnType<typeof situacaoDaPergunta>, string> = {
  respondida: "respondida",
  parcial: "parcial",
  lacuna: "lacuna",
};

export function PilaresPainel() {
  return (
    <div className="space-y-4">
      <ul aria-label="Pilares" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {ORDEM_PILARES.map((p) => {
          const perg = PERGUNTAS.filter((q) => q.pilar === p);
          const apoio = PERGUNTAS.filter((q) => q.apoios.includes(p)).length;
          const cont = (s: string) =>
            perg.filter((q) => SITUACAO[situacaoDaPergunta(q)] === s).length;
          return (
            <li key={p} className="rounded-xl border bg-card p-4">
              <p className="text-xs text-muted-foreground">Pilar {PILARES[p].n}</p>
              <p className="font-semibold">{PILARES[p].titulo}</p>
              <p className="num mt-1 text-sm text-muted-foreground">
                {cont("respondida")} respondidas · {cont("parcial")} parciais · {cont("lacuna")}{" "}
                lacunas
                {apoio ? ` · apoia ${apoio}` : ""}
              </p>
              <p className="text-xs text-muted-foreground">Dono proposto: {PILARES[p].dono}</p>
            </li>
          );
        })}
      </ul>
      <ul
        aria-label="Exigências do mapa de investidores"
        className="divide-y rounded-xl border bg-card"
      >
        {EXIGENCIAS_INVESTIDOR.map((e) => {
          const q = PERGUNTAS.find((x) => x.exigencia === e.id);
          const s = q ? situacaoDaPergunta(q) : "lacuna";
          return (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
              <div className="w-24 shrink-0">
                <StatusBadge
                  tom={s === "respondida" ? "sucesso" : s === "parcial" ? "atencao" : "neutro"}
                >
                  {SITUACAO[s]}
                </StatusBadge>
              </div>
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">
                  {e.id}. {e.titulo}
                </span>
                {q && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {q.id}: {q.pendencia ?? q.resposta}
                  </span>
                )}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
