import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
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

const COLORS = ["#f59e0b", "#10b981", "#6366f1", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

export function CacTab() {
  const { registros, cnpjToUnidade, unidadesByName } = useData();
  const [selected, setSelected] = useState<UnidadeAggregate | null>(null);

  const { clientes, units, monthlySeries, kpis, pieData } = useMemo(() => {
    const clientes = enrichAll(registros, cnpjToUnidade, unidadesByName);
    const all = aggregateByUnit(clientes);
    // Para CAC oficial, ignorar bucket "Sem unidade" das somas mas mostrar na tabela.
    const units = all;
    const valid = all.filter((u) => u.nome !== "Sem unidade");
    const monthly = aggregateMonthly(clientes, "cac");
    const months = lastNMonths(18);
    const map = new Map(monthly.map((m) => [m.month, m.value]));
    const monthlySeries = months.map((m) => ({ label: formatMonthLabel(m), month: m, value: map.get(m) ?? 0 }));

    const cur = currentYM();
    const cacTotal = valid.reduce((s, u) => s + u.cacRealizado, 0);
    const cacPend = valid.reduce((s, u) => s + u.cacPendente, 0);
    const qtdAqMes = clientes.filter((c) => c.cacMes === cur && c.cacRecebido > 0 && c.unidadeNome).length;
    const ticketsMedio = (() => {
      const vals = clientes.filter((c) => c.cacRecebido > 0 && c.unidadeNome).map((c) => c.cacRecebido);
      if (vals.length === 0) return 0;
      return vals.reduce((s, x) => s + x, 0) / vals.length;
    })();

    const pieData = valid
      .filter((u) => u.cacRealizado > 0)
      .map((u) => ({ name: u.nome, value: u.cacRealizado }));

    return {
      clientes,
      units,
      monthlySeries,
      pieData,
      kpis: { cacTotal, cacPend, qtdAqMes, ticketsMedio },
    };
  }, [registros, cnpjToUnidade, unidadesByName]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="CAC recebido (matriz)"
          value={brl(kpis.cacTotal)}
          tone="emerald"
          highlight
          help="Soma do 1º pagamento de cada cliente — repassado integralmente da unidade para a matriz."
        />
        <KpiCard
          label="CAC pendente"
          value={brl(kpis.cacPend)}
          tone="orange"
          help="Estimativa (baseada no MRR) dos CACs ainda não recebidos: clientes com contrato fechado mas sem 1º pagamento."
        />
        <KpiCard
          label="Aquisições no mês"
          value={num(kpis.qtdAqMes)}
          sub={formatMonthLabel(currentYM())}
          help="Quantidade de novos clientes que fizeram o 1º pagamento neste mês corrente."
        />
        <KpiCard
          label="Ticket médio de CAC"
          value={brl(kpis.ticketsMedio)}
          help="Valor médio do 1º pagamento por cliente."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">CAC recebido mês a mês (últimos 18 meses)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlySeries}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(v: number) => brl(v)} />
                <Bar dataKey="value" name="CAC" fill="#f59e0b" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold">Participação no CAC por unidade</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={100} label>
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => brl(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">CAC por unidade</h3>
          <p className="text-xs text-muted-foreground">Clique numa linha para ver os clientes adquiridos.</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Unidade</th>
                <th className="px-3 py-2 text-right">Clientes</th>
                <th className="px-3 py-2 text-right">Aquisições</th>
                <th className="px-3 py-2 text-right">CAC realizado</th>
                <th className="px-3 py-2 text-right">CAC pendente</th>
                <th className="px-3 py-2 text-right">Ticket médio</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                const ticket = u.qtdAquisicoes > 0 ? u.cacRealizado / u.qtdAquisicoes : 0;
                const isOrphan = u.nome === "Sem unidade";
                return (
                  <tr
                    key={u.nome}
                    onClick={() => setSelected(u)}
                    className={`border-t cursor-pointer hover:bg-muted/50 ${isOrphan ? "opacity-70" : ""}`}
                  >
                    <td className="px-3 py-2 font-medium">{u.nome}</td>
                    <td className="px-3 py-2 text-right">{u.clientes.length}</td>
                    <td className="px-3 py-2 text-right">{u.qtdAquisicoes}</td>
                    <td className="px-3 py-2 text-right font-semibold text-success whitespace-nowrap">
                      {brl(u.cacRealizado)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap text-warning">
                      {brl(u.cacPendente)}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{brl(ticket)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <UnitDetailDrawer agg={selected} mode="cac" open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
