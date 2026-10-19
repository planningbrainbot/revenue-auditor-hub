import { Fragment, useMemo, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
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
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EstadoVazio, KpiCard, KpiGrade, StatusBadge } from "@/components/planning";
import { cn } from "@/lib/utils";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { brlOuTraco } from "@/components/receita/moldura";
import type { AbaMensal, DreCaixa, LinhaForecast } from "@/lib/dre-caixa.functions";

// As visões da área BI Financeiro que vêm das abas de análise da planilha (contrato
// docs/design/contratos/bi-financeiro.md): Visão executiva, Forecast × Realizado,
// Aquisição × Retenção, Fôlego e o "deveria × recebeu" da Competência × Caixa.
// Tudo vem pronto na chave `bi` do retrato `ops.dre_caixa`; a tela só escolhe meses e soma.

const MES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const rot = (m: string) => `${MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const mil = (v: number) =>
  Math.abs(v) < 500 ? "0" : `${(v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
const pct = (v: number | null) =>
  v === null || !Number.isFinite(v) ? "—" : `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const sinal = (v: number) => (v > 0 ? "+" : "") + brlOuTraco(v);

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

function SemPlanilha() {
  return (
    <EstadoVazio
      titulo="Este retrato ainda não traz as análises da planilha"
      descricao="Elas entram no retrato gerado por tools/dre_caixa_payload.py a partir de 19/10/2026."
    />
  );
}

/** Desvio a favor do plano? Receita e resultado: acima é bom. Custo: abaixo é bom. */
const favoravel = (l: LinhaForecast, d: number) => (l.tipo === "c" ? d < 0 : d > 0);
const corDesvio = (l: LinhaForecast, d: number) =>
  Math.abs(d) < 1 ? "text-muted-foreground" : favoravel(l, d) ? "text-success" : "text-danger";

function linhaF(D: DreCaixa, rotulo: string) {
  return D.bi?.forecast.linhas.find((l) => l.r === rotulo);
}

function serieAba(aba: AbaMensal | undefined, prefixo: string, meses: string[]): (number | null)[] {
  const l = aba?.linhas.find((x) => x.k.startsWith(prefixo));
  return meses.map((m) => {
    const j = aba?.meses.indexOf(m) ?? -1;
    return l?.v && j >= 0 ? l.v[j] : null;
  });
}

/** Meses fechados (não "andamento") até `ate`, do mais antigo ao mais novo. */
function fechadosAte(D: DreCaixa, ate: string) {
  return D.meses.filter((m) => m <= ate && !(D.situacao[m] ?? "").includes("andamento"));
}

/** Queima média sem o investidor (competência) dos últimos 3 meses fechados e os meses de caixa. */
function folego(D: DreCaixa, mes: string) {
  const bi = D.bi;
  const fech = fechadosAte(D, mes).slice(-3);
  const queima = serieAba(bi?.burn, "(=) QUEIMA DO MÊS SEM O INVESTIDOR", fech).map((v) => v ?? 0);
  const media = queima.length ? queima.reduce((a, b) => a + b, 0) / queima.length : 0;
  const saldo = serieAba(bi?.competencia_caixa, "(=) Saldo em conta no fim do mês", [mes])[0];
  const meses = saldo !== null && media < 0 ? saldo / -media : null;
  return { fech, media, saldo, meses };
}

// ---------------------------------------------------------------- visão executiva

export function VisaoExecutiva({ D }: { D: DreCaixa }) {
  const bi = D.bi;
  const fMeses = bi?.forecast.meses ?? [];
  const padrao = fMeses[fMeses.length - 1] ?? D.meses[D.meses.length - 1];
  const [mesUrl, setMes] = useFiltroNaUrl("mes", padrao);
  const mes = fMeses.includes(mesUrl) ? mesUrl : padrao;
  if (!bi) return <SemPlanilha />;

  const j = fMeses.indexOf(mes);
  const parcial = bi.forecast.parcial === mes;
  const receita = linhaF(D, "(=) Receita bruta");
  const ebit = linhaF(D, "(=) EBIT");
  const queima = serieAba(bi.burn, "(=) QUEIMA DO MÊS SEM O INVESTIDOR", [mes])[0];
  const f = folego(D, mes);
  const saldoSemInv = serieAba(bi.competencia_caixa, "(=) Saldo em conta sem o investidor", [mes])[0];
  const devendo = (D.inadimplencia?.unidades_partners ?? []).reduce((a, u) => a + u.total, 0);
  const trilha = (prefixo: string, aba: AbaMensal) => serieAba(aba, prefixo, fMeses);

  const kpiPlano = (rotulo: string, l: LinhaForecast | undefined, href: string) => {
    const p = l?.p?.[j] ?? null;
    const v = l?.v?.[j] ?? null;
    const d = p !== null && v !== null ? v - p : null;
    return (
      <KpiCard
        rotulo={rotulo}
        valor={brlOuTraco(v)}
        estado={parcial ? "parcial" : "ok"}
        meta={p !== null ? { valor: brlOuTraco(p), rotulo: "forecast", progresso: p > 0 && v !== null ? v / p : undefined } : undefined}
        nota={d !== null && l ? `${sinal(d)} contra o forecast` : "sem forecast para o mês"}
        tom={d === null || !l ? undefined : favoravel(l, d) ? "sucesso" : "perigo"}
        tendencia={l?.v ? { valores: l.v.slice(0, j + 1), rotulo: `${rot(fMeses[0])} a ${rot(mes)}` } : undefined}
        abrir={{ href, rotulo: "Ver no Forecast × Realizado" }}
      />
    );
  };

  // "Onde o resultado desvia": as três linhas com maior desvio em R$ no mês, fora totais e títulos.
  const desvios = bi.forecast.linhas
    .filter((l) => l.tipo !== "t" && !l.total && l.p && l.v)
    .map((l) => ({ l, d: (l.v![j] ?? 0) - (l.p![j] ?? 0) }))
    .filter((x) => Math.abs(x.d) >= 1)
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 3);

  const saldos = trilha("(=) Saldo em conta no fim do mês", bi.competencia_caixa);
  const historico = fMeses.map((m, i) => ({
    r: rot(m),
    m,
    receitaP: Math.round(receita?.p?.[i] ?? 0),
    receitaV: Math.round(receita?.v?.[i] ?? 0),
    ebitP: Math.round(ebit?.p?.[i] ?? 0),
    ebitV: Math.round(ebit?.v?.[i] ?? 0),
    saldo: saldos[i],
  }));

  return (
    <>
      <Card className="flex flex-wrap items-center gap-3 p-3">
        <span className="text-sm font-medium">Mês</span>
        <Select value={mes} onValueChange={(v) => setMes(v === padrao ? undefined : v)}>
          <SelectTrigger className="h-8 w-[110px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fMeses.map((m) => (
              <SelectItem key={m} value={m}>
                {rot(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parcial ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge tom="atencao">Parcial</StatusBadge>
            {bi.forecast.atualizado.replace(/^Atualizado em [^.]*\.\s*/, "")} O mês aberto sempre parece pior: a
            despesa entra no começo e a receita vai sendo emitida.
          </span>
        ) : (
          <StatusBadge tom={(D.situacao[mes] ?? "").startsWith("fechado") ? "sucesso" : "atencao"}>
            {(D.situacao[mes] ?? "").startsWith("fechado") ? "Fechado" : "Provisório"}
          </StatusBadge>
        )}
      </Card>

      <KpiGrade colunas={3}>
        {kpiPlano("Receita bruta", receita, "/bi-financeiro?aba=forecast")}
        {kpiPlano("EBIT", ebit, "/bi-financeiro?aba=forecast")}
        <KpiCard
          rotulo="Queima sem o investidor"
          valor={brlOuTraco(queima)}
          estado={parcial ? "parcial" : "ok"}
          nota="EBIT + não operacional, sem o aporte (competência)"
          tom={queima === null ? undefined : queima >= 0 ? "sucesso" : "perigo"}
          tendencia={{ valores: trilha("(=) QUEIMA DO MÊS SEM O INVESTIDOR", bi.burn).slice(0, j + 1), rotulo: "por mês" }}
          abrir={{ href: "/bi-financeiro?aba=folego", rotulo: "Ver o fôlego" }}
        />
        <KpiCard
          rotulo="Saldo em conta"
          valor={brlOuTraco(f.saldo)}
          nota={`fim de ${rot(mes)} pelo extrato · sem o investidor ${brlOuTraco(saldoSemInv)}`}
          tendencia={{ valores: saldos.slice(0, j + 1), rotulo: "fim de cada mês" }}
          abrir={{ href: "/bi-financeiro?aba=ponte", rotulo: "Ver Competência × Caixa" }}
        />
        <KpiCard
          rotulo="Meses de caixa sem o investidor"
          valor={f.meses === null ? "—" : f.meses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          nota={
            f.meses === null
              ? "sem queima nos últimos meses fechados"
              : `saldo ÷ queima média de ${f.fech.map(rot).join(", ")} (${brlOuTraco(-f.media)}/mês)`
          }
          tom={f.meses === null ? undefined : f.meses < 3 ? "perigo" : f.meses < 6 ? "atencao" : "sucesso"}
          abrir={{ href: "/bi-financeiro?aba=folego", rotulo: "Ver o fôlego" }}
        />
        <KpiCard
          rotulo="Unidades devendo à Partners"
          valor={D.inadimplencia ? brlOuTraco(devendo) : "—"}
          estado={D.inadimplencia ? "ok" : "indisponivel"}
          nota="vencido no Omie da Partners, hoje"
          tom={devendo > 0 ? "atencao" : undefined}
          abrir={{ href: "/bi-financeiro?aba=inadimplencia", rotulo: "Ver inadimplência" }}
        />
      </KpiGrade>

      <Secao
        titulo="Onde o resultado desvia do forecast"
        sub={`As três linhas que mais se afastam do Forecast Oficial em ${rot(mes)}, em reais.`}
      >
        {desvios.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma linha fora do plano neste mês.</p>
        ) : (
          <ul className="flex flex-col divide-y">
            {desvios.map(({ l, d }) => (
              <li key={l.r} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{l.r}</p>
                  <p className="text-xs text-muted-foreground">
                    previsto {brlOuTraco(l.p![j])} · realizado {brlOuTraco(l.v![j])}
                    {l.nota ? ` · ${l.nota}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cn("text-sm font-semibold tabular-nums", corDesvio(l, d))}>{sinal(d)}</span>
                  <StatusBadge tom={favoravel(l, d) ? "sucesso" : "perigo"}>
                    {favoravel(l, d) ? "a favor" : "contra o plano"}
                  </StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          to="/bi-financeiro"
          search={{ aba: "forecast" }}
          className="text-sm font-medium text-primary-text underline-offset-4 hover:underline"
        >
          Ver todas as linhas
        </Link>
      </Secao>

      <Secao
        titulo="Como fechamos os últimos meses"
        sub="Realizado (barra cheia) contra o Forecast Oficial (barra clara), desde o primeiro mês do forecast."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          {(
            [
              ["Receita bruta", "receitaP", "receitaV"],
              ["EBIT", "ebitP", "ebitV"],
            ] as const
          ).map(([titulo, p, v]) => (
            <div key={titulo}>
              <p className="mb-1 text-sm font-medium">{titulo}</p>
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={historico} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="r" {...eixoProps} />
                    <YAxis {...eixoProps} tickFormatter={mil} width={64} />
                    <Tooltip {...tooltipProps} formatter={(x: number, n: string) => [brlOuTraco(x), n]} />
                    <Legend {...legendaProps} />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Bar dataKey={p} name="Forecast" fill={CORES_SERIE[0]} fillOpacity={0.35} radius={3} isAnimationActive={false} />
                    <Bar dataKey={v} name="Realizado" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm tabular-nums">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Mês</th>
                <th className="py-2 pr-3 text-right font-medium">Receita</th>
                <th className="py-2 pr-3 text-right font-medium">EBIT</th>
                <th className="py-2 pr-3 text-right font-medium">Margem</th>
                <th className="py-2 pr-3 text-right font-medium">EBIT contra o forecast</th>
                <th className="py-2 text-right font-medium">Saldo em conta</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h) => (
                <tr key={h.m} className={cn("border-b last:border-0", h.m === mes && "bg-muted/50")}>
                  <td className="py-2 pr-3">
                    {h.r}
                    {bi.forecast.parcial === h.m && <span className="ml-1 text-xs text-muted-foreground">(parcial)</span>}
                  </td>
                  <td className="py-2 pr-3 text-right">{brlOuTraco(h.receitaV)}</td>
                  <td className="py-2 pr-3 text-right">{brlOuTraco(h.ebitV)}</td>
                  <td className="py-2 pr-3 text-right">{pct(h.receitaV ? h.ebitV / h.receitaV : null)}</td>
                  <td
                    className={cn(
                      "py-2 pr-3 text-right",
                      h.ebitV - h.ebitP >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {sinal(h.ebitV - h.ebitP)}
                  </td>
                  <td className="py-2 text-right">{brlOuTraco(h.saldo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------- forecast × realizado

export function ForecastRealizado({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const bi = D.bi;
  if (!bi) return <SemPlanilha />;
  const F = bi.forecast;
  const escolhidos = idx.map((i) => D.meses[i]).filter((m) => F.meses.includes(m));
  if (escolhidos.length === 0)
    return (
      <EstadoVazio
        titulo="O Forecast Oficial não cobre este período"
        descricao={`O forecast começa em ${rot(F.meses[0])}. Escolha um período a partir dele.`}
      />
    );
  const cols = escolhidos.map((m) => F.meses.indexOf(m));
  const fechados = escolhidos.filter((m) => m !== F.parcial);
  const colsAcc = fechados.map((m) => F.meses.indexOf(m));
  const mostrarAcc = colsAcc.length > 1;

  return (
    <Secao
      titulo="Forecast Oficial × realizado, linha a linha"
      sub="Previsto = aba Forecast Oficial. Realizado = DRE (competência). Custo aparece positivo dos dois lados. Desvio verde é a favor do plano, vermelho é contra."
    >
      {F.parcial && escolhidos.includes(F.parcial) && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge tom="atencao">Parcial</StatusBadge>
          {rot(F.parcial)} ainda está aberto: a despesa entra no começo do mês e a receita vai sendo emitida. O
          acumulado só soma os meses fechados.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card py-2 pr-3 text-left font-medium">Linha</th>
              {escolhidos.map((m) => (
                <th key={m} colSpan={3} className="border-l px-2 py-2 text-center font-medium">
                  {rot(m)}
                  {m === F.parcial ? " (parcial)" : ""}
                </th>
              ))}
              {mostrarAcc && (
                <th colSpan={3} className="border-l px-2 py-2 text-center font-medium">
                  Acumulado {rot(fechados[0])} a {rot(fechados[fechados.length - 1])}
                </th>
              )}
            </tr>
            <tr className="border-b text-xs text-muted-foreground">
              <th className="sticky left-0 bg-card" />
              {[...escolhidos, ...(mostrarAcc ? ["acc"] : [])].map((m) => (
                <Fragment key={m}>
                  <th className="border-l px-2 py-1 text-right font-normal">Previsto</th>
                  <th className="px-2 py-1 text-right font-normal">Realizado</th>
                  <th className="px-2 py-1 text-right font-normal">Desvio</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {F.linhas.map((l) =>
              l.tipo === "t" ? (
                <tr key={l.r}>
                  <td
                    colSpan={1 + 3 * (escolhidos.length + (mostrarAcc ? 1 : 0))}
                    className="sticky left-0 bg-card pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {l.r}
                  </td>
                </tr>
              ) : (
                <tr key={l.r} className={cn("border-b last:border-0", l.total && "font-semibold")}>
                  <td className="sticky left-0 max-w-[280px] bg-card py-1.5 pr-3">
                    {l.r}
                    {l.nota && <p className="text-xs font-normal text-muted-foreground">{l.nota}</p>}
                  </td>
                  {[...cols.map((c) => [c]), ...(mostrarAcc ? [colsAcc] : [])].map((grupo, gi) => {
                    const p = grupo.reduce((a, c) => a + (l.p?.[c] ?? 0), 0);
                    const v = grupo.reduce((a, c) => a + (l.v?.[c] ?? 0), 0);
                    const d = v - p;
                    return (
                      <Fragment key={gi}>
                        <td className="border-l px-2 py-1.5 text-right text-muted-foreground">{brlOuTraco(p)}</td>
                        <td className="px-2 py-1.5 text-right">{brlOuTraco(v)}</td>
                        <td className={cn("px-2 py-1.5 text-right", corDesvio(l, d))}>{sinal(d)}</td>
                      </Fragment>
                    );
                  })}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </Secao>
  );
}

// ---------------------------------------------------------------- abas mês a mês

function TabelaAba({ aba, meses, destaque }: { aba: AbaMensal; meses: string[]; destaque?: (k: string) => boolean }) {
  const cols = meses.map((m) => aba.meses.indexOf(m)).filter((j) => j >= 0);
  const linhas = aba.linhas.filter(
    (l) => l.titulo || l.nivel === 0 || cols.some((j) => Math.abs(l.v?.[j] ?? 0) >= 1),
  );
  const ehPct = (k: string) => k.includes("(%)") || k.toLowerCase().includes("inadimplência acumulada");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs text-muted-foreground">
            <th className="sticky left-0 bg-card py-2 pr-3 text-left font-medium">Linha</th>
            {cols.map((j) => (
              <th key={j} className="px-2 py-2 text-right font-medium">
                {rot(aba.meses[j])}
              </th>
            ))}
            {cols.length > 1 && <th className="border-l px-2 py-2 text-right font-medium">Soma</th>}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l, i) =>
            l.titulo ? (
              <tr key={i}>
                <td
                  colSpan={cols.length + 2}
                  className="sticky left-0 bg-card pb-1 pt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {l.k}
                </td>
              </tr>
            ) : (
              <tr
                key={i}
                className={cn(
                  "border-b last:border-0",
                  l.nivel === 0 && "font-semibold",
                  destaque?.(l.k) && "bg-muted/50",
                )}
              >
                <td className={cn("sticky left-0 max-w-[320px] bg-card py-1.5 pr-3", l.nivel === 1 && "pl-4 font-normal")}>
                  {l.k}
                </td>
                {cols.map((j) => (
                  <td
                    key={j}
                    className={cn("px-2 py-1.5 text-right", (l.v?.[j] ?? 0) < -0.5 && "text-danger")}
                  >
                    {ehPct(l.k) ? pct(l.v?.[j] ?? null) : brlOuTraco(l.v?.[j])}
                  </td>
                ))}
                {cols.length > 1 && (
                  <td className="border-l px-2 py-1.5 text-right">
                    {ehPct(l.k) || l.k.toLowerCase().includes("saldo") || l.k.includes("acumulado")
                      ? ""
                      : brlOuTraco(cols.reduce((a, j) => a + (l.v?.[j] ?? 0), 0))}
                  </td>
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
    </div>
  );
}

export function AquisicaoRetencao({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const bi = D.bi;
  const meses = idx.map((i) => D.meses[i]);
  const dados = useMemo(() => {
    if (!bi) return [];
    const aq = serieAba(bi.aquisicao, "(=) RESULTADO DA AQUISIÇÃO", meses);
    const re = serieAba(bi.retencao, "(=) RESULTADO DA RETENÇÃO", meses);
    return meses.map((m, i) => ({
      r: rot(m),
      aquisicao: Math.round(aq[i] ?? 0),
      retencao: Math.round(re[i] ?? 0),
      ebit: Math.round((aq[i] ?? 0) + (re[i] ?? 0)),
    }));
  }, [bi, meses.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bi) return <SemPlanilha />;
  const soma = (k: "aquisicao" | "retencao") => dados.reduce((a, d) => a + d[k], 0);

  return (
    <>
      <KpiGrade colunas={3}>
        <KpiCard
          rotulo="Resultado da aquisição"
          valor={brlOuTraco(soma("aquisicao"))}
          nota="o que entra para bancar o comercial − mídia, CSC Comercial e comissões"
          tom={soma("aquisicao") >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="Resultado da retenção"
          valor={brlOuTraco(soma("retencao"))}
          nota="royalties e receitas recorrentes − estrutura e impostos"
          tom={soma("retencao") >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard
          rotulo="EBIT"
          valor={brlOuTraco(soma("aquisicao") + soma("retencao"))}
          nota="aquisição + retenção, igual ao EBIT da DRE"
          tom={soma("aquisicao") + soma("retencao") >= 0 ? "sucesso" : "perigo"}
        />
      </KpiGrade>
      <Secao titulo="A máquina de vender e a carteira, mês a mês" sub="Cada conta é a mesma célula da DRE.">
        <div className="h-64">
          <ResponsiveContainer>
            <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(x: number, n: string) => [brlOuTraco(x), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="aquisicao" name="Aquisição" fill={CORES_SERIE[1]} radius={3} isAnimationActive={false} />
              <Bar dataKey="retencao" name="Retenção" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
              <Line dataKey="ebit" name="EBIT" stroke="var(--foreground)" strokeWidth={2} dot isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Secao>
      <Secao titulo="Aquisição" sub="Receita da aquisição (CSC das unidades, rateios, reembolsos de mídia, CAC) contra o custo de adquirir.">
        <TabelaAba aba={bi.aquisicao} meses={meses} />
      </Secao>
      <Secao titulo="Retenção" sub="Royalties e receitas recorrentes contra a estrutura: pessoal, administrativo, bancos, viagens e impostos.">
        <TabelaAba aba={bi.retencao} meses={meses} />
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------- fôlego

export function Folego({ D, idx }: { D: DreCaixa; idx: number[] }) {
  const bi = D.bi;
  const meses = idx.map((i) => D.meses[i]);
  if (!bi) return <SemPlanilha />;
  const ultimo = D.meses[D.meses.length - 1];
  const f = folego(D, ultimo);
  const queima = serieAba(bi.burn, "(=) QUEIMA DO MÊS SEM O INVESTIDOR", meses);
  const aq = serieAba(bi.burn, "Resultado da aquisição", meses);
  const re = serieAba(bi.burn, "Resultado da retenção", meses);
  const caixa = serieAba(bi.competencia_caixa, "(=) Queima sem o investidor · caixa", meses);
  const dados = meses.map((m, i) => ({
    r: rot(m),
    aquisicao: Math.round(aq[i] ?? 0),
    retencao: Math.round(re[i] ?? 0),
    queima: Math.round(queima[i] ?? 0),
    caixa: caixa[i] === null ? null : Math.round(caixa[i] ?? 0),
  }));
  const agenda = Object.entries(bi.cac_agenda.por_mes);

  return (
    <>
      <KpiGrade colunas={4}>
        <KpiCard
          rotulo="Meses de caixa sem o investidor"
          valor={f.meses === null ? "—" : f.meses.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          nota={`saldo de ${rot(ultimo)} ÷ queima média de ${f.fech.map(rot).join(", ")}`}
          tom={f.meses === null ? undefined : f.meses < 3 ? "perigo" : f.meses < 6 ? "atencao" : "sucesso"}
        />
        <KpiCard
          rotulo="Queima média sem o investidor"
          valor={brlOuTraco(f.media)}
          nota="por mês, competência, últimos 3 meses fechados"
          tom={f.media >= 0 ? "sucesso" : "perigo"}
        />
        <KpiCard rotulo="Saldo em conta" valor={brlOuTraco(f.saldo)} nota={`fim de ${rot(ultimo)}, extrato do Omie`} />
        <KpiCard
          rotulo="CAC atrasado"
          valor={brlOuTraco(bi.cac_agenda.atrasado.valor)}
          nota={`${bi.cac_agenda.atrasado.parcelas} parcelas de contratos assinados que já deviam ter entrado`}
          tom={bi.cac_agenda.atrasado.valor > 0 ? "atencao" : undefined}
        />
      </KpiGrade>
      <Secao
        titulo="Quanto queimamos sem o investidor"
        sub="Barras: resultado da aquisição e da retenção (competência). Linha cheia: a queima do mês sem o aporte. Linha tracejada: a mesma queima pelo caixa."
      >
        <div className="h-72">
          <ResponsiveContainer>
            <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis dataKey="r" {...eixoProps} />
              <YAxis {...eixoProps} tickFormatter={mil} width={64} />
              <Tooltip {...tooltipProps} formatter={(x: number, n: string) => [brlOuTraco(x), n]} />
              <Legend {...legendaProps} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="aquisicao" name="Aquisição" fill={CORES_SERIE[1]} radius={3} isAnimationActive={false} />
              <Bar dataKey="retencao" name="Retenção" fill={CORES_SERIE[0]} radius={3} isAnimationActive={false} />
              <Line dataKey="queima" name="Queima (competência)" stroke="var(--foreground)" strokeWidth={2} dot isAnimationActive={false} />
              <Line
                dataKey="caixa"
                name="Queima (caixa)"
                stroke="var(--muted-foreground)"
                strokeDasharray="5 4"
                strokeWidth={2}
                dot
                connectNulls={false}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <TabelaAba aba={bi.burn} meses={meses} destaque={(k) => k.startsWith("(=) QUEIMA")} />
      </Secao>
      <Secao
        titulo="CAC de contratos assinados que ainda vai entrar"
        sub="Agenda de parcelas contrato a contrato, pelo mês em que a parcela deve cair no caixa. Termo sem contrato fica de fora: depende de chance e está só na planilha."
      >
        {agenda.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma parcela a vencer na agenda.</p>
        ) : (
          <table className="w-full max-w-md text-sm tabular-nums">
            <tbody>
              {agenda.map(([m, x]) => (
                <tr key={m} className="border-b last:border-0">
                  <td className="py-1.5">{rot(m)}</td>
                  <td className="py-1.5 text-right text-muted-foreground">{x.parcelas} parcelas</td>
                  <td className="py-1.5 text-right">{brlOuTraco(x.valor)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1.5">Atrasado</td>
                <td className="py-1.5 text-right text-muted-foreground">{bi.cac_agenda.atrasado.parcelas} parcelas</td>
                <td className="py-1.5 text-right text-danger">{brlOuTraco(bi.cac_agenda.atrasado.valor)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Secao>
    </>
  );
}

// ---------------------------------------------------------------- deveria × recebeu

export function DeveriaRecebeu({ D, idx }: { D: DreCaixa; idx: number[] }) {
  if (!D.bi) return null;
  return (
    <Secao
      titulo="O que deveria ter entrado, o que entrou e o que ficou para trás"
      sub="Deveria = DRE (competência). Recebeu = extrato do Omie. 'Ficou para trás' é o acumulado do ano: negativo é dinheiro que a Partners ainda não viu."
    >
      <TabelaAba
        aba={D.bi.competencia_caixa}
        meses={idx.map((i) => D.meses[i])}
        destaque={(k) => k.includes("ficou para trás")}
      />
    </Secao>
  );
}
