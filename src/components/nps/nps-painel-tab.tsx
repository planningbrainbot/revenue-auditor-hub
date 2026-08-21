import { useMemo, useState } from "react";
import { Search, X, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontal } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useNps, useNpsCoverage } from "@/hooks/use-nps";
import type { NpsRow } from "@/lib/nps.functions";
import { usePermissions, unitMatches } from "@/hooks/use-permissions";
import { useTheme } from "@/hooks/use-theme";

const ALL = "__all__";

type Categoria = "promotor" | "neutro" | "detrator" | null;

function categorize(score: string | null): Categoria {
  if (score == null || score === "") return null;
  const n = Number(score);
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return "promotor";
  if (n >= 7) return "neutro";
  return "detrator";
}

function npsBadge(cat: Categoria) {
  if (cat === "promotor")
    return <Badge variant="outline" className="border-emerald-600/30 bg-emerald-600/[0.07] text-emerald-700 dark:text-emerald-400">Promotor</Badge>;
  if (cat === "neutro")
    return <Badge variant="outline" className="border-amber-600/30 bg-amber-600/[0.07] text-amber-700 dark:text-amber-400">Neutro</Badge>;
  if (cat === "detrator")
    return <Badge variant="outline" className="border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400">Detrator</Badge>;
  return <Badge variant="outline">—</Badge>;
}

function classifyNps(score: number) {
  if (score >= 75) return { label: "Excelente", icon: TrendingUp, color: "text-emerald-600" };
  if (score >= 50) return { label: "Muito bom", icon: TrendingUp, color: "text-emerald-600" };
  if (score >= 0) return { label: "Razoável", icon: Minus, color: "text-amber-600" };
  return { label: "Crítico", icon: TrendingDown, color: "text-red-600" };
}

function fmtDate(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
}

// CSAT consolida as 3 notas por serviço (fiscal/contábil/folha) num único
// score — convenção top-box: nota >= 8 (de 0-10) conta como "satisfeito".
function csatRatings(r: NpsRow): number[] {
  // Number(null) === 0 em JS — sem o filtro de nulo/vazio ANTES da
  // conversão, todo campo não respondido virava uma "nota 0" (bug real:
  // inflava o total de notas e derrubava o CSAT artificialmente).
  return [r.avaliacao_fiscal, r.avaliacao_contabil, r.avaliacao_folha_pagamento]
    .filter((v): v is string => v != null && v !== "" && v !== "Sem Resposta")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
}

// fill="hsl(var(--x))" como atributo SVG puro não resolve de forma confiável
// em produção (bug observado: barras saindo pretas) — resolvemos a cor em
// JS a partir do tema ativo em vez de depender do var() dentro do atributo.
const NPS_FILL = { light: "#00c38b", dark: "#3ce7ad" };
const CSAT_FILL = { light: "#0e5e8a", dark: "#2f91bd" };

export function NpsPainelTab() {
  const { data, isLoading, error } = useNps();
  const { data: coverage, isLoading: coverageLoading, error: coverageError } = useNpsCoverage();
  const perms = usePermissions();
  const { theme } = useTheme();
  const npsFill = NPS_FILL[theme];
  const csatFill = CSAT_FILL[theme];
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    // Mesmo padrão de tratativas-tab.tsx: só restringe por unidade quando o
    // usuário é escopado a uma unidade própria (sócio franqueado). Papéis
    // sem esse escopo (admin/diretor/auditor/CS) veem tudo, inclusive linhas
    // sem unidade reconhecida — necessário pra campanha de WhatsApp, cujos
    // cards nascem sem unidade (só descoberta depois, se descoberta).
    // Antes disso usava isFranquiaUnidade, que descartava silenciosamente
    // qualquer linha sem unidade pra TODO MUNDO, inclusive admin.
    if (!perms.scopedToOwnUnit || !perms.unidade) return all;
    return all.filter((r) => unitMatches(perms.unidade, r.unidade ?? r.empresa_unidade));
  }, [data, perms.scopedToOwnUnit, perms.unidade]);

  const [q, setQ] = useState("");
  const [unidade, setUnidade] = useState(ALL);
  const [segmento, setSegmento] = useState(ALL);
  const [categoria, setCategoria] = useState(ALL);
  const [fase, setFase] = useState(ALL);

  const unidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.unidade).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const segmentos = useMemo(
    () => Array.from(new Set(rows.map((r) => r.segmento).filter(Boolean) as string[])).sort(),
    [rows],
  );
  const fases = useMemo(
    () => Array.from(new Set(rows.map((r) => r.fase).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (unidade !== ALL && r.unidade !== unidade) return false;
      if (segmento !== ALL && r.segmento !== segmento) return false;
      if (fase !== ALL && r.fase !== fase) return false;
      if (categoria !== ALL) {
        const cat = categorize(r.nps_recomendacao);
        if (cat !== categoria) return false;
      }
      if (qn) {
        const hay = `${r.empresa ?? ""} ${r.nome_contato ?? ""} ${r.email_pesquisa ?? ""}`.toLowerCase();
        if (!hay.includes(qn)) return false;
      }
      return true;
    });
  }, [rows, q, unidade, segmento, fase, categoria]);

  const respondidas = useMemo(
    () => filtered.filter((r) => categorize(r.nps_recomendacao) !== null),
    [filtered],
  );

  const kpis = useMemo(() => {
    const total = filtered.length;
    const resp = respondidas.length;
    const promotores = respondidas.filter((r) => categorize(r.nps_recomendacao) === "promotor").length;
    const neutros = respondidas.filter((r) => categorize(r.nps_recomendacao) === "neutro").length;
    const detratores = respondidas.filter((r) => categorize(r.nps_recomendacao) === "detrator").length;
    const nps = resp > 0 ? Math.round(((promotores - detratores) / resp) * 100) : 0;
    const taxaResposta = total > 0 ? Math.round((resp / total) * 100) : 0;
    const aguardando = filtered.filter((r) => r.fase === "Pesquisa Enviada").length;
    const semResposta = filtered.filter((r) => r.fase === "Sem Resposta").length;
    const notasFiscais = filtered
      .map((r) => Number(r.avaliacao_fiscal))
      .filter((n) => Number.isFinite(n));
    const mediaFiscal =
      notasFiscais.length > 0
        ? notasFiscais.reduce((a, b) => a + b, 0) / notasFiscais.length
        : null;
    return { total, resp, promotores, neutros, detratores, nps, taxaResposta, mediaFiscal, aguardando, semResposta };
  }, [filtered, respondidas]);

  // Amostra pequena no mês corrente torna o delta ruído, não sinal — suprime
  // a variação (mostra só "amostra pequena") abaixo de AMOSTRA_MINIMA.
  const AMOSTRA_MINIMA = 10;

  function deltaVsMesAnterior(
    serie: { mes: string }[],
    key: "nps" | "csat",
    amostraKey: "respondentes" | "notas",
  ): { delta: number; amostraPequena: boolean } | null {
    if (serie.length < 2) return null;
    const atualRow = serie[serie.length - 1] as unknown as Record<string, number>;
    const anteriorRow = serie[serie.length - 2] as unknown as Record<string, number>;
    const amostraAtual = atualRow[amostraKey] ?? 0;
    return {
      delta: Math.round((atualRow[key] - anteriorRow[key]) * 10) / 10,
      amostraPequena: amostraAtual < AMOSTRA_MINIMA,
    };
  }

  const csat = useMemo(() => {
    const ratings = filtered.flatMap(csatRatings);
    const satisfeitos = ratings.filter((n) => n >= 8).length;
    const score = ratings.length > 0 ? Math.round((satisfeitos / ratings.length) * 1000) / 10 : null;
    return { score, totalNotas: ratings.length };
  }, [filtered]);

  const evolucaoCsatMensal = useMemo(() => {
    const map = new Map<string, { satisfeitos: number; total: number }>();
    for (const r of filtered) {
      const d = r.created_at ? new Date(r.created_at) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const ratings = csatRatings(r);
      if (ratings.length === 0) continue;
      const cur = map.get(key) ?? { satisfeitos: 0, total: 0 };
      cur.satisfeitos += ratings.filter((n) => n >= 8).length;
      cur.total += ratings.length;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        csat: v.total > 0 ? Math.round((v.satisfeitos / v.total) * 1000) / 10 : 0,
        notas: v.total,
      }));
  }, [filtered]);

  const distribuicaoCategoria = useMemo(
    () => [
      { name: "Promotores", value: kpis.promotores, fill: "hsl(142 71% 45%)" },
      { name: "Neutros", value: kpis.neutros, fill: "hsl(38 92% 50%)" },
      { name: "Detratores", value: kpis.detratores, fill: "hsl(0 84% 60%)" },
    ],
    [kpis],
  );

  const distribuicaoNota = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i <= 10; i++) map.set(i, 0);
    for (const r of respondidas) {
      const n = Number(r.nps_recomendacao);
      if (Number.isFinite(n) && n >= 0 && n <= 10) {
        map.set(n, (map.get(n) ?? 0) + 1);
      }
    }
    return Array.from(map.entries()).map(([nota, qtd]) => ({
      nota: String(nota),
      qtd,
      fill: nota >= 9 ? "hsl(142 71% 45%)" : nota >= 7 ? "hsl(38 92% 50%)" : "hsl(0 84% 60%)",
    }));
  }, [respondidas]);

  const npsPorUnidade = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      const u = r.unidade ?? "—";
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(u) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(u, cur);
    }
    return Array.from(map.entries())
      .map(([unidade, v]) => ({
        unidade,
        nps: v.total > 0 ? Math.round(((v.promotor - v.detrator) / v.total) * 100) : 0,
        respondentes: v.total,
      }))
      .sort((a, b) => b.nps - a.nps);
  }, [respondidas]);

  const npsPorSegmento = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      const s = r.segmento ?? "—";
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(s) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(s, cur);
    }
    return Array.from(map.entries())
      .map(([segmento, v]) => ({
        segmento,
        nps: v.total > 0 ? Math.round(((v.promotor - v.detrator) / v.total) * 100) : 0,
        respondentes: v.total,
      }))
      .sort((a, b) => b.nps - a.nps);
  }, [respondidas]);

  const evolucaoMensal = useMemo(() => {
    const map = new Map<string, { promotor: number; neutro: number; detrator: number; total: number }>();
    for (const r of respondidas) {
      const d = r.created_at ? new Date(r.created_at) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const cat = categorize(r.nps_recomendacao);
      if (!cat) continue;
      const cur = map.get(key) ?? { promotor: 0, neutro: 0, detrator: 0, total: 0 };
      cur[cat] += 1;
      cur.total += 1;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, v]) => ({
        mes,
        nps: v.total > 0 ? Math.round(((v.promotor - v.detrator) / v.total) * 100) : 0,
        respondentes: v.total,
      }));
  }, [respondidas]);

  const detratoresList = useMemo(
    () =>
      respondidas
        .filter((r) => categorize(r.nps_recomendacao) === "detrator")
        .sort((a, b) => Number(a.nps_recomendacao) - Number(b.nps_recomendacao))
        .slice(0, 10),
    [respondidas],
  );

  const hasFilters = q || unidade !== ALL || segmento !== ALL || fase !== ALL || categoria !== ALL;
  const clearFilters = () => {
    setQ("");
    setUnidade(ALL);
    setSegmento(ALL);
    setFase(ALL);
    setCategoria(ALL);
  };

  const filtrosAtivos = [q, unidade !== ALL, segmento !== ALL, categoria !== ALL, fase !== ALL].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {filtrosAtivos > 0 && (
                <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-primary-foreground">
                  {filtrosAtivos}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar empresa, contato ou e-mail..."
                className="pl-8"
              />
            </div>
            <Select value={unidade} onValueChange={setUnidade}>
              <SelectTrigger><SelectValue placeholder="Unidade" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as unidades</SelectItem>
                {unidades.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={segmento} onValueChange={setSegmento}>
              <SelectTrigger><SelectValue placeholder="Segmento" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos os segmentos</SelectItem>
                {segmentos.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas categorias</SelectItem>
                <SelectItem value="promotor">Promotores</SelectItem>
                <SelectItem value="neutro">Neutros</SelectItem>
                <SelectItem value="detrator">Detratores</SelectItem>
              </SelectContent>
            </Select>
            <Select value={fase} onValueChange={setFase}>
              <SelectTrigger><SelectValue placeholder="Fase" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas as fases</SelectItem>
                {fases.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="w-full">
                <X className="mr-1 h-4 w-4" /> Limpar filtros
              </Button>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {isLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando pesquisas…</Card>}
      {error && <Card className="p-6 text-sm text-red-600">Erro ao carregar dados.</Card>}

      <Tabs defaultValue="resumo" className="w-full">
        <TabsList>
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="cobertura">Cobertura da base</TabsTrigger>
          <TabsTrigger value="unidades">Por unidade</TabsTrigger>
          <TabsTrigger value="respostas">Respostas</TabsTrigger>
        </TabsList>

        <TabsContent value="resumo" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            {(() => {
              const npsDelta = deltaVsMesAnterior(evolucaoMensal, "nps", "respondentes");
              return (
                <Card className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">NPS</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-3xl font-semibold tabular-nums">{kpis.resp > 0 ? kpis.nps : "—"}</span>
                        {npsDelta != null && !npsDelta.amostraPequena && (
                          <span className={`flex items-center gap-0.5 text-xs font-medium ${npsDelta.delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                            {npsDelta.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {npsDelta.delta >= 0 ? "+" : ""}{npsDelta.delta} pts
                          </span>
                        )}
                        {npsDelta?.amostraPequena && (
                          <span className="text-xs text-muted-foreground">amostra pequena</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">vs. mês anterior · {kpis.resp} respostas</div>
                    </div>
                  </div>
                  <div className="mt-4 h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={evolucaoMensal}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis domain={[-100, 100]} tick={{ fontSize: 11 }} width={36} />
                        <Tooltip formatter={(v: number) => [v, "NPS"]} />
                        <Bar dataKey="nps" name="NPS" fill={npsFill} radius={[2, 2, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {evolucaoMensal.length === 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">Sem respostas registradas no filtro atual.</div>
                  )}
                </Card>
              );
            })()}

            {(() => {
              const csatDelta = deltaVsMesAnterior(evolucaoCsatMensal, "csat", "notas");
              return (
                <Card className="p-5">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">CSAT</div>
                      <div className="mt-1 flex items-baseline gap-2">
                        <span className="text-3xl font-semibold tabular-nums">{csat.score != null ? `${csat.score}%` : "—"}</span>
                        {csatDelta != null && !csatDelta.amostraPequena && (
                          <span className={`flex items-center gap-0.5 text-xs font-medium ${csatDelta.delta >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}>
                            {csatDelta.delta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {csatDelta.delta >= 0 ? "+" : ""}{csatDelta.delta} pp
                          </span>
                        )}
                        {csatDelta?.amostraPequena && (
                          <span className="text-xs text-muted-foreground">amostra pequena</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">vs. mês anterior · {csat.totalNotas} notas (fiscal + contábil + folha)</div>
                    </div>
                  </div>
                  <div className="mt-4 h-[160px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={evolucaoCsatMensal}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border/50" />
                        <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11 }} width={36} />
                        <Tooltip formatter={(v: number) => [`${v}%`, "CSAT"]} />
                        <Bar dataKey="csat" name="CSAT" fill={csatFill} radius={[2, 2, 0, 0]} maxBarSize={40} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  {evolucaoCsatMensal.length === 0 && (
                    <div className="mt-2 text-xs text-muted-foreground">Sem notas de serviço registradas no filtro atual.</div>
                  )}
                </Card>
              );
            })()}
          </div>

          <div className="pt-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Detalhamento
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card className="p-4 opacity-90">
              <div className="mb-2 text-sm font-medium">Distribuição por categoria</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={distribuicaoCategoria}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={(e: { name?: string; value?: number }) => `${e.name}: ${e.value}`}
                    >
                      {distribuicaoCategoria.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 opacity-90">
              <div className="mb-2 text-sm font-medium">Distribuição das notas (0-10)</div>
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={distribuicaoNota}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="nota" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="qtd" name="Respostas">
                      {distribuicaoNota.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4 opacity-90 lg:col-span-2">
              <div className="mb-2 text-sm font-medium">Detratores recentes (ação prioritária)</div>
              {detratoresList.length === 0 ? (
                <div className="text-sm text-muted-foreground">Nenhum detrator no filtro atual.</div>
              ) : (
                <ul className="divide-y">
                  {detratoresList.map((r) => (
                    <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{r.empresa ?? "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {r.unidade ?? "—"} · {r.nome_contato ?? "—"} · {r.email_pesquisa ?? "—"}
                        </div>
                      </div>
                      <Badge variant="outline" className="border-red-600/30 bg-red-600/[0.07] text-red-700 dark:text-red-400">
                        Nota {r.nps_recomendacao}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cobertura" className="space-y-4">
          {coverageLoading && <Card className="p-6 text-sm text-muted-foreground">Carregando cobertura…</Card>}
          {coverageError && <Card className="p-6 text-sm text-red-600">Erro ao carregar cobertura.</Card>}
          {coverage && (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Card className="p-4">
                  <div className="text-xs text-muted-foreground">Empresas cadastradas</div>
                  <div className="mt-1 text-2xl font-semibold">{coverage.totalEmpresas}</div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs text-muted-foreground">Já disparadas (empresas distintas)</div>
                  <div className="mt-1 text-2xl font-semibold">{coverage.totalJaDisparadas}</div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs text-muted-foreground">Com WhatsApp válido pra disparo</div>
                  <div className="mt-1 text-2xl font-semibold text-emerald-600">
                    {coverage.totalComWhatsapp}
                    <span className="ml-1 text-sm font-normal text-muted-foreground">
                      ({coverage.totalEmpresas > 0 ? Math.round((coverage.totalComWhatsapp / coverage.totalEmpresas) * 100) : 0}%)
                    </span>
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-xs text-muted-foreground">Sem contato — não disparará</div>
                  <div className="mt-1 text-2xl font-semibold text-red-600">{coverage.totalEmpresas - coverage.totalComWhatsapp}</div>
                </Card>
              </div>

              <Card className="p-3 text-xs text-muted-foreground">
                <strong className="text-foreground">Atenção:</strong> a coluna "Já disparadas" conta só pesquisas com empresa
                vinculada — hoje {coverage.pesquisasComEmpresaResolvida} de {coverage.pesquisasTotal} pesquisas
                enviadas têm esse vínculo resolvido ({coverage.pesquisasTotal > 0 ? Math.round((coverage.pesquisasComEmpresaResolvida / coverage.pesquisasTotal) * 100) : 0}%).
                O número real de empresas já pesquisadas é maior do que o mostrado aqui.
              </Card>

              <Card>
                <div className="border-b p-3 text-sm font-medium">Cobertura por unidade — quem está pronto pro disparo</div>
                <div className="table-wrap overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Unidade</TableHead>
                      <TableHead className="text-right">Empresas</TableHead>
                      <TableHead className="text-right">Já disparadas</TableHead>
                      <TableHead className="text-right">— Base Antiga</TableHead>
                      <TableHead className="text-right">— Base Nova</TableHead>
                      <TableHead className="text-right">Com WhatsApp</TableHead>
                      <TableHead className="text-right">Sem contato</TableHead>
                      <TableHead className="text-right">Cobertura</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {coverage.rows.map((u) => {
                      const pct = u.empresas > 0 ? Math.round((u.comWhatsapp / u.empresas) * 100) : 0;
                      const color =
                        pct >= 70 ? "text-emerald-600" : pct >= 30 ? "text-amber-600" : "text-red-600";
                      return (
                        <TableRow key={u.unidade}>
                          <TableCell className="font-medium">{u.unidade}</TableCell>
                          <TableCell className="text-right">{u.empresas}</TableCell>
                          <TableCell className="text-right">{u.jaDisparadas}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.jaDisparadasBaseAntiga}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.jaDisparadasBaseNova}</TableCell>
                          <TableCell className="text-right">{u.comWhatsapp}</TableCell>
                          <TableCell className="text-right text-red-600">{u.empresas - u.comWhatsapp}</TableCell>
                          <TableCell className={`text-right font-semibold ${color}`}>{pct}%</TableCell>
                        </TableRow>
                      );
                    })}
                    {coverage.rows.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="py-6 text-center text-muted-foreground">Sem dados de cobertura.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="unidades" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">NPS por unidade</div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={npsPorUnidade} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis type="number" domain={[-100, 100]} />
                    <YAxis type="category" dataKey="unidade" width={110} />
                    <Tooltip />
                    <Bar dataKey="nps" name="NPS" fill={npsFill} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-4">
              <div className="mb-2 text-sm font-medium">NPS por segmento</div>
              <div className="h-[320px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={npsPorSegmento} layout="vertical" margin={{ left: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis type="number" domain={[-100, 100]} />
                    <YAxis type="category" dataKey="segmento" width={110} />
                    <Tooltip />
                    <Bar dataKey="nps" name="NPS" fill={npsFill} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card>
            <div className="border-b p-3 text-sm font-medium">Detalhe por unidade</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Respondentes</TableHead>
                  <TableHead className="text-right">NPS</TableHead>
                  <TableHead>Classificação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {npsPorUnidade.map((u) => {
                  const c = classifyNps(u.nps);
                  return (
                    <TableRow key={u.unidade}>
                      <TableCell className="font-medium">{u.unidade}</TableCell>
                      <TableCell className="text-right">{u.respondentes}</TableCell>
                      <TableCell className="text-right font-semibold">{u.nps}</TableCell>
                      <TableCell className={c.color}>{c.label}</TableCell>
                    </TableRow>
                  );
                })}
                {npsPorUnidade.length === 0 && (
                  <TableRow><TableCell colSpan={4} className="py-6 text-center text-muted-foreground">Sem respostas no filtro atual.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="respostas">
          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <div className="text-sm font-medium">Pesquisas</div>
              <div className="text-xs text-muted-foreground">{filtered.length} registro(s)</div>
            </div>
            <div className="relative max-h-[600px] overflow-auto">
              <table className="w-full caption-bottom text-sm border-separate border-spacing-0">
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="bg-background">Empresa</TableHead>
                    <TableHead className="bg-background">CNPJ</TableHead>
                    <TableHead className="bg-background">Unidade</TableHead>
                    <TableHead className="bg-background">Segmento</TableHead>
                    <TableHead className="bg-background">Contato</TableHead>
                    <TableHead className="bg-background text-center">NPS</TableHead>
                    <TableHead className="bg-background">Categoria</TableHead>
                    <TableHead className="bg-background text-center">Fiscal</TableHead>
                    <TableHead className="bg-background text-center">Contábil</TableHead>
                    <TableHead className="bg-background text-center">Folha</TableHead>
                    <TableHead className="bg-background">Serviços</TableHead>
                    <TableHead className="bg-background">Fase</TableHead>
                    <TableHead className="bg-background">Enviada em</TableHead>
                    <TableHead className="bg-background">Data</TableHead>
                    <TableHead className="bg-background">Card</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r: NpsRow) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.empresa ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{r.empresa_cnpj ?? "—"}</TableCell>
                      <TableCell>{r.unidade ?? "—"}</TableCell>
                      <TableCell>{r.segmento ?? "—"}</TableCell>
                      <TableCell>
                        <div className="text-sm">{r.nome_contato ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{r.email_pesquisa ?? ""}</div>
                      </TableCell>
                      <TableCell className="text-center">{r.nps_recomendacao ?? "—"}</TableCell>
                      <TableCell>{npsBadge(categorize(r.nps_recomendacao))}</TableCell>
                      <TableCell className="text-center">{r.avaliacao_fiscal ?? "—"}</TableCell>
                      <TableCell className="text-center">{r.avaliacao_contabil ?? "—"}</TableCell>
                      <TableCell className="text-center">{r.avaliacao_folha_pagamento ?? "—"}</TableCell>
                      <TableCell className="text-xs">{r.servicos_contratados?.join(", ") ?? "—"}</TableCell>
                      <TableCell>{r.fase ?? "—"}</TableCell>
                      <TableCell>{fmtDate(r.data_envio)}</TableCell>
                      <TableCell>{fmtDate(r.created_at)}</TableCell>
                      <TableCell>
                        {r.pipefy_card_id ? (
                          <a
                            href={`https://app.pipefy.com/open-cards/${r.pipefy_card_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-primary underline underline-offset-2"
                          >
                            ver card
                          </a>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && !isLoading && (
                    <TableRow><TableCell colSpan={14} className="py-6 text-center text-muted-foreground">Nenhuma pesquisa encontrada.</TableCell></TableRow>
                  )}
                </TableBody>
              </table>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
