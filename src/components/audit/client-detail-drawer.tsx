import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import type { AuditRegistro } from "@/lib/audit-types";
import { brl, date } from "./format";
import { PagamentoBadge, TipoBadge } from "./badges";
import { buildSchedule, statusLabel, formatMonthLabel } from "./payment-schedule";
import { useData } from "./data-context";
import { calcCliente } from "./matriz-calc";
import { cn } from "@/lib/utils";
import { CORES_SERIE, COR_NEUTRA, eixoProps, gradeProps, legendaProps, tooltipProps } from "@/lib/planning/grafico";

interface Props {
  registro: AuditRegistro | null;
  open: boolean;
  onClose: () => void;
}

function StatCard({
  label,
  value,
  tone = "default",
  help,
}: {
  label: string;
  value: string;
  tone?: "default" | "emerald" | "red" | "indigo";
  help?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-card",
    emerald: "bg-success-soft border-success/40",
    red: "bg-danger-soft border-danger/40",
    indigo: "bg-info-soft border-info/30",
  };
  return (
    <div className={cn("rounded-lg border p-3 shadow-sm", tones[tone])}>
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {help && <div className="mt-1 text-xs text-muted-foreground">{help}</div>}
    </div>
  );
}

export function ClientDetailDrawer({ registro, open, onClose }: Props) {
  const data = useMemo(() => (registro ? buildSchedule(registro) : null), [registro]);
  const { cnpjToUnidade, unidadesByName, getOrigem } = useData();
  const origem = useMemo(
    () => (registro ? getOrigem(registro) : null),
    [registro, getOrigem],
  );
  const matriz = useMemo(() => {
    if (!registro) return null;
    const nome = registro.cnpj ? cnpjToUnidade.get(registro.cnpj) ?? null : null;
    const u = nome ? unidadesByName.get(nome) ?? null : null;
    return calcCliente(registro, nome, u);
  }, [registro, cnpjToUnidade, unidadesByName]);

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {registro && data && (
          <>
            <SheetHeader className="space-y-2">
              <SheetTitle className="text-xl">
                {registro.razao_social ?? registro.deal_titulo ?? "—"}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-mono">{registro.cnpj ?? "Sem CNPJ"}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{registro.cidade ?? "—"}</span>
                  <TipoBadge value={registro.tipo_contrato} />
                  <PagamentoBadge value={registro.status_pagamento} />
                  {origem === "Base Antiga" && (
                    <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
                      Base Antiga
                    </span>
                  )}
                  {origem === "Base Nova" && (
                    <span className="inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                      Base Nova
                    </span>
                  )}
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-muted-foreground">Fechamento</div>
                <div className="font-medium">{date(registro.data_fechamento)}</div>
              </div>
              <div className="rounded-md border bg-muted/30 p-2">
                <div className="text-muted-foreground">Início do contrato</div>
                <div className="font-medium">{date(registro.inicio_contrato)}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
              <StatCard label="Valor do contrato" value={brl(data.summary.totalContrato)} tone="indigo" />
              <StatCard label="Total recebido" value={brl(data.summary.totalRecebido)} tone="emerald" />
              <StatCard
                label="Esperado até hoje"
                value={brl(data.summary.esperadoAteHoje)}
                help={`${data.summary.mesesDecorridos} de ${data.summary.mesesContrato} meses`}
              />
              <StatCard
                label="Saldo em aberto"
                value={brl(data.summary.saldoEmAberto)}
                tone={data.summary.saldoEmAberto > 0 ? "red" : "emerald"}
              />
            </div>

            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                <span>% recebido do contrato total</span>
                <span className="font-medium text-foreground">
                  {(data.summary.pctRecebido * 100).toFixed(1)}%
                </span>
              </div>
              <Progress value={data.summary.pctRecebido * 100} />
            </div>

            {data.rows.length > 0 && (
              <div className="mt-6">
                <h4 className="mb-2 text-sm font-semibold">Esperado × Recebido</h4>
                <div className="h-52 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data.rows.map((r) => ({
                        mes: formatMonthLabel(r.month),
                        Esperado: r.isFuture ? 0 : r.expected,
                        Recebido: r.received,
                      }))}
                    >
                      <CartesianGrid {...gradeProps} />
                      <XAxis {...eixoProps} dataKey="mes" angle={-30} textAnchor="end" height={50} />
                      <YAxis {...eixoProps} tickFormatter={(v) => `${Math.round(Number(v) / 1000)}k`} />
                      <Tooltip {...tooltipProps} formatter={(v: number) => brl(v)} />
                      <Legend {...legendaProps} />
                      <Bar dataKey="Esperado" fill={COR_NEUTRA} />
                      <Bar dataKey="Recebido" fill={CORES_SERIE[0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            <div className="mt-6">
              <h4 className="mb-2 text-sm font-semibold">Histórico mês a mês</h4>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Mês</th>
                      <th className="px-3 py-2 text-right">Esperado</th>
                      <th className="px-3 py-2 text-right">Recebido</th>
                      <th className="px-3 py-2 text-right">Diferença</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const s = statusLabel(r.status);
                      return (
                        <tr
                          key={r.month}
                          className={cn(
                            "border-t",
                            r.status === "aberto" && "bg-danger-soft/60",
                            r.status === "parcial" && "bg-warning-soft/60",
                            r.isFuture && "text-muted-foreground",
                          )}
                        >
                          <td className="px-3 py-2 font-medium">{formatMonthLabel(r.month)}</td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {r.expected > 0 ? brl(r.expected) : "—"}
                          </td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">
                            {r.isFuture && r.received === 0 ? "—" : brl(r.received)}
                          </td>
                          <td
                            className={cn(
                              "px-3 py-2 text-right whitespace-nowrap font-medium",
                              !r.isFuture && r.diff < 0 && "text-danger",
                              r.diff > 0 && "text-info",
                            )}
                          >
                            {r.isFuture && r.received === 0
                              ? "—"
                              : `${r.diff >= 0 ? "+" : ""}${brl(r.diff)}`}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                                s.cls,
                              )}
                            >
                              <span className={cn("inline-block h-2 w-2 rounded-full", s.dot)} />
                              {s.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {matriz && (
              <div className="mt-6 rounded-lg border bg-muted/30 p-4">
                <h4 className="mb-3 text-sm font-semibold">Matriz (CAC + Royalties deste cliente)</h4>
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-background px-2 py-0.5 border">
                    Unidade: <strong>{matriz.unidadeNome ?? "não mapeada"}</strong>
                  </span>
                  <span className="rounded-full bg-background px-2 py-0.5 border">
                    % Royalties: <strong>{(matriz.pctRoyalties * 100).toFixed(1)}%</strong>
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border bg-warning-soft p-2">
                    <div className="text-xs uppercase text-warning">CAC</div>
                    <div className="text-base font-bold">{brl(matriz.cacRecebido)}</div>
                    <div className="text-xs text-muted-foreground">
                      {matriz.cacMes ? `1º pag.: ${formatMonthLabel(matriz.cacMes)}` : "ainda não pago"}
                    </div>
                  </div>
                  <div className="rounded-md border bg-info-soft p-2">
                    <div className="text-xs uppercase text-info">Royalties total</div>
                    <div className="text-base font-bold">{brl(matriz.totalRoyalties)}</div>
                    <div className="text-xs text-muted-foreground">
                      {matriz.royaltiesPorMes.length} parcelas
                    </div>
                  </div>
                  <div className="rounded-md border bg-success-soft p-2">
                    <div className="text-xs uppercase text-success">Total à matriz</div>
                    <div className="text-base font-bold">{brl(matriz.cacRecebido + matriz.totalRoyalties)}</div>
                  </div>
                </div>

                {matriz.royaltiesPorMes.length > 0 && (
                  <div className="mt-3 overflow-hidden rounded-md border bg-background">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 uppercase text-muted-foreground">
                        <tr>
                          <th className="px-2 py-1 text-left">Mês</th>
                          <th className="px-2 py-1 text-right">Valor pago</th>
                          <th className="px-2 py-1 text-right">Royalties ({(matriz.pctRoyalties * 100).toFixed(1)}%)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {matriz.royaltiesPorMes.map((rm) => (
                          <tr key={rm.month} className="border-t">
                            <td className="px-2 py-1">{formatMonthLabel(rm.month)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap">{brl(rm.valorPago)}</td>
                            <td className="px-2 py-1 text-right whitespace-nowrap font-semibold text-info">
                              {brl(rm.royalties)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
