import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES_SERIE } from "@/lib/planning/grafico";
import { BarChart3 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/rede-realizado")({
  component: RedeRealizadoPage,
});

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  faturado: number | null;
  recebido: number | null;
  num_contratos: number | null;
};

type RoasUnitRow = {
  mes: string;
  unidade: string;
  cac: number | null;
  investimento_midia: number | null;
  deals: number | null;
  mrr_medio: number | null;
};

type NpsRow = {
  created_at: string | null;
  unidade: string | null;
  nps_recomendacao: string | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${mo}/${y?.slice(2)}`;
};

// TODO(design): com mais de 6 unidades a cor repete; DESIGN.md §5 pede
// facetas ou "Outros" — decisão de produto, não de cor.
const UNIT_COLORS: readonly string[] = CORES_SERIE;

type MetricKey = "receita" | "mrr" | "clientes" | "arpa" | "crescimento" | "cac" | "nps";

const METRICS: { key: MetricKey; label: string; format: (v: number) => string }[] = [
  { key: "receita", label: "Recebido", format: fmtBRL },
  { key: "mrr", label: "MRR", format: fmtBRL },
  { key: "clientes", label: "Clientes Ativos", format: (v) => String(Math.round(v)) },
  { key: "arpa", label: "ARPA", format: fmtBRL },
  { key: "crescimento", label: "Crescimento %", format: (v) => `${v?.toFixed(1)}%` },
  { key: "cac", label: "CAC", format: fmtBRL },
  { key: "nps", label: "NPS", format: (v) => String(Math.round(v)) },
];

function RedeRealizadoPage() {
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [roasRows, setRoasRows] = useState<RoasUnitRow[]>([]);
  const [npsRows, setNpsRows] = useState<NpsRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [rec, roas, nps] = await Promise.all([
        supabase
          .from("v_reconciliacao_mensal")
          .select("mes,unidade,mrr_contratado,faturado,recebido,num_contratos")
          .order("mes", { ascending: true }),
        supabase
          .from("roas_por_unidade")
          .select("mes,unidade,cac,investimento_midia,deals,mrr_medio")
          .order("mes", { ascending: true }),
        supabase
          .from("nps_pesquisas")
          .select("created_at,unidade,nps_recomendacao")
          .not("nps_recomendacao", "is", null),
      ]);
      if (!mounted) return;
      setReconcRows((rec.data ?? []) as ReconcRow[]);
      setRoasRows((roas.data ?? []) as RoasUnitRow[]);
      setNpsRows((nps.data ?? []) as NpsRow[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const unidades = useMemo(
    () => Array.from(new Set(reconcRows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [reconcRows],
  );

  const meses = useMemo(
    () => Array.from(new Set(reconcRows.map((r) => r.mes).filter(Boolean) as string[])).sort(),
    [reconcRows],
  );

  const npsByMesUnidade = useMemo(() => {
    const map = new Map<string, Map<string, { p: number; d: number; total: number }>>();
    for (const r of npsRows) {
      if (!r.created_at || !r.unidade) continue;
      const d = new Date(r.created_at);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const n = Number(r.nps_recomendacao);
      if (!Number.isFinite(n)) continue;
      if (!map.has(mes)) map.set(mes, new Map());
      const umap = map.get(mes)!;
      const cur = umap.get(r.unidade) ?? { p: 0, d: 0, total: 0 };
      if (n >= 9) cur.p++;
      else if (n <= 6) cur.d++;
      cur.total++;
      umap.set(r.unidade, cur);
    }
    return map;
  }, [npsRows]);

  const cacByMesUnidade = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const r of roasRows) {
      const mes = r.mes.substring(0, 7);
      if (!map.has(mes)) map.set(mes, new Map());
      if (r.cac != null) map.get(mes)!.set(r.unidade, r.cac);
    }
    return map;
  }, [roasRows]);

  const metricByMesUnidade = useMemo(() => {
    const result = new Map<string, Map<string, Record<MetricKey, number | null>>>();
    for (const mes of meses) {
      const mesMap = new Map<string, Record<MetricKey, number | null>>();
      const mesRows = reconcRows.filter((r) => r.mes === mes);
      const prevMes = meses[meses.indexOf(mes) - 1];
      for (const u of unidades) {
        const row = mesRows.find((r) => r.unidade === u);
        const prevRow = prevMes
          ? reconcRows.find((r) => r.mes === prevMes && r.unidade === u)
          : null;
        const recebido = row?.recebido ?? null;
        const mrr = row?.mrr_contratado ?? null;
        const clientes = row?.num_contratos ?? null;
        const arpa = mrr != null && clientes != null && clientes > 0 ? mrr / clientes : null;
        const crescimento =
          recebido != null && prevRow?.recebido != null && prevRow.recebido > 0
            ? ((recebido - prevRow.recebido) / prevRow.recebido) * 100
            : null;
        const cacMap = cacByMesUnidade.get(mes);
        const cac = cacMap?.get(u) ?? null;
        const npsMap = npsByMesUnidade.get(mes)?.get(u);
        const nps =
          npsMap && npsMap.total > 0
            ? Math.round(((npsMap.p - npsMap.d) / npsMap.total) * 100)
            : null;
        mesMap.set(u, { receita: recebido, mrr, clientes, arpa, crescimento, cac, nps });
      }
      result.set(mes, mesMap);
    }
    return result;
  }, [meses, unidades, reconcRows, cacByMesUnidade, npsByMesUnidade]);

  function buildChartData(metric: MetricKey) {
    return meses.map((mes) => {
      const mesMap = metricByMesUnidade.get(mes);
      const entry: Record<string, string | number | null> = { mes, label: fmtMes(mes) };
      for (const u of unidades) {
        entry[u] = mesMap?.get(u)?.[metric] ?? null;
      }
      return entry;
    });
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Realizado por Unidade</h1>
          <p className="text-sm text-muted-foreground">Métricas por unidade ao longo do tempo</p>
        </div>
      </div>

      {loading && <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>}

      {!loading && (
        <Tabs defaultValue="receita" className="w-full">
          <TabsList className="flex-wrap h-auto gap-1">
            {METRICS.map((m) => (
              <TabsTrigger key={m.key} value={m.key}>{m.label}</TabsTrigger>
            ))}
          </TabsList>

          {METRICS.map((metric) => {
            const chartData = buildChartData(metric.key);
            return (
              <TabsContent key={metric.key} value={metric.key} className="mt-4">
                <Card className="p-4">
                  <div className="mb-2 text-sm font-medium">{metric.label} por Unidade</div>
                  <div className="h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis
                          tickFormatter={(v) => {
                            if (metric.key === "crescimento" || metric.key === "nps") return `${v?.toFixed(0)}`;
                            if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
                            if (v >= 1_000) return `${(v / 1_000).toFixed(0)}k`;
                            return String(v);
                          }}
                          tick={{ fontSize: 11 }}
                        />
                        <Tooltip
                          formatter={(v: number) => metric.format(v)}
                          labelFormatter={(l) => `Mês: ${l}`}
                        />
                        <Legend />
                        {unidades.map((u, i) => (
                          <Line
                            key={u}
                            type="monotone"
                            dataKey={u}
                            name={u}
                            stroke={UNIT_COLORS[i % UNIT_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </div>
  );
}
