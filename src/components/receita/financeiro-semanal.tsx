import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  StatusBadge,
  type TomStatus,
} from "@/components/planning";
import { eixoProps, tooltipProps } from "@/lib/planning/grafico";
import { cn } from "@/lib/utils";
import { MolduraReceita } from "@/components/receita/moldura";
import {
  carregarReporteCeo,
  type ReporteCeo,
  type SituacaoTitulo,
} from "@/lib/reporte-ceo.functions";

// Financeiro semanal da Partners: a mesma página do artifact "Financeiro Planning Partners"
// (claude.ai), agora lendo `ops.reporte_ceo` direto. As regras de texto são do usuário: só
// afirmação, sem ressalva, e valor visível em todas as barras.

const brl = (v: number, sinal = false) => {
  const t = "R$ " + Math.round(Math.abs(v)).toLocaleString("pt-BR");
  return sinal ? (v >= 0 ? "+" : "-") + t : (v < 0 ? "-" : "") + t;
};
const mil = (v: number) =>
  Math.abs(v) < 1
    ? ""
    : `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(v) < 10000 ? 1 : 0 })} mil`;

type Farol = "ok" | "warn" | "bad";
const FAROL: Record<Farol, { tom: TomStatus; rotulo: string }> = {
  ok: { tom: "sucesso", rotulo: "Em dia" },
  warn: { tom: "atencao", rotulo: "Atenção" },
  bad: { tom: "perigo", rotulo: "Crítico" },
};

const SIT_ROT: Record<SituacaoTitulo, string> = {
  atrasado: "Atrasado",
  em_dia: "Em dia",
  pago: "Pago",
};
const SIT_COR: Record<SituacaoTitulo, string> = {
  atrasado: "bg-danger",
  em_dia: "bg-chart-1",
  pago: "bg-chart-3",
};
const SITUACOES: SituacaoTitulo[] = ["atrasado", "em_dia", "pago"];

export function FinanceiroSemanal() {
  const fn = useServerFn(carregarReporteCeo);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["financeiro-semanal"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
    // A função grava às 12h e às 18h; quem deixa a aba aberta recebe a rodada nova sem recarregar.
    refetchInterval: 15 * 60_000,
  });

  return (
    <MolduraReceita
      titulo="Financeiro semanal"
      pergunta="O caixa da Partners paga a semana e o mês?"
      descricao="Caixa pelo extrato de conta corrente. Despesas e recebíveis pelos títulos do Omie da Planning Partners, cortados pela data de vencimento."
      procedencia={
        data
          ? {
              fonte: "Omie da Planning Partners · atualiza às 12h e às 18h",
              atualizadoEm: data.gravadoEm,
            }
          : undefined
      }
    >
      <div className="mx-auto flex max-w-[860px] flex-col gap-5 p-4 md:p-6">
        {isLoading ? (
          <Carregando variante="pagina" />
        ) : error ? (
          <EstadoErro detalhe={(error as Error).message} tentarNovamente={() => refetch()} />
        ) : !data ? (
          <EstadoVazio
            titulo="O reporte ainda não rodou"
            descricao="A Edge Function reporte-ceo grava o primeiro retrato na próxima rodada (12h ou 18h)."
          />
        ) : (
          <Conteudo D={data.payload} />
        )}
      </div>
    </MolduraReceita>
  );
}

function Pergunta({
  n,
  titulo,
  farol,
  children,
}: {
  n?: number;
  titulo: string;
  farol?: Farol;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {n !== undefined && (
            <span className="mr-2 font-normal text-muted-foreground tabular-nums">{n}</span>
          )}
          {titulo}
        </h2>
        {farol && <StatusBadge tom={FAROL[farol].tom}>{FAROL[farol].rotulo}</StatusBadge>}
      </div>
      {children}
    </Card>
  );
}

function Linha({ rotulo, valor, forte }: { rotulo: string; valor: number; forte?: boolean }) {
  return (
    <div className="flex justify-between gap-3 border-t py-2 text-sm first:border-t-0">
      <span className={forte ? "font-semibold text-foreground" : "text-muted-foreground"}>
        {rotulo}
      </span>
      <span className={cn("whitespace-nowrap tabular-nums", forte && "font-semibold")}>
        {brl(valor)}
      </span>
    </div>
  );
}

function Trilho({ partes, escala }: { partes: { valor: number; cor: string }[]; escala: number }) {
  return (
    <div className="flex h-3.5 overflow-hidden rounded-sm bg-muted">
      {partes.map((p, i) => (
        <i
          key={i}
          className={cn("block h-full", p.cor)}
          style={{ width: `${(100 * p.valor) / (escala || 1)}%` }}
        />
      ))}
    </div>
  );
}

function Legenda({ itens }: { itens: { cor: string; rotulo: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((it) => (
        <span key={it.rotulo} className="inline-flex items-center gap-1.5">
          <b className={cn("inline-block size-2.5 rounded-[2px]", it.cor)} />
          {it.rotulo}
        </span>
      ))}
    </div>
  );
}

function Tabela({
  cab,
  linhas,
  total,
  esquerda = 1,
}: {
  cab: string[];
  linhas: ReactNode[][];
  total?: ReactNode[];
  /** Quantas colunas do começo ficam à esquerda; as de valor vão à direita. */
  esquerda?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {cab.map((c, i) => (
              <th
                key={c}
                className={cn(
                  "border-b py-1.5 pr-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                  i < esquerda ? "text-left" : "pr-0 text-right",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[...linhas, ...(total ? [total] : [])].map((l, j) => (
            <tr key={j} className={cn(total && j === linhas.length && "font-semibold")}>
              {l.map((c, i) => (
                <td
                  key={i}
                  className={cn(
                    "border-b py-1.5 pr-2 align-top",
                    i >= esquerda && "whitespace-nowrap pr-0 text-right tabular-nums",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Nota({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-r-md border-l-[3px] border-primary bg-muted/50 px-3.5 py-2.5 text-sm">
      {children}
    </div>
  );
}

function Barras({
  rotulos,
  valores,
  rotulo,
}: {
  rotulos: string[];
  valores: number[];
  rotulo: string;
}) {
  const dados = rotulos.map((r, i) => ({ r, v: valores[i] }));
  return (
    <div className="h-[240px] w-full" role="img" aria-label={rotulo}>
      <ResponsiveContainer>
        <BarChart data={dados} margin={{ top: 22, right: 4, bottom: 4, left: 4 }}>
          <XAxis dataKey="r" {...eixoProps} />
          <Tooltip
            {...tooltipProps}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            formatter={(v: number) => [brl(v), ""]}
            separator=""
          />
          <Bar dataKey="v" maxBarSize={44} radius={3} isAnimationActive={false}>
            {dados.map((d) => (
              <Cell key={d.r} fill={d.v >= 0 ? "var(--chart-1)" : "var(--danger)"} />
            ))}
            <LabelList
              dataKey="v"
              position="top"
              className="fill-foreground text-[12px] tabular-nums"
              formatter={(v: number) => mil(v)}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function Conteudo({ D }: { D: ReporteCeo }) {
  const c = D.caixa;
  const p = D.pagar;
  const w0 = D.semanas[0];
  const ultSemana = D.semanas[D.semanas.length - 1];
  const sobra = c.total + w0.rec - w0.pag;
  const sobraFinal = sobra - p.vencido;
  const f1: Farol = sobraFinal >= 0 ? "ok" : sobra >= 0 ? "warn" : "bad";
  let acc = c.total;
  const saldos = D.semanas.map((w) => ({ ...w, saldo: (acc += w.rec - w.pag) }));
  const fim2 = acc;
  const f2: Farol = fim2 - p.vencido >= 0 ? "ok" : fim2 >= 0 ? "warn" : "bad";
  const v = D.vencido;
  const f3: Farol = v.pct < 0.1 ? "ok" : v.pct < 0.25 ? "warn" : "bad";
  const somaE = (k: keyof ReporteCeo["evolucao"][number]) =>
    D.evolucao.reduce((a, m) => a + (m[k] as number), 0);
  const ultEvo = D.evolucao[D.evolucao.length - 1];
  const evoAp = D.evolucao.filter((m) => m.saldo_aplic || m.aplicado || m.resgatado);
  const semRend = evoAp.filter((m) => m.saldo_aplic > 0 && m.rendimento < 1);
  const aportes = D.evolucao
    .filter((m) => m.aporte >= 1)
    .map((m) => `${m.mes} ${brl(m.aporte)}`)
    .join(", ");
  const posFat = D.evolucao.filter((m) => m.resultado_fat >= 0).length;
  const positivos = D.evolucao.filter((m) => m.operacional >= 0).length;
  const escala = Math.max(c.total + w0.rec, w0.pag + p.vencido);
  const meses = Object.entries(D.meses);

  return (
    <>
      <p className="text-sm text-muted-foreground">Semana de {D.hoje}</p>

      <Pergunta n={1} titulo={`Esta semana: ${w0.ini} a ${w0.fim}`} farol={f1}>
        <p className="text-base">
          {sobra >= 0 ? (
            <>
              O caixa de hoje mais o que entra na semana pagam os custos da semana e sobram{" "}
              <strong>{brl(sobra)}</strong>.
            </>
          ) : (
            <>
              O caixa de hoje mais o que entra na semana não pagam os custos da semana: faltam{" "}
              <strong>{brl(-sobra)}</strong>.
            </>
          )}{" "}
          {sobraFinal >= 0 ? (
            <>
              Pagando também as despesas atrasadas, sobram <strong>{brl(sobraFinal)}</strong>.
            </>
          ) : (
            <>
              Pagando também as despesas atrasadas, faltam <strong>{brl(-sobraFinal)}</strong>.
            </>
          )}
        </p>
        <div className="grid grid-cols-1 items-center gap-x-3 gap-y-1 text-sm sm:grid-cols-[110px_1fr] sm:gap-y-2">
          <span>Disponível</span>
          <Trilho
            escala={escala}
            partes={[
              { valor: c.conta, cor: "bg-chart-1" },
              { valor: c.aplic, cor: "bg-chart-3" },
              { valor: w0.rec, cor: "bg-success" },
            ]}
          />
          <span>A pagar</span>
          <Trilho
            escala={escala}
            partes={[
              { valor: w0.pag, cor: "bg-warning" },
              { valor: p.vencido, cor: "bg-danger" },
            ]}
          />
        </div>
        <Legenda
          itens={[
            { cor: "bg-chart-1", rotulo: `Em conta ${brl(c.conta)}` },
            { cor: "bg-chart-3", rotulo: `Aplicação ${brl(c.aplic)}` },
            { cor: "bg-success", rotulo: `A receber na semana ${brl(w0.rec)}` },
            { cor: "bg-warning", rotulo: `Custos da semana ${brl(w0.pag)}` },
            { cor: "bg-danger", rotulo: `Atrasadas ${brl(p.vencido)}` },
          ]}
        />
        <div className="flex flex-col">
          <Linha rotulo="Caixa hoje" valor={c.total} />
          <Linha rotulo={`(+) A receber de ${w0.ini} a ${w0.fim}`} valor={w0.rec} />
          <Linha rotulo={`(-) Custos que vencem de ${w0.ini} a ${w0.fim}`} valor={-w0.pag} />
          <Linha rotulo="(=) Sobra da semana" valor={sobra} forte />
          <Linha
            rotulo={`(-) Despesas atrasadas, vencidas antes de ${w0.ini}`}
            valor={-p.vencido}
          />
          <Linha rotulo="(=) Sobra pagando também as atrasadas" valor={sobraFinal} forte />
        </div>
        <a href="#despesas" className="text-sm text-primary-text hover:underline">
          Ver as despesas por categoria
        </a>
      </Pergunta>

      <Pergunta n={2} titulo={`Caixa até ${ultSemana.fim}`} farol={f2}>
        <p className="text-base">
          Partindo do caixa de hoje ({brl(c.total)}) e somando o que vence até {ultSemana.fim}, o
          saldo fecha em <strong>{brl(fim2)}</strong>. Pagando também as despesas já vencidas (
          {brl(p.vencido)}), fecha em <strong>{brl(fim2 - p.vencido)}</strong>.
        </p>
        <Tabela
          cab={["Semana", "A receber", "A pagar", "Saldo"]}
          linhas={[
            ["Caixa hoje", "", "", brl(c.total)],
            ...saldos.map((w) => [`${w.ini} a ${w.fim}`, brl(w.rec), brl(w.pag), brl(w.saldo)]),
          ]}
        />
      </Pergunta>

      <Pergunta n={3} titulo="Vencido a receber" farol={f3}>
        <p className="text-base">
          <strong>{brl(v.total)}</strong> de {v.n} clientes. Equivale a {Math.round(v.pct * 100)}%
          de um mês de receita.
        </p>
        <Tabela
          cab={["Cliente", "Vencido", "Há"]}
          linhas={v.top.map((t) => [t.nome, brl(t.valor), `${t.dias} dias`])}
        />
      </Pergunta>

      <Pergunta n={4} titulo="Risco e decisão">
        <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          Risco: a escrever
        </div>
        <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          Decisão: a escrever
        </div>
      </Pergunta>

      <h2 className="mt-3 text-lg font-semibold">Resultado mês a mês, {D.hoje.slice(-4)}</h2>

      <Pergunta titulo="Caixa da operação da Partners, sem aportes">
        <p className="text-base">
          A operação fechou no positivo em {positivos} de {D.evolucao.length} meses. No ano, o caixa
          da operação soma <strong>{brl(somaE("operacional"))}</strong>, e o dinheiro de fora da
          operação soma <strong>{brl(somaE("fora"))}</strong>.
        </p>
        <Barras
          rotulos={D.evolucao.map((m) => m.mes)}
          valores={D.evolucao.map((m) => m.operacional)}
          rotulo="Caixa da operação por mês"
        />
        <Nota>
          <p>
            <strong>As barras e a coluna Operação não incluem aportes.</strong> Mostram só o que
            entrou e saiu da operação da Partners.
          </p>
          <p>
            Os aportes de investidores estão na coluna Fora da operação: {aportes}. No ano, somam{" "}
            <strong>{brl(somaE("aporte"))}</strong>. Na mesma coluna entram também empréstimos entre
            empresas do grupo, valores indevidos, rendimentos da aplicação e os repasses de
            indicação de janeiro, que as empresas do grupo mandaram e a Partners pagou aos
            indicadores no mesmo mês.
          </p>
          <p>Variação do saldo = Operação + Fora da operação.</p>
        </Nota>
        <Tabela
          cab={[
            "Mês",
            "Entrou",
            "Saiu",
            "Operação",
            "Fora da operação (aportes e outros)",
            "Variação do saldo",
          ]}
          linhas={D.evolucao.map((m) => [
            m.mes,
            brl(m.entradas),
            brl(m.saidas),
            <strong key="o">{brl(m.operacional)}</strong>,
            brl(m.fora),
            brl(m.variacao),
          ])}
          total={[
            D.hoje.slice(-4),
            brl(somaE("entradas")),
            brl(somaE("saidas")),
            brl(somaE("operacional")),
            brl(somaE("fora")),
            brl(somaE("variacao")),
          ]}
        />
        <p className="text-sm text-muted-foreground">
          Pelo extrato de conta corrente. Fora da operação: aporte de investidores (jun a set),
          repasses de indicação que só passaram pela conta (jan), empréstimos entre empresas do
          grupo, valores indevidos e rendimentos. Transferências entre contas da Partners não
          entram.
        </p>
      </Pergunta>

      <Pergunta titulo="Faturado x saiu, sem aportes">
        <p className="text-base">
          O faturamento cobriu as saídas em {posFat} de {D.evolucao.length} meses. No ano, faturado
          menos saído soma <strong>{brl(somaE("resultado_fat"))}</strong>.
        </p>
        <Barras
          rotulos={D.evolucao.map((m) => m.mes)}
          valores={D.evolucao.map((m) => m.resultado_fat)}
          rotulo="Faturado menos saído por mês"
        />
        <Nota>
          <p>
            <strong>Faturado</strong> é o que a Partners cobrou no mês, não o que recebeu. De jan a
            jul, são os títulos a receber do Omie pelo vencimento. A partir de ago, é a apuração de
            royalties do mês anterior, porque RJ, Maceió e Patos pularam a emissão das notas de
            agosto.
          </p>
          <p>
            <strong>Saiu</strong> é o mesmo do gráfico de caixa: o que saiu da conta para a
            operação. Aportes não entram em nenhum dos dois lados.
          </p>
        </Nota>
        <Tabela
          cab={["Mês", "Faturado", "Saiu", "Faturado − saiu"]}
          linhas={D.evolucao.map((m) => [
            m.mes,
            brl(m.faturado),
            brl(m.saidas),
            <strong key="r">{brl(m.resultado_fat)}</strong>,
          ])}
          total={[
            D.hoje.slice(-4),
            brl(somaE("faturado")),
            brl(somaE("saidas")),
            brl(somaE("resultado_fat")),
          ]}
        />
      </Pergunta>

      <Pergunta titulo="Aplicação CDB">
        <p className="text-base">
          Saldo no fim de {ultEvo.mes}: <strong>{brl(ultEvo.saldo_aplic)}</strong>. Rendimento
          acumulado em {D.hoje.slice(-4)}: <strong>{brl(somaE("rendimento"))}</strong>.
        </p>
        <Barras
          rotulos={evoAp.map((m) => m.mes)}
          valores={evoAp.map((m) => m.saldo_aplic)}
          rotulo="Saldo da aplicação no fim de cada mês"
        />
        <Tabela
          cab={["Mês", "Aplicado", "Resgatado", "Rendimento", "Saldo no fim do mês"]}
          linhas={evoAp.map((m) => [
            m.mes,
            brl(m.aplicado),
            brl(m.resgatado),
            brl(m.rendimento),
            <strong key="s">{brl(m.saldo_aplic)}</strong>,
          ])}
        />
        {semRend.length > 0 && (
          <p className="text-sm text-muted-foreground">
            {semRend.map((m) => m.mes).join(", ")}: sem rendimento lançado no Omie.
          </p>
        )}
      </Pergunta>

      <Despesas D={D} meses={meses} />
    </>
  );
}

function Despesas({ D, meses }: { D: ReporteCeo; meses: [string, string][] }) {
  const [mes, setMes] = useState("todos");
  const [sit, setSit] = useState("todos");
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

  const { grupos, total, soma } = useMemo(() => {
    const lista = D.titulos.filter(
      (t) => (mes === "todos" || String(t.mes) === mes) && (sit === "todos" || t.sit === sit),
    );
    const mapa = new Map<
      string,
      { nome: string; total: number; itens: typeof lista } & Record<SituacaoTitulo, number>
    >();
    for (const t of lista) {
      const g = mapa.get(t.cat) ?? {
        nome: t.cat,
        total: 0,
        atrasado: 0,
        em_dia: 0,
        pago: 0,
        itens: [],
      };
      g.total += t.valor;
      g[t.sit] += t.valor;
      g.itens.push(t);
      mapa.set(t.cat, g);
    }
    const ord = [...mapa.values()].sort((a, b) => b.total - a.total);
    for (const g of ord) g.itens.sort((a, b) => (a.ordem < b.ordem ? -1 : 1));
    const s = (k: SituacaoTitulo) =>
      lista.filter((t) => t.sit === k).reduce((a, t) => a + t.valor, 0);
    return {
      grupos: ord,
      total: ord.reduce((a, g) => a + g.total, 0),
      soma: { atrasado: s("atrasado"), em_dia: s("em_dia"), pago: s("pago") },
    };
  }, [D.titulos, mes, sit]);
  const maior = Math.max(1, ...grupos.map((g) => g.total));

  const chips = (
    rotulo: string,
    atual: string,
    mudar: (v: string) => void,
    opcoes: [string, string][],
  ) => (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={rotulo}>
      {opcoes.map(([v, r]) => (
        <button
          key={v}
          type="button"
          aria-pressed={atual === v}
          onClick={() => mudar(v)}
          className={cn(
            "rounded-full border px-3 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            atual === v
              ? "border-primary bg-primary font-semibold text-primary-foreground"
              : "bg-card",
          )}
        >
          {r}
        </button>
      ))}
    </div>
  );

  return (
    <section id="despesas" className="flex scroll-mt-4 flex-col gap-3.5">
      <h2 className="mt-3 text-lg font-semibold">
        Despesas de {meses.map(([, n]) => n).join(" e ")}
      </h2>
      <p className="text-sm text-muted-foreground">
        Títulos a pagar do Omie pela data de vencimento, agrupados por categoria. Toque numa
        categoria para ver os títulos.
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2.5">
        {chips("Mês", mes, setMes, [
          ["todos", "Todos os meses"],
          ...meses.map(([m, n]) => [m, n[0].toUpperCase() + n.slice(1)] as [string, string]),
        ])}
        {chips("Situação", sit, setSit, [
          ["todos", "Todas"],
          ["atrasado", "Atrasado"],
          ["em_dia", "Em dia"],
          ["pago", "Pago"],
        ])}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Total", total],
          ["Atrasado", soma.atrasado],
          ["Em dia", soma.em_dia],
          ["Pago", soma.pago],
        ].map(([r, val]) => (
          <Card key={r as string} className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">{r}</span>
            <strong className="font-medium tabular-nums">{brl(val as number)}</strong>
          </Card>
        ))}
      </div>
      <Legenda itens={SITUACOES.map((k) => ({ cor: SIT_COR[k], rotulo: SIT_ROT[k] }))} />
      <div className="flex flex-col gap-2.5">
        {grupos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum título com esse filtro.</p>
        ) : (
          grupos.map((g) => {
            const aberto = abertos.has(g.nome);
            return (
              <Card key={g.nome} className="overflow-hidden">
                <button
                  type="button"
                  aria-expanded={aberto}
                  onClick={() =>
                    setAbertos((s) => {
                      const n = new Set(s);
                      if (n.has(g.nome)) n.delete(g.nome);
                      else n.add(g.nome);
                      return n;
                    })
                  }
                  className="flex w-full flex-col gap-2 px-4 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <strong>{g.nome}</strong>
                    <span className="whitespace-nowrap font-medium tabular-nums">
                      {brl(g.total)}
                    </span>
                  </div>
                  <Trilho
                    escala={maior}
                    partes={SITUACOES.map((k) => ({ valor: g[k], cor: SIT_COR[k] }))}
                  />
                  <div className="flex flex-wrap justify-between gap-3 text-[13px] text-muted-foreground">
                    <span>
                      {SITUACOES.filter((k) => g[k] > 0)
                        .map((k) => `${SIT_ROT[k]} ${brl(g[k])}`)
                        .join(" · ")}
                    </span>
                    <span className="inline-flex items-center gap-1 font-semibold text-primary-text">
                      {g.itens.length} título{g.itens.length > 1 ? "s" : ""}
                      <ChevronDown
                        className={cn("size-3.5 transition-transform", aberto && "rotate-180")}
                      />
                    </span>
                  </div>
                </button>
                {aberto && (
                  <div className="px-4 pb-3.5">
                    <Tabela
                      cab={["Vence", "Fornecedor", "Situação", "Valor"]}
                      esquerda={3}
                      linhas={g.itens.map((t) => [
                        <span key="v" className="tabular-nums">
                          {t.venc}
                        </span>,
                        t.forn,
                        <StatusBadge
                          key="s"
                          tom={t.sit === "atrasado" ? "perigo" : "neutro"}
                          icone={false}
                        >
                          {SIT_ROT[t.sit]}
                        </StatusBadge>,
                        brl(t.valor),
                      ])}
                    />
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>
    </section>
  );
}
