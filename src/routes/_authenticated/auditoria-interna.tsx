import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, RefreshCw, AlertTriangle, Gauge, Undo2, Handshake, Landmark } from "lucide-react";
import { toast } from "sonner";
import { syncAuditoriaInterna } from "@/lib/auditoria-interna.functions";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/auditoria-interna")({
  component: AuditoriaInternaPage,
});

type Auditoria = {
  pipefy_card_id: string;
  empresa_auditada: string | null;
  unidade: string | null;
  fase_atual: string | null;
  tipo_projeto: string | null;
  complexidade_fiscal: string | null;
  tipo_empresa: string | null;
  setor_atuacao: string | null;
  equipe_designada: string | null;
  prazo_atual: string | null;
  data_conclusao: string | null;
  auditoria_finalizada: boolean | null;
  classificacao_apontamentos: string | null;
  oportunidades_valor: number | null;
  contingencias_valor: number | null;
};

const NA = "—";
const FASES_CONCLUIDAS = new Set(["Projeto Concluído", "Reforma Tributária Concluida", "Solicitações Comerciais"]);
const FASE_COLORS = ["hsl(var(--primary))", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444"];

// Valor do campo "Tipo de Projeto" no Pipefy -> como apresentamos na tela e
// qual o objetivo de negócio de cada tipo (ver pipe 307181077, campo
// tipo_de_projeto). Ordem fixa — usada tanto nas abas quanto nas cores do
// gráfico "Projetos por tipo".
const TIPO_ORDER = ["Auditoria", "Contas Perdidas", "Solicitações Comerciais", "Reforma Tributária"] as const;
type TipoKey = (typeof TIPO_ORDER)[number];

const TIPO_LABEL: Record<TipoKey, string> = {
  Auditoria: "Auditoria",
  "Contas Perdidas": "Recuperação de Contas",
  "Solicitações Comerciais": "Apoio a Grandes Contas",
  "Reforma Tributária": "Reforma Tributária",
};

const TIPO_DESCRICAO: Record<TipoKey, string> = {
  Auditoria: "Auditoria fiscal dos projetos das unidades (ICMS, PIS/COFINS, Reforma Tributária).",
  "Contas Perdidas": "Apoio ao comercial para recuperar contas perdidas, trazendo um achado fiscal como gancho.",
  "Solicitações Comerciais": "Apoio ao comercial para fechar grandes contas, trazendo um insight fiscal.",
  "Reforma Tributária": "Execução do produto de Reforma Tributária para os clientes.",
};

const TIPO_COLOR: Record<TipoKey, string> = {
  Auditoria: "#6366f1",
  "Contas Perdidas": "#f59e0b",
  "Solicitações Comerciais": "#10b981",
  "Reforma Tributária": "#8b5cf6",
};

const TIPO_ICON: Record<TipoKey, typeof ClipboardCheck> = {
  Auditoria: ClipboardCheck,
  "Contas Perdidas": Undo2,
  "Solicitações Comerciais": Handshake,
  "Reforma Tributária": Landmark,
};

function fmtMoney(v: number | null | undefined) {
  if (!v) return fmtMoneyExato(0);
  return fmtMoneyExato(v);
}

function fmtMoneyExato(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtDate(s: string | null) {
  if (!s) return NA;
  const d = new Date(s);
  if (isNaN(d.getTime())) return NA;
  return d.toLocaleDateString("pt-BR");
}

function isConcluida(r: Auditoria): boolean {
  return !!r.auditoria_finalizada || FASES_CONCLUIDAS.has(r.fase_atual ?? "");
}

function diasAtraso(r: Auditoria): number | null {
  if (isConcluida(r) || !r.prazo_atual) return null;
  const prazo = new Date(r.prazo_atual).getTime();
  const agora = Date.now();
  if (isNaN(prazo) || prazo >= agora) return null;
  return Math.floor((agora - prazo) / (1000 * 60 * 60 * 24));
}

// ============ Blocos reutilizados entre a Visão Geral e as abas por tipo ============

function KpiCards({ rows, labelTotal }: { rows: Auditoria[]; labelTotal: string }) {
  const kpis = useMemo(() => {
    let concluidas = 0;
    let atrasadas = 0;
    let oportunidades = 0;
    let contingencias = 0;
    for (const r of rows) {
      if (isConcluida(r)) concluidas += 1;
      if (diasAtraso(r) != null) atrasadas += 1;
      oportunidades += r.oportunidades_valor ?? 0;
      contingencias += r.contingencias_valor ?? 0;
    }
    return {
      total: rows.length,
      emAndamento: rows.length - concluidas,
      concluidas,
      atrasadas,
      oportunidades,
      contingencias,
    };
  }, [rows]);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">{labelTotal}</div>
        <div className="text-2xl font-bold">{kpis.total}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Em andamento</div>
        <div className="text-2xl font-bold">{kpis.emAndamento}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Concluídas</div>
        <div className="text-2xl font-bold text-emerald-600">{kpis.concluidas}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Prazos vencidos</div>
        <div className={cn("text-2xl font-bold", kpis.atrasadas > 0 && "text-destructive")}>{kpis.atrasadas}</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Oportunidades identificadas</div>
        <div className="text-xl font-bold text-emerald-600">{fmtMoney(kpis.oportunidades)}</div>
        <div className="text-[11px] text-muted-foreground">estimado, extraído dos relatórios</div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Contingências/riscos identificados</div>
        <div className="text-xl font-bold text-amber-600">{fmtMoney(kpis.contingencias)}</div>
        <div className="text-[11px] text-muted-foreground">estimado, extraído dos relatórios</div>
      </Card>
    </div>
  );
}

function ResumoPorUnidade({ rows }: { rows: Auditoria[] }) {
  const porUnidade = useMemo(() => {
    const map = new Map<string, { unidade: string; total: number; oportunidades: number; contingencias: number }>();
    for (const r of rows) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, total: 0, oportunidades: 0, contingencias: 0 };
      g.total += 1;
      g.oportunidades += r.oportunidades_valor ?? 0;
      g.contingencias += r.contingencias_valor ?? 0;
      map.set(u, g);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Resumo por unidade</div>
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-sm">
          <TableHeader className="sticky top-0 z-10">
            <TableRow>
              <TableHead className="bg-background">Unidade</TableHead>
              <TableHead className="bg-background text-right">Casos</TableHead>
              <TableHead className="bg-background text-right">Oportunidades</TableHead>
              <TableHead className="bg-background text-right">Contingências</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {porUnidade.map((u) => (
              <TableRow key={u.unidade}>
                <TableCell className="font-medium">{u.unidade}</TableCell>
                <TableCell className="text-right">{u.total}</TableCell>
                <TableCell className="text-right text-emerald-600">{fmtMoney(u.oportunidades)}</TableCell>
                <TableCell className="text-right text-amber-600">{fmtMoney(u.contingencias)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </table>
      </div>
    </Card>
  );
}

function Rankings({ rows }: { rows: Auditoria[] }) {
  const porUnidade = useMemo(() => {
    const map = new Map<string, { unidade: string; oportunidades: number; contingencias: number }>();
    for (const r of rows) {
      const u = r.unidade ?? NA;
      const g = map.get(u) ?? { unidade: u, oportunidades: 0, contingencias: 0 };
      g.oportunidades += r.oportunidades_valor ?? 0;
      g.contingencias += r.contingencias_valor ?? 0;
      map.set(u, g);
    }
    return Array.from(map.values());
  }, [rows]);

  const rankingOportunidade = useMemo(
    () => porUnidade.filter((u) => u.oportunidades > 0).sort((a, b) => b.oportunidades - a.oportunidades),
    [porUnidade],
  );
  const rankingContingencia = useMemo(
    () => porUnidade.filter((u) => u.contingencias > 0).sort((a, b) => b.contingencias - a.contingencias),
    [porUnidade],
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Ranking de unidades — maior volume de oportunidade</div>
        </div>
        {rankingOportunidade.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhuma oportunidade identificada ainda.</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background w-10">#</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background text-right">Oportunidades</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingOportunidade.map((u, i) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right text-emerald-600 font-semibold">{fmtMoney(u.oportunidades)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Ranking de unidades — maior volume de contingência</div>
        </div>
        {rankingContingencia.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhuma contingência identificada ainda.</div>
        ) : (
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background w-10">#</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background text-right">Contingências</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rankingContingencia.map((u, i) => (
                  <TableRow key={u.unidade}>
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-medium">{u.unidade}</TableCell>
                    <TableCell className="text-right text-amber-600 font-semibold">{fmtMoney(u.contingencias)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function AtencaoPrazos({ rows }: { rows: Auditoria[] }) {
  const atencao = useMemo(
    () =>
      rows
        .map((r) => ({ r, dias: diasAtraso(r) }))
        .filter((x): x is { r: Auditoria; dias: number } => x.dias != null)
        .sort((a, b) => b.dias - a.dias),
    [rows],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b flex items-center gap-2">
        {atencao.length > 0 && <AlertTriangle className="h-4 w-4 text-destructive" />}
        <div className="text-sm font-semibold">Atenção — prazos vencidos</div>
      </div>
      {atencao.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum caso em andamento com prazo vencido.</div>
      ) : (
        <div className="overflow-auto max-h-[320px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Empresa</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Fase atual</TableHead>
                <TableHead className="bg-background text-right">Prazo</TableHead>
                <TableHead className="bg-background text-right">Dias em atraso</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {atencao.map(({ r, dias }) => (
                <TableRow key={r.pipefy_card_id}>
                  <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{r.fase_atual ?? NA}</TableCell>
                  <TableCell className="text-right">{fmtDate(r.prazo_atual)}</TableCell>
                  <TableCell className="text-right text-destructive font-semibold">{dias}d</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

function AchadosFiscais({ rows }: { rows: Auditoria[] }) {
  const maioresAchados = useMemo(
    () =>
      rows
        .filter((r) => {
          const c = (r.classificacao_apontamentos ?? "").toLowerCase();
          return c.includes("alta") || c.includes("média") || c.includes("media");
        })
        .map((r) => ({ r, total: (r.oportunidades_valor ?? 0) + (r.contingencias_valor ?? 0) }))
        .sort((a, b) => b.total - a.total),
    [rows],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Achados fiscais — classificação Alta ou Média</div>
      </div>
      {maioresAchados.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum apontamento classificado como Alta ou Média ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Empresa</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Classificação</TableHead>
                <TableHead className="bg-background text-right">Oportunidade</TableHead>
                <TableHead className="bg-background text-right">Contingência</TableHead>
                <TableHead className="bg-background text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {maioresAchados.map(({ r, total }) => (
                <TableRow key={r.pipefy_card_id}>
                  <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{r.classificacao_apontamentos ?? NA}</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmtMoney(r.oportunidades_valor)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmtMoney(r.contingencias_valor)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtMoney(total)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

function CargaPorAuditor({ rows }: { rows: Auditoria[] }) {
  const porAuditor = useMemo(() => {
    const map = new Map<string, { nome: string; total: number; concluidos: number }>();
    for (const r of rows) {
      if (!r.equipe_designada) continue;
      for (const nome of r.equipe_designada.split(",").map((n) => n.trim()).filter(Boolean)) {
        const g = map.get(nome) ?? { nome, total: 0, concluidos: 0 };
        g.total += 1;
        if (isConcluida(r)) g.concluidos += 1;
        map.set(nome, g);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [rows]);

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Carga por auditor(a)</div>
      </div>
      {porAuditor.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum card com equipe designada ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[320px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Auditor(a)</TableHead>
                <TableHead className="bg-background text-right">Casos designados</TableHead>
                <TableHead className="bg-background text-right">Concluídos</TableHead>
                <TableHead className="bg-background text-right">Em andamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {porAuditor.map((a) => (
                <TableRow key={a.nome}>
                  <TableCell className="font-medium">{a.nome}</TableCell>
                  <TableCell className="text-right">{a.total}</TableCell>
                  <TableCell className="text-right text-emerald-600">{a.concluidos}</TableCell>
                  <TableCell className="text-right">{a.total - a.concluidos}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

function PorFaseChart({ rows }: { rows: Auditoria[] }) {
  const porFase = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const f = r.fase_atual ?? NA;
      map.set(f, (map.get(f) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Projetos por fase</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={porFase} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {porFase.map((_, i) => (<Cell key={i} fill={FASE_COLORS[i % FASE_COLORS.length]} />))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function CasosTable({ rows }: { rows: Auditoria[] }) {
  const casos = useMemo(
    () => [...rows].sort((a, b) => (a.empresa_auditada ?? "").localeCompare(b.empresa_auditada ?? "")),
    [rows],
  );

  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 py-3 border-b">
        <div className="text-sm font-semibold">Casos</div>
      </div>
      {casos.length === 0 ? (
        <div className="text-center text-sm text-muted-foreground py-6">Nenhum caso deste tipo ainda.</div>
      ) : (
        <div className="overflow-auto max-h-[420px]">
          <table className="w-full text-sm">
            <TableHeader className="sticky top-0 z-10">
              <TableRow>
                <TableHead className="bg-background">Empresa</TableHead>
                <TableHead className="bg-background">Unidade</TableHead>
                <TableHead className="bg-background">Fase atual</TableHead>
                <TableHead className="bg-background">Classificação</TableHead>
                <TableHead className="bg-background text-right">Oportunidade</TableHead>
                <TableHead className="bg-background text-right">Contingência</TableHead>
                <TableHead className="bg-background text-right">Conclusão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {casos.map((r) => (
                <TableRow key={r.pipefy_card_id}>
                  <TableCell className="font-medium">{r.empresa_auditada ?? NA}</TableCell>
                  <TableCell>{r.unidade ?? NA}</TableCell>
                  <TableCell>{r.fase_atual ?? NA}</TableCell>
                  <TableCell>{r.classificacao_apontamentos ?? NA}</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmtMoney(r.oportunidades_valor)}</TableCell>
                  <TableCell className="text-right text-amber-600">{fmtMoney(r.contingencias_valor)}</TableCell>
                  <TableCell className="text-right">{fmtDate(r.data_conclusao)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ============ Visão Geral ============

function ProjetosPorTipo({ rows }: { rows: Auditoria[] }) {
  const data = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const t = r.tipo_projeto ?? NA;
      map.set(t, (map.get(t) ?? 0) + 1);
    }
    return TIPO_ORDER.map((t) => ({ name: TIPO_LABEL[t], value: map.get(t) ?? 0, color: TIPO_COLOR[t] }));
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Projetos por tipo</div>
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
            <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={150} />
            <Tooltip />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((d) => (<Cell key={d.name} fill={d.color} />))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function FinalizadasPorMes({ rows }: { rows: Auditoria[] }) {
  const { data, semData } = useMemo(() => {
    const map = new Map<string, number>();
    let concluidas = 0;
    let comData = 0;
    for (const r of rows) {
      if (!isConcluida(r)) continue;
      concluidas += 1;
      if (!r.data_conclusao) continue;
      const d = new Date(r.data_conclusao);
      if (isNaN(d.getTime())) continue;
      comData += 1;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    const data = Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => {
        const [y, m] = key.split("-");
        const name = new Date(Number(y), Number(m) - 1, 1)
          .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
          .replace(".", "");
        return { name, value };
      });
    return { data, semData: concluidas - comData };
  }, [rows]);

  return (
    <Card className="p-4">
      <div className="mb-2 text-sm font-semibold">Finalizadas por mês</div>
      <div className="h-72">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Nenhum caso finalizado com data de conclusão registrada.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ left: 0, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
              <Tooltip />
              <Bar dataKey="value" name="Finalizadas" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      {semData > 0 && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {semData} caso(s) concluído(s) sem data de conclusão registrada no Pipefy — não aparecem no gráfico.
        </div>
      )}
    </Card>
  );
}

function VisaoGeral({ rows }: { rows: Auditoria[] }) {
  return (
    <div className="space-y-4">
      <KpiCards rows={rows} labelTotal="Total de projetos" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {TIPO_ORDER.map((t) => {
          const Icon = TIPO_ICON[t];
          const total = rows.filter((r) => r.tipo_projeto === t).length;
          return (
            <Card key={t} className="p-4">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3.5 w-3.5" />
                {TIPO_LABEL[t]}
              </div>
              <div className="text-2xl font-bold">{total}</div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ProjetosPorTipo rows={rows} />
        <FinalizadasPorMes rows={rows} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ResumoPorUnidade rows={rows} />
        <CargaPorAuditor rows={rows} />
      </div>

      <Rankings rows={rows} />
      <AtencaoPrazos rows={rows} />
      <AchadosFiscais rows={rows} />
    </div>
  );
}

function TipoTab({ rows, tipo }: { rows: Auditoria[]; tipo: TipoKey }) {
  const filtradas = useMemo(() => rows.filter((r) => r.tipo_projeto === tipo), [rows, tipo]);
  const volumoso = tipo === "Auditoria";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{TIPO_DESCRICAO[tipo]}</p>
      <KpiCards rows={filtradas} labelTotal={volumoso ? "Total de auditorias" : "Total de casos"} />
      {volumoso ? (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PorFaseChart rows={filtradas} />
            <ResumoPorUnidade rows={filtradas} />
          </div>
          <Rankings rows={filtradas} />
          <AtencaoPrazos rows={filtradas} />
          <AchadosFiscais rows={filtradas} />
        </>
      ) : (
        <CasosTable rows={filtradas} />
      )}
    </div>
  );
}

function AuditoriaInternaPage() {
  const [rows, setRows] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("auditorias_internas")
      .select(
        "pipefy_card_id,empresa_auditada,unidade,fase_atual,tipo_projeto,complexidade_fiscal,tipo_empresa,setor_atuacao,equipe_designada,prazo_atual,data_conclusao,auditoria_finalizada,classificacao_apontamentos,oportunidades_valor,contingencias_valor",
      )
      .limit(5000);
    if (data) setRows(data as Auditoria[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const syncFn = useServerFn(syncAuditoriaInterna);
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: async (res) => {
      await carregar();
      toast.success(`Auditoria Interna atualizada do Pipefy: ${res.total} card(s).`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      toast.error(msg);
    },
  });

  const contagemPorTipo = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.tipo_projeto ?? NA, (map.get(r.tipo_projeto ?? NA) ?? 0) + 1);
    return map;
  }, [rows]);

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Auditoria Interna</h1>
            <p className="text-sm text-muted-foreground">
              Visão executiva dos projetos do time fiscal — auditoria, apoio ao comercial e reforma tributária
            </p>
          </div>
        </div>
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

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-16">Carregando…</div>
      ) : (
        <Tabs defaultValue="geral">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="geral" className="gap-1.5">
              <Gauge className="h-3.5 w-3.5" />
              Visão Geral
            </TabsTrigger>
            {TIPO_ORDER.map((t) => {
              const Icon = TIPO_ICON[t];
              return (
                <TabsTrigger key={t} value={t} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" />
                  {TIPO_LABEL[t]} ({contagemPorTipo.get(t) ?? 0})
                </TabsTrigger>
              );
            })}
          </TabsList>

          <TabsContent value="geral" className="mt-4">
            <VisaoGeral rows={rows} />
          </TabsContent>
          {TIPO_ORDER.map((t) => (
            <TabsContent key={t} value={t} className="mt-4">
              <TipoTab rows={rows} tipo={t} />
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
