import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
import { AppShell } from "@/components/app-shell";
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
import { useRoyaltiesHistoricoRede } from "@/hooks/use-royalties";
import type { RoyaltiesHistoricoMes } from "@/lib/royalties-historico.functions";

export const Route = createFileRoute("/_authenticated/royalties/")({
  head: () => ({ meta: [{ title: "Royalties – Planning" }] }),
  component: RoyaltiesHistoricoPage,
});

const ALL = "__all__";

function formatMesLabel(mesRef: string): string {
  const [y, m] = mesRef.slice(0, 7).split("-");
  const n = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${n[Number(m) - 1]}/${y.slice(2)}`;
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

function RoyaltiesHistoricoPage() {
  const { data, isLoading, error } = useRoyaltiesHistoricoRede();
  const [busca, setBusca] = useState("");
  const [unidadeId, setUnidadeId] = useState(ALL);

  const unidades = data?.unidades ?? [];
  const meses = data?.meses ?? [];

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
    const filtrados = unidadeId === ALL ? pontos : pontos.filter((p) => String(p.unidade_id) === unidadeId);
    const porMes = new Map<string, number>();
    for (const p of filtrados) {
      porMes.set(p.mes_referencia, (porMes.get(p.mes_referencia) ?? 0) + p.royalties_apurado);
    }
    return Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, valor]) => ({ mes: formatMesLabel(mes), valor }));
  }, [data?.evolucao, unidadeId]);

  return (
    <AppShell title="Royalties" subtitle="Histórico de royalties por cliente e evolução do valor apurado, rede toda">
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

        <Card className="p-4">
          <div className="mb-1 text-sm font-medium">Evolução de royalties apurados</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Soma do valor confirmado × % de royalties de cada apuração (recalculado item a item, não usa o total
            já salvo na apuração). Só entra item confirmado — meses em rascunho/revisão podem estar parciais.
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

        <Card className="overflow-hidden p-0">
          <div className="border-b p-3 text-sm font-medium">Histórico de royalties por cliente</div>
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : error ? (
            <div className="p-8 text-center text-sm text-destructive">{(error as Error).message}</div>
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
                      <td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium">{c.razao_social}</td>
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
                      <td colSpan={4 + meses.length} className="px-3 py-8 text-center text-muted-foreground">
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
          Só aparecem meses em que a apuração daquela unidade já foi aberta pelo menos uma vez — meses nunca
          abertos ainda não geram itens automaticamente aqui. Pra apurar um mês novo, acesse{" "}
          <Link to="/unidades" className="underline">
            Unidades → Royalties
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
