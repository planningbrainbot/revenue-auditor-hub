import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { Carregando, PageHeader } from "@/components/planning";

export const Route = createFileRoute("/_authenticated/rede-ltv")({
  component: RedeLtvPage,
});

type ContratoRow = {
  ganho_em: string | null;
  mrr_mensal: number | null;
  status_contrato: string | null;
  unidade: string | null;
};

type RoasMensalRow = {
  mes: string;
  cac: number | null;
  mrr_medio: number | null;
  deals_digital: number | null;
};

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  num_contratos: number | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${mo}/${y?.slice(2)}`;
};

function monthDiff(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

// TODO(design): pergunta da tela — docs/design/NAVEGACAO.md N1
function RedeLtvPage() {
  const [contratos, setContratos] = useState<ContratoRow[]>([]);
  const [roas, setRoas] = useState<RoasMensalRow[]>([]);
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [c, r, rec] = await Promise.all([
        supabase
          .from("contratos")
          .select("ganho_em,mrr_mensal,status_contrato,unidade")
          .eq("tipo_unidade", "franquia")
          .not("ganho_em", "is", null),
        supabase
          .from("roas_mensal")
          .select("mes,cac,mrr_medio,deals_digital")
          .order("mes", { ascending: true }),
        supabase
          .from("v_reconciliacao_mensal")
          .select("mes,unidade,mrr_contratado,num_contratos")
          .order("mes", { ascending: true }),
      ]);
      if (!mounted) return;
      setContratos((c.data ?? []) as ContratoRow[]);
      setRoas((r.data ?? []) as RoasMensalRow[]);
      setReconcRows((rec.data ?? []) as ReconcRow[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const hoje = useMemo(() => new Date(), []);

  const ativos = useMemo(
    () => contratos.filter((c) => c.status_contrato === "Ativo" && c.ganho_em),
    [contratos],
  );

  const kpis = useMemo(() => {
    if (ativos.length === 0) return { ltv: null, arpa: null, ltMedio: null };
    const totalMrr = ativos.reduce((s, c) => s + (c.mrr_mensal ?? 0), 0);
    const arpa = totalMrr / ativos.length;
    const ltMedio =
      ativos.reduce((s, c) => {
        const dt = new Date(c.ganho_em!);
        return s + Math.max(0, monthDiff(dt, hoje));
      }, 0) / ativos.length;
    const ltv = arpa * ltMedio;
    return { ltv, arpa, ltMedio };
  }, [ativos, hoje]);

  const ltvPorUnidade = useMemo(() => {
    const map = new Map<string, { mrr: number; count: number; ltTotal: number }>();
    for (const c of ativos) {
      const u = c.unidade ?? "—";
      const dt = new Date(c.ganho_em!);
      const lt = Math.max(0, monthDiff(dt, hoje));
      const cur = map.get(u) ?? { mrr: 0, count: 0, ltTotal: 0 };
      cur.mrr += c.mrr_mensal ?? 0;
      cur.count += 1;
      cur.ltTotal += lt;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => {
        const arpa = v.count > 0 ? v.mrr / v.count : 0;
        const lt = v.count > 0 ? v.ltTotal / v.count : 0;
        return { unidade, arpa, lt, ltv: arpa * lt };
      })
      .sort((a, b) => b.ltv - a.ltv);
  }, [ativos, hoje]);

  const reconcByMes = useMemo(() => {
    const map = new Map<string, { mrr: number; contratos: number }>();
    for (const r of reconcRows) {
      const m = r.mes ?? "";
      if (!m) continue;
      const cur = map.get(m) ?? { mrr: 0, contratos: 0 };
      cur.mrr += r.mrr_contratado ?? 0;
      cur.contratos += r.num_contratos ?? 0;
      map.set(m, cur);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [reconcRows]);

  const ltvChart = useMemo(() => {
    return reconcByMes.map(([mes, v], i) => {
      const arpa = v.contratos > 0 ? v.mrr / v.contratos : 0;
      const mesDate = new Date(mes + "-01");
      const ltCumMeses = monthDiff(new Date("2024-07-01"), mesDate);
      const lt = ltCumMeses > 0 ? ltCumMeses / 2 : 1;
      const ltv = arpa * lt;
      const roasRow = roas.find((r) => r.mes === mes + "-01" || r.mes === mes);
      const cac = roasRow?.cac ?? null;
      return { mes, label: fmtMes(mes), arpa, ltv, cac, lt };
    });
  }, [reconcByMes, roas]);

  const resumo = useMemo(() =>
    ltvChart.slice(-12).map((r) => ({
      ...r,
      contratos: reconcByMes.find(([m]) => m === r.mes)?.[1]?.contratos ?? 0,
    })),
    [ltvChart, reconcByMes],
  );

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        titulo="LTV Estimado"
        descricao="Gestão da Rede: valor do tempo de vida estimado por cliente"
      />

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">LTV</div>
          <div className="mt-1 text-2xl font-bold">{fmtBRL(kpis.ltv)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">por cliente ativo</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">ARPA</div>
          <div className="mt-1 text-2xl font-bold">{fmtBRL(kpis.arpa)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">receita média por cliente</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">LT Médio</div>
          <div className="mt-1 text-2xl font-bold">
            {kpis.ltMedio != null ? `${kpis.ltMedio.toFixed(1)}` : "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">meses desde a entrada</div>
        </Card>
      </div>

      {loading && <Carregando variante="grafico" />}

      {!loading && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* LTV vs CAC */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">LTV vs CAC por Mês</div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={ltvChart}>
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="label" {...eixoProps} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} {...eixoProps} />
                    <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} {...eixoProps} />
                    <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                    <Legend {...legendaProps} />
                    <Line yAxisId="left" type="monotone" dataKey="ltv" name="LTV" stroke={CORES_SERIE[0]} strokeWidth={2} dot={false} />
                    <Line yAxisId="right" type="monotone" dataKey="cac" name="CAC" stroke={CORES_SERIE[1]} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* ARPA histórico */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">ARPA vs LT Médio por Mês</div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={ltvChart}>
                    <CartesianGrid {...gradeProps} />
                    <XAxis dataKey="label" {...eixoProps} />
                    <YAxis yAxisId="left" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} {...eixoProps} />
                    <YAxis yAxisId="right" orientation="right" {...eixoProps} />
                    <Tooltip {...tooltipProps} formatter={(v: number, name: string) =>
                      name === "LT Médio" ? `${v?.toFixed(1)} meses` : fmtBRL(v)
                    } />
                    <Legend {...legendaProps} />
                    <Bar yAxisId="left" dataKey="arpa" name="ARPA" fill={CORES_SERIE[0]} fillOpacity={0.7} />
                    <Line yAxisId="right" type="monotone" dataKey="lt" name="LT Médio" stroke={CORES_SERIE[1]} strokeWidth={2} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* LTV por Unidade */}
          <Card className="p-4">
            <div className="mb-2 text-sm font-medium">LTV por Unidade</div>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ltvPorUnidade} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid {...gradeProps} vertical horizontal={false} />
                  <XAxis type="number" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} {...eixoProps} />
                  <YAxis type="category" dataKey="unidade" width={80} {...eixoProps} />
                  <Tooltip {...tooltipProps} formatter={(v: number) => fmtBRL(v)} />
                  <Bar dataKey="ltv" name="LTV" fill={CORES_SERIE[0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Resumo */}
          <Card className="overflow-x-auto">
            <div className="border-b p-3 text-sm font-semibold">Resumo Mensal</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês/Ano</TableHead>
                  <TableHead className="text-right">Ativos BPO</TableHead>
                  <TableHead className="text-right">ARPA</TableHead>
                  <TableHead className="text-right">LT Médio</TableHead>
                  <TableHead className="text-right">LTV</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resumo.map((r) => (
                  <TableRow key={r.mes}>
                    <TableCell>{fmtMes(r.mes)}</TableCell>
                    <TableCell className="text-right">{r.contratos || "—"}</TableCell>
                    <TableCell className="text-right">{fmtBRL(r.arpa)}</TableCell>
                    <TableCell className="text-right">{r.lt?.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">{fmtBRL(r.ltv)}</TableCell>
                  </TableRow>
                ))}
                {resumo.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                      Nenhum dado disponível.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
