import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "@/lib/utils";
import { useRoasData, monthLabel } from "./data-context";
import { aggregateUnidades, investimentoEfetivo } from "./calculations";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";

// TODO(design): área empilhada com uma série por unidade passa de 3 (DESIGN §5); decisão de produto.
const COLORS = CORES_SERIE;

export function TrendTab() {
  const { contratos, configs, mesesDisponiveis } = useRoasData();
  const meses = mesesDisponiveis;
  const unidades = useMemo(() => configs.map((c) => c.nome).sort(), [configs]);

  // ROAS por mês × unidade (denominador correto = midia_mensal efetivo da unidade)
  const { roasByKey, dealsByKey, totalRoasByMes } = useMemo(() => {
    const roas = new Map<string, number>();
    const deals = new Map<string, number>();
    const totalRoas = new Map<string, number>();
    for (const m of meses) {
      const aggs = aggregateUnidades(contratos, configs, m);
      let mrrSum = 0;
      let invSum = 0;
      for (const a of aggs) {
        roas.set(`${m}__${a.unidade}`, a.roas);
        deals.set(`${m}__${a.unidade}`, a.deals);
        mrrSum += a.modelo === "absorcao" ? a.cacRecebido : a.mrrMes;
        invSum += a.investimento;
      }
      totalRoas.set(m, invSum > 0 ? mrrSum / invSum : 0);
    }
    return { roasByKey: roas, dealsByKey: deals, totalRoasByMes: totalRoas };
  }, [contratos, configs, meses]);

  const areaData = useMemo(() => {
    return meses.map((m) => {
      const row: Record<string, number | string> = { mes: monthLabel(m) };
      for (const u of unidades) row[u] = dealsByKey.get(`${m}__${u}`) ?? 0;
      return row;
    });
  }, [meses, unidades, dealsByKey]);

  void configs.map(investimentoEfetivo); // silence unused

  return (
    <div className="space-y-6">
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold">Deals por unidade ao longo do tempo</h3>
        <p className="mb-4 text-xs text-muted-foreground">Área empilhada — volume total de deals por mês.</p>
        <div className="h-80 w-full">
          <ResponsiveContainer>
            <AreaChart data={areaData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="mes" />
              <YAxis {...eixoProps} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendaProps} />
              {unidades.map((u, i) => (
                <Area
                  key={u}
                  type="monotone"
                  dataKey={u}
                  stackId="1"
                  stroke={COLORS[i % COLORS.length]}
                  fill={COLORS[i % COLORS.length]}
                  fillOpacity={0.7}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b p-4">
          <h3 className="text-sm font-semibold">Evolução mensal do ROAS por unidade</h3>
          <p className="text-xs text-muted-foreground">
            Verba/Interna: MRR fechado ÷ Inv. mensal. Absorção: CAC recebido ÷ Inv. mensal. Verde ≥ 1, vermelho &lt; 1.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left">Unidade</th>
                {meses.map((m) => (
                  <th key={m} className="px-3 py-2 text-center">{monthLabel(m)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {unidades.map((u) => (
                <tr key={u} className="border-t">
                  <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">{u}</td>
                  {meses.map((m) => {
                    const v = roasByKey.get(`${m}__${u}`);
                    if (v == null) {
                      return (
                        <td key={m} className="px-3 py-2 text-center text-muted-foreground">—</td>
                      );
                    }
                    return (
                      <td key={m} className="px-3 py-2 text-center">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                            v >= 1
                              ? "bg-success-soft text-success"
                              : "bg-danger-soft text-danger",
                          )}
                        >
                          {v.toFixed(2)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t bg-muted/40 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/40 px-3 py-2">TOTAL</td>
                {meses.map((m) => {
                  const v = totalRoasByMes.get(m) ?? 0;
                  return (
                    <td key={m} className="px-3 py-2 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-xs",
                          v >= 1
                            ? "bg-success-soft text-success"
                            : "bg-danger-soft text-danger",
                        )}
                      >
                        {v.toFixed(2)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
