import { useMemo, useState } from "react";
import React from "react";
import { ChevronDown, ChevronRight, Receipt } from "lucide-react";
import {
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
import { useQuery } from "@tanstack/react-query";

import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";

// Fonte de dados: `royalties_apuracao` (por unidade/mês), a mesma usada em
// Receitas Partners / DRE Projetada — ver hook `useRoyaltiesPorUnidade`.
// Substituiu a antiga `v_royalties_mensais`, que calculava royalties como um
// percentual fixo (`unidades.royalties_percentual`) sobre o recebido bruto,
// ignorando overrides por cliente e as regras reais de apuração (base
// antiga, vigência etc.) — por isso a coluna Royalties aparecia zerada.
type ApuracaoRow = {
  unidade_id: number;
  mes_referencia: string;
  royalties_valor: number | null;
  cac_valor: number | null;
  csc_valor_fixo: number | null;
  csc_base_antiga_valor: number | null;
  csc_trafego_pago: number | null;
};

const ALL = "__all__";

const fmtBRL = (v: number | null | undefined) =>
  v == null
    ? "—"
    : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${mo}/${y?.slice(2)}`;
};

// Mesma regra de reconhecimento usada em `useRoyaltiesPorUnidade`: a
// apuração de um mês M vira receita em M+1 (fatura fechada num mês,
// recebida no seguinte).
function mesReconhecimento(mesReferencia: string): string {
  const [y, m] = mesReferencia.slice(0, 7).split("-").map(Number);
  const d = new Date(y, m - 1 + 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Ordem fixa de cores categóricas — nunca ciclada, mesma ordem em gráficos,
// legendas e tabela.
const COLORS = {
  csc: "hsl(221 83% 53%)",
  royalties: "hsl(142 71% 45%)",
  midia: "hsl(271 81% 56%)",
  cac: "hsl(38 92% 42%)",
};

const PERIODO_OPTS = [
  { value: "3", label: "Últimos 3 meses" },
  { value: "6", label: "Últimos 6 meses" },
  { value: "12", label: "Últimos 12 meses" },
  { value: "24", label: "Últimos 24 meses" },
  { value: "ano", label: "Ano corrente" },
  { value: "tudo", label: "Tudo" },
] as const;
type PeriodoOpt = (typeof PERIODO_OPTS)[number]["value"];

export function RedeFinanceiroView() {
  const [unidadeFilter, setUnidadeFilter] = useState(ALL);
  const [periodo, setPeriodo] = useState<PeriodoOpt>("12");

  const { data, isLoading } = useQuery({
    queryKey: ["rede-financeiro", "apuracao"],
    queryFn: async () => {
      const [uRes, apRes] = await Promise.all([
        supabase.from("unidades").select("id,nome_da_praca").eq("tipo", "regional"),
        supabase
          .from("royalties_apuracao")
          .select(
            "unidade_id,mes_referencia,royalties_valor,cac_valor,csc_valor_fixo,csc_base_antiga_valor,csc_trafego_pago",
          ),
      ]);
      const nomePorId = new Map<number, string>();
      (uRes.data ?? []).forEach((u) => nomePorId.set(u.id, u.nome_da_praca));

      return (apRes.data ?? []).flatMap((a: ApuracaoRow) => {
        const unidade = nomePorId.get(a.unidade_id);
        if (!unidade) return [];
        const cscFixo = a.csc_valor_fixo != null ? Number(a.csc_valor_fixo) : null;
        return [
          {
            unidade,
            mes: mesReconhecimento(a.mes_referencia),
            csc: cscFixo ?? Number(a.csc_base_antiga_valor ?? 0),
            royalties: Number(a.royalties_valor ?? 0),
            midia: Number(a.csc_trafego_pago ?? 0),
            cac: Number(a.cac_valor ?? 0),
          },
        ];
      });
    },
    staleTime: 30_000,
  });

  const rows = useMemo(() => data ?? [], [data]);

  const unidadesOpts = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade))).sort(),
    [rows],
  );

  const porUnidade = useMemo(
    () => rows.filter((r) => unidadeFilter === ALL || r.unidade === unidadeFilter),
    [rows, unidadeFilter],
  );

  const mesesDisponiveis = useMemo(
    () => Array.from(new Set(porUnidade.map((r) => r.mes))).sort(),
    [porUnidade],
  );

  const periodoMeses = useMemo(() => {
    if (mesesDisponiveis.length === 0) return [];
    if (periodo === "tudo") return mesesDisponiveis;
    if (periodo === "ano") {
      const anoRef = mesesDisponiveis[mesesDisponiveis.length - 1].slice(0, 4);
      return mesesDisponiveis.filter((m) => m.startsWith(anoRef));
    }
    const n = Number(periodo);
    return mesesDisponiveis.slice(-n);
  }, [mesesDisponiveis, periodo]);

  const enriched = useMemo(
    () => porUnidade.filter((r) => periodoMeses.includes(r.mes)),
    [porUnidade, periodoMeses],
  );

  const byMes = useMemo(() => {
    const map = new Map<
      string,
      { csc: number; royalties: number; midia: number; cac: number; total: number }
    >();
    for (const r of enriched) {
      const cur = map.get(r.mes) ?? { csc: 0, royalties: 0, midia: 0, cac: 0, total: 0 };
      cur.csc += r.csc;
      cur.royalties += r.royalties;
      cur.midia += r.midia;
      cur.cac += r.cac;
      cur.total += r.csc + r.royalties + r.midia + r.cac;
      map.set(r.mes, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ mes, label: fmtMes(mes), ...v }));
  }, [enriched]);

  const periodLabel = periodoMeses.length
    ? periodoMeses.length === 1
      ? fmtMes(periodoMeses[0])
      : `${fmtMes(periodoMeses[0])} – ${fmtMes(periodoMeses[periodoMeses.length - 1])}`
    : "—";

  const kpis = useMemo(
    () =>
      byMes.reduce(
        (acc, m) => ({
          total: acc.total + m.total,
          csc: acc.csc + m.csc,
          royalties: acc.royalties + m.royalties,
          midia: acc.midia + m.midia,
          cac: acc.cac + m.cac,
        }),
        { total: 0, csc: 0, royalties: 0, midia: 0, cac: 0 },
      ),
    [byMes],
  );

  const { pivot, months } = useMemo(() => {
    const umap = new Map<string, PivotUnidade>();
    const monthsSet = new Set<string>();

    for (const r of enriched) {
      monthsSet.add(r.mes);
      if (!umap.has(r.unidade)) {
        umap.set(r.unidade, {
          nome: r.unidade,
          monthly: {},
          csc: {},
          royalties: {},
          midia: {},
          cac: {},
          total: 0,
        });
      }
      const p = umap.get(r.unidade)!;
      const rowTotal = r.csc + r.royalties + r.midia + r.cac;
      p.monthly[r.mes] = (p.monthly[r.mes] ?? 0) + rowTotal;
      p.csc[r.mes] = (p.csc[r.mes] ?? 0) + r.csc;
      p.royalties[r.mes] = (p.royalties[r.mes] ?? 0) + r.royalties;
      p.midia[r.mes] = (p.midia[r.mes] ?? 0) + r.midia;
      p.cac[r.mes] = (p.cac[r.mes] ?? 0) + r.cac;
      p.total += rowTotal;
    }

    const sortedMonths = Array.from(monthsSet).sort();
    const sortedPivot = Array.from(umap.values()).sort((a, b) => b.total - a.total);
    return { pivot: sortedPivot, months: sortedMonths };
  }, [enriched]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Receipt className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Financeiro — Gestão da Rede</h1>
            <p className="text-sm text-muted-foreground">
              CSC, Royalties, Mídia e CAC por unidade — fonte: apuração de royalties
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={periodo} onValueChange={(v) => setPeriodo(v as PeriodoOpt)}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent>
              {PERIODO_OPTS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Unidade" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todos</SelectItem>
              {unidadesOpts.map((u) => (
                <SelectItem key={u} value={u}>
                  {u}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* KPIs — somados no período selecionado, não mais um único "último mês" */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Card className="p-4 lg:col-span-2">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{periodLabel}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">CSC</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.csc)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Royalties</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.royalties)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Mídia</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.midia)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">CAC</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.cac)}</div>
        </Card>
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>}

      {!isLoading && byMes.length > 0 && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Stacked bar por tipo */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">Faturamento por Tipo e Mês</div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byMes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Legend />
                    <Bar dataKey="csc" name="CSC" stackId="a" fill={COLORS.csc} />
                    <Bar dataKey="royalties" name="Royalties" stackId="a" fill={COLORS.royalties} />
                    <Bar dataKey="midia" name="Mídia" stackId="a" fill={COLORS.midia} />
                    <Bar
                      dataKey="cac"
                      name="CAC"
                      stackId="a"
                      fill={COLORS.cac}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Tendência — só Royalties, acompanhamento mensal */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">Royalties — Acompanhamento Mensal</div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={byMes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
                      tick={{ fontSize: 11 }}
                    />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Line
                      type="monotone"
                      dataKey="royalties"
                      name="Royalties"
                      stroke={COLORS.royalties}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Tabela de Faturamento — pivot por unidade */}
          <PivotTable pivot={pivot} months={months} />
        </>
      )}
    </div>
  );
}

type PivotUnidade = {
  nome: string;
  monthly: Record<string, number>;
  csc: Record<string, number>;
  royalties: Record<string, number>;
  midia: Record<string, number>;
  cac: Record<string, number>;
  total: number;
};

function PivotTable({ pivot, months }: { pivot: PivotUnidade[]; months: string[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (nome: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(nome)) next.delete(nome);
      else next.add(nome);
      return next;
    });

  const grandTotal = useMemo(() => {
    const monthly: Record<string, number> = {};
    let total = 0;
    for (const u of pivot) {
      for (const m of months) {
        monthly[m] = (monthly[m] ?? 0) + (u.monthly[m] ?? 0);
      }
      total += u.total;
    }
    return { monthly, total };
  }, [pivot, months]);

  const SUB_ROWS = [
    { key: "csc" as const, label: "CSC" },
    { key: "royalties" as const, label: "Royalties" },
    { key: "midia" as const, label: "Mídia" },
    { key: "cac" as const, label: "CAC" },
  ];

  return (
    <Card className="overflow-x-auto">
      <div className="border-b p-3 text-sm font-semibold">Faturamento por Unidade</div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="sticky left-0 bg-muted/50 w-[200px] font-semibold">
              Unidade
            </TableHead>
            {months.map((m) => (
              <TableHead key={m} className="text-right min-w-[110px] font-semibold">
                {fmtMes(m)}
              </TableHead>
            ))}
            <TableHead className="text-right min-w-[120px] font-semibold">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {pivot.map((u) => {
            const isOpen = expanded.has(u.nome);
            return (
              <React.Fragment key={u.nome}>
                <TableRow
                  className="cursor-pointer hover:bg-muted/40 bg-muted/20"
                  onClick={() => toggle(u.nome)}
                >
                  <TableCell className="sticky left-0 bg-muted/20 py-2 font-semibold">
                    <div className="flex items-center gap-2">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {u.nome}
                    </div>
                  </TableCell>
                  {months.map((m) => (
                    <TableCell key={m} className="text-right tabular-nums py-2 font-semibold">
                      {u.monthly[m] ? fmtBRL(u.monthly[m]) : "—"}
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums py-2 font-bold">
                    {fmtBRL(u.total)}
                  </TableCell>
                </TableRow>
                {isOpen &&
                  SUB_ROWS.map(({ key, label }) => (
                    <TableRow key={`${u.nome}|${key}`} className="hover:bg-muted/10">
                      <TableCell className="sticky left-0 bg-background pl-10 py-1.5 text-sm text-muted-foreground">
                        {label}
                      </TableCell>
                      {months.map((m) => (
                        <TableCell key={m} className="text-right tabular-nums py-1.5 text-sm">
                          {u[key][m] ? fmtBRL(u[key][m]) : "—"}
                        </TableCell>
                      ))}
                      <TableCell className="text-right tabular-nums py-1.5 text-sm font-medium">
                        {fmtBRL(Object.values(u[key]).reduce((s, v) => s + v, 0) || null)}
                      </TableCell>
                    </TableRow>
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/40 font-bold">
            <td className="sticky left-0 bg-muted/40 py-2.5 px-4 text-sm">Grand Total</td>
            {months.map((m) => (
              <td key={m} className="py-2.5 px-4 text-right tabular-nums text-sm">
                {grandTotal.monthly[m] ? fmtBRL(grandTotal.monthly[m]) : "—"}
              </td>
            ))}
            <td className="py-2.5 px-4 text-right tabular-nums text-sm">
              {fmtBRL(grandTotal.total)}
            </td>
          </tr>
        </tfoot>
      </Table>
    </Card>
  );
}
