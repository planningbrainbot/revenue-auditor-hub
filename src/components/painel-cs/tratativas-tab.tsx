import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
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
import { isUnidadeDaRede } from "@/lib/unidades-rede";
import { CORES_SERIE, COR_NEGATIVO, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";
import { useFiltroNaUrl } from "@/lib/planning/filtro-url";
import { Carregando, EstadoErro, KpiCard, KpiGrade, StatusBadge, type TomStatus } from "@/components/planning";
import { BotaoAtualizarPipefy } from "./botao-atualizar";

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
const TODOS = "__all__";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function fmtMoney(v: number | null | undefined) {
  if (v == null) return NA;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtDate(s: string | null) {
  if (!s) return NA;
  // Data pura ("aaaa-mm-dd") sai da própria string: `new Date` a leria em UTC
  // e, no fuso de Brasília, mostraria o dia anterior.
  const soData = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (soData) return `${soData[3]}/${soData[2]}/${soData[1]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

// Mês do eixo a partir da string "aaaa-mm", sem passar por Date.
function fmtMesLabel(mesKey: string): string {
  const [ano, mes] = mesKey.split("-");
  const nome = MESES[Number(mes) - 1];
  return nome && ano ? `${nome}/${ano.slice(2)}` : mesKey;
}

// Chave de mês da data de churn tirada da string: `new Date("2026-08-01")` é
// meia-noite UTC, que em Brasília ainda é 31/07 e jogava o churn no mês errado.
function mesDaData(s: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function fmtPct(v: number | null): string {
  return v == null ? NA : `${v.toFixed(1).replace(".", ",")}%`;
}

const STATUS: Record<string, { tom: TomStatus; rotulo: string }> = {
  open: { tom: "info", rotulo: "Aberto" },
  lost: { tom: "perigo", rotulo: "Perdido" },
  won: { tom: "sucesso", rotulo: "Recuperado" },
};

function rotuloStatus(status: string): string {
  return STATUS[status.toLowerCase()]?.rotulo ?? status;
}

function statusBadge(status: string | null) {
  const conhecido = STATUS[(status ?? "").toLowerCase()];
  if (conhecido) return <StatusBadge tom={conhecido.tom}>{conhecido.rotulo}</StatusBadge>;
  return <StatusBadge tom="neutro">{status ?? NA}</StatusBadge>;
}

export function TratativasTab() {
  const perms = usePermissions();
  const [rows, setRows] = useState<Tratativa[]>([]);
  const [ganhoEmPorDealId, setGanhoEmPorDealId] = useState<Map<string, string>>(new Map());
  const [empresasBaseNova, setEmpresasBaseNova] = useState<{ pipedrive_id: string | null; unidade: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [erros, setErros] = useState<string[]>([]);
  // Filtros na URL (N7): recarregar ou colar o link reproduz o recorte.
  const [unidadeNaUrl, setUnidadeFilter] = useFiltroNaUrl("unidade", TODOS);
  const [statusNaUrl, setStatusFilter] = useFiltroNaUrl("status", TODOS);
  const [q, setQ] = useFiltroNaUrl("q", "");
  const [dateFrom, setDateFrom] = useFiltroNaUrl("de", "");
  const [dateTo, setDateTo] = useFiltroNaUrl("ate", "");

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
    // Erro de leitura era engolido e a tela mostrava zeros (N4): cada fonte
    // que falhou é nomeada no EstadoErro.
    const falhas: string[] = [];
    if (tratativasRes.error) falhas.push(`central_tratativas (Central de Tratativas): ${tratativasRes.error.message}`);
    if (contratosRes.error) falhas.push(`contratos (data do ganho): ${contratosRes.error.message}`);
    if (empresasRes.error) falhas.push(`empresas (base para o churn blended): ${empresasRes.error.message}`);
    setErros(falhas);
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
    // Hard filter: somente unidades regionais da rede.
    const daRede = rows.filter((r) => isUnidadeDaRede(r.unidade));
    if (perms.scopedToOwnUnit && perms.unidade) {
      return daRede.filter((r) => unitMatches(perms.unidade, r.unidade ?? ""));
    }
    return daRede;
  }, [rows, perms.scopedToOwnUnit, perms.unidade]);

  const unidades = useMemo(
    () => Array.from(new Set(visiveis.map((r) => r.unidade ?? NA))).sort(),
    [visiveis],
  );
  const statuses = useMemo(
    () => Array.from(new Set(visiveis.map((r) => r.status ?? NA))).sort(),
    [visiveis],
  );
  // Link com ?unidade= ou ?status= fora das opções (colado à mão, unidade
  // fora do escopo) cai em "todos", em vez de zerar a tela sem explicar.
  const unidadeFilter = unidades.includes(unidadeNaUrl) ? unidadeNaUrl : TODOS;
  const statusFilter = statuses.includes(statusNaUrl) ? statusNaUrl : TODOS;

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return visiveis.filter((r) => {
      if (unidadeFilter !== TODOS && (r.unidade ?? NA) !== unidadeFilter) return false;
      if (statusFilter !== TODOS && (r.status ?? NA) !== statusFilter) return false;
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
        (unidadeFilter === TODOS || (r.unidade ?? NA) === unidadeFilter) &&
        (r.status ?? "").toLowerCase() === "lost",
    );
    return new Set(perdidosEscopo.map((r) => String(r.pipedrive_deal_id)).filter((id) => id !== "null"));
  }, [visiveis, unidadeFilter]);

  const baseNovaStats = useMemo(() => {
    const escopo = empresasBaseNova.filter((e) => {
      if (perms.scopedToOwnUnit && perms.unidade && !unitMatches(perms.unidade, e.unidade ?? "")) return false;
      if (unidadeFilter !== TODOS && (e.unidade ?? NA) !== unidadeFilter) return false;
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
    let perdidosSemMrr = 0;
    let mrrRecuperado = 0;
    const tenures: number[] = [];
    for (const r of filtered) {
      const s = (r.status ?? "").toLowerCase();
      const mrr = r.mrr ?? 0;
      if (s === "lost") {
        perdidos += 1;
        mrrPerdido += mrr;
        if (r.mrr == null) perdidosSemMrr += 1;
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
      perdidosSemMrr,
      mrrRecuperado,
      // Sem denominador a taxa não existe: "—", não 0% (N4).
      taxaRecuperacao: perdidos + recuperados > 0 ? (recuperados / (perdidos + recuperados)) * 100 : null,
      taxaChurnBlended: baseNovaStats.ativos > 0 ? (churnedIdsEscopo.size / baseNovaStats.ativos) * 100 : null,
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
      const key = mesDaData(r.data_churn);
      if (!key) continue;
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
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="ghost" size="sm" className="gap-1.5">
          <Link to="/clientes" search={{ view: "contratos" }}>
            Contratos e churn
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </Button>
        <BotaoAtualizarPipefy atualizando={sync.isPending} onClick={() => sync.mutate()} />
      </div>

      {erros.length > 0 ? (
        <EstadoErro
          detalhe={
            <ul className="list-disc pl-4">
              {erros.map((e) => (
                <li key={e}>Fonte: {e}</li>
              ))}
            </ul>
          }
          tentarNovamente={() => {
            setErros([]);
            setLoading(true);
            void carregar();
          }}
        />
      ) : loading ? (
        <div className="space-y-4">
          <Carregando variante="kpis" />
          <Carregando variante="grafico" />
          <Carregando variante="tabela" />
        </div>
      ) : (
      <>

      {/* KPIs — oito números em duas linhas de quatro: a grade do design system
          vai até seis por linha, e oito cards de 30px numa só não cabem. As
          cores de perdido/recuperado ficam como tom do KpiCard, com ícone de status
          junto da cor (V7). */}
      <KpiGrade colunas={4}>
        <KpiCard rotulo="Total" valor={kpis.total} />
        <KpiCard rotulo="Em aberto" valor={kpis.abertos} />
        <KpiCard rotulo="Perdidos" valor={kpis.perdidos} tom="perigo" />
        <KpiCard rotulo="Recuperados" valor={kpis.recuperados} tom="sucesso" />
        <KpiCard
          rotulo="MRR perdido"
          valor={fmtMoney(kpis.mrrPerdido)}
          tom="perigo"
          nota={kpis.perdidosSemMrr > 0 ? `${kpis.perdidosSemMrr} perdidos sem MRR` : undefined}
        />
        <KpiCard
          rotulo="Taxa de recuperação"
          valor={fmtPct(kpis.taxaRecuperacao)}
          estado={kpis.taxaRecuperacao == null ? "nao-apurado" : "ok"}
          nota="recuperados ÷ (recuperados + perdidos)"
        />
        <KpiCard
          rotulo="Taxa de churn (blended)"
          valor={fmtPct(kpis.taxaChurnBlended)}
          estado={kpis.taxaChurnBlended == null ? "nao-apurado" : "ok"}
          tom="perigo"
          nota={`${kpis.churnBlendedNum} churn / ${kpis.churnBlendedDenom} ativos (base nova) · ignora busca, status e período`}
        />
        <KpiCard
          rotulo="Tempo médio até churn"
          valor={fmtTenure(kpis.tenureMedioDias)}
          estado={kpis.tenureMedioDias == null ? "nao-apurado" : "ok"}
          nota={
            kpis.tenureAmostra > 0
              ? `${kpis.tenureAmostra} caso(s) com contrato + data de churn`
              : "sem dados suficientes"
          }
        />
      </KpiGrade>

      {/* Filtros */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              aria-label="Buscar por título"
              placeholder="Buscar por título…"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
            <SelectTrigger aria-label="Unidade"><SelectValue placeholder="Unidade" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todas as unidades</SelectItem>
              {unidades.map((u) => (<SelectItem key={u} value={u}>{u}</SelectItem>))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger aria-label="Status"><SelectValue placeholder="Status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={TODOS}>Todos os status</SelectItem>
              {statuses.map((s) => (<SelectItem key={s} value={s}>{rotuloStatus(s)}</SelectItem>))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-1.5">
            <label htmlFor="cs-churn-de" className="text-[13px] text-muted-foreground shrink-0">Churn de</label>
            <Input
              id="cs-churn-de"
              type="date"
              className="text-sm"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="cs-churn-ate" className="text-[13px] text-muted-foreground shrink-0">até</label>
            <Input
              id="cs-churn-ate"
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
                <CartesianGrid {...gradeProps} />
                <XAxis {...eixoProps} dataKey="unidade" interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis {...eixoProps} />
                <Tooltip {...tooltipProps} />
                <Legend {...legendaProps} />
                <Bar dataKey="perdidos" stackId="a" fill={COR_NEGATIVO} name="Perdidos" />
                <Bar dataKey="recuperados" stackId="a" fill={CORES_SERIE[0]} name="Recuperados" />
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
                  <CartesianGrid {...gradeProps} />
                  <XAxis {...eixoProps} dataKey="mes" tickFormatter={fmtMesLabel} />
                  <YAxis {...eixoProps} tickFormatter={(v) => fmtMoney(v)} width={90} />
                  <Tooltip
                    {...tooltipProps}
                    labelFormatter={(v) => fmtMesLabel(String(v))}
                    formatter={(value: number, name, item) => [
                      fmtMoney(value),
                      `MRR perdido (${item?.payload?.qtd ?? 0} caso(s))`,
                    ]}
                  />
                  <Bar dataKey="mrr" fill={COR_NEGATIVO} name="MRR perdido" />
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
                    <TableCell className="num text-right">{m.count}</TableCell>
                    <TableCell className="num text-right">{fmtMoney(m.mrr)}</TableCell>
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
                const taxa = denom > 0 ? (u.recuperados / denom) * 100 : null;
                return (
                  <TableRow key={u.unidade}>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="num text-right">{u.total}</TableCell>
                    <TableCell className="num text-right text-danger">{u.perdidos}</TableCell>
                    <TableCell className="num text-right text-success">{u.recuperados}</TableCell>
                    <TableCell className="num text-right">{fmtMoney(u.mrrPerdido)}</TableCell>
                    <TableCell className="num text-right">{fmtPct(taxa)}</TableCell>
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
          <div className="text-xs text-muted-foreground">{`${tabela.length} registros`}</div>
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
                  <TableCell className="num text-right">{fmtMoney(r.mrr)}</TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.motivo ?? undefined}>
                    {r.motivo ?? NA}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate" title={r.observacao ?? undefined}>
                    {r.observacao ?? NA}
                  </TableCell>
                  <TableCell>{fmtTenure(tenureDias(r))}</TableCell>
                  <TableCell>{fmtDate(ganhoEmDe(r))}</TableCell>
                  <TableCell>{fmtDate(r.data_churn)}</TableCell>
                </TableRow>
              ))}
              {tabela.length === 0 && (
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
      </>
      )}
    </div>
  );
}
