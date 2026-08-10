import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  LabelList,
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

// Backfill manual pra jan–mai/2026: nesses meses a apuração ainda não existia
// no app pra estas 3 unidades (primeira apuração no banco é jun/2026 — ver
// `royalties_apuracao`). Valores vêm da linha "ROYALTIES" do QUADRO RESUMO
// das planilhas de fechamento mensal em ~/Desktop/Royalties (Planning Belém/
// Curitiba/Sudeste – Maio – 2026.xlsx; "Sudeste" = Rio de Janeiro, confirmado
// pela regra de royalties da Genial citada na própria planilha). Não é
// itemizado por cliente — por isso só entra na evolução/resumo por unidade,
// não na tabela "Histórico de royalties por cliente" abaixo.
const MANUAL_BACKFILL_2026: {
  unidade_id: number;
  mes_referencia: string;
  royalties_apurado: number;
}[] = [
  // Rio de Janeiro (id 4)
  { unidade_id: 4, mes_referencia: "2026-01-01", royalties_apurado: 23452.34 },
  { unidade_id: 4, mes_referencia: "2026-02-01", royalties_apurado: 36384.48 },
  { unidade_id: 4, mes_referencia: "2026-03-01", royalties_apurado: 44103.38 },
  { unidade_id: 4, mes_referencia: "2026-04-01", royalties_apurado: 42547.48 },
  { unidade_id: 4, mes_referencia: "2026-05-01", royalties_apurado: 27711.16 },
  // Belém (id 3)
  { unidade_id: 3, mes_referencia: "2026-01-01", royalties_apurado: 8392.3 },
  { unidade_id: 3, mes_referencia: "2026-02-01", royalties_apurado: 8143.95 },
  { unidade_id: 3, mes_referencia: "2026-03-01", royalties_apurado: 15392.07 },
  { unidade_id: 3, mes_referencia: "2026-04-01", royalties_apurado: 12289.36 },
  { unidade_id: 3, mes_referencia: "2026-05-01", royalties_apurado: 16670.33 },
  // Curitiba (id 1)
  { unidade_id: 1, mes_referencia: "2026-01-01", royalties_apurado: 6679.15 },
  { unidade_id: 1, mes_referencia: "2026-02-01", royalties_apurado: 9482.68 },
  { unidade_id: 1, mes_referencia: "2026-03-01", royalties_apurado: 8779.04 },
  { unidade_id: 1, mes_referencia: "2026-04-01", royalties_apurado: 9372.38 },
  { unidade_id: 1, mes_referencia: "2026-05-01", royalties_apurado: 11968.93 },
];

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
  const unidadeNomeMap = useMemo(
    () => new Map((data?.unidades ?? []).map((u) => [u.id, u.nome])),
    [data?.unidades],
  );

  // Junta a evolução vinda do app com o backfill manual — só entra o mês
  // manual se aquela unidade+mês ainda não tiver apuração real no app
  // (evita duplicar quando alguém abrir a apuração retroativa desses meses).
  const pontosCombinados = useMemo(() => {
    const base = data?.evolucao ?? [];
    const existentes = new Set(base.map((p) => `${p.unidade_id}|${p.mes_referencia}`));
    const manual = MANUAL_BACKFILL_2026.filter(
      (m) => !existentes.has(`${m.unidade_id}|${m.mes_referencia}`),
    ).map((m) => ({
      mes_referencia: m.mes_referencia,
      unidade_id: m.unidade_id,
      unidade_nome: unidadeNomeMap.get(m.unidade_id) ?? "—",
      apuracao_status: "manual",
      royalties_apurado: m.royalties_apurado,
    }));
    return [...base, ...manual];
  }, [data?.evolucao, unidadeNomeMap]);

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
    const filtrados =
      unidadeId === ALL
        ? pontosCombinados
        : pontosCombinados.filter((p) => String(p.unidade_id) === unidadeId);
    const porMes = new Map<string, number>();
    for (const p of filtrados) {
      porMes.set(p.mes_referencia, (porMes.get(p.mes_referencia) ?? 0) + p.royalties_apurado);
    }
    return Array.from(porMes.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, valor]) => ({ mes: formatMesLabel(mes), valor }));
  }, [pontosCombinados, unidadeId]);

  const ANO_RESUMO = "2026";
  const resumoPorUnidade = useMemo(() => {
    const pontos = pontosCombinados.filter((p) => p.mes_referencia.startsWith(ANO_RESUMO));
    const porUnidade = new Map<
      number,
      { unidade_id: number; unidade_nome: string; total: number; temManual: boolean }
    >();
    for (const p of pontos) {
      const cur = porUnidade.get(p.unidade_id);
      if (cur) {
        cur.total += p.royalties_apurado;
        if (p.apuracao_status === "manual") cur.temManual = true;
      } else {
        porUnidade.set(p.unidade_id, {
          unidade_id: p.unidade_id,
          unidade_nome: p.unidade_nome,
          total: p.royalties_apurado,
          temManual: p.apuracao_status === "manual",
        });
      }
    }
    return Array.from(porUnidade.values())
      .filter((u) => u.total > 0)
      .map((u) => ({ ...u, label: u.temManual ? `${u.unidade_nome} *` : u.unidade_nome }))
      .sort((a, b) => b.total - a.total);
  }, [pontosCombinados]);

  const totalResumoAno = useMemo(
    () => resumoPorUnidade.reduce((acc, u) => acc + u.total, 0),
    [resumoPorUnidade],
  );

  return (
    <AppShell
      title="Royalties"
      subtitle="Histórico de royalties por cliente e evolução do valor apurado, rede toda"
    >
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
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <div className="text-sm font-medium">
              Resumo por unidade — royalties recebidos em {ANO_RESUMO}
            </div>
            {totalResumoAno > 0 && (
              <div className="text-sm font-semibold tabular-nums">{brl(totalResumoAno)}</div>
            )}
          </div>
          <p className="mb-3 text-xs text-muted-foreground">
            Soma de {formatMesLabel(`${ANO_RESUMO}-01-01`)} a{" "}
            {formatMesLabel(`${ANO_RESUMO}-12-01`)}, mesma base de item confirmado × % de royalties
            usada no gráfico de evolução abaixo. Independe do filtro de unidade acima.
            {resumoPorUnidade.some((u) => u.temManual) && (
              <>
                {" "}
                <strong className="font-medium text-foreground">*</strong> jan–mai/26 dessas
                unidades vêm de planilha manual (fechamento mensal), a apuração no app só começa em
                jun/26.
              </>
            )}
          </p>
          {isLoading ? (
            <div className="py-12 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : resumoPorUnidade.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Sem royalties confirmados em {ANO_RESUMO} ainda.
            </div>
          ) : (
            <div style={{ height: Math.max(140, resumoPorUnidade.length * 36) }} className="w-full">
              <ResponsiveContainer>
                <BarChart
                  data={resumoPorUnidade}
                  layout="vertical"
                  margin={{ top: 4, right: 56, bottom: 4, left: 4 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickFormatter={(v) => brl(v).replace("R$", "")}
                  />
                  <YAxis
                    dataKey="label"
                    type="category"
                    width={110}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 6,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => brl(v)}
                    labelFormatter={(label) => String(label)}
                  />
                  <Bar dataKey="total" name="Royalties recebidos" radius={[0, 4, 4, 0]}>
                    {resumoPorUnidade.map((u) => (
                      <Cell
                        key={u.unidade_id}
                        fill={
                          unidadeId === ALL || String(u.unidade_id) === unidadeId
                            ? "hsl(var(--chart-2, 142 71% 45%))"
                            : "hsl(var(--muted-foreground) / 0.35)"
                        }
                      />
                    ))}
                    <LabelList
                      dataKey="total"
                      position="right"
                      formatter={(v: number) => brl(v)}
                      className="fill-foreground text-[11px]"
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-4">
          <div className="mb-1 text-sm font-medium">Evolução de royalties apurados</div>
          <p className="mb-3 text-xs text-muted-foreground">
            Soma do valor confirmado × % de royalties de cada apuração (recalculado item a item, não
            usa o total já salvo na apuração). Só entra item confirmado — meses em rascunho/revisão
            podem estar parciais. Jan–mai/26 de Belém, Curitiba e Rio de Janeiro vêm de planilha
            manual (ver resumo por unidade acima).
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
          uma vez — meses nunca abertos ainda não geram itens automaticamente aqui (os gráficos no
          topo da página completam jan–mai/26 de 3 unidades com planilha manual, mas isso não é
          itemizado por cliente). Pra apurar um mês novo, acesse{" "}
          <Link to="/unidades" className="underline">
            Unidades → Royalties
          </Link>
          .
        </p>
      </div>
    </AppShell>
  );
}
