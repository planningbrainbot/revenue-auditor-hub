import { Fragment, useMemo, useState } from "react";
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
import { Upload, Pencil, Check, X } from "lucide-react";
import { useData } from "./data-context";
import { KpiCard } from "./kpi-card";
import { brl } from "./format";
import {
  aggregateByUnit,
  enrichAll,
  formatMonthLabel,
  lastNMonths,
  type UnidadeAggregate,
} from "./matriz-calc";
import { UnitDetailDrawer } from "./unit-detail-drawer";
import { useRepasses } from "@/hooks/use-repasses";
import { usePermissions } from "@/hooks/use-permissions";
import { ImportRepassesDialog } from "./import-repasses-dialog";
import type { TipoRepasse } from "@/lib/repasses.functions";
import { toast } from "sonner";

interface Props {
  tipo: TipoRepasse;
}

function ymToDate(ym: string): string {
  return `${ym}-01`;
}

export function DeParaMensalTab({ tipo }: Props) {
  const { registros, cnpjToUnidade, unidadesByName } = useData();
  const { can } = usePermissions();
  const canManage = can("manage.repasses");
  const { rows: repasses, lancar, excluir } = useRepasses(tipo);
  const [meses, setMeses] = useState<3 | 6 | 12>(6);
  const [drawer, setDrawer] = useState<{ unit: UnidadeAggregate } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [editCell, setEditCell] = useState<{ unidade: string; ym: string; value: string } | null>(null);

  const { units, monthsList } = useMemo(() => {
    const clientes = enrichAll(registros, cnpjToUnidade, unidadesByName);
    const all = aggregateByUnit(clientes).filter((u) => u.nome !== "Sem unidade");
    return { units: all, monthsList: lastNMonths(meses) };
  }, [registros, cnpjToUnidade, unidadesByName, meses]);

  // Index recebidos: unidade -> ym -> { valor, id }
  const recebidos = useMemo(() => {
    const m = new Map<string, Map<string, { valor: number; id: string }>>();
    for (const r of repasses) {
      const ym = r.competencia.slice(0, 7);
      const inner = m.get(r.unidade) ?? new Map();
      inner.set(ym, { valor: Number(r.valor_recebido), id: r.id });
      m.set(r.unidade, inner);
    }
    return m;
  }, [repasses]);

  const prevPorUnidadeMes = (u: UnidadeAggregate, ym: string) => {
    const map = tipo === "royalties" ? u.royaltiesPorMes : u.cacPorMes;
    return map.get(ym) ?? 0;
  };

  // KPIs do período
  const kpis = useMemo(() => {
    let totalPrev = 0;
    let totalReceb = 0;
    let unidadesAtraso = 0;
    for (const u of units) {
      let prevU = 0;
      let recebU = 0;
      for (const ym of monthsList) {
        prevU += prevPorUnidadeMes(u, ym);
        recebU += recebidos.get(u.nome)?.get(ym)?.valor ?? 0;
      }
      totalPrev += prevU;
      totalReceb += recebU;
      if (prevU > 0 && recebU / prevU < 0.7) unidadesAtraso += 1;
    }
    const aderencia = totalPrev > 0 ? (totalReceb / totalPrev) * 100 : 0;
    return { totalPrev, totalReceb, aderencia, unidadesAtraso };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, monthsList, recebidos, tipo]);

  const chartData = useMemo(() => {
    return monthsList.map((ym) => {
      let prev = 0;
      let receb = 0;
      for (const u of units) {
        prev += prevPorUnidadeMes(u, ym);
        receb += recebidos.get(u.nome)?.get(ym)?.valor ?? 0;
      }
      return { label: formatMonthLabel(ym), Previsto: prev, Recebido: receb };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, monthsList, recebidos, tipo]);

  const titulo = tipo === "royalties" ? "Royalties" : "CAC";
  const corPrev = tipo === "royalties" ? "#6366f1" : "#f59e0b";
  const corReceb = "#10b981";

  function statusCls(prev: number, receb: number) {
    if (prev === 0 && receb === 0) return "text-muted-foreground";
    if (prev === 0) return "text-success";
    const r = receb / prev;
    if (r >= 0.95) return "text-success";
    if (r >= 0.7) return "text-warning";
    return "text-danger";
  }

  async function saveCell() {
    if (!editCell) return;
    const valor = Number(editCell.value.replace(",", "."));
    if (!Number.isFinite(valor) || valor < 0) {
      toast.error("Valor inválido");
      return;
    }
    try {
      await lancar.mutateAsync({
        unidade: editCell.unidade,
        competencia: ymToDate(editCell.ym),
        valor,
      });
      toast.success("Repasse lançado");
      setEditCell(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erro ao salvar");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid flex-1 grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label={`${titulo} previsto`} value={brl(kpis.totalPrev)} tone={tipo === "royalties" ? "indigo" : "orange"} help={`Soma do que deveria ser repassado nos últimos ${meses} meses.`} />
          <KpiCard label={`${titulo} recebido`} value={brl(kpis.totalReceb)} tone="emerald" highlight help="Soma do que as unidades efetivamente repassaram." />
          <KpiCard label="Aderência" value={`${kpis.aderencia.toFixed(1)}%`} sub="Recebido / Previsto" help="Indicador rápido do quanto a rede está em dia." />
          <KpiCard label="Unidades em atraso" value={String(kpis.unidadesAtraso)} sub="Aderência < 70%" tone={kpis.unidadesAtraso > 0 ? "orange" : "emerald"} />
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium"
            value={meses}
            onChange={(e) => setMeses(Number(e.target.value) as 3 | 6 | 12)}
          >
            <option value={3}>Últimos 3 meses</option>
            <option value={6}>Últimos 6 meses</option>
            <option value={12}>Últimos 12 meses</option>
          </select>
          {canManage && (
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Upload className="h-4 w-4" /> Importar planilha
            </button>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold">{titulo}: Previsto × Recebido (mês a mês)</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
              <Tooltip formatter={(v: number) => brl(v)} />
              <Legend />
              <Bar dataKey="Previsto" fill={corPrev} />
              <Bar dataKey="Recebido" fill={corReceb} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-lg border bg-card shadow-sm">
        <div className="border-b px-4 py-3">
          <h3 className="text-sm font-semibold">Conciliação Royalties Unidades</h3>
          <p className="text-xs text-muted-foreground">
            Clique no nome da unidade para abrir o detalhamento. Clique no ícone {canManage ? "para lançar manualmente o valor recebido." : "."}
          </p>
        </div>
        <div className="max-h-[calc(100vh-460px)] overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 z-10 bg-card uppercase text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
              <tr>
                <th className="bg-card px-3 py-2 text-left">Unidade</th>
                {monthsList.map((ym) => (
                  <th key={ym} className="bg-card px-3 py-2 text-center border-l" colSpan={3}>
                    {formatMonthLabel(ym)}
                  </th>
                ))}
                <th className="bg-card px-3 py-2 text-center border-l" colSpan={3}>Total</th>
              </tr>
              <tr className="text-xs">
                <th className="bg-card px-3 py-1 text-left"></th>
                {monthsList.map((ym) => (
                  <Fragment key={ym}>
                    <th className="bg-card px-2 py-1 text-right border-l">Prev</th>
                    <th className="bg-card px-2 py-1 text-right">Receb</th>
                    <th className="bg-card px-2 py-1 text-right">Δ</th>
                  </Fragment>
                ))}
                <th className="bg-card px-2 py-1 text-right border-l">Prev</th>
                <th className="bg-card px-2 py-1 text-right">Receb</th>
                <th className="bg-card px-2 py-1 text-right">Ader.</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => {
                let totalPrev = 0;
                let totalReceb = 0;
                return (
                  <tr key={u.nome} className="border-t hover:bg-muted/50">
                    <td className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        className="text-left hover:underline"
                        onClick={() => setDrawer({ unit: u })}
                      >
                        {u.nome}
                      </button>
                    </td>
                    {monthsList.map((ym) => {
                      const prev = prevPorUnidadeMes(u, ym);
                      const rec = recebidos.get(u.nome)?.get(ym);
                      const receb = rec?.valor ?? 0;
                      const delta = receb - prev;
                      totalPrev += prev;
                      totalReceb += receb;
                      const isEditing = editCell?.unidade === u.nome && editCell?.ym === ym;
                      return (
                        <Fragment key={`${u.nome}-${ym}`}>
                          <td className="px-2 py-1 text-right whitespace-nowrap border-l text-muted-foreground">
                            {prev > 0 ? brl(prev) : "—"}
                          </td>
                          <td className="px-2 py-1 text-right whitespace-nowrap">
                            {isEditing ? (
                              <span className="inline-flex items-center gap-1">
                                <input
                                  autoFocus
                                  value={editCell.value}
                                  onChange={(e) => setEditCell({ ...editCell, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") void saveCell();
                                    if (e.key === "Escape") setEditCell(null);
                                  }}
                                  className="h-6 w-20 rounded border border-border bg-background px-1 text-right text-xs"
                                />
                                <button type="button" onClick={() => void saveCell()} className="text-success hover:text-success">
                                  <Check className="h-3 w-3" />
                                </button>
                                <button type="button" onClick={() => setEditCell(null)} className="text-muted-foreground hover:text-foreground">
                                  <X className="h-3 w-3" />
                                </button>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1">
                                <span className={receb > 0 ? "font-semibold text-success" : "text-muted-foreground"}>
                                  {receb > 0 ? brl(receb) : "—"}
                                </span>
                                {canManage && (
                                  <button
                                    type="button"
                                    title={rec ? "Editar" : "Lançar"}
                                    onClick={() => setEditCell({ unidade: u.nome, ym, value: receb > 0 ? String(receb) : "" })}
                                    className="text-muted-foreground hover:text-foreground"
                                  >
                                    <Pencil className="h-3 w-3" />
                                  </button>
                                )}
                              </span>
                            )}
                          </td>
                          <td className={`px-2 py-1 text-right whitespace-nowrap ${statusCls(prev, receb)}`}>
                            {prev === 0 && receb === 0 ? "—" : brl(delta)}
                          </td>
                        </Fragment>
                      );
                    })}
                    <td className="px-2 py-2 text-right whitespace-nowrap border-l text-muted-foreground">{brl(totalPrev)}</td>
                    <td className="px-2 py-2 text-right whitespace-nowrap font-semibold">{brl(totalReceb)}</td>
                    <td className={`px-2 py-2 text-right whitespace-nowrap ${statusCls(totalPrev, totalReceb)}`}>
                      {totalPrev > 0 ? `${((totalReceb / totalPrev) * 100).toFixed(0)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <UnitDetailDrawer
        agg={drawer?.unit ?? null}
        mode={tipo}
        open={!!drawer}
        onClose={() => setDrawer(null)}
      />

      <ImportRepassesDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        tipo={tipo}
        unidadesConhecidas={units.map((u) => u.nome)}
      />
    </div>
  );
}
