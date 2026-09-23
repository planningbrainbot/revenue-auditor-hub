import { useMemo, useState } from "react";
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
import { brl, num } from "@/components/audit/format";
import { cn } from "@/lib/utils";
import { useRoasData, monthLabel } from "./data-context";
import { aggregateUnidades, type UnidadeMesAgg } from "./calculations";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, linhaMetaProps, tooltipProps } from "@/lib/planning/grafico";
import { KpiCard } from "@/components/planning";

function fmtBRL(v: number) {
  return brl(v);
}

function MonthSelect({
  value,
  onChange,
  meses,
}: {
  value: string;
  onChange: (m: string) => void;
  meses: string[];
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Mês:
      </label>
      <select
        className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {meses.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
    </div>
  );
}

interface Kpis {
  invTotal: number;
  verba: number;
  bolso: number;
  mrrTotal: number;
  mrrRegionais: number;
  mrrBUs: number;
  roas: number;
  gap: number;
  cacRecebido: number;
  saldo: number;
  royaltiesNovos: number; // royalties mensais dos contratos fechados no mês das unidades de absorção
  mesesParaCobrir: number | null;
}

function computeKpis(aggs: UnidadeMesAgg[]): Kpis {
  let invTotal = 0;
  let verba = 0;
  let bolso = 0;
  let mrrTotal = 0;
  let mrrRegionais = 0;
  let mrrBUs = 0;
  let cacRecebido = 0;
  let royaltiesNovos = 0;
  for (const a of aggs) {
    invTotal += a.investimento;
    if (a.modelo === "absorcao") bolso += a.investimento;
    else verba += a.investimento;
    mrrTotal += a.mrrMes;
    if (a.modelo === "interna") mrrBUs += a.mrrMes;
    else mrrRegionais += a.mrrMes;
    if (a.modelo === "absorcao") {
      cacRecebido += a.cacRecebido;
      const pct = Number(a.cfg.royalties_pct ?? 0) / 100;
      royaltiesNovos += a.mrrMes * pct;
    }
  }
  const roas = invTotal > 0 ? mrrTotal / invTotal : 0;
  const gap = bolso;
  const saldo = gap - cacRecebido;
  const mesesParaCobrir = saldo > 0 && royaltiesNovos > 0 ? saldo / royaltiesNovos : null;
  return { invTotal, verba, bolso, mrrTotal, mrrRegionais, mrrBUs, roas, gap, cacRecebido, saldo, royaltiesNovos, mesesParaCobrir };
}

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN
// §1.6). O `tone` pintava só o número; cor sozinha não é status (V7), então
// fica aceito e ignorado.
function Card({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "emerald" | "red" | "amber" | "neutral";
}) {
  return <KpiCard rotulo={label} valor={value} nota={sub} />;
}

export function OverviewTab() {
  const { contratos, configs, mesesDisponiveis, metricasMensais } = useRoasData();
  const meses = mesesDisponiveis.length ? mesesDisponiveis : [];
  const [mes, setMes] = useState<string>(meses[meses.length - 1] ?? "");

  const aggs = useMemo(() => (mes ? aggregateUnidades(contratos, configs, mes) : []), [contratos, configs, mes]);
  const k = useMemo(() => computeKpis(aggs), [aggs]);

  // Série mensal corrigida: investimento real = SUM(investimentoEfetivo) por mês,
  // que é constante (capacity da operação). MRR captado e Royalties variam.
  const invMensalFixo = useMemo(() => {
    let v = 0;
    for (const c of configs) {
      // reutiliza a fn investimentoEfetivo via aggregateUnidades para um mês qualquer
      v += c.tipo !== "interna" && (c.absorve_midia || c.paga_cac)
        ? (c.midia_mensal > 0 ? c.midia_mensal : 20000)
        : c.midia_mensal;
    }
    return v;
  }, [configs]);

  const barData = useMemo(() => {
    return meses.map((m) => {
      const a = aggregateUnidades(contratos, configs, m);
      let mrr = 0;
      let roy = 0;
      for (const u of a) {
        mrr += u.mrrMes;
        roy += u.royaltiesMes;
      }
      return { mes: monthLabel(m), investimento: invMensalFixo, mrr, royalties: roy };
    });
  }, [contratos, configs, meses, invMensalFixo]);

  void metricasMensais; // mantido para compat

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelect value={mes} onChange={setMes} meses={meses} />
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card
          label="Investimento Total do Mês"
          value={fmtBRL(k.invTotal)}
          sub={`Verba recebida: ${fmtBRL(k.verba)}  |  Bolso próprio: ${fmtBRL(k.bolso)}`}
        />
        <Card
          label="MRR Gerado no Mês"
          value={fmtBRL(k.mrrTotal)}
          sub={`Regionais: ${fmtBRL(k.mrrRegionais)}  |  BUs internas: ${fmtBRL(k.mrrBUs)}`}
          tone={k.mrrTotal >= k.invTotal ? "emerald" : "red"}
        />
        <Card
          label="ROAS do Mês"
          value={k.roas.toFixed(2)}
          sub="Break-even em 1,00"
          tone={k.roas >= 1 ? "emerald" : "red"}
        />
        <Card
          label="Status do Gap"
          value={
            k.saldo <= 0
              ? "✓ Coberto"
              : `Faltam ${fmtBRL(k.saldo)}`
          }
          sub={
            k.saldo <= 0
              ? "Gap próprio coberto pelo CAC no mês"
              : k.mesesParaCobrir != null
                ? `Payback em ${k.mesesParaCobrir.toFixed(1)} meses via royalties dos novos`
                : "Sem royalties novos no mês para projetar payback"
          }
          tone={k.saldo <= 0 ? "emerald" : "amber"}
        />
      </div>

      {/* Análise do investimento */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Q1 */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Q1 — Teve ROAS 1 no mês?
          </div>
          <div className="mt-3 h-4 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                k.roas >= 1 ? "bg-success" : k.roas >= 0.6 ? "bg-warning" : "bg-danger",
              )}
              style={{ width: `${Math.min(100, k.roas * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="mt-3 text-sm">
            <span className="font-semibold">{fmtBRL(k.mrrTotal)}</span>{" "}
            <span className="text-muted-foreground">de {fmtBRL(k.invTotal)} para ROAS 1</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {(k.roas * 100).toFixed(0)}% do break-even
          </div>
        </div>

        {/* Q2 — waterfall */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Q2 — A verba cobriu o investimento?
          </div>
          <div className="mt-3 space-y-1.5 text-sm">
            <Row label="Investimento total" value={-k.invTotal} />
            <Row label="+ Verba recebida" value={k.verba} />
            <Row label="= Gap próprio" value={-k.gap} muted />
            <Row label="+ CAC recebido" value={k.cacRecebido} />
            <div className="mt-1 border-t pt-1.5">
              <Row
                label="= Saldo final"
                value={-k.saldo}
                bold
                tone={k.saldo <= 0 ? "emerald" : "red"}
              />
            </div>
          </div>
        </div>

        {/* Q3 */}
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Q3 — Quanto tempo p/ o dinheiro voltar?
          </div>
          {k.saldo <= 0 ? (
            <>
              <div className="mt-4 text-3xl font-bold text-success">
                Mês 1 ✓
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                CAC cobriu o investimento próprio no mesmo mês.
              </div>
            </>
          ) : (
            <>
              <div className="mt-4 text-3xl font-bold text-warning">
                {k.mesesParaCobrir != null ? `${k.mesesParaCobrir.toFixed(1)} meses` : "—"}
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Saldo {fmtBRL(k.saldo)} ÷ Royalties{" "}
                {fmtBRL(k.royaltiesNovos)}/mês
              </div>
            </>
          )}
        </div>
      </div>

      {/* Gráfico corrigido */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold">Investimento vs MRR captado vs Royalties</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Investimento mensal total ({fmtBRL(invMensalFixo)}) vs MRR fechado no mês e royalties recorrentes.
        </p>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={barData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="mes" />
              <YAxis {...eixoProps} tickFormatter={(v) => num(v)} />
              <Tooltip {...tooltipProps} formatter={(v: number) => brl(v)} />
              <Legend {...legendaProps} />
              <ReferenceLine
                y={invMensalFixo}
                {...linhaMetaProps}
                label={{ value: "Break-even", fill: "var(--muted-foreground)", fontSize: 12 }}
              />
              <Bar dataKey="investimento" fill={CORES_SERIE[0]} name="Investimento" />
              <Bar dataKey="mrr" fill={CORES_SERIE[1]} name="MRR captado" />
              <Bar dataKey="royalties" fill={CORES_SERIE[2]} name="Royalties do mês" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  tone,
}: {
  label: string;
  value: number;
  bold?: boolean;
  muted?: boolean;
  tone?: "emerald" | "red";
}) {
  const cls = cn(
    "flex items-center justify-between",
    bold && "font-semibold",
    muted && "text-muted-foreground",
    tone === "emerald" && "text-success",
    tone === "red" && "text-danger",
  );
  const sign = value >= 0 ? "+" : "−";
  return (
    <div className={cls}>
      <span>{label}</span>
      <span>
        {sign}
        {brl(Math.abs(value))}
      </span>
    </div>
  );
}
