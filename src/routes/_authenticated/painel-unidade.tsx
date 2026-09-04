import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";

export const Route = createFileRoute("/_authenticated/painel-unidade")({
  head: () => ({ meta: [{ title: "Painel da Unidade – Planning" }] }),
  component: PainelUnidadePage,
});

const fmtBRL = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const fmtData = (d: string | null) => (d ? new Date(d).toLocaleDateString("pt-BR") : "—");
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D+/g, "");

type Empresa = { id: number; razao_social: string | null; cnpj: string | null; unidade: string | null; pipedrive_id: string | null; status_financeiro: string | null };
type Contrato = { pipedrive_deal_id: string | null; mrr_mensal: number | null; status_contrato: string | null; ganho_em: string | null; unidade: string | null };
type CR = { valor: number | null; status_pagamento: string | null; data_pagamento: string | null; data_vencimento: string | null; cpf_cnpj: string | null; unidade: string | null };
type Tratativa = { status: string | null; unidade: string | null; update_time: string | null; stage_change_time: string | null };
type Nps = { nps_recomendacao: string | null; created_at: string | null; unidade: string | null };

function PainelUnidadePage() {
  const { unidade: userUnidade, loading: permLoading } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [contratos, setContratos] = useState<Contrato[]>([]);
  const [cr, setCr] = useState<CR[]>([]);
  const [tratativas, setTratativas] = useState<Tratativa[]>([]);
  const [nps, setNps] = useState<Nps[]>([]);

  useEffect(() => {
    if (permLoading) return;
    let alive = true;
    setLoading(true);
    (async () => {
      const [e, c, t, n] = await Promise.all([
        // Sem filtro por tipo_unidade: a coluna está vazia em boa parte da base
        // (as empresas vindas da Omie não a preenchem) e filtrar por ela
        // escondia a maioria dos clientes da unidade.
        supabase.from("empresas").select("id,razao_social,cnpj,unidade,pipedrive_id,status_financeiro").limit(10000),
        supabase.from("contratos").select("pipedrive_deal_id,mrr_mensal,status_contrato,ganho_em,unidade").limit(20000),
        supabase.from("central_tratativas").select("status,unidade,update_time,stage_change_time").limit(10000),
        supabase.from("nps_pesquisas").select("nps_recomendacao,created_at,unidade").limit(10000),
      ]);
      const pageSize = 1000;
      let from = 0;
      const allCr: CR[] = [];
      while (true) {
        const { data } = await supabase
          .from("contas_receber")
          .select("valor,status_pagamento,data_pagamento,data_vencimento,cpf_cnpj,unidade")
          .neq("status_pagamento", "CANCELADO")
          .range(from, from + pageSize - 1);
        const batch = (data ?? []) as CR[];
        allCr.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      if (!alive) return;
      setEmpresas((e.data ?? []) as Empresa[]);
      setContratos((c.data ?? []) as Contrato[]);
      setTratativas((t.data ?? []) as Tratativa[]);
      setNps((n.data ?? []) as Nps[]);
      setCr(allCr);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [permLoading]);

  const empresasUnidade = useMemo(
    () => empresas.filter((e) => unitMatches(userUnidade, e.unidade)),
    [empresas, userUnidade],
  );
  const cnpjsUnidade = useMemo(() => new Set(empresasUnidade.map((e) => onlyDigits(e.cnpj))), [empresasUnidade]);

  // A unidade vem do próprio contrato. Antes o filtro passava por
  // empresas.pipedrive_id, mas só ~1/4 das empresas tem esse id preenchido,
  // então boa parte do MRR sumia do painel.
  const ativosUnidade = useMemo(
    () => contratos.filter((c) => c.status_contrato === "Ativo" && unitMatches(userUnidade, c.unidade)),
    [contratos, userUnidade],
  );
  const mrr = ativosUnidade.reduce((s, c) => s + Number(c.mrr_mensal ?? 0), 0);
  // Contratos ativos, e não empresas.status_financeiro: esse campo só é
  // preenchido para parte da base e subestimava muito a carteira.
  const clientesAtivos = new Set(ativosUnidade.map((c) => String(c.pipedrive_deal_id ?? c.ganho_em))).size;

  const now = new Date();
  const mesIni = new Date(now.getFullYear(), now.getMonth(), 1);
  const churnMes = tratativas.filter(
    (t) =>
      (t.status ?? "").toLowerCase() === "lost" &&
      unitMatches(userUnidade, t.unidade) &&
      ((t.stage_change_time && new Date(t.stage_change_time) >= mesIni) ||
        (t.update_time && new Date(t.update_time) >= mesIni)),
  ).length;

  const since90 = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const npsRespostas = nps.filter(
    (n) => unitMatches(userUnidade, n.unidade) && n.created_at && new Date(n.created_at) >= since90,
  );
  // Number(null) é 0 — sem descartar as respostas sem nota, cada pesquisa não
  // respondida entrava como zero e derrubava a média.
  const npsScores = npsRespostas
    .filter((n) => n.nps_recomendacao !== null && String(n.nps_recomendacao).trim() !== "")
    .map((n) => Number(n.nps_recomendacao))
    .filter((v) => Number.isFinite(v));
  const npsMedio = npsScores.length ? npsScores.reduce((a, b) => a + b, 0) / npsScores.length : 0;

  const crUnidade = useMemo(
    () => cr.filter((r) => unitMatches(userUnidade, r.unidade) || cnpjsUnidade.has(onlyDigits(r.cpf_cnpj))),
    [cr, userUnidade, cnpjsUnidade],
  );
  const inadimplentes = crUnidade.filter((r) => ["ATRASADO", "VENCIDO"].includes(r.status_pagamento ?? ""));
  const inadValor = inadimplentes.reduce((s, r) => s + Number(r.valor ?? 0), 0);
  const inadClientes = new Set(inadimplentes.map((r) => onlyDigits(r.cpf_cnpj))).size;
  const emRisco = empresasUnidade.filter((e) => ["EM_ATRASO", "INADIMPLENTE"].includes(e.status_financeiro ?? "")).length;

  const serie = useMemo(() => {
    const buckets: { mes: string; key: string; novos: number; mrr_acum: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      buckets.push({
        mes: `${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`,
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
        novos: 0,
        mrr_acum: 0,
      });
    }
    const idx = new Map(buckets.map((b, i) => [b.key, i]));
    ativosUnidade.forEach((c) => {
      if (!c.ganho_em) return;
      const k = c.ganho_em.slice(0, 7);
      const i = idx.get(k);
      if (i !== undefined) buckets[i].novos += 1;
    });
    // MRR cumulativo até o final de cada mês
    for (const b of buckets) {
      const fim = new Date(Number(b.key.split("-")[0]), Number(b.key.split("-")[1]), 1);
      b.mrr_acum = ativosUnidade
        .filter((c) => c.ganho_em && new Date(c.ganho_em) < fim)
        .reduce((s, c) => s + Number(c.mrr_mensal ?? 0), 0);
    }
    return buckets;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativosUnidade]);

  const topAlertas = useMemo(() => {
    const byCnpj = new Map<string, CR[]>();
    crUnidade.forEach((r) => {
      const k = onlyDigits(r.cpf_cnpj);
      if (!k) return;
      const arr = byCnpj.get(k) ?? [];
      arr.push(r);
      byCnpj.set(k, arr);
    });
    return empresasUnidade
      .map((e) => {
        const rows = byCnpj.get(onlyDigits(e.cnpj)) ?? [];
        const atraso = rows
          .filter((r) => ["ATRASADO", "VENCIDO"].includes(r.status_pagamento ?? ""))
          .reduce((s, r) => s + Number(r.valor ?? 0), 0);
        const ultimoPag = rows
          .filter((r) => r.status_pagamento === "RECEBIDO" && r.data_pagamento)
          .map((r) => r.data_pagamento as string)
          .sort()
          .pop();
        return { empresa: e.razao_social ?? "—", status: e.status_financeiro ?? "—", ultimoPag: ultimoPag ?? null, atraso };
      })
      .filter((r) => r.atraso > 0)
      .sort((a, b) => b.atraso - a.atraso)
      .slice(0, 5);
  }, [empresasUnidade, crUnidade]);

  return (
    <AppShell title="Painel da Unidade" subtitle={`Visão geral — ${userUnidade ?? "minha unidade"}`}>
      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi label="MRR Atual" value={loading ? "—" : fmtBRL(mrr)} />
          <Kpi label="Clientes Ativos" value={loading ? "—" : String(clientesAtivos)} />
          <Kpi label="Churn no Mês" value={loading ? "—" : String(churnMes)} />
          <Kpi
            label="Nota média (90d)"
            value={loading ? "—" : npsScores.length ? npsMedio.toFixed(1) : "—"}
            sub={`${npsScores.length} de ${npsRespostas.length} pesquisas com nota`}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Alert tone="red" label="Inadimplência" value={fmtBRL(inadValor)} sub={`${inadClientes} cliente(s) com fatura em atraso`} loading={loading} />
          <Alert tone="amber" label="Clientes em Risco" value={String(emRisco)} sub="status EM_ATRASO ou INADIMPLENTE" loading={loading} />
        </div>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold">Evolução — últimos 6 meses</h2>
          {loading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={serie}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <RTooltip formatter={(v: number, name: string) => (name === "MRR" ? fmtBRL(v) : v)} />
                <Legend />
                <Bar yAxisId="right" dataKey="novos" name="Novos clientes" fill="hsl(160 60% 45%)" />
                <Line yAxisId="left" dataKey="mrr_acum" name="MRR" stroke="hsl(220 70% 50%)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b px-4 py-3 text-sm font-semibold">Top 5 alertas</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Empresa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Último pagamento</TableHead>
                <TableHead className="text-right">Em atraso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topAlertas.length === 0 && !loading && (
                <TableRow>
                  <TableCell colSpan={4} className="py-6 text-center text-sm text-muted-foreground">Nenhum alerta crítico.</TableCell>
                </TableRow>
              )}
              {topAlertas.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="font-medium">{r.empresa}</TableCell>
                  <TableCell>{r.status}</TableCell>
                  <TableCell>{fmtData(r.ultimoPag)}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-600">{fmtBRL(r.atraso)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </AppShell>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </Card>
  );
}

function Alert({ tone, label, value, sub, loading }: { tone: "red" | "amber"; label: string; value: string; sub: string; loading: boolean }) {
  const bg = tone === "red" ? "bg-red-50 border-red-200 dark:bg-red-950/40 dark:border-red-900" : "bg-amber-50 border-amber-200 dark:bg-amber-950/40 dark:border-amber-900";
  return (
    <Card className={`${bg} p-4`}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{loading ? "—" : value}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>
    </Card>
  );
}
