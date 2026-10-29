import { useMemo, useRef, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Procedencia,
  StatusBadge,
} from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import {
  CORES_SERIE,
  eixoProps,
  gradeProps,
  legendaProps,
  tooltipProps,
} from "@/lib/planning/grafico";
import { brlOuTraco } from "@/components/receita/moldura";
import { carregarRoasAssinaturas, type VendaAssinatura } from "@/lib/roas-assinaturas.functions";

// Aba "ROAS e assinaturas" do BI Financeiro. Contrato: docs/design/contratos/bi-financeiro.md §7.
// A pergunta é se a mídia do Inside Sales vira contrato assinado, e quando. Diferente da aba
// Vendas e ROAS, que mede o MRR vendido (deal ganho), aqui só conta o que tem data de assinatura.
//   ROAS de contrato no mês  = MRR das vendas do mês assinado até o fim do mês da venda ÷ mídia do mês anterior.
//   ROAS de contrato da safra = MRR das vendas do mês assinado até hoje, em qualquer mês ÷ mídia do mês anterior.
// A mídia de um mês gera as vendas do mês seguinte (regra do dono, 29/10/2026).

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const roas = (v: number | null) =>
  v === null
    ? "—"
    : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const data = (d: string | null) =>
  d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : "—";
const nMes = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7));
/** `YYYY-MM` do mês anterior: é a mídia dele que entra no ROAS do mês. */
const mesAnterior = (m: string) => {
  const a = Number(m.slice(0, 4));
  const mm = Number(m.slice(5, 7));
  return mm === 1 ? `${a - 1}-12` : `${a}-${String(mm - 1).padStart(2, "0")}`;
};
const ROAS_REFERENCIA = 0.8;
const tomRoas = (v: number | null) =>
  v === null ? undefined : v >= ROAS_REFERENCIA ? "sucesso" : "perigo";
const corRoas = (v: number | null) =>
  v === null ? "" : v >= ROAS_REFERENCIA ? "text-success" : "text-danger";
const FAIXAS = ["M0", "M1", "M2", "M3+"] as const;
type Faixa = (typeof FAIXAS)[number];

/** Em que mês, contado a partir da venda, o contrato foi assinado. Assinatura antes do ganho conta como M0. */
function faixa(v: VendaAssinatura): Faixa | null {
  if (!v.assinatura) return null;
  const k = Math.max(0, nMes(v.assinatura) - nMes(v.ganho));
  return k >= 3 ? "M3+" : (`M${k}` as Faixa);
}

const SITUACOES = {
  todos: "Todos",
  fato: "Assinado no mês da venda",
  depois: "Assinado depois",
  sem: "Sem assinatura",
} as const;
type Situacao = keyof typeof SITUACOES;
const situacao = (v: VendaAssinatura): Exclude<Situacao, "todos"> =>
  !v.assinatura ? "sem" : faixa(v) === "M0" ? "fato" : "depois";

function Bloco({
  titulo,
  sub,
  children,
}: {
  titulo: string;
  sub?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-4 md:p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </Card>
  );
}

/**
 * `de` e `ate` vêm do filtro de período do BI. Quando `ate` é o último mês do retrato, os meses
 * mais novos que a view já tem também entram (a view é ao vivo, o retrato não).
 */
export function RoasAssinaturas({
  de,
  ate,
  ateEhUltimo,
}: {
  de: string;
  ate: string;
  ateEhUltimo: boolean;
}) {
  const fn = useServerFn(carregarRoasAssinaturas);
  const q = useQuery({
    queryKey: ["roas-assinaturas"],
    queryFn: () => fn(),
    staleTime: 5 * 60_000,
  });
  const [modo, setModo] = useFiltroNaUrl("ver", "mrr");
  const [mesSel, setMesSel] = useFiltroNaUrl("mes", "");
  const [sit, setSit] = useFiltroNaUrl("situacao", "todos");
  const clientesRef = useRef<HTMLDivElement>(null);

  const meses = useMemo(() => {
    if (!q.data) return [];
    const todos = [...new Set(q.data.vendas.map((v) => v.ganho.slice(0, 7)))].sort();
    return todos.filter((m) => m >= de && (ateEhUltimo || m <= ate));
  }, [q.data, de, ate, ateEhUltimo]);

  const linhas = useMemo(() => {
    if (!q.data) return [];
    return meses.map((m) => {
      const g = q.data.vendas.filter((v) => v.ganho.startsWith(m));
      const b: Record<Faixa, { n: number; mrr: number }> = {
        M0: { n: 0, mrr: 0 },
        M1: { n: 0, mrr: 0 },
        M2: { n: 0, mrr: 0 },
        "M3+": { n: 0, mrr: 0 },
      };
      for (const v of g) {
        const f = faixa(v);
        if (f) {
          b[f].n++;
          b[f].mrr += v.mrr;
        }
      }
      const vend = g.reduce((s, v) => s + v.mrr, 0);
      const saf = FAIXAS.reduce((s, k) => s + b[k].mrr, 0);
      const na = FAIXAS.reduce((s, k) => s + b[k].n, 0);
      const midia = q.data.midia[mesAnterior(m)] ?? 0;
      return { m, g, b, vend, saf, na, fato: b.M0.mrr, midia };
    });
  }, [q.data, meses]);

  if (q.isLoading) return <Carregando variante="pagina" />;
  if (q.error)
    return <EstadoErro detalhe={(q.error as Error).message} tentarNovamente={() => q.refetch()} />;
  if (!q.data || linhas.length === 0)
    return (
      <EstadoVazio
        titulo="Sem vendas do Inside Sales no período"
        descricao="Escolha outro período no filtro acima."
      />
    );

  const r = (v: number, md: number) => (md > 0 ? v / md : null);
  const tot = {
    midia: linhas.reduce((s, x) => s + x.midia, 0),
    n: linhas.reduce((s, x) => s + x.g.length, 0),
    vend: linhas.reduce((s, x) => s + x.vend, 0),
    fato: linhas.reduce((s, x) => s + x.fato, 0),
    saf: linhas.reduce((s, x) => s + x.saf, 0),
    na: linhas.reduce((s, x) => s + x.na, 0),
    b: Object.fromEntries(
      FAIXAS.map((k) => [
        k,
        {
          n: linhas.reduce((s, x) => s + x.b[k].n, 0),
          mrr: linhas.reduce((s, x) => s + x.b[k].mrr, 0),
        },
      ]),
    ) as Record<Faixa, { n: number; mrr: number }>,
  };
  const grafico = linhas.map((x) => ({
    r: rot(x.m),
    fato: x.midia > 0 ? Number((x.fato / x.midia).toFixed(2)) : null,
    safra: x.midia > 0 ? Number((x.saf / x.midia).toFixed(2)) : null,
  }));
  const celula = (b: { n: number; mrr: number }, vend: number) =>
    modo === "n"
      ? b.n || ""
      : modo === "pct"
        ? vend && b.mrr
          ? `${Math.round((b.mrr / vend) * 100)}%`
          : ""
        : b.mrr
          ? brlOuTraco(b.mrr)
          : "";

  const mesClientes = meses.includes(mesSel) ? mesSel : meses[meses.length - 1];
  const doMes = linhas.find((x) => x.m === mesClientes)?.g ?? [];
  const sitAtual: Situacao = sit in SITUACOES ? (sit as Situacao) : "todos";
  const clientes = doMes.filter((v) => sitAtual === "todos" || situacao(v) === sitAtual);
  const abrirMes = (m: string) => {
    setMesSel(m);
    clientesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const linhaTabela = (
    chave: string,
    rotulo: ReactNode,
    x: {
      midia: number;
      n: number;
      vend: number;
      b: Record<Faixa, { n: number; mrr: number }>;
      saf: number;
      na: number;
      fato: number;
    },
    total = false,
  ) => {
    const rf = r(x.fato, x.midia);
    const rs = r(x.saf, x.midia);
    const forte = total ? "font-semibold" : "";
    return (
      <tr key={chave} className={total ? "border-t-2" : "border-b"}>
        <td className={`py-1.5 ${forte}`}>{rotulo}</td>
        <td className={`py-1.5 text-right ${forte}`}>{brlOuTraco(x.midia)}</td>
        <td className={`py-1.5 text-right ${forte}`}>{x.n}</td>
        <td className={`py-1.5 text-right ${forte}`}>{brlOuTraco(x.vend)}</td>
        {FAIXAS.map((k) => (
          <td key={k} className={`py-1.5 text-right ${forte}`}>
            {celula(x.b[k], x.vend)}
          </td>
        ))}
        <td className="py-1.5 text-right font-semibold">
          {modo === "n" ? x.na : brlOuTraco(x.saf)}
        </td>
        <td className={`py-1.5 text-right ${forte}`}>
          {x.vend ? `${Math.round((x.saf / x.vend) * 100)}%` : "—"}
        </td>
        <td className={`py-1.5 text-right ${forte}`}>
          {modo === "n" ? x.n - x.na : brlOuTraco(x.vend - x.saf)}
        </td>
        <td className={`py-1.5 text-right font-medium ${corRoas(rf)}`}>{roas(rf)}</td>
        <td className={`py-1.5 text-right font-medium ${corRoas(rs)}`}>{roas(rs)}</td>
      </tr>
    );
  };

  return (
    <>
      <Bloco
        titulo="A mídia vira contrato assinado?"
        sub={
          <>
            Vendas do pipeline Inside Sales (Pipedrive), rede toda, e a data de assinatura do
            contrato (Pipefy Central de Contratos). <b>ROAS de contrato no mês</b>: MRR das vendas
            do mês assinado até o fim do mês da venda ÷ mídia do mês anterior.{" "}
            <b>ROAS de contrato da safra</b>: MRR das vendas do mês assinado até hoje, em qualquer
            mês ÷ mídia do mês anterior. A mídia de um mês gera as vendas do mês seguinte.
            Referência: {roas(ROAS_REFERENCIA)}.
          </>
        }
      >
        <Procedencia
          fonte="Pipedrive (deals ganhos), Pipefy Central de Contratos (data de assinatura) e mídia do Inside Sales, ao vivo"
          atualizadoEm={q.data.lidoEm}
        />
        <KpiGrade colunas={3}>
          <KpiCard
            rotulo="Mídia do mês anterior"
            valor={brlOuTraco(tot.midia)}
            nota={`Inside Sales, ${rot(mesAnterior(linhas[0].m))} a ${rot(mesAnterior(linhas[linhas.length - 1].m))}`}
          />
          <KpiCard
            rotulo="ROAS de contrato no mês"
            valor={roas(r(tot.fato, tot.midia))}
            nota={`${brlOuTraco(tot.fato)} assinados no mês da venda`}
            tom={tomRoas(r(tot.fato, tot.midia))}
          />
          <KpiCard
            rotulo="ROAS de contrato da safra"
            valor={roas(r(tot.saf, tot.midia))}
            nota={`${brlOuTraco(tot.saf)} assinados até hoje, ${tot.vend ? Math.round((tot.saf / tot.vend) * 100) : 0}% do vendido`}
            tom={tomRoas(r(tot.saf, tot.midia))}
          />
        </KpiGrade>
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={grafico} margin={{ top: 16, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} width={40} tickFormatter={(v: number) => roas(v)} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [roas(v), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={ROAS_REFERENCIA} stroke="var(--warning)" strokeDasharray="4 4" />
              <Bar
                dataKey="fato"
                name="ROAS de contrato no mês"
                fill={CORES_SERIE[0]}
                radius={3}
                isAnimationActive={false}
                label={{ position: "top", fontSize: 12, formatter: (v: number) => roas(v) }}
              />
              <Bar
                dataKey="safra"
                name="ROAS de contrato da safra"
                fill={CORES_SERIE[2]}
                radius={3}
                isAnimationActive={false}
                label={{ position: "top", fontSize: 12, formatter: (v: number) => roas(v) }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Bloco>

      <Bloco
        titulo="Quando cada safra assinou"
        sub="M0 = assinado até o mês da venda (é o que entra no ROAS de contrato no mês). M1, M2, M3+ = meses depois, completam a safra. Clique no mês para ver os clientes."
      >
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["mrr", "MRR"],
              ["pct", "% do MRR vendido"],
              ["n", "Contratos"],
            ] as const
          ).map(([v, t]) => (
            <Button
              key={v}
              size="sm"
              variant={modo === v ? "default" : "outline"}
              onClick={() => setModo(v === "mrr" ? undefined : v)}
            >
              {t}
            </Button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Mês da venda</th>
                <th className="py-2 text-right font-medium">Mídia do mês anterior</th>
                <th className="py-2 text-right font-medium">Vendas</th>
                <th className="py-2 text-right font-medium">MRR vendido</th>
                {FAIXAS.map((k) => (
                  <th key={k} className="py-2 text-right font-medium">
                    {k === "M0" ? "M0 (no mês)" : k}
                  </th>
                ))}
                <th className="py-2 text-right font-medium">Assinado até hoje</th>
                <th className="py-2 text-right font-medium">% assinado</th>
                <th className="py-2 text-right font-medium">Sem assinatura</th>
                <th className="py-2 text-right font-medium">ROAS de contrato no mês</th>
                <th className="py-2 text-right font-medium">ROAS de contrato da safra</th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((x) =>
                linhaTabela(
                  x.m,
                  <button
                    type="button"
                    className="text-primary-text underline-offset-2 hover:underline"
                    onClick={() => abrirMes(x.m)}
                  >
                    {rot(x.m)}
                  </button>,
                  { ...x, n: x.g.length },
                ),
              )}
              {linhaTabela("total", "Total", tot, true)}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Antes de agosto falta data de assinatura em muitos contratos (o pipe de Contratos do
          Pipefy existe desde 03/08), então jan a abr aparecem com pouca assinatura mesmo tendo
          contrato. Nos meses recentes, a maior parte do "sem assinatura" é o campo "Data de
          assinatura do contrato" vazio no card do Pipefy: preenchido, o cliente entra aqui sozinho.
        </p>
      </Bloco>

      <div ref={clientesRef} className="scroll-mt-4">
        <Bloco
          titulo={`Clientes de ${rot(mesClientes)}`}
          sub="Vendas do mês e em que situação está a assinatura do contrato."
        >
          <div className="flex flex-wrap items-center gap-2">
            <Select value={mesClientes} onValueChange={(v) => setMesSel(v)}>
              <SelectTrigger className="h-8 w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {meses.map((m) => (
                  <SelectItem key={m} value={m}>
                    {rot(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(Object.keys(SITUACOES) as Situacao[]).map((k) => {
              const n =
                k === "todos" ? doMes.length : doMes.filter((v) => situacao(v) === k).length;
              return (
                <Button
                  key={k}
                  size="sm"
                  variant={sitAtual === k ? "default" : "outline"}
                  onClick={() => setSit(k === "todos" ? undefined : k)}
                >
                  {SITUACOES[k]} ({n})
                </Button>
              );
            })}
          </div>
          {clientes.length === 0 ? (
            <EstadoVazio
              titulo="Nenhum cliente nesta situação"
              descricao="Troque a situação ou o mês."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 text-left font-medium">Cliente</th>
                    <th className="py-2 text-left font-medium">Unidade</th>
                    <th className="py-2 text-left font-medium">Closer</th>
                    <th className="py-2 text-right font-medium">MRR</th>
                    <th className="py-2 text-right font-medium">Ganho</th>
                    <th className="py-2 text-right font-medium">Assinatura</th>
                    <th className="py-2 text-right font-medium">Dias</th>
                    <th className="py-2 text-left font-medium">Situação</th>
                    <th className="py-2 text-left font-medium">Contrato no Pipefy</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes.map((v) => {
                    const s = situacao(v);
                    const dias =
                      v.assinatura && v.ganho
                        ? Math.round((Date.parse(v.assinatura) - Date.parse(v.ganho)) / 86_400_000)
                        : null;
                    return (
                      <tr key={v.deal_id} className="border-b">
                        <td className="py-1.5">
                          <a
                            href={`https://planning.pipedrive.com/deal/${v.deal_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-primary-text underline-offset-2 hover:underline"
                          >
                            {v.cliente}
                          </a>
                        </td>
                        <td className="py-1.5">{v.unidade ?? "—"}</td>
                        <td className="py-1.5">{v.closer ?? "—"}</td>
                        <td className="py-1.5 text-right">{brlOuTraco(v.mrr)}</td>
                        <td className="py-1.5 text-right">{data(v.ganho)}</td>
                        <td className="py-1.5 text-right">{data(v.assinatura)}</td>
                        <td className="py-1.5 text-right">{dias ?? "—"}</td>
                        <td className="py-1.5">
                          <StatusBadge
                            tom={s === "fato" ? "sucesso" : s === "depois" ? "info" : "atencao"}
                          >
                            {s === "sem" && !v.tem_contrato ? "Sem contrato no Ops" : SITUACOES[s]}
                          </StatusBadge>
                        </td>
                        <td className="py-1.5">
                          {v.pipefy_card_id ? (
                            <a
                              href={`https://app.pipefy.com/open-cards/${v.pipefy_card_id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-primary-text underline-offset-2 hover:underline"
                            >
                              {v.fase_contrato ?? "abrir card"}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">sem card</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>
      </div>
    </>
  );
}
