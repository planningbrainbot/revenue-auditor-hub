import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw, TrendingUp, TrendingDown, Target, Sparkles } from "lucide-react";
import { toast } from "sonner";
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
import {
  syncVendasServicos,
  syncCustoOperacional,
  FASES_ORDEM_VENDAS,
  isVendida,
} from "@/lib/ebit-operacional.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

const NA = "—";
const COLORS = ["hsl(var(--primary))", "#6366f1", "#10b981", "#f59e0b", "#ec4899", "#ef4444"];

type VendaRow = {
  pipefy_card_id: string;
  titulo: string | null;
  solucao: string | null;
  unidade: string | null;
  fase_atual: string | null;
  venda_feita: boolean | null;
  valor_mensal_1_mes: number | null;
  valor_teto_rampa: number | null;
  gatilho_reajuste: string | null;
  negociacao: string | null;
};

type CustoRow = {
  despesa: string;
  categoria: string | null;
  mes: string;
  valor: number;
};

function fmtMoney(v: number | null | undefined) {
  if (v == null) return NA;
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function mesAtualISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export function EbitOperacionalView() {
  const [vendas, setVendas] = useState<VendaRow[]>([]);
  const [custos, setCustos] = useState<CustoRow[]>([]);
  const [loading, setLoading] = useState(true);

  const carregar = useCallback(async () => {
    const [vendasRes, custosRes] = await Promise.all([
      supabase
        .from("vendas_servicos_unidades")
        .select("pipefy_card_id,titulo,solucao,unidade,fase_atual,venda_feita,valor_mensal_1_mes,valor_teto_rampa,gatilho_reajuste,negociacao")
        .limit(2000),
      supabase.from("custo_operacional_mensal").select("despesa,categoria,mes,valor").limit(5000),
    ]);
    if (vendasRes.data) setVendas(vendasRes.data as VendaRow[]);
    if (custosRes.data) setCustos(custosRes.data as CustoRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const syncVendasFn = useServerFn(syncVendasServicos);
  const syncCustoFn = useServerFn(syncCustoOperacional);
  const sync = useMutation({
    mutationFn: async () => {
      const [v, c] = await Promise.all([syncVendasFn(), syncCustoFn()]);
      return { v, c };
    },
    onSuccess: async ({ v, c }) => {
      await carregar();
      toast.success(`Atualizado: ${v.total} card(s) de vendas, ${c.total} lançamento(s) de custo.`);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      toast.error(msg);
    },
  });

  const vendidas = useMemo(
    () => vendas.filter((v) => isVendida(v.fase_atual, v.venda_feita)),
    [vendas],
  );

  const mrrVendido = useMemo(
    () => vendidas.reduce((s, v) => s + (v.valor_mensal_1_mes ?? 0), 0),
    [vendidas],
  );

  const mrrPotencial = useMemo(
    () => vendidas.reduce((s, v) => s + (v.valor_teto_rampa ?? v.valor_mensal_1_mes ?? 0), 0),
    [vendidas],
  );

  const custoMesAtual = useMemo(() => {
    const mes = mesAtualISO();
    return custos.filter((c) => c.mes === mes).reduce((s, c) => s + (c.valor ?? 0), 0);
  }, [custos]);

  const gap = custoMesAtual - mrrVendido;
  const pctCoberto = custoMesAtual > 0 ? mrrVendido / custoMesAtual : 0;

  const funil = useMemo(() => {
    const map = new Map<string, number>();
    for (const f of FASES_ORDEM_VENDAS) map.set(f, 0);
    for (const v of vendas) {
      const f = (v.fase_atual ?? NA).trim();
      map.set(f, (map.get(f) ?? 0) + 1);
    }
    return FASES_ORDEM_VENDAS.map((name) => ({ name, value: map.get(name) ?? 0 }));
  }, [vendas]);

  const listaOrdenada = useMemo(
    () =>
      [...vendas].sort((a, b) => {
        const oa = FASES_ORDEM_VENDAS.indexOf(a.fase_atual ?? "");
        const ob = FASES_ORDEM_VENDAS.indexOf(b.fase_atual ?? "");
        return (oa === -1 ? 999 : oa) - (ob === -1 ? 999 : ob);
      }),
    [vendas],
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Custo Operacional (mês atual)</div>
          <div className="text-2xl font-bold">{fmtMoney(custoMesAtual)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Soma dos itens · aba Controle de Gastos Geral</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Vendido (MRR atual)</div>
          <div className="text-2xl font-bold text-emerald-600">{fmtMoney(mrrVendido)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{vendidas.length} venda(s) confirmada(s)</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            Gap a fechar
            {gap <= 0 ? (
              <TrendingUp className="h-3 w-3 text-emerald-600" />
            ) : (
              <TrendingDown className="h-3 w-3 text-destructive" />
            )}
          </div>
          <div className={cn("text-2xl font-bold", gap <= 0 ? "text-emerald-600" : "text-destructive")}>
            {gap <= 0 ? "EBIT zerado" : fmtMoney(gap)}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            <Target className="inline h-3 w-3 mr-0.5" />
            {(pctCoberto * 100).toFixed(0)}% do custo coberto
          </div>
        </Card>
        <Card className="p-4 border-dashed">
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Potencial pós-rampa
          </div>
          <div className="text-2xl font-bold text-muted-foreground">{fmtMoney(mrrPotencial)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Informativo — não conta pro gap oficial até acontecer
          </div>
        </Card>
      </div>

      {/* Funil */}
      <Card className="p-4">
        <div className="mb-2 text-sm font-semibold">Funil por fase (todos os cards)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funil} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={140} />
              <Tooltip />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {funil.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Tabela */}
      <Card className="p-0 overflow-hidden">
        <div className="px-4 py-3 border-b">
          <div className="text-sm font-semibold">Vendas de serviços por unidade</div>
        </div>
        {loading ? (
          <div className="text-center text-sm text-muted-foreground py-6">Carregando…</div>
        ) : listaOrdenada.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-6">Nenhum card no pipe ainda.</div>
        ) : (
          <div className="overflow-auto max-h-[480px]">
            <table className="w-full text-sm">
              <TableHeader className="sticky top-0 z-10">
                <TableRow>
                  <TableHead className="bg-background">Solução</TableHead>
                  <TableHead className="bg-background">Unidade</TableHead>
                  <TableHead className="bg-background">Fase</TableHead>
                  <TableHead className="bg-background text-right">Valor atual</TableHead>
                  <TableHead className="bg-background text-right">Teto da rampa</TableHead>
                  <TableHead className="bg-background">Gatilho do reajuste</TableHead>
                  <TableHead className="bg-background">Negociação</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {listaOrdenada.map((v) => {
                  const vendida = isVendida(v.fase_atual, v.venda_feita);
                  return (
                    <TableRow key={v.pipefy_card_id}>
                      <TableCell className="font-medium">{v.solucao ?? v.titulo ?? NA}</TableCell>
                      <TableCell>{v.unidade ?? NA}</TableCell>
                      <TableCell>
                        <Badge variant={vendida ? "default" : v.fase_atual === "Perdido" ? "destructive" : "outline"}>
                          {v.fase_atual ?? NA}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">{fmtMoney(v.valor_mensal_1_mes)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {v.valor_teto_rampa != null ? fmtMoney(v.valor_teto_rampa) : NA}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{v.gatilho_reajuste ?? NA}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[280px] truncate" title={v.negociacao ?? ""}>
                        {v.negociacao || NA}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
