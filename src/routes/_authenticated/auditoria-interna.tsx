import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardCheck, RefreshCw, AlertTriangle } from "lucide-react";
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
const COLORS = ["hsl(var(--primary))", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#ef4444"];

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

function AuditoriaInternaPage() {
  const [rows, setRows] = useState<Auditoria[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const { data } = await supabase
      .from("auditorias_internas")
      .select(
        "pipefy_card_id,empresa_auditada,unidade,fase_atual,complexidade_fiscal,tipo_empresa,setor_atuacao,equipe_designada,prazo_atual,data_conclusao,auditoria_finalizada,classificacao_apontamentos,oportunidades_valor,contingencias_valor",
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

  const rankingOportunidade = useMemo(
    () => [...porUnidade].filter((u) => u.oportunidades > 0).sort((a, b) => b.oportunidades - a.oportunidades),
    [porUnidade],
  );

  const rankingContingencia = useMemo(
    () => [...porUnidade].filter((u) => u.contingencias > 0).sort((a, b) => b.contingencias - a.contingencias),
    [porUnidade],
  );

  const atencao = useMemo(
    () =>
      rows
        .map((r) => ({ r, dias: diasAtraso(r) }))
        .filter((x): x is { r: Auditoria; dias: number } => x.dias != null)
        .sort((a, b) => b.dias - a.dias),
    [rows],
  );

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
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ClipboardCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Auditoria Interna</h1>
            <p className="text-sm text-muted-foreground">
              Visão executiva das auditorias fiscais (ICMS/PIS-COFINS/Reforma Tributária) em andamento nos clientes
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

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total de auditorias</div>
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

      {/* Funil + Por unidade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="mb-2 text-sm font-semibold">Auditorias por fase</div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porFase} layout="vertical" margin={{ left: 24 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={160} />
                <Tooltip />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {porFase.map((_, i) => (<Cell key={i} fill={COLORS[i % COLORS.length]} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b">
            <div className="text-sm font-semibold">Resumo por unidade</div>
          </div>
          <div className="overflow-auto max-h-[320px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background text-right">Auditorias</TableHead>
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
      </div>

      {/* Rankings por unidade */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-4 py-3 border-b">
            <div className="text-sm font-semibold">Ranking de unidades — maior volume de oportunidade</div>
          </div>
          {rankingOportunidade.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-6">
              Nenhuma oportunidade identificada ainda.
            </div>
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
                      <TableCell className="text-right text-emerald-600 font-semibold">
                        {fmtMoney(u.oportunidades)}
                      </TableCell>
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
            <div className="text-center text-sm text-muted-foreground py-6">
              Nenhuma contingência identificada ainda.
            </div>
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
                      <TableCell className="text-right text-amber-600 font-semibold">
                        {fmtMoney(u.contingencias)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Atenção: prazos vencidos */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center gap-2">
          {kpis.atrasadas > 0 && <AlertTriangle className="h-4 w-4 text-destructive" />}
          <div className="text-sm font-semibold">Atenção — prazos vencidos</div>
        </div>
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-6">Carregando…</div>
        ) : atencao.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            Nenhuma auditoria em andamento com prazo vencido.
          </div>
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

      {/* Maiores achados fiscais */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Achados fiscais — classificação Alta ou Média</div>
        </div>
        {maioresAchados.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">
            Nenhum apontamento classificado como Alta ou Média ainda.
          </div>
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
    </div>
  );
}
