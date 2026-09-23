import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { brl } from "./format";
import {
  type UnidadeAggregate,
  type ClienteMatriz,
  formatMonthLabel,
  lastNMonths,
} from "./matriz-calc";
import { ClientDetailDrawer } from "./client-detail-drawer";
import type { AuditRegistro } from "@/lib/audit-types";
import { cn } from "@/lib/utils";
import { CORES_SERIE, eixoProps, gradeProps, tooltipProps } from "@/lib/planning/grafico";

interface Props {
  agg: UnidadeAggregate | null;
  mode: "cac" | "royalties";
  open: boolean;
  onClose: () => void;
}

export function UnitDetailDrawer({ agg, mode, open, onClose }: Props) {
  const [clientSel, setClientSel] = useState<AuditRegistro | null>(null);

  const monthly = useMemo(() => {
    if (!agg) return [];
    const months = lastNMonths(18);
    const source = mode === "cac" ? agg.cacPorMes : agg.royaltiesPorMes;
    // incluir todos os meses que tenham valor mesmo fora da janela
    const allKeys = new Set<string>([...months, ...source.keys()]);
    return Array.from(allKeys)
      .sort((a, b) => a.localeCompare(b))
      .map((m) => ({ month: m, value: source.get(m) ?? 0, label: formatMonthLabel(m) }));
  }, [agg, mode]);

  return (
    <>
      <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
          {agg && (
            <>
              <SheetHeader className="space-y-2">
                <SheetTitle className="text-xl">
                  {mode === "cac" ? "CAC" : "Royalties"} · {agg.nome}
                </SheetTitle>
                <SheetDescription asChild>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      % Royalties: <strong>{(agg.pctRoyalties * 100).toFixed(1)}%</strong>
                    </span>
                    <span className="rounded-full bg-muted px-2 py-0.5">
                      {agg.clientes.length} clientes
                    </span>
                  </div>
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 grid grid-cols-3 gap-2">
                {mode === "cac" ? (
                  <>
                    <Stat label="CAC realizado" value={brl(agg.cacRealizado)} tone="emerald" />
                    <Stat label="CAC pendente" value={brl(agg.cacPendente)} tone="amber" />
                    <Stat label="Aquisições" value={`${agg.qtdAquisicoes} de ${agg.clientes.length}`} />
                  </>
                ) : (
                  <>
                    <Stat label="Royalties acumulado" value={brl(agg.royaltiesAcumulado)} tone="indigo" />
                    <Stat
                      label="Royalties médio/mês"
                      value={brl(
                        agg.royaltiesPorMes.size > 0
                          ? agg.royaltiesAcumulado / agg.royaltiesPorMes.size
                          : 0,
                      )}
                    />
                    <Stat label="Meses com royalties" value={String(agg.royaltiesPorMes.size)} />
                  </>
                )}
              </div>

              <div className="mt-6">
                <h4 className="mb-2 text-sm font-semibold">
                  {mode === "cac" ? "CAC mês a mês" : "Royalties mês a mês"}
                </h4>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthly}>
                      <CartesianGrid {...gradeProps} />
                      <XAxis {...eixoProps} dataKey="label" angle={-30} textAnchor="end" height={50} />
                      <YAxis {...eixoProps} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <Tooltip {...tooltipProps} formatter={(v: number) => brl(v)} />
                      <Bar dataKey="value" name={mode === "cac" ? "CAC" : "Royalties"} fill={CORES_SERIE[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="mt-6">
                <h4 className="mb-2 text-sm font-semibold">Clientes da unidade</h4>
                <div className="overflow-hidden rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left">Cliente</th>
                        <th className="px-3 py-2 text-right">
                          {mode === "cac" ? "CAC" : "Royalties"}
                        </th>
                        <th className="px-3 py-2 text-left">
                          {mode === "cac" ? "Mês CAC" : "Status"}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...agg.clientes]
                        .sort((a, b) =>
                          mode === "cac"
                            ? b.cacRecebido - a.cacRecebido
                            : b.totalRoyalties - a.totalRoyalties,
                        )
                        .map((c, i) => (
                          <tr
                            key={`${c.registro.deal_id ?? c.registro.cnpj ?? i}`}
                            onClick={() => setClientSel(c.registro)}
                            className="border-t cursor-pointer hover:bg-muted/50"
                          >
                            <td className="px-3 py-2 font-medium">
                              {c.registro.razao_social ?? c.registro.deal_titulo ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {mode === "cac"
                                ? c.cacRecebido > 0
                                  ? brl(c.cacRecebido)
                                  : `pendente: ${brl(c.cacEstimado)}`
                                : brl(c.totalRoyalties)}
                            </td>
                            <td className="px-3 py-2 text-xs">
                              {mode === "cac"
                                ? c.cacMes
                                  ? formatMonthLabel(c.cacMes)
                                  : "—"
                                : c.registro.status_pagamento}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
      <ClientDetailDrawer
        registro={clientSel}
        open={!!clientSel}
        onClose={() => setClientSel(null)}
      />
    </>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "amber" | "indigo";
}) {
  const tones: Record<string, string> = {
    default: "bg-card",
    emerald: "bg-success-soft border-success/40",
    amber: "bg-warning-soft border-warning/40",
    indigo: "bg-info-soft border-info/30",
  };
  return (
    <div className={cn("rounded-lg border p-3 shadow-sm", tones[tone])}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
    </div>
  );
}
