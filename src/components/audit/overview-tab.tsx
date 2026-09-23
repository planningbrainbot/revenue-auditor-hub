import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useData, type OrigemBase } from "./data-context";
import { KpiCard } from "./kpi-card";
import { brl, num, pct } from "./format";
import { PagamentoBadge } from "./badges";
import { ClientDetailDrawer } from "./client-detail-drawer";
import { useState } from "react";
import type { AuditRegistro } from "@/lib/audit-types";
import { OrigemBadge, groupByOrigem } from "./origem-badge";
import { CORES_SERIE, COR_NEUTRA, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";

// Esta pizza é de status de pagamento: aqui a cor é o próprio status.
const PAG_COLORS: Record<string, string> = {
  adimplente: "var(--success)",
  inadimplente: "var(--danger)",
  recente: "var(--warning)",
  sem_dados: COR_NEUTRA,
};

const TIPO_COLORS: Record<string, string> = {
  Recorrente: CORES_SERIE[0],
  "Avulso (On-Time)": CORES_SERIE[1],
};

const DIAS_BUCKETS: { label: string; test: (d: number) => boolean }[] = [
  { label: "1–15d", test: (d) => d >= 1 && d <= 15 },
  { label: "16–30d", test: (d) => d >= 16 && d <= 30 },
  { label: "31–45d", test: (d) => d >= 31 && d <= 45 },
  { label: "46–60d", test: (d) => d >= 46 && d <= 60 },
  { label: "61–90d", test: (d) => d >= 61 && d <= 90 },
  { label: "91–120d", test: (d) => d >= 91 && d <= 120 },
  { label: ">120d", test: (d) => d > 120 },
];

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-card-foreground">{title}</h3>
      <div className="h-72 w-full">{children}</div>
    </div>
  );
}

export function OverviewTab() {
  const { stats, registros, getOrigem } = useData();
  const [selected, setSelected] = useState<AuditRegistro | null>(null);

  const origemFor = (r: AuditRegistro): OrigemBase => getOrigem(r);


  const cidadeData = useMemo(() => {
    const map = new Map<string, { cidade: string; total: number; pagaram: number }>();
    for (const r of registros) {
      const c = r.cidade?.trim() || "—";
      const cur = map.get(c) ?? { cidade: c, total: 0, pagaram: 0 };
      cur.total += 1;
      if (r.pagou) cur.pagaram += 1;
      map.set(c, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => b.total - a.total)
      .slice(0, 12);
  }, [registros]);

  const pagData = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of registros) {
      map.set(r.status_pagamento, (map.get(r.status_pagamento) ?? 0) + 1);
    }
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [registros]);

  const diasData = useMemo(() => {
    return DIAS_BUCKETS.map((b) => ({
      label: b.label,
      count: registros.filter((r) => r.dias_ate_primeiro_pag != null && b.test(r.dias_ate_primeiro_pag)).length,
    }));
  }, [registros]);

  const tipoData = useMemo(() => {
    const map = new Map<string, { name: string; count: number; mrr: number }>();
    for (const r of registros) {
      const k = r.tipo_contrato ?? "—";
      const cur = map.get(k) ?? { name: k, count: 0, mrr: 0 };
      cur.count += 1;
      cur.mrr += r.mrr ?? 0;
      map.set(k, cur);
    }
    return Array.from(map.values());
  }, [registros]);

  const inadimplentes = useMemo(
    () => registros.filter((r) => r.status_pagamento === "inadimplente"),
    [registros],
  );

  const inadGroups = useMemo(
    () => groupByOrigem(inadimplentes, origemFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inadimplentes, getOrigem],
  );

  const planningSemDealList = useMemo(
    () => registros.filter((r) => r.status_match === "planning_sem_deal"),
    [registros],
  );
  const planningGroups = useMemo(
    () => groupByOrigem(planningSemDealList, origemFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planningSemDealList, getOrigem],
  );

  const inadOrdered = useMemo(() => {
    const order = (r: AuditRegistro) => {
      const o = origemFor(r);
      if (o === "Base Nova") return 0;
      if (o === null) return 1;
      return 2; // Base Antiga last
    };
    const arr = [...inadimplentes];
    arr.sort((a, b) => order(a) - order(b));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inadimplentes, getOrigem]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <KpiCard
          label="Tempo Médio até 1º Pagamento"
          value={`${stats.media_dias?.toFixed?.(1) ?? stats.media_dias} dias`}
          sub={`mediana ${stats.mediana_dias}d · n=${stats.n_amostra_dias}`}
          tone="indigo"
          highlight
          help={`Média de dias entre o fechamento da venda e o primeiro pagamento recebido. "n" indica quantos clientes (${stats.n_amostra_dias}) têm essa informação preenchida e foram considerados no cálculo.`}
        />
        <KpiCard
          label="Total de Registros"
          value={num(stats.total_registros)}
          help="Quantidade total de vendas e recebimentos analisados na base (CRM + Planning combinados)."
        />
        <KpiCard
          label="% Pagaram"
          value={pct(stats.ever_paid, stats.total_registros)}
          sub={`${num(stats.ever_paid)} clientes`}
          tone="emerald"
          help="Percentual de clientes que já efetuaram ao menos um pagamento desde o fechamento da venda."
        />
        <KpiCard
          label="Inadimplentes"
          value={num(stats.inadimplentes)}
          sub={`Nova ${num(inadGroups.nova.length)} · Antiga ${num(inadGroups.antiga.length)} · s/cad ${num(inadGroups.semCadastro.length)}`}
          tone="red"
          help="Clientes que estão com pagamento atrasado ou inadimplente no momento. A sub-linha mostra a quebra entre Base Nova (priorizar), Base Antiga e sem cadastro."
        />
        <KpiCard
          label="Vendas sem recebimento localizado"
          value={num(stats.deal_sem_planning)}
          tone="orange"
          help="Vendas fechadas no CRM (Pipedrive) que não foram encontradas no sistema de controle de recebimentos (Planning). Pode indicar contrato não cadastrado, erro de CNPJ ou divergência de dados."
        />
        <KpiCard
          label="Recebimento sem venda localizada"
          value={num(stats.planning_sem_deal)}
          sub={`Nova ${num(planningGroups.nova.length)} · Antiga ${num(planningGroups.antiga.length)} (esperado) · s/cad ${num(planningGroups.semCadastro.length)}`}
          tone="purple"
          help="Contratos/recebimentos cadastrados no Planning sem venda no CRM. Registros de Base Antiga são esperados (não estão no Pipedrive); Base Nova deve ser investigada."
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Clientes por cidade (Top 12)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cidadeData}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="cidade" angle={-25} textAnchor="end" height={70} />
              <YAxis {...eixoProps} />
              <Tooltip {...tooltipProps} />
              <Legend {...legendaProps} />
              <Bar dataKey="total" name="Total" fill={CORES_SERIE[0]} />
              <Bar dataKey="pagaram" name="Pagaram" fill={CORES_SERIE[1]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Status de pagamento">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pagData} dataKey="value" nameKey="name" outerRadius={100} label>
                {pagData.map((entry) => (
                  <Cell key={entry.name} fill={PAG_COLORS[entry.name] ?? COR_NEUTRA} />
                ))}
              </Pie>
              <Tooltip {...tooltipProps} />
              <Legend {...legendaProps} />
            </PieChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Dias até o 1º pagamento">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={diasData}>
              <CartesianGrid {...gradeProps} />
              <XAxis {...eixoProps} dataKey="label" />
              <YAxis {...eixoProps} />
              <Tooltip {...tooltipProps} />
              <Bar dataKey="count" name="Clientes" fill={CORES_SERIE[0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Tipo de contrato">
          <div className="flex h-full flex-col gap-3">
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={tipoData} dataKey="count" nameKey="name" outerRadius={70} label>
                    {tipoData.map((entry) => (
                      <Cell key={entry.name} fill={TIPO_COLORS[entry.name] ?? COR_NEUTRA} />
                    ))}
                  </Pie>
                  <Tooltip {...tooltipProps} />
                  <Legend {...legendaProps} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {tipoData.map((t) => (
                <div key={t.name} className="rounded-md border bg-muted/30 p-2">
                  <div className="text-xs font-medium text-muted-foreground">{t.name}</div>
                  <div className="text-sm font-semibold">{num(t.count)} clientes</div>
                  <div className="text-xs text-muted-foreground">MRR total: {brl(t.mrr)}</div>
                </div>
              ))}
            </div>
          </div>
        </ChartCard>
      </div>

      <div className="rounded-lg border bg-danger-soft p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-danger">
            Inadimplentes ({inadOrdered.length})
            <span className="ml-2 text-xs font-normal text-danger/80">
              · Nova {num(inadGroups.nova.length)} · Antiga {num(inadGroups.antiga.length)} · s/cad {num(inadGroups.semCadastro.length)}
            </span>
          </h3>
        </div>
        <div className="max-h-80 overflow-auto rounded-md border border-danger/40">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-danger-soft text-left text-xs uppercase text-danger">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Razão Social</th>
                <th className="px-3 py-2">Base</th>
                <th className="px-3 py-2">Cidade</th>
                <th className="px-3 py-2">MRR</th>
                <th className="px-3 py-2">Valor Contrato</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {inadOrdered.map((r, i) => (
                <tr
                  key={`${r.deal_id ?? r.cnpj ?? "x"}-${i}`}
                  onClick={() => setSelected(r)}
                  className="border-t border-danger/60 cursor-pointer hover:bg-danger-soft/60"
                >
                  <td className="px-3 py-2 font-mono text-xs">{r.deal_id ?? "—"}</td>
                  <td className="px-3 py-2">{r.razao_social ?? r.deal_titulo ?? "—"}</td>
                  <td className="px-3 py-2"><OrigemBadge value={origemFor(r)} /></td>
                  <td className="px-3 py-2">{r.cidade ?? "—"}</td>
                  <td className="px-3 py-2">{brl(r.mrr)}</td>
                  <td className="px-3 py-2">{brl(r.valor_contrato)}</td>
                  <td className="px-3 py-2"><PagamentoBadge value={r.status_pagamento} /></td>
                </tr>
              ))}
              {inadOrdered.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">Nenhum inadimplente.</td></tr>
              )}
            </tbody>
          </table>
        </div>

      <ClientDetailDrawer registro={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
    </div>
  );
}
