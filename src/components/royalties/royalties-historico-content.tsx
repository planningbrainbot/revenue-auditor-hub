import { useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { brl, date } from "@/components/audit/format";
import { digits } from "@/lib/server-utils";
import { useRoyaltiesHistoricoRede, useVendasPorUnidadeRede } from "@/hooks/use-royalties";
import type { RoyaltiesHistoricoMes } from "@/lib/royalties-historico.functions";

const ALL = "__all__";

function formatMesLabel(mesRef: string): string {
  const [y, m] = mesRef.slice(0, 7).split("-");
  const n = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${n[Number(m) - 1]}/${y.slice(2)}`;
}

// % de variação mês a mês de uma série de totais — só compara quando os dois
// meses (atual e anterior) têm valor > 0, senão fica sem comparação em vez
// de "-100%"/infinito (mês sem apuração/venda ainda não é queda de verdade).
function crescimentoDe(totais: number[]): (number | null)[] {
  return totais.map((v, i) => {
    const anterior = i > 0 ? totais[i - 1] : null;
    if (!anterior || anterior <= 0 || v <= 0) return null;
    return (v - anterior) / anterior;
  });
}

// Estado de cada célula do histórico — deriva do item de `royalties_itens`
// daquele mês (mesma semântica de `SituacaoBadge` na tela de apuração).
type CelulaStatus = "confirmado" | "recebido_pendente" | "sem_recebimento" | "excluido";

const CELULA_INFO: Record<CelulaStatus, { cls: string; label: string }> = {
  confirmado: {
    cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300",
    label: "Confirmado",
  },
  recebido_pendente: {
    cls: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
    label: "Recebido no Omie, aguardando confirmação",
  },
  sem_recebimento: {
    cls: "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300",
    label: "Sem recebimento no Omie neste mês",
  },
  excluido: {
    cls: "bg-muted text-muted-foreground line-through",
    label: "Excluído da apuração",
  },
};

function celulaStatus(mes: RoyaltiesHistoricoMes | undefined): CelulaStatus | null {
  if (!mes) return null;
  if (mes.excluido_em) return "excluido";
  if (mes.confirmado) return "confirmado";
  if (mes.status_match === "so_pipedrive") return "sem_recebimento";
  return "recebido_pendente";
}

export function RoyaltiesHistoricoContent() {
  const { data, isLoading, error } = useRoyaltiesHistoricoRede();
  const { data: vendas, isLoading: isLoadingVendas } = useVendasPorUnidadeRede();
  const [busca, setBusca] = useState("");
  const [unidadeId, setUnidadeId] = useState(ALL);
  const tabelaClientesRef = useRef<HTMLDivElement>(null);

  const unidades = data?.unidades ?? [];
  const meses = useMemo(() => data?.meses ?? [], [data?.meses]);
  const unidadeDataInicioMap = useMemo(
    () => new Map((data?.unidades ?? []).map((u) => [u.id, u.dataInicio])),
    [data?.unidades],
  );

  const clientesFiltrados = useMemo(() => {
    let arr = data?.clientes ?? [];
    if (unidadeId !== ALL) arr = arr.filter((c) => String(c.unidade_id) === unidadeId);
    const q = busca.trim().toLowerCase();
    if (q) {
      const qDigits = digits(q);
      arr = arr.filter(
        (c) =>
          c.razao_social.toLowerCase().includes(q) ||
          (qDigits.length > 0 && !!c.cnpj && digits(c.cnpj).includes(qDigits)),
      );
    }
    return arr;
  }, [data?.clientes, unidadeId, busca]);

  const evolucaoChart = useMemo(() => {
    const pontos = data?.evolucao ?? [];
    const filtrados =
      unidadeId === ALL ? pontos : pontos.filter((p) => String(p.unidade_id) === unidadeId);
    const porMes = new Map<string, number>();
    for (const p of filtrados) {
      porMes.set(p.mes_referencia, (porMes.get(p.mes_referencia) ?? 0) + p.royalties_apurado);
    }
    return Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, valor]) => ({ mes: formatMesLabel(mes), valor }));
  }, [data?.evolucao, unidadeId]);

  // Resumo por unidade × mês — mesma base do gráfico de evolução (item
  // confirmado × % de royalties), só reagrupada em matriz unidade × mês.
  const resumoPorUnidade = useMemo(() => {
    const porUnidade = new Map<
      number,
      {
        unidade_id: number;
        unidade_nome: string;
        dataInicio: string | null;
        porMes: Map<string, number>;
      }
    >();
    for (const p of data?.evolucao ?? []) {
      let u = porUnidade.get(p.unidade_id);
      if (!u) {
        u = {
          unidade_id: p.unidade_id,
          unidade_nome: p.unidade_nome,
          dataInicio: unidadeDataInicioMap.get(p.unidade_id) ?? null,
          porMes: new Map(),
        };
        porUnidade.set(p.unidade_id, u);
      }
      u.porMes.set(p.mes_referencia, (u.porMes.get(p.mes_referencia) ?? 0) + p.royalties_apurado);
    }
    return Array.from(porUnidade.values())
      .map((u) => ({
        ...u,
        total: Array.from(u.porMes.values()).reduce((acc, v) => acc + v, 0),
      }))
      .filter((u) => u.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [data?.evolucao, unidadeDataInicioMap]);

  const totalResumoGeral = useMemo(
    () => resumoPorUnidade.reduce((acc, u) => acc + u.total, 0),
    [resumoPorUnidade],
  );

  // Total da rede por mês + variação % vs. o mês anterior (mesma lista de
  // `meses` da tabela — só entra % quando o mês anterior também está na
  // tabela e tem valor > 0; senão fica sem comparação, não "-100%"/infinito).
  const totalPorMes = useMemo(
    () => meses.map((m) => resumoPorUnidade.reduce((acc, u) => acc + (u.porMes.get(m) ?? 0), 0)),
    [meses, resumoPorUnidade],
  );
  const crescimentoPorMes = useMemo(() => crescimentoDe(totalPorMes), [totalPorMes]);

  // Vendas (MRR ganho no Pipedrive) por unidade × mês — mesmas colunas de
  // `meses` da tabela de royalties, pra comparar lado a lado se o
  // crescimento de royalties acompanha o de vendas.
  const vendasPorUnidade = useMemo(() => {
    return (vendas?.unidades ?? [])
      .map((u) => ({ ...u, total: meses.reduce((acc, m) => acc + (u.porMes[m] ?? 0), 0) }))
      .filter((u) => u.total > 0)
      .sort((a, b) => b.total - a.total);
  }, [vendas?.unidades, meses]);
  const vendasTotalGeral = useMemo(
    () => vendasPorUnidade.reduce((acc, u) => acc + u.total, 0),
    [vendasPorUnidade],
  );
  const vendasTotalPorMes = useMemo(
    () => meses.map((m) => vendasPorUnidade.reduce((acc, u) => acc + (u.porMes[m] ?? 0), 0)),
    [meses, vendasPorUnidade],
  );
  const vendasCrescimentoPorMes = useMemo(
    () => crescimentoDe(vendasTotalPorMes),
    [vendasTotalPorMes],
  );

  function selecionarUnidade(id: number) {
    setUnidadeId((cur) => (cur === String(id) ? ALL : String(id)));
    tabelaClientesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente ou CNPJ..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={unidadeId} onValueChange={setUnidadeId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Unidade" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as unidades</SelectItem>
            {unidades.map((u) => (
              <SelectItem key={u.id} value={String(u.id)}>
                {u.nome}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{clientesFiltrados.length} clientes</span>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="flex items-baseline justify-between gap-2 border-b p-3">
          <div className="text-sm font-medium">Resumo por unidade</div>
          {totalResumoGeral > 0 && (
            <div className="text-sm font-semibold tabular-nums">{brl(totalResumoGeral)}</div>
          )}
        </div>
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          Royalties recebidos, mês a mês. Clique numa unidade pra ver os clientes que compõem a
          apuração dela na tabela abaixo.
        </p>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : resumoPorUnidade.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sem royalties confirmados ainda.
          </div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Unidade</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Data de início</th>
                  {meses.map((m) => (
                    <th key={m} className="px-2 py-2 text-center whitespace-nowrap">
                      {formatMesLabel(m)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {resumoPorUnidade.map((u) => {
                  const selecionada = String(u.unidade_id) === unidadeId;
                  return (
                    <tr
                      key={u.unidade_id}
                      onClick={() => selecionarUnidade(u.unidade_id)}
                      className={cn(
                        "cursor-pointer border-t hover:bg-muted/40",
                        selecionada && "bg-emerald-50 dark:bg-emerald-950/30",
                      )}
                    >
                      <td
                        className={cn(
                          "sticky left-0 z-10 bg-card px-3 py-2 font-medium underline decoration-dotted underline-offset-2",
                          selecionada && "bg-emerald-50 dark:bg-emerald-950/30",
                        )}
                      >
                        {u.unidade_nome}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                        {date(u.dataInicio)}
                      </td>
                      {meses.map((m) => {
                        const v = u.porMes.get(m) ?? 0;
                        return (
                          <td key={m} className="px-2 py-2 text-center tabular-nums">
                            {v > 0 ? brl(v) : <span className="text-muted-foreground/40">·</span>}
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums">
                        {brl(u.total)}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2">Total rede</td>
                  <td />
                  {totalPorMes.map((total, i) => (
                    <td key={meses[i]} className="px-2 py-2 text-center tabular-nums">
                      {total > 0 ? brl(total) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{brl(totalResumoGeral)}</td>
                </tr>
                <tr className="border-t text-xs text-muted-foreground">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                    Crescimento vs. mês anterior
                  </td>
                  <td />
                  {crescimentoPorMes.map((pct, i) => (
                    <td
                      key={meses[i]}
                      className={cn(
                        "px-2 py-1.5 text-center tabular-nums",
                        pct != null && pct > 0 && "text-emerald-600 dark:text-emerald-400",
                        pct != null && pct < 0 && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {pct != null ? `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%` : "—"}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
        <div className="flex items-baseline justify-between gap-2 border-b p-3">
          <div className="text-sm font-medium">Vendas por unidade</div>
          {vendasTotalGeral > 0 && (
            <div className="text-sm font-semibold tabular-nums">{brl(vendasTotalGeral)}</div>
          )}
        </div>
        <p className="px-3 pt-2 text-xs text-muted-foreground">
          MRR ganho no Pipedrive por mês (mesmas colunas do Resumo de royalties acima), pra
          comparar se o crescimento de royalties acompanha o de vendas.
        </p>
        {isLoadingVendas ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : vendasPorUnidade.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sem vendas nesse período.
          </div>
        ) : (
          <div className="mt-2 max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Unidade</th>
                  {meses.map((m) => (
                    <th key={m} className="px-2 py-2 text-center whitespace-nowrap">
                      {formatMesLabel(m)}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right whitespace-nowrap">Total</th>
                </tr>
              </thead>
              <tbody>
                {vendasPorUnidade.map((u) => (
                  <tr key={u.unidade_id} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                      {u.unidade_nome}
                    </td>
                    {meses.map((m) => {
                      const v = u.porMes[m] ?? 0;
                      return (
                        <td key={m} className="px-2 py-2 text-center tabular-nums">
                          {v > 0 ? brl(v) : <span className="text-muted-foreground/40">·</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">
                      {brl(u.total)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t bg-muted/30 font-semibold">
                  <td className="sticky left-0 z-10 bg-muted/30 px-3 py-2">Total rede</td>
                  {vendasTotalPorMes.map((total, i) => (
                    <td key={meses[i]} className="px-2 py-2 text-center tabular-nums">
                      {total > 0 ? brl(total) : "—"}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right tabular-nums">{brl(vendasTotalGeral)}</td>
                </tr>
                <tr className="border-t text-xs text-muted-foreground">
                  <td className="sticky left-0 z-10 bg-card px-3 py-1.5">
                    Crescimento vs. mês anterior
                  </td>
                  {vendasCrescimentoPorMes.map((pct, i) => (
                    <td
                      key={meses[i]}
                      className={cn(
                        "px-2 py-1.5 text-center tabular-nums",
                        pct != null && pct > 0 && "text-emerald-600 dark:text-emerald-400",
                        pct != null && pct < 0 && "text-red-600 dark:text-red-400",
                      )}
                    >
                      {pct != null ? `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(0)}%` : "—"}
                    </td>
                  ))}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-1 text-sm font-medium">Evolução de royalties apurados</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Soma do valor confirmado × % de royalties de cada apuração (recalculado item a item, não
          usa o total já salvo na apuração). Só entra item confirmado — meses em rascunho/revisão
          podem estar parciais.
        </p>
        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : evolucaoChart.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Sem dados apurados ainda para este filtro.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={evolucaoChart} margin={{ left: 8, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="mes" stroke="hsl(var(--muted-foreground))" fontSize={12} />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={12}
                tickFormatter={(v) => brl(v).replace("R$", "")}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(var(--popover))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                formatter={(v: number) => brl(v)}
              />
              <Line
                type="monotone"
                dataKey="valor"
                name="Royalties apurados"
                stroke="hsl(var(--chart-2, 142 71% 45%))"
                strokeWidth={2}
                dot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card ref={tabelaClientesRef} className="overflow-hidden p-0 scroll-mt-4">
        <div className="border-b p-3 text-sm font-medium">Histórico de royalties por cliente</div>
        {isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
        ) : error ? (
          <div className="p-8 text-center text-sm text-destructive">
            {(error as Error).message}
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="sticky left-0 z-10 bg-muted px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">CNPJ</th>
                  <th className="px-3 py-2 text-left">Unidade</th>
                  <th className="px-3 py-2 text-left whitespace-nowrap">Data do ganho</th>
                  {meses.map((m) => (
                    <th key={m} className="px-2 py-2 text-center whitespace-nowrap">
                      {formatMesLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clientesFiltrados.map((c) => (
                  <tr key={c.chave} className="border-t">
                    <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">
                      {c.razao_social}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{c.cnpj ?? "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{c.unidade_nome}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{date(c.data_ganho)}</td>
                    {meses.map((m) => {
                      const mes = c.meses[m];
                      const status = celulaStatus(mes);
                      const info = status ? CELULA_INFO[status] : null;
                      return (
                        <td key={m} className="px-1.5 py-1.5 text-center">
                          {info && mes ? (
                            <span
                              title={`${info.label}${mes.churn_pipefy_card_id ? " · churn" : ""}`}
                              className={cn(
                                "inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium",
                                info.cls,
                              )}
                            >
                              {mes.valor_confirmado > 0 ? brl(mes.valor_confirmado) : "—"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/40">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {clientesFiltrados.length === 0 && (
                  <tr>
                    <td
                      colSpan={4 + meses.length}
                      className="px-3 py-8 text-center text-muted-foreground"
                    >
                      Sem resultados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="px-1 text-xs text-muted-foreground">
        A tabela acima só traz meses em que a apuração daquela unidade já foi aberta pelo menos
        uma vez — meses nunca abertos ainda não geram itens automaticamente aqui. Pra apurar um mês
        novo, use a aba "Royalties" acima.
      </p>
    </div>
  );
}
