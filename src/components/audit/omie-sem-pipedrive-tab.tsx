import { useMemo, useState } from "react";
import { useData } from "./data-context";
import { brl, num } from "./format";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/planning";

/**
 * Auditoria reversa: clientes com recebimentos no Omie (contas_receber)
 * que NÃO possuem cadastro / vínculo no Pipedrive.
 *
 * Critério: registro tem total_pago ou meses_pagos > 0 (recebimento Omie)
 * mas deal_id é nulo (sem venda registrada no Pipedrive).
 */
export function OmieSemPipedriveTab() {
  const { registros } = useData();
  const [q, setQ] = useState("");
  const [onlyGap, setOnlyGap] = useState(true);

  const comOmie = useMemo(
    () => registros.filter((r) => (r.meses_pagos ?? 0) > 0 || (r.total_pago ?? 0) > 0),
    [registros],
  );

  const semPipedrive = useMemo(
    () => comOmie.filter((r) => r.deal_id == null),
    [comOmie],
  );

  const stats = useMemo(() => {
    const total = comOmie.length;
    const gap = semPipedrive.length;
    const ok = total - gap;
    const valorGap = semPipedrive.reduce((s, r) => s + (r.total_pago ?? 0), 0);
    return {
      total,
      ok,
      gap,
      valorGap,
      pctCobertura: total ? (ok / total) * 100 : 0,
    };
  }, [comOmie, semPipedrive]);

  const base = onlyGap ? semPipedrive : comOmie;
  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    if (!ql) return base;
    return base.filter((r) =>
      `${r.razao_social ?? ""} ${r.cnpj ?? ""}`.toLowerCase().includes(ql),
    );
  }, [base, q]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          Clientes Omie sem registro no Pipedrive
        </h2>
        <p className="text-xs text-muted-foreground">
          Recebimentos do Omie que não têm uma venda correspondente registrada no Pipedrive.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Clientes c/ recebimento Omie" value={num(stats.total)} />
        <Kpi label="Com Pipedrive" value={num(stats.ok)} sub={`${stats.pctCobertura.toFixed(1)}% cobertura`} tone="ok" />
        <Kpi label="Sem Pipedrive" value={num(stats.gap)} tone="warn" />
        <Kpi label="Valor recebido sem venda" value={brl(stats.valorGap)} tone="warn" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          placeholder="Buscar nome / CNPJ..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyGap} onChange={(e) => setOnlyGap(e.target.checked)} />
          Mostrar apenas sem Pipedrive
        </label>
        <span className="text-xs text-muted-foreground">{num(filtered.length)} resultados</span>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              <Th>Razão Social</Th>
              <Th>CNPJ</Th>
              <Th>Unidade</Th>
              <Th>Meses pagos</Th>
              <Th>Total recebido</Th>
              <Th>Pipedrive</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={`${r.cnpj ?? "x"}-${i}`}
                className={cn(
                  "border-t",
                  r.deal_id == null && "bg-danger-soft/60",
                )}
              >
                <td className="px-3 py-2 font-medium">{r.razao_social ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.cnpj ?? "—"}</td>
                <td className="px-3 py-2">{r.cidade ?? "—"}</td>
                <td className="px-3 py-2">{r.meses_pagos ?? 0}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.total_pago)}</td>
                <td className="px-3 py-2">
                  {r.deal_id != null ? (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                      #{r.deal_id}
                    </span>
                  ) : (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                      Não cadastrado
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
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
// §1.6). O `tone` pintava só o número de verde/âmbar; cor sozinha não é status
// (V7), então fica aceito e ignorado, e o sentido mora no rótulo e na nota.
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" }) {
  return <KpiCard rotulo={label} valor={value} nota={sub} />;
}
