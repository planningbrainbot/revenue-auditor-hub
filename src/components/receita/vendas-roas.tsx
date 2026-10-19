import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
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
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EstadoVazio, KpiCard, KpiGrade, StatusBadge } from "@/components/planning";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { brlOuTraco } from "@/components/receita/moldura";
import type { DreCaixa, VendasRetrato } from "@/lib/dre-caixa.functions";

// Aba "Vendas e ROAS" do BI Financeiro. Retrato em payload.vendas, gravado por
// tools/vendas_roas_planilha.py (e pela rodada completa de tools/dre_caixa_payload.py).
// Três perguntas: quanto o Inside Sales vendeu na rede toda, se a mídia se paga (ROAS fato
// e safra) e quando o CAC das vendas entra no caixa da Partners.

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => (m.length === 7 ? `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}` : m);
const mil = (v: number) =>
  Math.abs(v) < 500 ? "0" : `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
const roas = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const ROAS_FORECAST = 0.7;
const MESES_MADURA = 3;

const SITUACOES = [
  { chave: "recebida", rotulo: "Já recebido", cor: CORES_SERIE[0] },
  { chave: "atrasada", rotulo: "Atrasado", cor: "var(--danger)" },
  { chave: "cobrada", rotulo: "Cobrado, a vencer", cor: CORES_SERIE[1] },
  { chave: "a cobrar", rotulo: "A cobrar (contrato assinado)", cor: CORES_SERIE[2] },
  { chave: "termo sem contrato", rotulo: "Termo sem contrato (ponderado)", cor: CORES_SERIE[5] },
] as const;

export function VendasRoas({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const V = D.vendas;
  const [unidade, setUnidade] = useFiltroNaUrl("unidade", "todas");
  const [escopo, setEscopo] = useFiltroNaUrl("escopo", "rede");
  if (!V)
    return (
      <EstadoVazio
        titulo="O retrato ainda não tem as vendas"
        descricao="Elas entram na próxima rodada de tools/vendas_roas_planilha.py --gravar."
      />
    );
  const periodo = idx.map((i) => D.meses[i]).filter((m) => V.meses.includes(m));
  const unidades = [...new Set(V.vendas.map((v) => v.unidade))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const filtra = (u: string, funil: boolean) =>
    (unidade === "todas" || u === unidade) &&
    (escopo === "rede" || (escopo === "funil" ? funil : !funil));

  return (
    <>
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-medium">Unidade</span>
        <Select value={unidade} onValueChange={(v) => setUnidade(v === "todas" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Rede toda</SelectItem>
            {unidades.map((u) => (
              <SelectItem key={u} value={u}>
                {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm font-medium">Vendas</span>
        <Select value={escopo} onValueChange={(v) => setEscopo(v === "rede" ? undefined : v)}>
          <SelectTrigger className="h-8 w-[230px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rede">Todas do Inside Sales</SelectItem>
            <SelectItem value="funil">Só unidades do Funil de CAC</SelectItem>
            <SelectItem value="fora">Só fora do Funil de CAC</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">Retrato de {V.gerado_em.split("-").reverse().join("/")}</span>
      </Card>

      <Vendas V={V} periodo={periodo} filtra={filtra} />
      <Roas V={V} periodo={periodo} filtra={filtra} filtrado={unidade !== "todas" || escopo !== "rede"} />
      <Agenda V={V} unidade={unidade} />
    </>
  );
}

function Secao({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children: ReactNode }) {
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

// ---------------------------------------------------------------- vendas

function Vendas({
  V,
  periodo,
  filtra,
}: {
  V: VendasRetrato;
  periodo: string[];
  filtra: (u: string, funil: boolean) => boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const doPeriodo = V.vendas.filter((v) => periodo.includes(v.ganho.slice(0, 7)) && filtra(v.unidade, v.funil_cac));
  const porMes = periodo.map((m) => {
    const d = doPeriodo.filter((v) => v.ganho.startsWith(m));
    const funil = d.filter((v) => v.funil_cac);
    return {
      m,
      r: rot(m),
      n: d.length,
      mrr: d.reduce((s, v) => s + v.mrr, 0),
      nFunil: funil.length,
      funil: funil.reduce((s, v) => s + v.mrr, 0),
      fora: d.filter((v) => !v.funil_cac).reduce((s, v) => s + v.mrr, 0),
    };
  });
  const T = {
    n: doPeriodo.length,
    mrr: doPeriodo.reduce((s, v) => s + v.mrr, 0),
    nFunil: doPeriodo.filter((v) => v.funil_cac).length,
    funil: doPeriodo.filter((v) => v.funil_cac).reduce((s, v) => s + v.mrr, 0),
  };
  const porUnidade = useMemo(() => {
    const m = new Map<string, { n: number; mrr: number; funil: boolean }>();
    for (const v of doPeriodo) {
      const x = m.get(v.unidade) ?? { n: 0, mrr: 0, funil: false };
      x.n += 1;
      x.mrr += v.mrr;
      x.funil ||= v.funil_cac;
      m.set(v.unidade, x);
    }
    return [...m.entries()].sort((a, b) => b[1].mrr - a[1].mrr);
  }, [doPeriodo]);

  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Vendido no período"
          valor={brlOuTraco(T.mrr)}
          nota={`${T.n} vendas · MRR`}
        />
        <KpiCard
          rotulo="Nas unidades do Funil de CAC"
          valor={brlOuTraco(T.funil)}
          nota={`${T.nFunil} vendas · ${T.mrr > 0 ? Math.round((T.funil / T.mrr) * 100) : 0}% do vendido`}
        />
        <KpiCard
          rotulo="Fora do Funil de CAC"
          valor={brlOuTraco(T.mrr - T.funil)}
          nota={`${T.n - T.nFunil} vendas · unidades que não pagam CAC`}
        />
      </KpiGrade>

      <Secao
        titulo="Quanto o Inside Sales vendeu, mês a mês?"
        sub="Venda é deal ganho no pipeline Inside Sales do Pipedrive, no mês em que foi ganho; valor é o MRR do deal. O Funil de CAC mostra só a parte verde: as unidades que pagam CAC ou têm card de cobrança."
      >
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={porMes} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
              <Legend {...legendaProps} />
              <Bar dataKey="funil" name="Unidades do Funil de CAC" stackId="v" fill={CORES_SERIE[0]} isAnimationActive={false} />
              <Bar dataKey="fora" name="Fora do Funil de CAC" stackId="v" fill={CORES_SERIE[5]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Mês</th>
                <th className="py-2 text-right font-medium">Vendas</th>
                <th className="py-2 text-right font-medium">MRR vendido</th>
                <th className="py-2 text-right font-medium">No Funil de CAC</th>
                <th className="py-2 text-right font-medium">MRR no funil</th>
                <th className="py-2 text-right font-medium">MRR fora do funil</th>
              </tr>
            </thead>
            <tbody>
              {porMes.map((x) => (
                <tr key={x.m} className="border-b">
                  <td className="py-1.5">{x.r}</td>
                  <td className="py-1.5 text-right">{x.n}</td>
                  <td className="py-1.5 text-right font-medium">{brlOuTraco(x.mrr)}</td>
                  <td className="py-1.5 text-right">{x.nFunil}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.funil)}</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.fora)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-2">Período</td>
                <td className="py-2 text-right">{T.n}</td>
                <td className="py-2 text-right">{brlOuTraco(T.mrr)}</td>
                <td className="py-2 text-right">{T.nFunil}</td>
                <td className="py-2 text-right">{brlOuTraco(T.funil)}</td>
                <td className="py-2 text-right">{brlOuTraco(T.mrr - T.funil)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Secao>

      <Secao titulo="Quem vendeu?" sub="Por unidade no período. Clique para ver as vendas.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 text-left font-medium">Unidade</th>
                <th className="py-2 text-left font-medium">Funil de CAC</th>
                <th className="py-2 text-right font-medium">Vendas</th>
                <th className="py-2 text-right font-medium">MRR vendido</th>
                <th className="py-2 text-right font-medium">% do período</th>
              </tr>
            </thead>
            <tbody>
              {porUnidade.map(([u, x]) => (
                <Fragment key={u}>
                  <tr
                    className="cursor-pointer border-b hover:bg-muted/40"
                    onClick={() => setAberta(aberta === u ? null : u)}
                  >
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        {aberta === u ? (
                          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                        )}
                        {u}
                      </span>
                    </td>
                    <td className="py-1.5">
                      {x.funil ? <StatusBadge tom="sucesso">dentro</StatusBadge> : <StatusBadge tom="neutro">fora</StatusBadge>}
                    </td>
                    <td className="py-1.5 text-right">{x.n}</td>
                    <td className="py-1.5 text-right font-medium">{brlOuTraco(x.mrr)}</td>
                    <td className="py-1.5 text-right">{T.mrr > 0 ? `${Math.round((x.mrr / T.mrr) * 100)}%` : "—"}</td>
                  </tr>
                  {aberta === u &&
                    doPeriodo
                      .filter((v) => v.unidade === u)
                      .sort((a, b) => a.ganho.localeCompare(b.ganho))
                      .map((v, i) => (
                        <tr key={`${u}-${i}`} className="border-b bg-muted/20 text-xs">
                          <td className="py-1 pl-7">{v.titulo}</td>
                          <td className="py-1 text-muted-foreground">criado {fmtData(v.criado)}</td>
                          <td className="py-1 text-right text-muted-foreground">ganho {fmtData(v.ganho)}</td>
                          <td className="py-1 text-right">{brlOuTraco(v.mrr)}</td>
                          <td />
                        </tr>
                      ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    </>
  );
}

const fmtData = (d: string) => (d ? d.slice(0, 10).split("-").reverse().join("/") : "—");

// ---------------------------------------------------------------- ROAS

function Roas({
  V,
  periodo,
  filtra,
  filtrado,
}: {
  V: VendasRetrato;
  periodo: string[];
  filtra: (u: string, funil: boolean) => boolean;
  filtrado: boolean;
}) {
  const ultimo = V.meses[V.meses.length - 1];
  const idade = (m: string) =>
    (Number(ultimo.slice(0, 4)) - Number(m.slice(0, 4))) * 12 + Number(ultimo.slice(5, 7)) - Number(m.slice(5, 7));
  const linhas = periodo.map((m) => {
    const midia = V.midia[m] ?? 0;
    const fato = V.vendas
      .filter((v) => v.ganho.startsWith(m) && filtra(v.unidade, v.funil_cac))
      .reduce((s, v) => s + v.mrr, 0);
    // a safra filtrada sai das vendas cruas; a da rede toda vem pronta (inclui deals ganhos fora do período)
    const safraMrr = filtrado
      ? V.vendas.filter((v) => v.criado.startsWith(m) && filtra(v.unidade, v.funil_cac)).reduce((s, v) => s + v.mrr, 0)
      : (V.safra[m]?.mrr ?? 0);
    const s = V.safra[m] ?? { criados: 0, ganhos: 0, abertos: 0, mrr: 0 };
    return {
      m,
      r: rot(m),
      midia,
      fato,
      safra: safraMrr,
      roasFato: midia > 0 ? fato / midia : null,
      roasSafra: midia > 0 ? safraMrr / midia : null,
      ...s,
      madura: idade(m) >= MESES_MADURA,
    };
  });
  const midia = linhas.reduce((s, x) => s + x.midia, 0);
  const fato = linhas.reduce((s, x) => s + x.fato, 0);
  const maduras = linhas.filter((x) => x.madura);
  const midiaMad = maduras.reduce((s, x) => s + x.midia, 0);
  const safraMad = maduras.reduce((s, x) => s + x.safra, 0);
  const rFato = midia > 0 ? fato / midia : null;
  const rSafra = midiaMad > 0 ? safraMad / midiaMad : null;
  const tomRoas = (v: number | null) => (v === null ? undefined : v >= 1 ? "sucesso" : v >= ROAS_FORECAST ? "atencao" : "perigo");
  const grafico = linhas.map((x) => ({
    r: x.r,
    midia: Math.round(x.midia),
    roasFato: x.roasFato === null ? null : Number(x.roasFato.toFixed(2)),
    roasSafra: x.roasSafra === null ? null : Number(x.roasSafra.toFixed(2)),
  }));

  return (
    <Secao
      titulo="A mídia se paga?"
      sub={
        <>
          ROAS é o MRR vendido dividido pela mídia do Inside Sales do mesmo mês. <b>Fato</b>: vendas ganhas no mês.{" "}
          <b>Safra</b>: deals criados no mês e ganhos até hoje, que é o que aquela mídia realmente gerou. Safra com
          menos de {MESES_MADURA} meses ainda tem deal aberto e vai subir. Régua do Forecast Oficial: {roas(ROAS_FORECAST)}.
          {filtrado && " Com filtro de unidade, a mídia continua sendo a da rede toda: a mídia não é separada por unidade."}
        </>
      }
    >
      <KpiGrade colunas={3}>
        <KpiCard rotulo="Mídia do Inside Sales" valor={brlOuTraco(midia)} nota={`${linhas.length} meses`} />
        <KpiCard
          rotulo="ROAS fato"
          valor={roas(rFato)}
          nota={`${brlOuTraco(fato)} vendidos no período`}
          tom={tomRoas(rFato)}
        />
        <KpiCard
          rotulo="ROAS safra (safras maduras)"
          valor={roas(rSafra)}
          nota={
            maduras.length
              ? `${maduras.length} de ${linhas.length} meses com ${MESES_MADURA}+ meses de idade`
              : "nenhuma safra madura no período"
          }
          tom={tomRoas(rSafra)}
        />
      </KpiGrade>
      <div className="h-72">
        <ResponsiveContainer>
          <ComposedChart data={grafico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="r" {...eixoProps} />
            <YAxis yAxisId="r" {...eixoProps} tickFormatter={mil} width={64} />
            <YAxis yAxisId="x" orientation="right" {...eixoProps} width={40} tickFormatter={(v: number) => roas(v)} />
            <Tooltip
              {...tooltipProps}
              formatter={(v: number, n: string) => [n === "Mídia" ? brlOuTraco(v) : roas(v), n]}
            />
            <Legend {...legendaProps} />
            <Bar yAxisId="r" dataKey="midia" name="Mídia" fill={CORES_SERIE[5]} radius={3} isAnimationActive={false} />
            <ReferenceLine yAxisId="x" y={1} stroke="var(--border)" strokeDasharray="4 4" />
            <ReferenceLine yAxisId="x" y={ROAS_FORECAST} stroke="var(--warning)" strokeDasharray="4 4" />
            <Line yAxisId="x" dataKey="roasFato" name="ROAS fato" stroke={CORES_SERIE[0]} strokeWidth={2} dot isAnimationActive={false} connectNulls />
            <Line yAxisId="x" dataKey="roasSafra" name="ROAS safra" stroke={CORES_SERIE[2]} strokeWidth={2} dot isAnimationActive={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Mês</th>
              <th className="py-2 text-right font-medium">Mídia</th>
              <th className="py-2 text-right font-medium">MRR fato</th>
              <th className="py-2 text-right font-medium">ROAS fato</th>
              <th className="py-2 text-right font-medium">Deals criados</th>
              <th className="py-2 text-right font-medium">Ganhos</th>
              <th className="py-2 text-right font-medium">Ainda abertos</th>
              <th className="py-2 text-right font-medium">MRR safra</th>
              <th className="py-2 text-right font-medium">ROAS safra</th>
              <th className="py-2 text-right font-medium">Safra</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((x) => (
              <tr key={x.m} className="border-b">
                <td className="py-1.5">{x.r}</td>
                <td className="py-1.5 text-right">{brlOuTraco(x.midia)}</td>
                <td className="py-1.5 text-right">{brlOuTraco(x.fato)}</td>
                <td className="py-1.5 text-right font-medium">{roas(x.roasFato)}</td>
                <td className="py-1.5 text-right">{x.criados}</td>
                <td className="py-1.5 text-right">{x.ganhos}</td>
                <td className="py-1.5 text-right">{x.abertos}</td>
                <td className="py-1.5 text-right">{brlOuTraco(x.safra)}</td>
                <td className="py-1.5 text-right font-medium">{roas(x.roasSafra)}</td>
                <td className="py-1.5 text-right">
                  {x.madura ? <StatusBadge tom="neutro">madura</StatusBadge> : <StatusBadge tom="atencao">em maturação</StatusBadge>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Deals criados, ganhos e abertos são da rede toda. Mídia é a finalidade Inside Sales; não entram construção
        civil, novos sócios, recon nem Curitiba.
      </p>
    </Secao>
  );
}

// ---------------------------------------------------------------- agenda do CAC

function Agenda({ V, unidade }: { V: VendasRetrato; unidade: string }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const atual = V.meses[V.meses.length - 1];
  const parcelas = V.agenda.filter((p) => unidade === "todas" || p.unidade === unidade);
  const esperado = (p: VendasRetrato["agenda"][number]) => p.valor * p.peso;
  const meses = [...new Set(parcelas.map((p) => p.mes_caixa))]
    .filter((m) => m === "sem data" || m >= atual)
    .sort((a, b) => (a === "sem data" ? 1 : b === "sem data" ? -1 : a.localeCompare(b)));
  const linhas = meses.map((m) => {
    const d = parcelas.filter((p) => p.mes_caixa === m);
    const o: Record<string, number> = {};
    for (const s of SITUACOES) o[s.chave] = d.filter((p) => p.situacao === s.chave).reduce((a, p) => a + esperado(p), 0);
    const aReceber = d.filter((p) => p.situacao !== "recebida").reduce((a, p) => a + esperado(p), 0);
    return { m, r: rot(m), ...o, aReceber, d };
  });
  const soma = (f: (p: VendasRetrato["agenda"][number]) => boolean) =>
    parcelas.filter(f).reduce((a, p) => a + esperado(p), 0);
  const atrasado = soma((p) => p.situacao === "atrasada");
  const tresMeses = soma(
    (p) => p.situacao !== "recebida" && p.mes_caixa !== "sem data" && p.mes_caixa >= atual && p.mes_caixa <= somaMes(atual, 2),
  );
  const termos = soma((p) => p.situacao === "termo sem contrato");
  const semData = soma((p) => p.mes_caixa === "sem data");
  const P = V.premissas;

  return (
    <Secao
      titulo="Quando o CAC das vendas entra no caixa?"
      sub={
        <>
          CAC que as unidades pagam à Partners, parcela por parcela. 1ª parcela: assinatura do contrato + {P.lag_p1} mês.
          2ª: competência inicial do serviço + {P.lag_p2} meses (Recife: as duas na competência). Cobrada e não paga de
          mês passado vira <b>atrasada</b> no mês atual. Termo sem contrato entra ponderado: {Math.round(P.conv * 100)}% se
          é recente, {Math.round(P.chance_m2 * 100)}% se já tem 2+ meses (quase sempre é quebra).
        </>
      }
    >
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Atrasado"
          valor={brlOuTraco(atrasado)}
          nota="devia ter entrado e não entrou"
          tom={atrasado > 0 ? "perigo" : undefined}
        />
        <KpiCard
          rotulo={`A receber até ${rot(somaMes(atual, 2))}`}
          valor={brlOuTraco(tresMeses)}
          nota="inclui o atrasado e os termos ponderados"
        />
        <KpiCard rotulo="Depende de assinar contrato" valor={brlOuTraco(termos)} nota="termo ganho, contrato ainda não" />
        <KpiCard
          rotulo="Sem data"
          valor={brlOuTraco(semData)}
          nota="contrato sem competência inicial no Pipefy"
          tom={semData > 0 ? "atencao" : undefined}
        />
      </KpiGrade>
      <div className="h-72">
        <ResponsiveContainer>
          <BarChart data={linhas} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
            <CartesianGrid {...gradeProps} />
            <XAxis dataKey="r" {...eixoProps} />
            <YAxis {...eixoProps} tickFormatter={mil} width={64} />
            <Tooltip {...tooltipProps} formatter={(v: number, n: string) => [brlOuTraco(v), n]} />
            <Legend {...legendaProps} />
            {SITUACOES.map((s) => (
              <Bar key={s.chave} dataKey={s.chave} name={s.rotulo} stackId="a" fill={s.cor} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b">
              <th className="py-2 text-left font-medium">Mês no caixa</th>
              {SITUACOES.map((s) => (
                <th key={s.chave} className="py-2 text-right font-medium">
                  {s.rotulo}
                </th>
              ))}
              <th className="py-2 text-right font-medium">A receber</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((x) => (
              <Fragment key={x.m}>
                <tr className="cursor-pointer border-b hover:bg-muted/40" onClick={() => setAberto(aberto === x.m ? null : x.m)}>
                  <td className="py-1.5">
                    <span className="flex items-center gap-1.5">
                      {aberto === x.m ? (
                        <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                      )}
                      {x.r}
                    </span>
                  </td>
                  {SITUACOES.map((s) => (
                    <td key={s.chave} className="py-1.5 text-right">
                      {brlOuTraco((x as unknown as Record<string, number>)[s.chave])}
                    </td>
                  ))}
                  <td className="py-1.5 text-right font-semibold">{brlOuTraco(x.aReceber)}</td>
                </tr>
                {aberto === x.m && (
                  <tr className="border-b bg-muted/20">
                    <td colSpan={SITUACOES.length + 2} className="p-2">
                      <table className="w-full text-xs tabular-nums">
                        <thead className="text-muted-foreground">
                          <tr>
                            <th className="py-1 text-left font-medium">Unidade</th>
                            <th className="py-1 text-left font-medium">Cliente</th>
                            <th className="py-1 text-left font-medium">Parcela</th>
                            <th className="py-1 text-left font-medium">Situação</th>
                            <th className="py-1 text-left font-medium">Termo</th>
                            <th className="py-1 text-left font-medium">Assinatura</th>
                            <th className="py-1 text-left font-medium">Competência</th>
                            <th className="py-1 text-right font-medium">Valor</th>
                            <th className="py-1 text-right font-medium">Esperado</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...x.d]
                            .sort((a, b) => esperado(b) - esperado(a))
                            .map((p, i) => (
                              <tr key={i} className="border-t">
                                <td className="py-1">{p.unidade}</td>
                                <td className="py-1">{p.cliente}</td>
                                <td className="py-1">{p.parcela}</td>
                                <td className="py-1">{SITUACOES.find((s) => s.chave === p.situacao)?.rotulo ?? p.situacao}</td>
                                <td className="py-1">{fmtData(p.termo)}</td>
                                <td className="py-1">{fmtData(p.assinatura)}</td>
                                <td className="py-1">{fmtData(p.competencia)}</td>
                                <td className="py-1 text-right">{brlOuTraco(p.valor)}</td>
                                <td className="py-1 text-right">{brlOuTraco(esperado(p))}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

function somaMes(m: string, n: number) {
  const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
