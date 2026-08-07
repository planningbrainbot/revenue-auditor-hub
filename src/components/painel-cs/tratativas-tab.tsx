import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { syncTratativas } from "@/lib/tratativas.functions";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { isFranquiaUnidade } from "@/lib/franquias";
import { cn } from "@/lib/utils";

type Tratativa = {
  id: number;
  titulo: string | null;
  estagio: string | null;
  status: string | null;
  unidade: string | null;
  mrr: number | null;
  update_time: string | null;
  stage_change_time: string | null;
  motivo: string | null;
  observacao: string | null;
  data_churn: string | null;
  pipedrive_deal_id: number | null;
};

const NA = "—";

function fmtMoney(v: number | null | undefined) {
  if (v == null) return NA;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtDate(s: string | null) {
  if (!s) return NA;
  const d = new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

function fmtMesLabel(mesKey: string): string {
  const [ano, mes] = mesKey.split("-").map(Number);
  const d = new Date(ano, mes - 1, 1);
  return d.toLocaleDateString("pt-BR", { month: "short", year: "2-digit" });
}

function statusBadge(status: string | null) {
  const s = (status ?? "").toLowerCase();
  if (s === "won") return <Badge className="bg-emerald-600 hover:bg-emerald-600">Ganho</Badge>;
  if (s === "lost") return <Badge variant="destructive">Perdido</Badge>;
  if (s === "open") return <Badge variant="secondary">Aberto</Badge>;
  return <Badge variant="outline">{status ?? NA}</Badge>;
}

export function TratativasTab() {
  const perms = usePermissions();
  const [rows, setRows] = useState<Tratativa[]>([]);
  const [ganhoEmPorDealId, setGanhoEmPorDealId] = useState<Map<string, string>>(new Map());
  const [empresasBaseNova, setEmpresasBaseNova] = useState<{ pipedrive_id: string | null; unidade: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [unidadeFilter, setUnidadeFilter] = useState<string>("__all__");
  const [statusFilter, setStatusFilter] = useState<string>("__all__");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  const carregar = useCallback(async () => {
    const [tratativasRes, contratosRes, empresasRes] = await Promise.all([
      supabase
        .from("central_tratativas")
        .select("id,titulo,estagio,status,unidade,mrr,update_time,stage_change_time,motivo,observacao,data_churn,pipedrive_deal_id")
        .limit(5000),
      supabase
        .from("contratos")
        .select("pipedrive_deal_id,ganho_em")
        .not("pipedrive_deal_id", "is", null)
        .not("ganho_em", "is", null)
        .limit(10000),
      supabase
        .from("empresas")
        .select("pipedrive_id,unidade")
        .eq("tipo_unidade", "franquia")
        .limit(5000),
    ]);
    if (tratativasRes.data) setRows(tratativasRes.data as Tratativa[]);
    if (contratosRes.data) {
      const map = new Map<string, string>();
      for (const c of contratosRes.data as { pipedrive_deal_id: string | null; ganho_em: string | null }[]) {
        if (c.pipedrive_deal_id && c.ganho_em) map.set(String(c.pipedrive_deal_id), c.ganho_em);
      }
      setGanhoEmPorDealId(map);
    }
    if (empresasRes.data) {
      setEmpresasBaseNova(empresasRes.data as { pipedrive_id: string | null; unidade: string | null }[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await carregar();
      if (!mounted) return;
    })();
    return () => {
      mounted = false;
    };
  }, [carregar]);

  const syncFn = useServerFn(syncTratativas);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      await carregar();
      toast.success(`Tratativas atualizadas do Pipefy: ${res.total} card(s).`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      toast.error(msg);
    },
  });

  function tenureDias(r: Tratativa): number | null {
    if (r.pipedrive_deal_id == null || !r.data_churn) return null;
    const ganhoEm = ganhoEmPorDealId.get(String(r.pipedrive_deal_id));
    if (!ganhoEm) return null;
    const inicio = new Date(ganhoEm).getTime();
    const fim = new Date(r.data_churn).getTime();
    if (isNaN(inicio) || isNaN(fim) || fim < inicio) return null;
    return Math.round((fim - inicio) / (1000 * 60 * 60 * 24));
  }

  function ganhoEmDe(r: Tratativa): string | null {
    if (r.pipedrive_deal_id == null) return null;
    return ganhoEmPorDealId.get(String(r.pipedrive_deal_id)) ?? null;
  }

  function fmtTenure(dias: number | null): string {
    if (dias == null) return NA;
    const meses = dias / 30;
    if (meses < 1) return `${dias} dias`;
    return `${meses.toFixed(1)} meses`;
  }

  const visiveis = useMemo(() => {
    // Hard filter: somente unidades da rede de franquias (OpsBoard).
    const onlyFranchise = rows.filter((r) => isFranquiaUnidade(r.unidade));
    if (perms.scopedToOwnUnit && perms.unidade) {
      return onlyFranchise.filter((r) => unitMatches(perms.unidade, r.unidade ?? ""));
    }
    return onlyFranchise;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  const unidades = useMemo(
    () => Array.from(new Set(visiveis.map((r) => r.unidade ?? NA))).sort(),
    [visiveis],
  );
  const statuses = useMemo(
    () => Array.from(new Set(visiveis.map((r) => r.status ?? NA))).sort(),
    [visiveis],
  );

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((r) => {
      if (unidadeFilter !== "__all__" && (r.unidade ?? NA) !== unidadeFilter) return false;
      if (statusFilter !== "__all__" && (r.status ?? NA) !== statusFilter) return false;
      if (term && !(r.titulo ?? "").toLowerCase().includes(term)) return false;
      // Filtro de período: aplica só sobre quem tem data de churn — abertos/recuperados
      // sem essa data não são afetados pelo range selecionado.
      if ((dateFrom || dateTo) && r.data_churn) {
        const d = r.data_churn.slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
      }
      return true;
    });
  }, [visiveis, unidadeFilter, statusFilter, q, dateFrom, dateTo]);

  // Escopo de churn independente dos filtros secundários (estágio/status/busca) —
  // usado só pra taxa de churn blended, que precisa do total real de clientes perdidos
  // por unidade/permissão, não do subconjunto momentâneo da tabela.
  const churnedIdsEscopo = useMemo(() => {
    const perdidosEscopo = visiveis.filter(
      (r) =>
        (unidadeFilter === "__all__" || (r.unidade ?? NA) === unidadeFilter) &&
        (r.status ?? "").toLowerCase() === "lost",
    );
    return new Set(perdidosEscopo.map((r) => String(r.pipedrive_deal_id)).filter((id) => id !== "null"));
  }, [visiveis, unidadeFilter]);

  const baseNovaStats = useMemo(() => {
    const escopo = empresasBaseNova.filter((e) => {
      if (perms.scopedToOwnUnit && perms.unidade && !unitMatches(perms.unidade, e.unidade ?? "")) return false;
      if (unidadeFilter !== "__all__" && (e.unidade ?? NA) !== unidadeFilter) return false;
      return true;
    });
    const ativos = escopo.filter(
      (e) => !e.pipedrive_id || !churnedIdsEscopo.has(String(e.pipedrive_id)),
    ).length;
    return { total: escopo.length, ativos };
  }, [empresasBaseNova, perms.scopedToOwnUnit, perms.unidade, unidadeFilter, churnedIdsEscopo]);

  const kpis = useMemo(() => {
    let perdidos = 0;
    let recuperados = 0;
    let abertos = 0;
    let mrrPerdido = 0;
    let mrrRecuperado = 0;
    const tenures: number[] = [];
    for (const r of filtered) {
      const s = (r.status ?? "").toLowerCase();
      const mrr = r.mrr ?? 0;
      if (s === "lost") {
        perdidos += 1;
        mrrPerdido += mrr;
        const t = tenureDias(r);
        if (t != null) tenures.push(t);
      } else if (s === "won") {
        recuperados += 1;
        mrrRecuperado += mrr;
      } else if (s === "open") {
        abertos += 1;
      }
    }
    const tenureMedioDias = tenures.length > 0 ? tenures.reduce((a, b) => a + b, 0) / tenures.length : null;
    return {
      total: filtered.length,
      perdidos,
      recuperados,
      abertos,
      mrrPerdido,
      mrrRecuperado,
      taxaRecuperacao: perdidos + recuperados > 0 ? (recuperados / (perdidos + recuperados)) * 100 : 0,
      taxaChurnBlended: baseNovaStats.ativos > 0 ? (churnedIdsEscopo.size / baseNovaStats.ativos) * 100 : 0,
      churnBlendedNum: churnedIdsEscopo.size,
      churnBlendedDenom: baseNovaStats.ativos,
      tenureMedioDias,
      tenureAmostra: tenures.length,
    };
  }, [filtered, ganhoEmPorDealId, baseNovaStats, churnedIdsEscopo]);

  const motivosPerda = useMemo(() => {
    const map = new Map<string, { motivo: string; count: number; mrr: number }>();
    for (const r of filtered) {
      if ((r.status ?? "").toLowerCase() !== "lost") continue;
      const motivo = (r.motivo ?? "").trim();
      if (!motivo) continue;
      const g = map.get(motivo) ?? { motivo, count: 0, mrr: 0 };
      g.count += 1;
      g.mrr += r.mrr ?? 0;
      map.set(motivo, g);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const perdidosSemMotivo = useMemo(
    () => filtered.filter((r) => (r.status ?? "").toLowerCase() === "lost" && !(r.motivo ?? "").trim()).length,
    [filtered],
  );

  const porUnidade = useMemo(() => {
    const map = new Map<string, { unidade: string; total: number; perdidos: number; recuperados: number; mrrPerdido: number }>();
    for (const r of filtered) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, total: 0, perdidos: 0, recuperados: 0, mrrPerdido: 0 };
      g.total += 1;
      const s = (r.status ?? "").toLowerCase();
      if (s === "lost") {
        g.perdidos += 1;
        g.mrrPerdido += r.mrr ?? 0;
      } else if (s === "won") {
        g.recuperados += 1;
      }
      map.set(u, g);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filtered]);

  const mrrPerdidoPorMes = useMemo(() => {
    const map = new Map<string, { mes: string; mrr: number; qtd: number }>();
    for (const r of filtered) {
      if ((r.status ?? "").toLowerCase() !== "lost" || !r.data_churn) continue;
      const d = new Date(r.data_churn);
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const g = map.get(key) ?? { mes: key, mrr: 0, qtd: 0 };
      g.mrr += r.mrr ?? 0;
      g.qtd += 1;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => a.mes.localeCompare(b.mes));
  }, [filtered]);

  const tabela = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const da = a.update_time ? new Date(a.update_time).getTime() : 0;
        const db = b.update_time ? new Date(b.update_time).getTime() : 0;
        return db - da;
      }),
    [filtered],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", sync.isPending && "animate-spin")} />
          Forçar atualização
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total</div>
          <div className="text-2xl font-bold">{kpis.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Em aberto</div>
          <div className="text-2xl font-bold">{kpis.abertos}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Perdidos</div>
          <div className="text-2xl font-bold text-destructive">{kpis.perdidos}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Recuperados</div>
          <div className="text-2xl font-bold text-emerald-600">{kpis.recuperados}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">MRR perdido</div>
          <div className="text-xl font-bold text-destructive">{fmtMoney(kpis.mrrPerdido)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Taxa de recuperação</div>
          <div className="text-2xl font-bold">{kpis.taxaRecuperacao.toFixed(1)}%</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Taxa de churn (blended)</div>
          <div className="text-2xl font-bold text-destructive">{kpis.taxaChurnBlended.toFixed(1)}%</div>
          <div className="text-[11px] text-muted-foreground">
            {kpis.churnBlendedNum} churn / {kpis.churnBlendedDenom} ativos (base nova)
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Tempo médio até churn</div>
          <div className="text-xl font-bold">{fmtTenure(kpis.tenureMedioDias)}</div>
          <div className="text-[11px] text-muted-foreground">
            {kpis.tenureAmostra > 0 ? `${kpis.tenureAmostra} caso(s) com contrato + data de churn` : "sem dados suficientes"}
          </div>
        </Card>
      </div>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por título…"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
            <SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todas as unidades</SelectItem>
              {unidades.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos os status</SelectItem>
              {statuses.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">Churn de</span>
            <Input
              type="date"
              className="text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground shrink-0">até</span>
            <Input
              type="date"
              className="text-sm"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
        </div>
      </Card>

      {/* Gráficos */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Tratativas por unidade</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porUnidade}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="unidade" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="perdidos" stackId="a" fill="#ef4444" name="Perdidos" />
                <Bar dataKey="recuperados" stackId="a" fill="#10b981" name="Recuperados" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">MRR perdido por mês</div>
          <div className="h-72">
            {mrrPerdidoPorMes.length === 0 ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Nenhum churn com data registrada para os filtros atuais.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={mrrPerdidoPorMes}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="mes" tickFormatter={fmtMesLabel} tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtMoney(v)} width={90} />
                  <Tooltip
                    labelFormatter={(v) => fmtMesLabel(String(v))}
                    formatter={(value: number, name, item) => [
                      fmtMoney(value),
                      `MRR perdido (${item?.payload?.qtd ?? 0} caso(s))`,
                    ]}
                  />
                  <Bar dataKey="mrr" fill="#ef4444" name="MRR perdido" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* Motivos de perda */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm font-semibold">Motivos de perda</div>
          {perdidosSemMotivo > 0 && (
            <div className="text-xs text-muted-foreground">
              {perdidosSemMotivo} perdido(s) sem motivo registrado no Pipefy
            </div>
          )}
        </div>
        {motivosPerda.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            Nenhum motivo de perda registrado ainda para os filtros atuais.
          </div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Motivo</TableHead>
                  <TableHead className="bg-background text-right">Ocorrências</TableHead>
                  <TableHead className="bg-background text-right">MRR perdido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {motivosPerda.map((m) => (
                  <TableRow key={m.motivo}>
                    <TableCell className="font-medium">{m.motivo}</TableCell>
                    <TableCell className="text-right">{m.count}</TableCell>
                    <TableCell className="text-right">{fmtMoney(m.mrr)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>

      {/* Resumo por unidade */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Resumo por unidade</div>
        </div>
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b">
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background text-right">Total</TableHead>
                <TableHead className="bg-background text-right">Perdidos</TableHead>
                <TableHead className="bg-background text-right">Recuperados</TableHead>
                <TableHead className="bg-background text-right">MRR perdido</TableHead>
                <TableHead className="bg-background text-right">% recuperação</TableHead>
              </tr>
            </thead>
            <TableBody>
              {porUnidade.map((u) => {
                const denom = u.perdidos + u.recuperados;
                const taxa = denom > 0 ? (u.recuperados / denom) * 100 : 0;
                return (
                  <TableRow key={u.unidade}>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right">{u.total}</TableCell>
                    <TableCell className="text-right text-destructive">{u.perdidos}</TableCell>
                    <TableCell className="text-right text-emerald-600">{u.recuperados}</TableCell>
                    <TableCell className="text-right">{fmtMoney(u.mrrPerdido)}</TableCell>
                    <TableCell className="text-right">{taxa.toFixed(1)}%</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
      </Card>

      {/* Tabela detalhada */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="text-sm font-semibold">Tratativas</div>
          <div className="text-xs text-muted-foreground">{loading ? "Carregando…" : `${tabela.length} registros`}</div>
        </div>
        <div className="overflow-auto max-h-[600px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Título</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Status</TableHead>
                <TableHead className="bg-background text-right">MRR</TableHead>
                <TableHead className="bg-background">Motivo da perda</TableHead>
                <TableHead className="bg-background">Observação</TableHead>
                <TableHead className="bg-background">Tempo como cliente</TableHead>
                <TableHead className="bg-background">Data do ganho</TableHead>
                <TableHead className="bg-background">Data do churn</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tabela.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.titulo ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right">{fmtMoney(r.mrr)}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.motivo ?? undefined}>
                    {r.motivo ?? NA}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.observacao ?? undefined}>
                    {r.observacao ?? NA}
                  </TableCell>
                  <TableCell>{fmtTenure(tenureDias(r))}</TableCell>
                  <TableCell>{ganhoEmDe(r) ? fmtDate(ganhoEmDe(r)) : ""}</TableCell>
                  <TableCell>{r.data_churn ? fmtDate(r.data_churn) : ""}</TableCell>
                </TableRow>
              ))}
              {!loading && tabela.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                    Nenhuma tratativa encontrada com os filtros atuais.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </table>
        </div>
      </Card>
    </div>
  );
}
