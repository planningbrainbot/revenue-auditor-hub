import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData } from "./data-context";
import { KpiCard } from "./kpi-card";
import { brl, num } from "./format";
import {
  aggregateByUnit,
  aggregateMonthly,
  currentYM,
  enrichAll,
  formatMonthLabel,
  lastNMonths,
  type UnidadeAggregate,
} from "./matriz-calc";
import { UnitDetailDrawer } from "./unit-detail-drawer";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";

export function RoyaltiesTab() {
  const { registros, cnpjToUnidade, unidadesByName } = useData();
  const [selected, setSelected] = useState<UnidadeAggregate | null>(null);

  const { units, monthlySeries, kpis, topUnits } = useMemo(() => {
    const clientes = enrichAll(registros, cnpjToUnidade, unidadesByName);
    const all = aggregateByUnit(clientes);
    const valid = all.filter((u) => u.nome !== "Sem unidade");
    const monthly = aggregateMonthly(clientes, "royalties");
    const months = lastNMonths(18);
    const map = new Map(monthly.map((m) => [m.month, m.value]));
    const monthlySeries = months.map((m) => ({ label: formatMonthLabel(m), month: m, value: map.get(m) ?? 0 }));

    const cur = currentYM();
    const total = valid.reduce((s, u) => s + u.royaltiesAcumulado, 0);
    const royaltiesMes = valid.reduce((s, u) => s + (u.royaltiesPorMes.get(cur) ?? 0), 0);
    const mesesComRoyalties = new Set<string>();
    valid.forEach((u) => u.royaltiesPorMes.forEach((_, m) => mesesComRoyalties.add(m)));
    const mediaMensal = mesesComRoyalties.size > 0 ? total / mesesComRoyalties.size : 0;
    const clientesAtivos = valid.reduce((s, u) => s + u.clientes.filter((c) => c.totalRoyalties > 0).length, 0);

    const topUnits = [...valid]
      .filter((u) => u.royaltiesAcumulado > 0)
      .sort((a, b) => b.royaltiesAcumulado - a.royaltiesAcumulado)
      .slice(0, 10)
      .map((u) => ({ nome: u.nome, value: u.royaltiesAcumulado }));

    return {
      units: all,
      monthlySeries,
      topUnits,
      kpis: { total, royaltiesMes, mediaMensal, clientesAtivos },
    };
  }, [registros, cnpjToUnidade, unidadesByName]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Royalties acumulado"
          value={brl(kpis.total)}
          tone="indigo"
          highlight
          help="Soma de todos os royalties já realizados pela matriz: % da unidade aplicada sobre cada pagamento a partir do 2º."
        />
        <KpiCard
          label="Royalties no mês"
          value={brl(kpis.royaltiesMes)}
          tone="emerald"
          sub={formatMonthLabel(currentYM())}
          help="Royalties recebidos no mês corrente."
        />
        <KpiCard
          label="Média mensal"
          value={brl(kpis.mediaMensal)}
          help="Média de royalties por mês considerando apenas meses em que houve recebimento."
        />
        <KpiCard
          label="Clientes contribuintes"
          value={num(kpis.clientesAtivos)}
          help="Clientes que já pagaram pelo menos a 2ª parcela e geraram royalties."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Royalties mês a mês (últimos 18 meses)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} dataKey="label" angle={-30} textAnchor="end" height={60} />
                <YAxis {...eixoProps} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip {...tooltipProps} formatter={(v: number) => brl(v)} />
                <Bar dataKey="value" name="Royalties" fill={CORES_SERIE[0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Top unidades por royalties acumulados</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topUnits} layout="vertical">
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} type="number" tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <YAxis {...eixoProps} dataKey="nome" type="category" width={110} />
                <Tooltip {...tooltipProps} formatter={(v: number) => brl(v)} />
                <Legend {...legendaProps} />
                <Bar dataKey="value" name="Royalties" fill={CORES_SERIE[0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Royalties por unidade</h3>
          <p className="text-xs text-muted-foreground">Clique numa linha para ver mês a mês e clientes contribuintes.</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Unidade</th>
                <th className="px-3 py-2 text-right">% Royalties</th>
                <th className="px-3 py-2 text-right">Clientes contribuintes</th>
                <th className="px-3 py-2 text-right">Royalties acumulado</th>
                <th className="px-3 py-2 text-right">Mês atual</th>
                <th className="px-3 py-2 text-right">Média / mês</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const cur = currentYM();
                const mesAtual = u.royaltiesPorMes.get(cur) ?? 0;
                const media = u.royaltiesPorMes.size > 0 ? u.royaltiesAcumulado / u.royaltiesPorMes.size : 0;
                const contribuintes = u.clientes.filter((c) => c.totalRoyalties > 0).length;
                const isOrphan = u.nome === "Sem unidade";
                return (
                  <tr
                    key={u.nome}
                    onClick={() => setSelected(u)}
                    className={`border-t cursor-pointer hover:bg-muted/50 ${isOrphan ? "opacity-70" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">{u.nome}</td>
                    <td className="px-3 py-2 text-right">{(u.pctRoyalties * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-right">{contribuintes}</td>
                    <td className="px-3 py-2 text-right font-semibold text-info whitespace-nowrap">
                      {brl(u.royaltiesAcumulado)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{brl(mesAtual)}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{brl(media)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <UnitDetailDrawer agg={selected} mode="royalties" open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
