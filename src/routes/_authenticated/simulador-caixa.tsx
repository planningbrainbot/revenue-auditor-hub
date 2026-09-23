import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { TrendingDown, Calendar, Target } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { AppShell } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/simulador-caixa")({
  head: () => ({
    meta: [{ title: "Simulador de Fluxo de Caixa – Planning" }],
  }),
  // Página desativada: sem link no menu e acesso direto redireciona.
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: SimuladorCaixa,
});

// 3% annual churn → ~0.25% monthly
const CHURN_MONTHLY = 0.03 / 12;

const DEFAULTS = { investimento: 185_687, roas: 1.1, royalties: 9 };

// Fixed ROAS values for parallel scenario comparison
const SCENARIO_ROAS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const SCENARIO_COLORS = ["#ef4444", "#f97316", "#6366f1", "#0ea5e9", "#10b981", "#8b5cf6"];

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

interface MonthRow {
  mes: number;
  entradaRoas: number;
  entradaRoyalties: number;
  saida: number;
  fluxo: number;
  acumulado: number;
}

interface ScenarioResult {
  data: MonthRow[];
  drawdown: number;
  breakeven: number | null;
  payback: number | null;
}

function calcScenario(investimento: number, roas: number, royaltiesPct: number): ScenarioResult {
  const data: MonthRow[] = [];
  let acumulado = 0;
  let drawdown = 0;
  let breakeven: number | null = null;
  let payback: number | null = null;
  // Accumulated active client billing base (decays by churn each month)
  let royaltyBase = 0;

  for (let c = 0; c <= 35; c++) {
    const saida = investimento;
    const entradaRoas = c >= 3 ? investimento * roas : 0;
    // Royalties are paid on the base from PREVIOUS months (1-month lag)
    const entradaRoyalties = c >= 4 ? royaltyBase * (royaltiesPct / 100) : 0;
    const fluxo = entradaRoas + entradaRoyalties - saida;
    acumulado += fluxo;

    if (acumulado < drawdown) drawdown = acumulado;
    if (breakeven === null && fluxo >= 0) breakeven = c;
    if (payback === null && acumulado >= 0) payback = c;

    data.push({
      mes: c,
      entradaRoas,
      entradaRoyalties,
      saida,
      fluxo,
      acumulado: Math.round(acumulado),
    });

    // Add this month new cohort + decay existing base for next month
    if (c >= 3) {
      royaltyBase = royaltyBase * (1 - CHURN_MONTHLY) + investimento * roas;
    }
  }

  return { data, drawdown, breakeven, payback };
}

type ViewMode = "acumulado" | "mensal";

function SimuladorCaixa() {
  useAuth();
  const [loading, setLoading] = useState(true);
  const [investimento, setInvestimento] = useState(DEFAULTS.investimento);
  const [roas, setRoas] = useState(DEFAULTS.roas);
  const [royalties, setRoyalties] = useState(DEFAULTS.royalties);
  const [viewMode, setViewMode] = useState<ViewMode>("acumulado");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [roasRes, royRes] = await Promise.all([
          supabase
            .from("roas_mensal")
            .select("investimento_real, roas_direto, mes")
            .gte("mes", "2025-12-01")
            .lte("mes", "2026-05-31")
            .gt("investimento_real", 0),
          supabase
            .from("v_royalties_mensais")
            .select("faturado, royalties_percentual, mes")
            .gte("mes", "2026-06-01"),
        ]);
        if (cancelled) return;
        if (roasRes.error) throw roasRes.error;
        if (royRes.error) throw royRes.error;

        const rows = roasRes.data ?? [];
        if (rows.length > 0) {
          const avgInv =
            rows.reduce((s, r) => s + Number(r.investimento_real ?? 0), 0) / rows.length;
          const roasRows = rows.filter((r) => r.roas_direto != null);
          const avgRoas = roasRows.length
            ? roasRows.reduce((s, r) => s + Number(r.roas_direto ?? 0), 0) / roasRows.length
            : DEFAULTS.roas;
          setInvestimento(Math.round(avgInv));
          setRoas(Math.round(avgRoas * 100) / 100);
        }

        const royRows = (royRes.data ?? []).filter(
          (r) => Number(r.faturado ?? 0) > 0 && r.royalties_percentual,
        );
        if (royRows.length > 0) {
          const totalFat = royRows.reduce((s, r) => s + Number(r.faturado), 0);
          const weighted = royRows.reduce(
            (s, r) => s + (Number(r.faturado) * Number(r.royalties_percentual)) / 100,
            0,
          );
          if (totalFat > 0) setRoyalties(Math.round((weighted / totalFat) * 1000) / 100);
        }
      } catch (e) {
        console.error("simulador defaults:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const main = useMemo(
    () => calcScenario(investimento, roas, royalties),
    [investimento, roas, royalties],
  );

  const scenarios = useMemo(
    () => SCENARIO_ROAS.map((r) => ({ roas: r, ...calcScenario(investimento, r, royalties) })),
    [investimento, royalties],
  );

  // Merge all scenario acumulados into one dataset for the multi-line chart
  const chartDataAcumulado = useMemo(
    () =>
      main.data.map((row) => {
        const entry: Record<string, number> = { mes: row.mes };
        scenarios.forEach((s) => {
          entry["roas_" + String(s.roas).replace(".", "_")] = s.data[row.mes].acumulado;
        });
        return entry;
      }),
    [main, scenarios],
  );

  const closestScenarioIdx = scenarios.reduce(
    (best, s, i) =>
      Math.abs(s.roas - roas) < Math.abs(scenarios[best].roas - roas) ? i : best,
    0,
  );

  return (
    <AppShell
      title="Simulador de Fluxo de Caixa"
      subtitle="Vale do caixa: mídia mensal × royalties fracionados (churn 3% a.a.)"
    >
      <div className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {/* ── KPIs ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-5 border-l-4 border-l-destructive">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Aporte Máximo Necessário
                </div>
                <div className="mt-2 text-3xl font-bold text-destructive">{fmt(main.drawdown)}</div>
                <div className="text-xs text-muted-foreground mt-1">Fundo do Vale de Caixa</div>
              </div>
              <TrendingDown className="h-5 w-5 text-destructive" />
            </div>
          </Card>
          <Card className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Break-even Operacional
                </div>
                <div className="mt-2 text-3xl font-bold">
                  {main.breakeven !== null ? "Mês " + main.breakeven : "Fora do período"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">1º fluxo mensal ≥ 0</div>
              </div>
              <Calendar className="h-5 w-5 text-muted-foreground" />
            </div>
          </Card>
          <Card className="p-5 border-l-4 border-l-success">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Payback Total (ROI+)
                </div>
                <div className="mt-2 text-3xl font-bold text-success">
                  {main.payback !== null ? "Mês " + main.payback : "Fora do período"}
                </div>
                <div className="text-xs text-muted-foreground mt-1">Caixa acumulado ≥ 0</div>
              </div>
              <Target className="h-5 w-5 text-success" />
            </div>
          </Card>
        </div>

        {/* ── Params + Chart ── */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <Card className="lg:col-span-1 p-5 space-y-6 h-fit">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Parâmetros
            </h3>
            <SliderField
              label="Investimento Mensal em Mídia"
              loading={loading}
              value={investimento}
              min={10_000}
              max={500_000}
              step={1_000}
              onChange={setInvestimento}
              display={fmt(investimento)}
              hint="Média real dos últimos 6 meses"
            />
            <SliderField
              label="ROAS Médio"
              loading={loading}
              value={roas}
              min={0.1}
              max={3}
              step={0.05}
              onChange={setRoas}
              display={roas.toFixed(2) + "x"}
              hint="Média real dos últimos 6 meses"
            />
            <SliderField
              label="Taxa de Royalties"
              loading={loading}
              value={royalties}
              min={4}
              max={20}
              step={0.5}
              onChange={setRoyalties}
              display={royalties.toFixed(1) + "%"}
              hint="Média ponderada das unidades"
            />
          </Card>

          <Card className="lg:col-span-3 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">
                  {viewMode === "acumulado"
                    ? "Caixa Acumulado — cenários paralelos de ROAS"
                    : "Fluxo Mensal — mês a mês (ROAS " + roas.toFixed(2) + "x)"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {viewMode === "acumulado"
                    ? "Cada linha é um ROAS diferente. Linha mais grossa = mais próxima do slider."
                    : "Entradas e saída do cenário selecionado, sem acumulação."}
                </p>
              </div>
              <div className="flex gap-1 rounded-md border p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setViewMode("acumulado")}
                  className={cn(
                    "rounded px-3 py-1 font-medium transition-colors",
                    viewMode === "acumulado"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Acumulado
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("mensal")}
                  className={cn(
                    "rounded px-3 py-1 font-medium transition-colors",
                    viewMode === "mensal"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Mensal
                </button>
              </div>
            </div>

            <div className="h-[460px]">
              <ResponsiveContainer width="100%" height="100%">
                {viewMode === "acumulado" ? (
                  <AreaChart data={chartDataAcumulado} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      {scenarios.map((s, i) => (
                        <linearGradient key={s.roas} id={"fill" + i} x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor={SCENARIO_COLORS[i]} stopOpacity={0.15} />
                          <stop offset="95%" stopColor={SCENARIO_COLORS[i]} stopOpacity={0} />
                        </linearGradient>
                      ))}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="mes" tickFormatter={(v) => "M" + v} tick={{ fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(v) =>
                        Math.abs(v) >= 1000 ? Math.round(v / 1000) + "k" : String(v)
                      }
                      tick={{ fontSize: 12 }}
                    />
                    <ReferenceLine
                      y={0}
                      stroke="var(--foreground)"
                      strokeWidth={1.5}
                      label={{ value: "Break-even", position: "insideTopRight", fontSize: 11 }}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const mes = (payload[0]?.payload as { mes: number }).mes;
                        return (
                          <div className="rounded-md border bg-background p-3 text-xs shadow-md">
                            <div className="font-semibold mb-2">Mês {mes}</div>
                            {scenarios.map((s, i) => (
                              <div key={s.roas} style={{ color: SCENARIO_COLORS[i] }}>
                                ROAS {s.roas}x:{" "}
                                <strong>{fmt(s.data[mes]?.acumulado ?? 0)}</strong>
                              </div>
                            ))}
                          </div>
                        );
                      }}
                    />
                    {scenarios.map((s, i) => {
                      const key = "roas_" + String(s.roas).replace(".", "_");
                      const isClosest = i === closestScenarioIdx;
                      return (
                        <Area
                          key={s.roas}
                          type="monotone"
                          dataKey={key}
                          name={"ROAS " + s.roas + "x"}
                          stroke={SCENARIO_COLORS[i]}
                          strokeWidth={isClosest ? 2.5 : 1.5}
                          strokeOpacity={isClosest ? 1 : 0.5}
                          fill={"url(#fill" + i + ")"}
                          isAnimationActive={false}
                        />
                      );
                    })}
                    <Legend />
                  </AreaChart>
                ) : (
                  <AreaChart data={main.data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradPos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradNeg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradRoy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="mes" tickFormatter={(v) => "M" + v} tick={{ fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(v) =>
                        Math.abs(v) >= 1000 ? Math.round(v / 1000) + "k" : String(v)
                      }
                      tick={{ fontSize: 12 }}
                    />
                    <ReferenceLine y={0} stroke="var(--foreground)" strokeWidth={1} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const h = payload[0]?.payload as MonthRow;
                        return (
                          <div className="rounded-md border bg-background p-3 text-xs shadow-md">
                            <div className="font-semibold mb-1">Mês {h.mes}</div>
                            <div>
                              Mensalidade:{" "}
                              <strong className="text-success">{fmt(h.entradaRoas)}</strong>
                            </div>
                            <div>
                              Royalties:{" "}
                              <strong className="text-indigo-500">{fmt(h.entradaRoyalties)}</strong>
                            </div>
                            <div>
                              Saída Mídia:{" "}
                              <strong className="text-destructive">−{fmt(h.saida)}</strong>
                            </div>
                            <div className="mt-1 border-t pt-1">
                              Fluxo Líquido:{" "}
                              <strong
                                className={cn(
                                  h.fluxo >= 0 ? "text-success" : "text-destructive",
                                )}
                              >
                                {fmt(h.fluxo)}
                              </strong>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="entradaRoas"
                      name="Mensalidade"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#gradPos)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="entradaRoyalties"
                      name="Royalties"
                      stroke="#6366f1"
                      strokeWidth={2}
                      fill="url(#gradRoy)"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="saida"
                      name="Saída Mídia"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#gradNeg)"
                      isAnimationActive={false}
                    />
                    <Legend />
                  </AreaChart>
                )}
              </ResponsiveContainer>
            </div>
          </Card>
        </div>

        {/* ── Scenario comparison table ── */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Comparação de Cenários — Investimento {fmt(investimento)} · Royalties{" "}
            {royalties.toFixed(1)}% · Churn 3% a.a.
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 text-left">ROAS</th>
                  <th className="pb-2 text-right">Aporte Máx.</th>
                  <th className="pb-2 text-right">Break-even</th>
                  <th className="pb-2 text-right">Payback</th>
                  <th className="pb-2 text-right">Fluxo M12</th>
                  <th className="pb-2 text-right">Fluxo M24</th>
                  <th className="pb-2 text-right">Caixa M36</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((s, i) => (
                  <tr
                    key={s.roas}
                    className={cn("border-b transition-colors", i === closestScenarioIdx && "bg-muted/40")}
                  >
                    <td className="py-2 font-bold" style={{ color: SCENARIO_COLORS[i] }}>
                      {s.roas}x
                    </td>
                    <td className="py-2 text-right text-destructive">{fmt(s.drawdown)}</td>
                    <td className="py-2 text-right">
                      {s.breakeven !== null ? "Mês " + s.breakeven : "—"}
                    </td>
                    <td className="py-2 text-right">
                      {s.payback !== null ? "Mês " + s.payback : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right",
                        s.data[12].fluxo >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(s.data[12].fluxo)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right",
                        s.data[24].fluxo >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(s.data[24].fluxo)}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-semibold",
                        s.data[35].acumulado >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(s.data[35].acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Month-by-month detail table ── */}
        <Card className="p-5">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-4">
            Detalhe Mês a Mês — ROAS {roas.toFixed(2)}x
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 text-left">Mês</th>
                  <th className="pb-2 text-right">Mensalidade</th>
                  <th className="pb-2 text-right">Royalties</th>
                  <th className="pb-2 text-right">Saída Mídia</th>
                  <th className="pb-2 text-right">Fluxo Mensal</th>
                  <th className="pb-2 text-right">Caixa Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {main.data.map((row) => (
                  <tr key={row.mes} className={cn("border-b", row.mes % 2 === 0 && "bg-muted/20")}>
                    <td className="py-1 font-medium">M{row.mes}</td>
                    <td className="py-1 text-right text-success">{fmt(row.entradaRoas)}</td>
                    <td className="py-1 text-right text-indigo-500">{fmt(row.entradaRoyalties)}</td>
                    <td className="py-1 text-right text-destructive">−{fmt(row.saida)}</td>
                    <td
                      className={cn(
                        "py-1 text-right font-medium",
                        row.fluxo >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(row.fluxo)}
                    </td>
                    <td
                      className={cn(
                        "py-1 text-right font-semibold",
                        row.acumulado >= 0 ? "text-success" : "text-destructive",
                      )}
                    >
                      {fmt(row.acumulado)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

function SliderField({
  label,
  loading,
  value,
  min,
  max,
  step,
  onChange,
  display,
  hint,
}: {
  label: string;
  loading: boolean;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  display: string;
  hint: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium">{label}</label>
        <span className="text-sm font-bold tabular-nums">{display}</span>
      </div>
      {loading ? (
        <Skeleton className="h-4 w-full" />
      ) : (
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => onChange(v[0])}
        />
      )}
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{hint}</div>
    </div>
  );
}
