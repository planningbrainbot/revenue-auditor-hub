import { useEffect, useMemo, useState } from "react";
import React from "react";
import { ChevronDown, ChevronRight, Receipt } from "lucide-react";
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

import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

type RoyaltiesRow = {
  mes: string | null;
  unidade: string | null;
  csc_valor: number | null;
  csc_valor_fixo: number | null;
  faturado: number | null;
  recebido: number | null;
};

type Unidade = {
  nome_da_praca: string;
  midia_mensal: number | null;
};

const ALL = "__all__";

const fmtBRL = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtMes = (m: string | null | undefined) => {
  if (!m) return "—";
  const [y, mo] = m.split("-");
  return `${mo}/${y?.slice(2)}`;
};

const COLORS = {
  csc: "hsl(221 83% 53%)",
  royalties: "hsl(142 71% 45%)",
  midia: "hsl(271 81% 56%)",
  taxa: "hsl(38 92% 50%)",
};

export function RedeFinanceiroView() {
  const [royalties, setRoyalties] = useState<RoyaltiesRow[]>([]);
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [loading, setLoading] = useState(true);
  const [unidadeFilter, setUnidadeFilter] = useState(ALL);
  // Royalties real, por "Unidade|YYYY-MM" — somado direto de royalties_apuracao
  // (mesma fonte que a seção "Validação Royalties" abaixo usa como "Cobrado").
  // Não usar v_royalties_mensais.royalties_valor pra isso: aquela view estima
  // royalties como recebido bruto do Omie × percentual fixo da unidade, o que
  // ignora a apuração de verdade (valor líquido, por cliente, com overrides e
  // confirmação manual) — ver DATA-RULES.md.
  const [royaltiesApuradoMap, setRoyaltiesApuradoMap] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [r, u, uIds, apuracoes] = await Promise.all([
        supabase
          .from("v_royalties_mensais")
          .select("mes,unidade,csc_valor,csc_valor_fixo,faturado,recebido")
          .order("mes", { ascending: true }),
        supabase
          .from("unidades")
          .select("nome_da_praca,midia_mensal")
          .neq("tipo", "interna"),
        supabase.from("unidades").select("id,nome_da_praca").eq("tipo", "regional"),
        supabase.from("royalties_apuracao").select("unidade_id,mes_referencia,royalties_valor,status"),
      ]);
      if (!mounted) return;
      setRoyalties((r.data ?? []) as RoyaltiesRow[]);
      setUnidades((u.data ?? []) as Unidade[]);

      const nomePorUnidadeId = new Map<number, string>();
      (uIds.data ?? []).forEach((x: any) => nomePorUnidadeId.set(x.id, x.nome_da_praca));
      const apMap = new Map<string, number>();
      (apuracoes.data ?? []).forEach((a: any) => {
        const nome = nomePorUnidadeId.get(a.unidade_id);
        if (!nome) return;
        const mes = String(a.mes_referencia).slice(0, 7);
        const key = `${nome}|${mes}`;
        apMap.set(key, (apMap.get(key) ?? 0) + Number(a.royalties_valor ?? 0));
      });
      setRoyaltiesApuradoMap(apMap);

      setLoading(false);
    })();
    return () => { mounted = false; };
  }, []);

  const midiaByUnidade = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of unidades) {
      map.set(u.nome_da_praca, u.midia_mensal ?? 0);
    }
    return map;
  }, [unidades]);

  const unidadesOpts = useMemo(
    () => Array.from(new Set(royalties.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [royalties],
  );

  const filtered = useMemo(
    () => royalties.filter((r) => unidadeFilter === ALL || r.unidade === unidadeFilter),
    [royalties, unidadeFilter],
  );

  const enriched = useMemo(
    () => filtered.map((r) => ({
      ...r,
      midia: r.unidade ? (midiaByUnidade.get(r.unidade) ?? 0) : 0,
      csc: r.csc_valor ?? r.csc_valor_fixo ?? 0,
      royaltiesReal: r.unidade && r.mes
        ? (royaltiesApuradoMap.get(`${r.unidade}|${r.mes.slice(0, 7)}`) ?? 0)
        : 0,
    })),
    [filtered, midiaByUnidade, royaltiesApuradoMap],
  );

  const byMes = useMemo(() => {
    const map = new Map<string, { csc: number; royalties: number; midia: number; total: number; faturado: number }>();
    for (const r of enriched) {
      const m = r.mes ?? "";
      if (!m) continue;
      const cur = map.get(m) ?? { csc: 0, royalties: 0, midia: 0, total: 0, faturado: 0 };
      cur.csc += r.csc;
      cur.royalties += r.royaltiesReal;
      cur.midia += r.midia;
      cur.faturado += r.faturado ?? 0;
      cur.total += r.csc + r.royaltiesReal + r.midia;
      map.set(m, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({ mes, label: fmtMes(mes), ...v }));
  }, [enriched]);

  const ultimoMes = byMes[byMes.length - 1];

  const kpis = useMemo(() => {
    if (!ultimoMes) return { total: 0, csc: 0, royalties: 0, midia: 0 };
    return {
      total: ultimoMes.total,
      csc: ultimoMes.csc,
      royalties: ultimoMes.royalties,
      midia: ultimoMes.midia,
    };
  }, [ultimoMes]);

  const { pivot, months } = useMemo(() => {
    const umap = new Map<string, PivotUnidade>();
    const monthsSet = new Set<string>();

    for (const r of enriched) {
      const m = r.mes ?? "";
      const u = r.unidade ?? "—";
      if (!m) continue;
      monthsSet.add(m);

      if (!umap.has(u)) {
        umap.set(u, { nome: u, monthly: {}, csc: {}, royalties: {}, midia: {}, total: 0 });
      }
      const p = umap.get(u)!;
      const cscVal = r.csc;
      const royVal = r.royaltiesReal;
      const midVal = r.midia;
      const rowTotal = cscVal + royVal + midVal;

      p.monthly[m] = (p.monthly[m] ?? 0) + rowTotal;
      p.csc[m] = (p.csc[m] ?? 0) + cscVal;
      p.royalties[m] = (p.royalties[m] ?? 0) + royVal;
      p.midia[m] = (p.midia[m] ?? 0) + midVal;
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
            <p className="text-sm text-muted-foreground">CSC, Royalties e Mídia por unidade</p>
          </div>
        </div>
        <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            {unidadesOpts.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <Card className="p-4 lg:col-span-2">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.total)}</div>
          <div className="text-xs text-muted-foreground mt-0.5">último mês</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">CSC</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.csc)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Mídia</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.midia)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Royalties</div>
          <div className="mt-1 text-xl font-bold">{fmtBRL(kpis.royalties)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Taxa de Franquia</div>
          <div className="mt-1 text-xl font-bold text-muted-foreground">—</div>
          <div className="text-xs text-muted-foreground mt-0.5">via Omie</div>
        </Card>
      </div>

      {loading && <Card className="p-6 text-sm text-muted-foreground">Carregando dados…</Card>}

      {!loading && byMes.length > 0 && (
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
                    <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Legend />
                    <Bar dataKey="csc" name="CSC" stackId="a" fill={COLORS.csc} />
                    <Bar dataKey="royalties" name="Royalties" stackId="a" fill={COLORS.royalties} />
                    <Bar dataKey="midia" name="Mídia" stackId="a" fill={COLORS.midia} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            {/* Linha de tendência */}
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">Tendência por Componente</div>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={byMes}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tickFormatter={(v) => `${(v/1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Legend />
                    <Line type="monotone" dataKey="csc" name="CSC" stroke={COLORS.csc} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="royalties" name="Royalties" stroke={COLORS.royalties} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="midia" name="Mídia" stroke={COLORS.midia} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="total" name="Total" stroke="hsl(0 0% 40%)" strokeWidth={2} dot={false} strokeDasharray="4 4" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* Tabela de Faturamento — pivot por unidade */}
          <PivotTable pivot={pivot} months={months} />
        </>
      )}

      {/* Validação Royalties — Cobrado x Recebido */}
      <ValidacaoRoyaltiesSection />
    </div>
  );
}

type PivotUnidade = {
  nome: string;
  monthly: Record<string, number>;
  csc: Record<string, number>;
  royalties: Record<string, number>;
  midia: Record<string, number>;
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
  ];

  return (
    <Card className="overflow-x-auto">
      <div className="border-b p-3 text-sm font-semibold">Faturamento por Unidade</div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="sticky left-0 bg-muted/50 w-[200px] font-semibold">Unidade</TableHead>
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
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
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
                {isOpen && SUB_ROWS.map(({ key, label }) => (
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

// ============================================================
// Validação Royalties — Cobrado x Recebido por unidade
// ============================================================
type ApuracaoRow = {
  id: number;
  unidade_id: number;
  mes_referencia: string;
  royalties_valor: number | null;
  status: string;
};

type RecebidoLanc = {
  razao_social: string | null;
  categoria_codigo: string | null;
  status_titulo: string | null;
  data_pagamento: string | null;
  data_vencimento: string | null;
  valor_documento: number | null;
  numero_documento: string | null;
};

type RoyaltiesItem = {
  id: number;
  razao_social: string;
  cnpj: string | null;
  valor_confirmado: number | null;
  royalties_item: number | null;
  confirmado: boolean | null;
};

type ValidacaoCell = {
  cobrado: number | null;
  cobradoStatus?: string;
  cobradoApuracaoId?: number;
  recebido: number;
  recebidoItems: RecebidoLanc[];
};

const STATUS_APURACAO_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  em_revisao: "Em revisão",
  confirmado: "Confirmado",
  faturado: "Faturado",
};

function ValidacaoRoyaltiesSection() {
  const [loading, setLoading] = useState(true);
  const [apuracoes, setApuracoes] = useState<ApuracaoRow[]>([]);
  const [recebidos, setRecebidos] = useState<RecebidoLanc[]>([]);
  const [mapaUnidade, setMapaUnidade] = useState<Map<string, string>>(new Map());
  const [unidadesById, setUnidadesById] = useState<Map<number, string>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<
    | { tipo: "cobrado"; unidade: string; mes: string; apuracaoId: number }
    | { tipo: "recebido"; unidade: string; mes: string; items: RecebidoLanc[] }
    | null
  >(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [uRes, apRes, mapRes, pfRes] = await Promise.all([
        supabase.from("unidades").select("id,nome_da_praca").eq("tipo", "regional"),
        supabase
          .from("royalties_apuracao")
          .select("id,unidade_id,mes_referencia,royalties_valor,status"),
        (supabase as any).from("partners_financeiro_unidade_map").select("razao_social,unidade"),
        supabase
          .from("partners_financeiro")
          .select("razao_social,categoria_codigo,status_titulo,data_pagamento,data_vencimento,valor_documento,numero_documento")
          .in("categoria_codigo", ["1.01.95", "1.01.93"]),
      ]);
      if (!mounted) return;

      const uMap = new Map<number, string>();
      (uRes.data ?? []).forEach((u: any) => uMap.set(u.id, u.nome_da_praca));
      setUnidadesById(uMap);
      setApuracoes((apRes.data ?? []) as ApuracaoRow[]);

      const mMap = new Map<string, string>();
      (mapRes.data ?? []).forEach((m: any) => mMap.set(m.razao_social, m.unidade));
      setMapaUnidade(mMap);
      setRecebidos((pfRes.data ?? []) as RecebidoLanc[]);
      setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const { cells, months, unidadesList } = useMemo(() => {
    const cellMap = new Map<string, ValidacaoCell>();
    const monthsSet = new Set<string>();
    const unidadesSet = new Set<string>();

    const getCell = (unidade: string, mes: string) => {
      const key = `${unidade}|${mes}`;
      let c = cellMap.get(key);
      if (!c) {
        c = { cobrado: null, recebido: 0, recebidoItems: [] };
        cellMap.set(key, c);
      }
      monthsSet.add(mes);
      unidadesSet.add(unidade);
      return c;
    };

    for (const a of apuracoes) {
      const unidade = unidadesById.get(a.unidade_id);
      if (!unidade) continue;
      const mes = String(a.mes_referencia).slice(0, 7);
      const c = getCell(unidade, mes);
      c.cobrado = (c.cobrado ?? 0) + (a.royalties_valor ?? 0);
      c.cobradoApuracaoId = a.id;
      c.cobradoStatus = a.status;
    }

    for (const r of recebidos) {
      if (r.status_titulo !== "RECEBIDO") continue;
      const unidade = r.razao_social ? mapaUnidade.get(r.razao_social) : undefined;
      if (!unidade) continue;
      const dataRef = r.data_pagamento ?? r.data_vencimento;
      if (!dataRef) continue;
      const mes = dataRef.slice(0, 7);
      const c = getCell(unidade, mes);
      c.recebido += r.valor_documento ?? 0;
      c.recebidoItems.push(r);
    }

    return {
      cells: cellMap,
      months: Array.from(monthsSet).sort(),
      unidadesList: Array.from(unidadesSet).sort(),
    };
  }, [apuracoes, recebidos, mapaUnidade, unidadesById]);

  const toggle = (unidade: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(unidade)) next.delete(unidade);
      else next.add(unidade);
      return next;
    });

  if (loading) {
    return <Card className="p-6 text-sm text-muted-foreground">Carregando validação de royalties…</Card>;
  }

  if (unidadesList.length === 0) {
    return null;
  }

  const ROW_DEFS = [
    { key: "cobrado" as const, label: "Cobrado" },
    { key: "recebido" as const, label: "Recebido" },
  ];

  return (
    <Card className="overflow-x-auto">
      <div className="border-b p-3">
        <div className="text-sm font-semibold">Validação Royalties — Cobrado × Recebido</div>
        <div className="text-xs text-muted-foreground">
          Cobrado: apuração de royalties por unidade (também é a fonte da linha Royalties na aba Receitas/DRE).
          Recebido: Omie da Partners, por razão social mapeada à unidade. Clique num valor pra ver o detalhe.
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="sticky left-0 bg-muted/50 w-[200px] font-semibold">Unidade</TableHead>
            {months.map((m) => (
              <TableHead key={m} className="text-right min-w-[110px] font-semibold">
                {fmtMes(m)}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {unidadesList.map((unidade) => {
            const isOpen = expanded.has(unidade);
            return (
              <React.Fragment key={unidade}>
                <TableRow className="cursor-pointer hover:bg-muted/40 bg-muted/20" onClick={() => toggle(unidade)}>
                  <TableCell className="sticky left-0 bg-muted/20 py-2 font-semibold">
                    <div className="flex items-center gap-2">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {unidade}
                    </div>
                  </TableCell>
                  {months.map((m) => {
                    const c = cells.get(`${unidade}|${m}`);
                    if (!c || (c.cobrado == null && !c.recebido)) {
                      return (
                        <TableCell key={m} className="text-right tabular-nums py-2 text-sm text-muted-foreground/40">
                          —
                        </TableCell>
                      );
                    }
                    // Diverge se os dois existem e a diferença passa de 1% do cobrado
                    const diverge =
                      c.cobrado != null && c.recebido > 0 && Math.abs(c.cobrado - c.recebido) > Math.abs(c.cobrado) * 0.01;
                    return (
                      <TableCell key={m} className="text-right tabular-nums py-2 text-sm">
                        <span className={diverge ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"}>
                          {fmtBRL(c.cobrado ?? c.recebido)}
                        </span>
                        {diverge && <span title="Cobrado e Recebido divergem" className="ml-1">⚠️</span>}
                      </TableCell>
                    );
                  })}
                </TableRow>
                {isOpen &&
                  ROW_DEFS.map(({ key, label }) => (
                    <TableRow key={`${unidade}|${key}`} className="hover:bg-muted/10">
                      <TableCell className="sticky left-0 bg-background pl-10 py-1.5 text-sm text-muted-foreground">
                        {label}
                      </TableCell>
                      {months.map((m) => {
                        const c = cells.get(`${unidade}|${m}`);
                        if (!c) {
                          return (
                            <TableCell key={m} className="text-right tabular-nums py-1.5 text-sm text-muted-foreground/40">
                              —
                            </TableCell>
                          );
                        }
                        if (key === "cobrado") {
                          return (
                            <TableCell key={m} className="text-right tabular-nums py-1.5 text-sm">
                              {c.cobrado != null ? (
                                <button
                                  type="button"
                                  className="hover:underline hover:text-primary"
                                  title={`Ver clientes (${STATUS_APURACAO_LABEL[c.cobradoStatus ?? ""] ?? c.cobradoStatus})`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (c.cobradoApuracaoId) {
                                      setDrill({ tipo: "cobrado", unidade, mes: m, apuracaoId: c.cobradoApuracaoId });
                                    }
                                  }}
                                >
                                  {fmtBRL(c.cobrado)}
                                </button>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          );
                        }
                        return (
                          <TableCell key={m} className="text-right tabular-nums py-1.5 text-sm">
                            {c.recebido ? (
                              <button
                                type="button"
                                className="hover:underline hover:text-primary"
                                title="Ver lançamentos"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDrill({ tipo: "recebido", unidade, mes: m, items: c.recebidoItems });
                                }}
                              >
                                {fmtBRL(c.recebido)}
                              </button>
                            ) : (
                              "—"
                            )}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
      <ValidacaoDrillDialog drill={drill} onClose={() => setDrill(null)} />
    </Card>
  );
}

function ValidacaoDrillDialog({
  drill,
  onClose,
}: {
  drill:
    | { tipo: "cobrado"; unidade: string; mes: string; apuracaoId: number }
    | { tipo: "recebido"; unidade: string; mes: string; items: RecebidoLanc[] }
    | null;
  onClose: () => void;
}) {
  const [itens, setItens] = useState<RoyaltiesItem[] | null>(null);

  useEffect(() => {
    if (!drill || drill.tipo !== "cobrado") {
      setItens(null);
      return;
    }
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from("royalties_itens")
        .select("id,razao_social,cnpj,valor_confirmado,royalties_item,confirmado")
        .eq("apuracao_id", drill.apuracaoId)
        .eq("categoria", "royalties");
      if (mounted) setItens((data ?? []) as RoyaltiesItem[]);
    })();
    return () => {
      mounted = false;
    };
  }, [drill]);

  if (!drill) return null;

  const titulo = `${drill.unidade} — ${fmtMes(drill.mes)} — ${drill.tipo === "cobrado" ? "Cobrado (clientes)" : "Recebido (Omie Partners)"}`;

  return (
    <Dialog open={!!drill} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {drill.tipo === "cobrado"
              ? "Clientes que compõem o valor de royalties apurado para esta unidade/mês."
              : "Lançamentos recebidos no Omie da Partners, atribuídos a esta unidade pelo mapeamento de razão social."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto">
          {drill.tipo === "cobrado" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead className="text-center">Confirmado</TableHead>
                  <TableHead className="text-right">Royalties</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {itens === null ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : itens.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Sem itens.
                    </TableCell>
                  </TableRow>
                ) : (
                  itens.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>{it.razao_social}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{it.cnpj ?? "—"}</TableCell>
                      <TableCell className="text-center">{it.confirmado ? "✓" : "—"}</TableCell>
                      <TableCell className="text-right">{fmtBRL(it.royalties_item ?? 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Razão Social</TableHead>
                  <TableHead>Doc.</TableHead>
                  <TableHead>Pagamento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {drill.items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      Sem lançamentos.
                    </TableCell>
                  </TableRow>
                ) : (
                  drill.items.map((r, i) => (
                    <TableRow key={`${r.numero_documento ?? i}-${i}`}>
                      <TableCell>{r.razao_social ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.numero_documento ?? "—"}</TableCell>
                      <TableCell className="text-xs">
                        {r.data_pagamento
                          ? new Date(r.data_pagamento).toLocaleDateString("pt-BR")
                          : r.data_vencimento
                            ? new Date(r.data_vencimento).toLocaleDateString("pt-BR")
                            : "—"}
                      </TableCell>
                      <TableCell className="text-right">{fmtBRL(r.valor_documento ?? 0)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
