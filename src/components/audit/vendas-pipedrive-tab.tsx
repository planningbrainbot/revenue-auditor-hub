import { useMemo, useState } from "react";
import { useData } from "./data-context";
import { brl, num, date } from "./format";
import { cn } from "@/lib/utils";
import { KpiCard, tomDoLegado } from "@/components/planning";

function diasClass(d: number | null) {
  if (d == null) return "";
  if (d <= 45) return "text-success font-medium";
  if (d <= 90) return "text-warning font-medium";
  return "text-danger font-semibold";
}

export function VendasPipedriveTab() {
  const { registros } = useData();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "pago" | "sem_pag">("all");

  // Apenas vendas registradas no Pipedrive
  const vendas = useMemo(
    () => registros.filter((r) => r.deal_id != null),
    [registros],
  );

  const stats = useMemo(() => {
    const total = vendas.length;
    const comPag = vendas.filter((r) => r.pagou).length;
    const semPag = total - comPag;
    const dias = vendas
      .map((r) => r.dias_ate_primeiro_pag)
      .filter((d): d is number => d != null);
    const media = dias.length ? dias.reduce((a, b) => a + b, 0) / dias.length : 0;
    const sorted = [...dias].sort((a, b) => a - b);
    const mediana = sorted.length
      ? sorted.length % 2
        ? sorted[(sorted.length - 1) / 2]
        : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : 0;
    const mrrSemPag = vendas
      .filter((r) => !r.pagou)
      .reduce((s, r) => s + (r.mrr ?? 0), 0);
    return {
      total,
      comPag,
      semPag,
      media: Math.round(media),
      mediana: Math.round(mediana),
      mrrSemPag,
      pctRecebido: total ? (comPag / total) * 100 : 0,
    };
  }, [vendas]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return vendas.filter((r) => {
      if (filter === "pago" && !r.pagou) return false;
      if (filter === "sem_pag" && r.pagou) return false;
      if (ql) {
        const hay = `${r.razao_social ?? ""} ${r.deal_titulo ?? ""} ${r.cnpj ?? ""} ${r.deal_id ?? ""} ${r.unidade ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [vendas, q, filter]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Auditoria das vendas registradas no Pipedrive</h2>
        <p className="text-xs text-muted-foreground">
          Quanto tempo até o primeiro pagamento e quais vendas ainda não tiveram nenhum recebimento.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Vendas Pipedrive" value={num(stats.total)} />
        <Kpi label="Com 1º pagamento" value={num(stats.comPag)} sub={`${stats.pctRecebido.toFixed(1)}%`} tone="ok" />
        <Kpi label="Sem nenhum pag." value={num(stats.semPag)} tone="warn" />
        <Kpi label="MRR sem recebimento" value={brl(stats.mrrSemPag)} tone="warn" />
        <Kpi label="Dias médios 1º pag." value={`${stats.media} d`} />
        <Kpi label="Mediana dias" value={`${stats.mediana} d`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          placeholder="Buscar nome / CNPJ / Deal ID..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">Todas as vendas</option>
          <option value="pago">Já teve 1º pagamento</option>
          <option value="sem_pag">Sem nenhum recebimento</option>
        </select>
        <span className="self-center text-xs text-muted-foreground">{num(filtered.length)} resultados</span>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              <Th>Deal ID</Th>
              <Th>Razão Social</Th>
              <Th>CNPJ</Th>
              <Th>Unidade</Th>
              <Th>Fechamento</Th>
              <Th>MRR</Th>
              <Th>1º Pagamento</Th>
              <Th>Dias até 1º pag.</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={`${r.deal_id}-${i}`}
                className={cn(
                  "border-t",
                  !r.pagou && "bg-warning-soft/60",
                )}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.deal_id}</td>
                <td className="px-3 py-2 font-medium">{r.razao_social ?? r.deal_titulo ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.cnpj ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{r.unidade ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_fechamento)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.mrr)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_primeiro_pag)}</td>
                <td className={cn("px-3 py-2", diasClass(r.dias_ate_primeiro_pag))}>
                  {r.dias_ate_primeiro_pag ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {r.pagou ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                      Recebido
                    </span>
                  ) : (
                    <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      Sem recebimento
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                  Sem resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  );
}

// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN
// §1.6). O `tone` pintava o número de verde/âmbar e vira o `tom` do KpiCard
// (ok → sucesso, warn → atenção), com ícone de status junto da cor (V7).
function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return <KpiCard rotulo={label} valor={value} nota={sub} tom={tomDoLegado(tone)} />;
}
