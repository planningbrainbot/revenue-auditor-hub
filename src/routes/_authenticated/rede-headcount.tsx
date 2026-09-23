import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { Users, AlertCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/rede-headcount")({
  component: RedeHeadcountPage,
});

type HeadcountRow = {
  unidade: string;
  mes: string;
  headcount: number;
  admissoes: number;
  demissoes: number;
};

type ReconcRow = {
  mes: string | null;
  unidade: string | null;
  mrr_contratado: number | null;
  num_contratos: number | null;
};

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtPct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toFixed(1)}%`;

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const d = new Date(m);
  return d.toLocaleDateString("pt-BR", { month: "2-digit", year: "numeric" });
};

function RedeHeadcountPage() {
  const [rows, setRows] = useState<HeadcountRow[]>([]);
  const [reconcRows, setReconcRows] = useState<ReconcRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [tableExists, setTableExists] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [h, r] = await Promise.all([
        (supabase as any).from("headcount_mensal").select("unidade,mes,headcount,admissoes,demissoes").order("mes"),
        supabase.from("v_reconciliacao_mensal").select("mes,unidade,mrr_contratado,num_contratos").order("mes"),
      ]);
      if (!mounted) return;
      if (h.error?.code === "42P01" || h.error?.message?.includes("does not exist")) {
        setTableExists(false);
      } else {
        setRows((h.data ?? []) as HeadcountRow[]);
      }
      setReconcRows((r.data ?? []) as ReconcRow[]);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const byMes = useMemo(() => {
    const map = new Map<string, { headcount: number; admissoes: number; demissoes: number }>();
    for (const r of rows) {
      const cur = map.get(r.mes) ?? { headcount: 0, admissoes: 0, demissoes: 0 };
      cur.headcount += r.headcount;
      cur.admissoes += r.admissoes;
      cur.demissoes += r.demissoes;
      map.set(r.mes, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        label: fmtMes(mes),
        ...v,
        turnover: v.headcount > 0 ? ((v.demissoes / v.headcount) * 100) : 0,
      }));
  }, [rows]);

  const reconcByMes = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of reconcRows) {
      const m = r.mes ?? "";
      if (!m) continue;
      map.set(m, (map.get(m) ?? 0) + (r.mrr_contratado ?? 0));
    }
    return map;
  }, [reconcRows]);

  const combinedChart = useMemo(() =>
    byMes.map((r) => {
      const mrr = reconcByMes.get(r.mes) ?? null;
      const receitaPerHead = mrr && r.headcount > 0 ? mrr / r.headcount : null;
      return { ...r, mrr, receitaPerHead };
    }),
    [byMes, reconcByMes],
  );

  const ultimo = byMes[byMes.length - 1];

  const byUnidade = useMemo(() => {
    const map = new Map<string, HeadcountRow>();
    for (const r of rows) {
      const cur = map.get(r.unidade);
      if (!cur || r.mes > cur.mes) map.set(r.unidade, r);
    }
    return Array.from(map.values()).sort((a, b) => b.headcount - a.headcount);
  }, [rows]);

  if (!tableExists) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Headcount — Gestão da Rede</h1>
            <p className="text-sm text-muted-foreground">Admissões, demissões e turnover por unidade</p>
          </div>
        </div>
        <Card className="p-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold text-sm mb-1">Tabela de headcount não configurada</div>
              <p className="text-sm text-muted-foreground mb-4">
                Execute o SQL abaixo no Supabase (SQL Editor) para criar a tabela e começar a alimentar os dados de headcount:
              </p>
              <pre className="rounded-md bg-muted p-4 text-xs overflow-x-auto whitespace-pre-wrap">
{`-- Crie a tabela de headcount mensal por unidade
CREATE TABLE IF NOT EXISTS headcount_mensal (
  id SERIAL PRIMARY KEY,
  unidade TEXT NOT NULL,
  mes DATE NOT NULL,
  headcount INTEGER NOT NULL DEFAULT 0,
  admissoes INTEGER NOT NULL DEFAULT 0,
  demissoes INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT headcount_mensal_unidade_mes_key UNIQUE (unidade, mes)
);

-- Índice para performance
CREATE INDEX IF NOT EXISTS idx_headcount_mensal_mes ON headcount_mensal (mes);
CREATE INDEX IF NOT EXISTS idx_headcount_mensal_unidade ON headcount_mensal (unidade);

-- Ativar RLS (opcional, mas recomendado)
ALTER TABLE headcount_mensal ENABLE ROW LEVEL SECURITY;

-- Política de leitura para usuários autenticados
CREATE POLICY "Headcount leitura autenticados"
  ON headcount_mensal FOR SELECT
  TO authenticated
  USING (true);`}
              </pre>
              <p className="text-sm text-muted-foreground mt-4">
                Após criar a tabela, insira os dados de headcount por unidade e mês. O formato do campo <code className="bg-muted px-1 rounded">mes</code> deve ser a primeira data do mês, ex: <code className="bg-muted px-1 rounded">2026-01-01</code>.
              </p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Carregando dados…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">Headcount — Gestão da Rede</h1>
        </div>
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Tabela criada mas sem dados. Insira registros na tabela <code className="bg-muted px-1 rounded">headcount_mensal</code>.
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Headcount — Gestão da Rede</h1>
          <p className="text-sm text-muted-foreground">Admissões, demissões e turnover por unidade</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Headcount Mês</div>
          <div className="mt-1 text-2xl font-bold">{ultimo?.headcount ?? "—"}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{ultimo ? fmtMes(ultimo.mes) : ""}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Turnover Mês</div>
          <div className={`mt-1 text-2xl font-bold ${(ultimo?.turnover ?? 0) > 5 ? "text-red-500" : "text-foreground"}`}>
            {ultimo ? fmtPct(ultimo.turnover) : "—"}
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Admissões Mês</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">{ultimo?.admissoes ?? "—"}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Demissões Mês</div>
          <div className="mt-1 text-2xl font-bold text-red-500">{ultimo?.demissoes ?? "—"}</div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Headcount e Turnover */}
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Headcount e Turnover Mensal</div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedChart}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="label" {...eixoProps} />
                <YAxis yAxisId="left" allowDecimals={false} {...eixoProps} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v?.toFixed(1)}%`} {...eixoProps} />
                <Tooltip {...tooltipProps} formatter={(v: number, name: string) =>
                  name === "Turnover %" ? fmtPct(v) : v
                } />
                <Legend {...legendaProps} />
                <Bar yAxisId="left" dataKey="headcount" name="Headcount" fill={CORES_SERIE[0]} fillOpacity={0.7} />
                <Line yAxisId="right" type="monotone" dataKey="turnover" name="Turnover %" stroke={CORES_SERIE[1]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Admissões vs Demissões */}
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Admissões vs Demissões</div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={byMes}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="label" {...eixoProps} />
                <YAxis allowDecimals={false} {...eixoProps} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendaProps} />
                <Bar dataKey="admissoes" name="Admissões" fill={CORES_SERIE[0]} />
                <Bar dataKey="demissoes" name="Demissões" fill={CORES_SERIE[1]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Receita / Headcount */}
        <Card className="p-4">
          <div className="mb-2 text-sm font-medium">Receita / Headcount</div>
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedChart}>
                <CartesianGrid {...gradeProps} />
                <XAxis dataKey="label" {...eixoProps} />
                <YAxis yAxisId="left" allowDecimals={false} {...eixoProps} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} {...eixoProps} />
                <Tooltip {...tooltipProps} formatter={(v: number, name: string) =>
                  name === "Receita/HC" ? fmtBRL(v) : v
                } />
                <Legend {...legendaProps} />
                <Bar yAxisId="left" dataKey="headcount" name="Headcount" fill={CORES_SERIE[0]} fillOpacity={0.4} />
                <Line yAxisId="right" type="monotone" dataKey="receitaPerHead" name="Receita/HC" stroke={CORES_SERIE[1]} strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Resumo por unidade */}
        <Card className="overflow-hidden">
          <div className="border-b p-3 text-sm font-semibold">Resumo por Unidade</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unidade</TableHead>
                <TableHead className="text-right">HC</TableHead>
                <TableHead className="text-right">Adm.</TableHead>
                <TableHead className="text-right">Dem.</TableHead>
                <TableHead className="text-right">Turnover</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {byUnidade.map((r) => (
                <TableRow key={r.unidade}>
                  <TableCell className="font-medium">{r.unidade}</TableCell>
                  <TableCell className="text-right">{r.headcount}</TableCell>
                  <TableCell className="text-right text-emerald-600">{r.admissoes || "—"}</TableCell>
                  <TableCell className="text-right text-red-500">{r.demissoes || "—"}</TableCell>
                  <TableCell className="text-right">
                    {r.headcount > 0 ? fmtPct((r.demissoes / r.headcount) * 100) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
