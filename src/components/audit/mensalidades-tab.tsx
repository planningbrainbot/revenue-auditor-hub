import { useMemo, useState } from "react";
import { useData } from "./data-context";
import { brl, num } from "./format";
import { cn } from "@/lib/utils";
import { KpiCard, tomDoLegado } from "@/components/planning";

function ymToDate(ym: string): Date {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1);
}

function currentYM(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetweenInclusive(startYM: string, endYM: string): number {
  if (startYM > endYM) return 0;
  const a = ymToDate(startYM);
  const b = ymToDate(endYM);
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

interface Linha {
  cnpj: string | null;
  razao: string;
  dealId: number | null;
  inicioYM: string;
  mrr: number;
  mesesEsperados: number;
  mesesPagos: number;
  valorEsperado: number;
  valorPago: number;
  diferenca: number;
  pctRealizado: number;
  status: "ok" | "faltando" | "excedente";
}

export function MensalidadesTab() {
  const { registros } = useData();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "faltando" | "ok" | "excedente">("all");

  const linhas = useMemo<Linha[]>(() => {
    const hoje = currentYM();
    const out: Linha[] = [];
    for (const r of registros) {
      const mrr = r.mrr ?? 0;
      const inicio = r.inicio_contrato ?? r.data_fechamento;
      if (!inicio || mrr <= 0) continue;
      const inicioYM = inicio.slice(0, 7);
      const mesesEsperados = monthsBetweenInclusive(inicioYM, hoje);
      if (mesesEsperados <= 0) continue;
      const mesesPagos = r.meses_pagos ?? 0;
      const valorEsperado = mesesEsperados * mrr;
      const valorPago = r.total_pago ?? 0;
      const diferenca = valorEsperado - valorPago;
      const pct = valorEsperado > 0 ? (valorPago / valorEsperado) * 100 : 0;
      let status: Linha["status"] = "ok";
      if (diferenca > mrr * 0.5) status = "faltando";
      else if (diferenca < -mrr * 0.5) status = "excedente";
      out.push({
        cnpj: r.cnpj,
        razao: r.razao_social ?? r.deal_titulo ?? "—",
        dealId: r.deal_id,
        inicioYM,
        mrr,
        mesesEsperados,
        mesesPagos,
        valorEsperado,
        valorPago,
        diferenca,
        pctRealizado: pct,
        status,
      });
    }
    return out;
  }, [registros]);

  const stats = useMemo(() => {
    const total = linhas.length;
    const faltando = linhas.filter((l) => l.status === "faltando").length;
    const okCount = linhas.filter((l) => l.status === "ok").length;
    const excedente = linhas.filter((l) => l.status === "excedente").length;
    const totalEsperado = linhas.reduce((s, l) => s + l.valorEsperado, 0);
    const totalPago = linhas.reduce((s, l) => s + l.valorPago, 0);
    const diff = totalEsperado - totalPago;
    return {
      total,
      faltando,
      okCount,
      excedente,
      totalEsperado,
      totalPago,
      diff,
      pctGlobal: totalEsperado ? (totalPago / totalEsperado) * 100 : 0,
    };
  }, [linhas]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    let arr = linhas;
    if (filter !== "all") arr = arr.filter((l) => l.status === filter);
    if (ql) arr = arr.filter((l) => `${l.razao} ${l.cnpj ?? ""}`.toLowerCase().includes(ql));
    return [...arr].sort((a, b) => b.diferenca - a.diferenca);
  }, [linhas, q, filter]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">
          Auditoria de mensalidades — esperado × recebido
        </h2>
        <p className="text-xs text-muted-foreground">
          Para cada cliente, compara o valor total esperado (MRR × meses desde o início do contrato
          até o mês vigente) com o total efetivamente recebido no Omie.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Kpi label="Clientes auditados" value={num(stats.total)} />
        <Kpi label="Em dia" value={num(stats.okCount)} tone="ok" />
        <Kpi label="Faltando" value={num(stats.faltando)} tone="warn" />
        <Kpi label="Esperado total" value={brl(stats.totalEsperado)} />
        <Kpi label="Recebido total" value={brl(stats.totalPago)} sub={`${stats.pctGlobal.toFixed(1)}%`} />
        <Kpi label="Diferença" value={brl(stats.diff)} tone={stats.diff > 0 ? "warn" : "ok"} />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          placeholder="Buscar nome / CNPJ..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">Todos os status</option>
          <option value="faltando">Faltando</option>
          <option value="ok">Em dia</option>
          <option value="excedente">Excedente</option>
        </select>
        <span className="self-center text-xs text-muted-foreground">{num(filtered.length)} resultados</span>
      </div>

      <div className="max-h-[600px] overflow-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              <Th>Razão Social</Th>
              <Th>CNPJ</Th>
              <Th>Início</Th>
              <Th>MRR</Th>
              <Th>Meses esp.</Th>
              <Th>Meses pagos</Th>
              <Th>Esperado</Th>
              <Th>Recebido</Th>
              <Th>Diferença</Th>
              <Th>% real.</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((l, i) => (
              <tr
                key={`${l.cnpj ?? "x"}-${i}`}
                className={cn(
                  "border-t",
                  l.status === "faltando" && "bg-danger-soft/60",
                  l.status === "excedente" && "bg-info-soft/60",
                )}
              >
                <td className="px-3 py-2 font-medium">{l.razao}</td>
                <td className="px-3 py-2 font-mono text-xs">{l.cnpj ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.inicioYM}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(l.mrr)}</td>
                <td className="px-3 py-2">{l.mesesEsperados}</td>
                <td className="px-3 py-2">{l.mesesPagos}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(l.valorEsperado)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(l.valorPago)}</td>
                <td
                  className={cn(
                    "px-3 py-2 whitespace-nowrap font-medium",
                    l.diferenca > 0 && "text-danger",
                    l.diferenca < 0 && "text-info",
                  )}
                >
                  {brl(l.diferenca)}
                </td>
                <td className="px-3 py-2">{l.pctRealizado.toFixed(0)}%</td>
                <td className="px-3 py-2">
                  {l.status === "ok" && (
                    <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-medium text-success">
                      Em dia
                    </span>
                  )}
                  {l.status === "faltando" && (
                    <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                      Faltando
                    </span>
                  )}
                  {l.status === "excedente" && (
                    <span className="rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
                      Excedente
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
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
