import { useMemo, useState } from "react";
import { brl, num } from "@/components/audit/format";
import { cn } from "@/lib/utils";
import { useBiVendasData, monthLabel } from "./data-context";

interface BuRow {
  unidade: string;
  propostas: number;
  vendas: number;
  contratosAssinados: number;
  investimento: number;
  roas: number | null;
}

export function ByBuTab() {
  const { vendas, propostas, investimento, mesesDisponiveis } = useBiVendasData();
  const [mes, setMes] = useState<string>(mesesDisponiveis[mesesDisponiveis.length - 1] ?? "");

  const rows = useMemo<BuRow[]>(() => {
    const unidades = new Set<string>();
    for (const v of vendas) if (v.ganho_em.slice(0, 7) === mes) unidades.add(v.unidade);
    for (const p of propostas) if (p.mes.slice(0, 7) === mes) unidades.add(p.unidade);
    for (const i of investimento) if (i.mes.slice(0, 7) === mes) unidades.add(i.bu);
    unidades.delete("Não mapeado");

    return Array.from(unidades)
      .map((unidade) => {
        const vendasUnidade = vendas.filter((v) => v.ganho_em.slice(0, 7) === mes && v.unidade === unidade);
        const vendasValor = vendasUnidade.reduce((s, v) => s + v.mrr, 0);
        const contratosAssinados = vendasUnidade.length;

        const propostasValor = propostas
          .filter((p) => p.mes.slice(0, 7) === mes && p.unidade === unidade)
          .reduce((s, p) => s + p.valor, 0);

        const investimentoValor = investimento
          .filter((i) => i.mes.slice(0, 7) === mes && i.bu === unidade)
          .reduce((s, i) => s + i.valor, 0);

        const roas = investimentoValor > 0 ? vendasValor / investimentoValor : null;

        return {
          unidade,
          propostas: propostasValor,
          vendas: vendasValor,
          contratosAssinados,
          investimento: investimentoValor,
          roas,
        };
      })
      .sort((a, b) => b.vendas - a.vendas);
  }, [vendas, propostas, investimento, mes]);

  const totais = rows.reduce(
    (acc, r) => {
      acc.propostas += r.propostas;
      acc.vendas += r.vendas;
      acc.contratos += r.contratosAssinados;
      acc.investimento += r.investimento;
      return acc;
    },
    { propostas: 0, vendas: 0, contratos: 0, investimento: 0 },
  );
  const roasTotal = totais.investimento > 0 ? totais.vendas / totais.investimento : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mês:</label>
        <select
          className="h-9 rounded-md border border-border bg-background px-3 text-sm font-medium"
          value={mes}
          onChange={(e) => setMes(e.target.value)}
        >
          {mesesDisponiveis.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">BU</th>
              <th className="px-3 py-2 text-right">Propostas Geradas</th>
              <th className="px-3 py-2 text-right">Vendas Realizadas (MRR)</th>
              <th className="px-3 py-2 text-right">Contratos Assinados</th>
              <th className="px-3 py-2 text-right">Investimento</th>
              <th className="px-3 py-2 text-center">ROAS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.unidade} className="border-t hover:bg-muted/30">
                <td className="px-3 py-2 font-medium">{r.unidade}</td>
                <td className="px-3 py-2 text-right">{brl(r.propostas)}</td>
                <td className="px-3 py-2 text-right">{brl(r.vendas)}</td>
                <td className="px-3 py-2 text-right">{num(r.contratosAssinados)}</td>
                <td className="px-3 py-2 text-right">{brl(r.investimento)}</td>
                <td className="px-3 py-2 text-center">
                  <RoasBadge roas={r.roas} />
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                  Sem dados para o mês selecionado.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t bg-muted/30 font-semibold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 text-right">{brl(totais.propostas)}</td>
                <td className="px-3 py-2 text-right">{brl(totais.vendas)}</td>
                <td className="px-3 py-2 text-right">{num(totais.contratos)}</td>
                <td className="px-3 py-2 text-right">{brl(totais.investimento)}</td>
                <td className="px-3 py-2 text-center">
                  <RoasBadge roas={roasTotal} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        ROAS = Vendas Realizadas (MRR ganho no mês) ÷ Investimento em anúncios do mês. Ex: investimento de R$50k
        gerando R$50k em vendas = ROAS 1,0x. Métrica distinta do ROAS de expansão da rede (payback de CAC).
        "Propostas Geradas" vem de sqls_por_bu (deals com estágio ≥ Precificação), não de todo deal criado.
      </p>
    </div>
  );
}

function RoasBadge({ roas }: { roas: number | null }) {
  if (roas == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        roas >= 1
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      )}
    >
      {roas.toFixed(2)}x
    </span>
  );
}
