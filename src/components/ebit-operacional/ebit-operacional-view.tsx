import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";
import {
  syncVendasServicos,
  syncCustoOperacional,
  FASES_ORDEM_VENDAS,
  isVendida,
} from "@/lib/ebit-operacional.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Carregando,
  EstadoErro,
  EstadoVazio,
  KpiCard,
  KpiGrade,
  Secao,
  StatusBadge,
  type EstadoKpi,
} from "@/components/planning";
import { rotuloMes } from "@/components/receita/moldura";
import { cn } from "@/lib/utils";

/**
 * EBIT Operacional (contrato `docs/design/contratos/receita-e-repasses.md` §9).
 * Custo zero por falta de lançamento aparecia como "EBIT zerado" em verde: sem
 * custo lançado no mês, custo e gap ficam "não apurado" (N4). Erro de leitura
 * vira `EstadoErro`, não card zerado nem "Nenhum card no pipe ainda".
 */

const NA = "—";

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
  const [erroVendas, setErroVendas] = useState<string | null>(null);
  const [erroCustos, setErroCustos] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const [vendasRes, custosRes] = await Promise.all([
      supabase
        .from("vendas_servicos_unidades")
        .select("pipefy_card_id,titulo,solucao,unidade,fase_atual,venda_feita,valor_mensal_1_mes,valor_teto_rampa,gatilho_reajuste,negociacao")
        .limit(2000),
      supabase.from("custo_operacional_mensal").select("despesa,categoria,mes,valor").limit(5000),
    ]);
    setErroVendas(vendasRes.error ? vendasRes.error.message : null);
    setErroCustos(custosRes.error ? custosRes.error.message : null);
    if (vendasRes.data) setVendas(vendasRes.data as VendaRow[]);
    if (custosRes.data) setCustos(custosRes.data as CustoRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const tentarDeNovo = () => {
    setLoading(true);
    void carregar();
  };

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

  const mes = mesAtualISO();
  const custosDoMes = useMemo(() => custos.filter((c) => c.mes === mes), [custos, mes]);
  const custoMesAtual = useMemo(
    () => custosDoMes.reduce((s, c) => s + (c.valor ?? 0), 0),
    [custosDoMes],
  );
  // Sem nenhum lançamento no mês o custo não é zero: não foi lançado ainda.
  const temCusto = custosDoMes.length > 0;

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

  const nomeMes = rotuloMes(mes.slice(0, 7)).toLowerCase();
  const semCustoNota = `sem custo lançado para ${nomeMes}`;

  const estadoCusto: EstadoKpi = erroCustos ? "indisponivel" : temCusto ? "ok" : "nao-apurado";
  const estadoVendas: EstadoKpi = erroVendas ? "indisponivel" : "ok";
  const estadoGap: EstadoKpi =
    estadoCusto !== "ok" ? estadoCusto : estadoVendas !== "ok" ? estadoVendas : "ok";
  const notaGap =
    estadoCusto === "nao-apurado"
      ? semCustoNota
      : estadoGap === "indisponivel"
        ? "uma das fontes não carregou"
        : `${(pctCoberto * 100).toFixed(0)}% do custo coberto`;

  return (
    <div className="space-y-6 px-4 py-6 md:px-6">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          <RefreshCw className={cn("size-4", sync.isPending && "animate-spin")} aria-hidden />
          {sync.isPending ? "Atualizando…" : "Forçar atualização"}
        </Button>
      </div>

      <Secao
        titulo={`O vendido cobre o custo de ${nomeMes}?`}
        descricao="Custo operacional do mês corrente contra o MRR das vendas de serviço confirmadas hoje."
      >
        {erroCustos && (
          <EstadoErro
            titulo="Não foi possível ler o custo operacional; custo e gap ficam indisponíveis"
            detalhe={erroCustos}
            tentarNovamente={tentarDeNovo}
          />
        )}
        {erroVendas && (
          <EstadoErro
            titulo="Não foi possível ler as vendas de serviço; vendido, gap e potencial ficam indisponíveis"
            detalhe={erroVendas}
            tentarNovamente={tentarDeNovo}
          />
        )}
        {loading ? (
          <Carregando variante="kpis" />
        ) : (
          <KpiGrade>
            <KpiCard
              rotulo="Custo operacional (mês corrente)"
              valor={fmtMoney(custoMesAtual)}
              estado={estadoCusto}
              nota={
                estadoCusto === "nao-apurado"
                  ? semCustoNota
                  : "soma dos itens · aba Controle de Gastos Geral"
              }
            />
            <KpiCard
              rotulo="Vendido (MRR atual)"
              valor={fmtMoney(mrrVendido)}
              estado={estadoVendas}
              nota={`${vendidas.length} venda(s) confirmada(s)`}
            />
            <KpiCard
              rotulo="Gap a fechar"
              valor={gap <= 0 ? "EBIT zerado" : fmtMoney(gap)}
              estado={estadoGap}
              tom={gap <= 0 ? "sucesso" : "perigo"}
              tomRotulo={gap <= 0 ? "custo coberto" : "custo não coberto"}
              nota={notaGap}
            />
            <KpiCard
              rotulo="Potencial pós-rampa"
              valor={fmtMoney(mrrPotencial)}
              estado={estadoVendas}
              nota="informativo: não conta para o gap oficial até acontecer"
            />
          </KpiGrade>
        )}
      </Secao>

      {!erroVendas && (
        <Secao
          titulo="Em que fase estão os cards de venda de serviço?"
          descricao="Todos os cards do pipe, em quantidade de cards por fase."
        >
          {loading ? (
            <Carregando variante="grafico" />
          ) : (
            <div className="h-64 rounded-xl border bg-card p-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={funil} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid {...gradeProps} vertical horizontal={false} />
                  <XAxis type="number" {...eixoProps} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" {...eixoProps} width={140} />
                  <Tooltip {...tooltipProps} formatter={(v) => [v as number, "Cards"]} />
                  <Bar dataKey="value" name="Cards" fill={CORES_SERIE[0]} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Secao>
      )}

      <Secao titulo="Quais serviços cada unidade comprou?" descricao="Ordenado pela fase do pipe.">
        {erroVendas ? null : loading ? (
          <Carregando variante="tabela" />
        ) : listaOrdenada.length === 0 ? (
          <EstadoVazio titulo="Nenhum card no pipe ainda" />
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full caption-bottom border-separate border-spacing-0 text-sm [&_tbody_td]:border-b">
                <TableHeader className="sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)]">
                  <TableRow>
                    <TableHead className="bg-card">Solução</TableHead>
                    <TableHead className="bg-card">Unidade</TableHead>
                    <TableHead className="bg-card">Fase</TableHead>
                    <TableHead className="bg-card text-right">Valor atual</TableHead>
                    <TableHead className="bg-card text-right">Teto da rampa</TableHead>
                    <TableHead className="bg-card">Gatilho do reajuste</TableHead>
                    <TableHead className="bg-card">Negociação</TableHead>
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
                          <StatusBadge
                            tom={vendida ? "sucesso" : v.fase_atual === "Perdido" ? "perigo" : "neutro"}
                          >
                            {v.fase_atual ?? NA}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="num text-right">{fmtMoney(v.valor_mensal_1_mes)}</TableCell>
                        <TableCell className="num text-right text-muted-foreground">
                          {v.valor_teto_rampa != null ? fmtMoney(v.valor_teto_rampa) : NA}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{v.gatilho_reajuste ?? NA}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={v.negociacao ?? ""}>
                          {v.negociacao || NA}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          </div>
        )}
      </Secao>
    </div>
  );
}
