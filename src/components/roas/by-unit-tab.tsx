import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { brl } from "@/components/audit/format";
import { cn } from "@/lib/utils";
import { useRoasData, monthLabel } from "./data-context";
import { aggregateUnidades, unidadesNaoMapeadas, type UnidadeMesAgg, type Modelo } from "./calculations";

const GROUPS: { key: Modelo; label: string; color: string }[] = [
  { key: "verba", label: "Regionais Verba", color: "bg-indigo-50 dark:bg-indigo-950/40" },
  { key: "absorcao", label: "Regionais Absorção / CAC", color: "bg-warning-soft" },
  { key: "interna", label: "BUs Internas", color: "bg-muted" },
];

function paybackTone(d: number | null): string {
  if (d == null) return "text-muted-foreground";
  if (d === 0) return "text-success";
  if (d <= 90) return "text-success";
  if (d <= 180) return "text-warning";
  if (d <= 360) return "text-warning";
  return "text-danger";
}

function paybackBarColor(d: number) {
  if (d <= 30) return "#10b981";
  if (d <= 90) return "#22c55e";
  if (d <= 180) return "#f59e0b";
  if (d <= 360) return "#f97316";
  return "#ef4444";
}

export function ByUnitTab() {
  const { contratos, configs, mesesDisponiveis } = useRoasData();
  const meses = mesesDisponiveis;
  const [mes, setMes] = useState<string>(meses[meses.length - 1] ?? "");
  const aggs = useMemo(() => (mes ? aggregateUnidades(contratos, configs, mes) : []), [contratos, configs, mes]);
  const naoMapeadas = useMemo(() => unidadesNaoMapeadas(contratos, configs), [contratos, configs]);

  const grouped = useMemo(() => {
    const out: Record<Modelo, UnidadeMesAgg[]> = { verba: [], absorcao: [], interna: [] };
    for (const a of aggs) out[a.modelo].push(a);
    return out;
  }, [aggs]);

  const chartData = useMemo(() => {
    return aggs
      .filter((a) => a.modelo !== "interna" && a.paybackDias != null)
      .map((a) => ({ unidade: a.unidade, payback: a.paybackDias! }))
      .sort((x, y) => x.payback - y.payback);
  }, [aggs]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Mês:
        </label>
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
        >
          {meses.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Unidade</th>
              <th className="px-3 py-2 text-center">Modelo</th>
              <th className="px-3 py-2 text-right">Inv./Mês</th>
              <th className="px-3 py-2 text-right">Deals</th>
              <th className="px-3 py-2 text-right">MRR Total</th>
              <th className="px-3 py-2 text-center">ROAS</th>
              <th className="px-3 py-2 text-right">CAC Recebido</th>
              <th className="px-3 py-2 text-right">Royalties/Mês</th>
              <th className="px-3 py-2 text-center">Payback</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => {
              const rows = grouped[g.key];
              if (rows.length === 0) return null;
              return (
                <GroupRows key={g.key} title={g.label} bg={g.color} rows={rows} />
              );
            })}
            {aggs.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  Sem dados para o mês selecionado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Não mapeados */}
      {naoMapeadas.length > 0 && (
        <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
          <div className="border-b bg-muted/30 px-4 py-2">
            <h3 className="text-sm font-semibold">Não Mapeados</h3>
            <p className="text-xs text-muted-foreground">
              Contratos cuja unidade em empresas não bate com nenhuma unidade da config (acumulado).
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Unidade</th>
                <th className="px-3 py-2 text-right">Contratos</th>
                <th className="px-3 py-2 text-right">MRR Total</th>
              </tr>
            </thead>
            <tbody>
              {naoMapeadas.map((u) => (
                <tr key={u.unidade} className="border-t">
                  <td className="px-3 py-2 font-medium">{u.unidade}</td>
                  <td className="px-3 py-2 text-right">{u.deals}</td>
                  <td className="px-3 py-2 text-right">{brl(u.mrr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Payback por unidade */}
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-1 text-sm font-semibold">Payback por unidade (dias) — {monthLabel(mes)}</h3>
        <p className="mb-4 text-xs text-muted-foreground">
          Matriz, Construção Civil e Consultoria não exibidas — royalties = 0%.
        </p>
        <div style={{ height: Math.max(220, chartData.length * 38) }} className="w-full">
          <ResponsiveContainer>
            <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, bottom: 5, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" fontSize={11} tickFormatter={(v) => `${v}d`} />
              <YAxis dataKey="unidade" type="category" fontSize={11} width={120} />
              <Tooltip formatter={(v: number) => `${v} dias`} />
              <Bar dataKey="payback" name="Payback (dias)">
                {chartData.map((d, i) => (
                  <Cell key={i} fill={paybackBarColor(d.payback)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function GroupRows({
  title,
  bg,
  rows,
}: {
  title: string;
  bg: string;
  rows: UnidadeMesAgg[];
}) {
  // totais do grupo
  const total = rows.reduce(
    (acc, r) => {
      acc.inv += r.investimento;
      acc.deals += r.deals;
      acc.mrr += r.mrrMes;
      acc.cac += r.cacRecebido;
      acc.roy += r.royaltiesMes;
      return acc;
    },
    { inv: 0, deals: 0, mrr: 0, cac: 0, roy: 0 },
  );
  const roasGrupo = total.inv > 0 ? (rows[0]?.modelo === "absorcao" ? total.cac : total.mrr) / total.inv : 0;
  return (
    <>
      <tr className={cn("border-t", bg)}>
        <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </td>
      </tr>
      {rows.map((r) => (
        <tr key={r.unidade} className="border-t hover:bg-muted/30">
          <td className="px-3 py-2 font-medium">{r.unidade}</td>
          <td className="px-3 py-2 text-center">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                r.modelo === "verba" && "bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200",
                r.modelo === "absorcao" && "bg-warning-soft text-warning",
                r.modelo === "interna" && "bg-muted text-foreground",
              )}
            >
              {r.modelo === "verba" ? "Verba" : r.modelo === "absorcao" ? "Absorção" : "Interna"}
            </span>
          </td>
          <td className="px-3 py-2 text-right">{brl(r.investimento)}</td>
          <td className="px-3 py-2 text-right">{r.deals}</td>
          <td className="px-3 py-2 text-right">{brl(r.mrrMes)}</td>
          <td className="px-3 py-2 text-center">
            <span
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                r.roas >= 1
                  ? "bg-success-soft text-success"
                  : "bg-danger-soft text-danger",
              )}
            >
              {r.roas.toFixed(2)}
            </span>
          </td>
          <td className="px-3 py-2 text-right">{r.modelo === "absorcao" ? brl(r.cacRecebido) : "—"}</td>
          <td className="px-3 py-2 text-right">{r.modelo === "interna" ? "—" : brl(r.royaltiesMes)}</td>
          <td className={cn("px-3 py-2 text-center text-xs font-semibold", paybackTone(r.paybackDias))}>
            {r.paybackTexto}
          </td>
        </tr>
      ))}
      <tr className={cn("border-t font-semibold", bg)}>
        <td className="px-3 py-1.5">Subtotal</td>
        <td />
        <td className="px-3 py-1.5 text-right">{brl(total.inv)}</td>
        <td className="px-3 py-1.5 text-right">{total.deals}</td>
        <td className="px-3 py-1.5 text-right">{brl(total.mrr)}</td>
        <td className="px-3 py-1.5 text-center">{roasGrupo.toFixed(2)}</td>
        <td className="px-3 py-1.5 text-right">{rows[0]?.modelo === "absorcao" ? brl(total.cac) : "—"}</td>
        <td className="px-3 py-1.5 text-right">{rows[0]?.modelo === "interna" ? "—" : brl(total.roy)}</td>
        <td />
      </tr>
    </>
  );
}
