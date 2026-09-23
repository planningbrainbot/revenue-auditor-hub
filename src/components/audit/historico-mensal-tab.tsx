import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useData } from "./data-context";
import { brl } from "./format";
import type { AuditRegistro } from "@/lib/audit-types";
import { cn } from "@/lib/utils";
import { KpiCard, tomDoLegado } from "@/components/planning";

const UNIDADES_COM_OMIE = new Set(["Belém", "Campo Novo", "Curitiba", "Rio de Janeiro"]);

function buildMeses(): string[] {
  const meses: string[] = [];
  const now = new Date();
  const cur = new Date(2025, 0, 1);
  while (cur <= now) {
    meses.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return meses;
}

function mesLabel(m: string): string {
  const [y, mo] = m.split("-");
  const names = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  return `${names[Number(mo) - 1]}/${y.slice(2)}`;
}

function cellClass(pago: number, mrr: number | null) {
  if (pago === 0) return "";
  if (!mrr || mrr === 0) return "bg-success-soft";
  const ratio = pago / mrr;
  if (ratio >= 0.8) return "bg-success-soft";
  if (ratio >= 0.3) return "bg-warning-soft";
  return "bg-warning-soft";
}

function exportCsv(rows: ReturnType<typeof buildRows>, meses: string[]) {
  const headers = ["Deal ID", "Razão Social", "Unidade", "MRR", "Ganho em", "1º Recebimento", ...meses.map(mesLabel), "Total Recebido"];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const cells = [
      r.deal_id ?? "",
      `"${(r.razao_social ?? "").replace(/"/g, '""')}"`,
      r.unidade ?? "",
      r.mrr ?? 0,
      r.ganho_em ?? "",
      r.primeiro_rec ?? "",
      ...meses.map((m) => r.por_mes.get(m) ?? 0),
      r.total_rec,
    ];
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `reconciliacao-pipedrive-omie-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function buildRows(registros: AuditRegistro[]) {
  return registros
    .filter((r) => r.deal_id != null && r.unidade && UNIDADES_COM_OMIE.has(r.unidade))
    .map((r) => {
      const por_mes = new Map<string, number>();
      let primeiro_rec: string | null = null;
      let total_rec = 0;
      for (const p of r.pagamentos_mensais ?? []) {
        por_mes.set(p.month, (por_mes.get(p.month) ?? 0) + p.value);
        if (!primeiro_rec || p.month < primeiro_rec) primeiro_rec = p.month;
        total_rec += p.value;
      }
      return {
        deal_id: r.deal_id,
        razao_social: r.razao_social ?? r.deal_titulo,
        unidade: r.unidade,
        mrr: r.mrr,
        ganho_em: r.data_fechamento?.slice(0, 7) ?? null,
        primeiro_rec,
        total_rec,
        por_mes,
        na_ana: total_rec > 0,
      };
    });
}

export function HistoricoMensalTab() {
  const { registros } = useData();
  const [unidadeFilter, setUnidadeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "com_rec" | "sem_rec">("todos");
  const [q, setQ] = useState("");
  const [showOnlyGanhoAte, setShowOnlyGanhoAte] = useState("2026-03");

  const meses = useMemo(() => buildMeses(), []);

  const allRows = useMemo(() => buildRows(registros), [registros]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return allRows.filter((r) => {
      if (unidadeFilter && r.unidade !== unidadeFilter) return false;
      if (statusFilter === "com_rec" && !r.na_ana) return false;
      if (statusFilter === "sem_rec" && r.na_ana) return false;
      if (ql) {
        const hay = `${r.razao_social ?? ""} ${r.deal_id ?? ""} ${r.unidade ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [allRows, unidadeFilter, statusFilter, q]);

  const stats = useMemo(() => {
    const comOmie = allRows.filter((r) => r.na_ana).length;
    const semOmie = allRows.filter((r) => !r.na_ana).length;
    const mrrGap = allRows
      .filter((r) => !r.na_ana && r.ganho_em && r.ganho_em <= showOnlyGanhoAte)
      .reduce((s, r) => s + (r.mrr ?? 0), 0);
    return { total: allRows.length, comOmie, semOmie, mrrGap };
  }, [allRows, showOnlyGanhoAte]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Histórico de Recebimento por Cliente</h2>
        <p className="text-xs text-muted-foreground">
          Deals ganhos no Pipedrive × recebimentos mensais no Omie — jan/2025 até hoje.
          Unidades com Omie ativo: Belém, Campo Novo, Curitiba, Rio de Janeiro.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi label="Deals Pipedrive (4 unidades)" value={String(stats.total)} />
        <Kpi label="Com recebimento Omie" value={`${stats.comOmie} (${stats.total ? Math.round((stats.comOmie / stats.total) * 100) : 0}%)`} tone="ok" />
        <Kpi label="Sem nenhum recebimento" value={String(stats.semOmie)} tone="warn" />
        <Kpi label={`MRR sem recebimento (até ${showOnlyGanhoAte})`} value={brl(stats.mrrGap)} tone="warn" sub="deals ganhos ≥ 3 meses atrás" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-9 w-56 rounded-md border bg-background px-3 text-sm"
          placeholder="Buscar nome / Deal ID..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={unidadeFilter}
          onChange={(e) => setUnidadeFilter(e.target.value)}
        >
          <option value="">Todas as unidades</option>
          {[...UNIDADES_COM_OMIE].sort().map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="todos">Todos os status</option>
          <option value="com_rec">Com recebimento Omie</option>
          <option value="sem_rec">Sem recebimento</option>
        </select>
        <span className="self-center text-xs text-muted-foreground">{filtered.length} resultados</span>
        <button
          type="button"
          onClick={() => exportCsv(filtered, meses)}
          className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-accent"
        >
          <Download className="h-4 w-4" />
          Exportar CSV
        </button>
      </div>

      <div className="overflow-auto rounded-lg border bg-card shadow-sm" style={{ maxHeight: "70vh" }}>
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
            <tr>
              <Th sticky>Razão Social</Th>
              <Th>Unidade</Th>
              <Th>MRR</Th>
              <Th>Ganho em</Th>
              <Th>1º Rec.</Th>
              {meses.map((m) => <Th key={m}>{mesLabel(m)}</Th>)}
              <Th>Total Rec.</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={`${r.deal_id}`}
                className={cn("border-t", !r.na_ana && "bg-warning-soft/50")}
              >
                <td className="sticky left-0 z-[1] max-w-[220px] truncate bg-inherit px-3 py-1.5 font-medium">
                  {r.razao_social ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.unidade ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-right">{r.mrr ? brl(r.mrr) : "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{r.ganho_em ?? "—"}</td>
                <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">
                  {r.primeiro_rec ? mesLabel(r.primeiro_rec) : <span className="text-warning">sem rec.</span>}
                </td>
                {meses.map((m) => {
                  const v = r.por_mes.get(m) ?? 0;
                  return (
                    <td
                      key={m}
                      className={cn(
                        "whitespace-nowrap px-2 py-1.5 text-right",
                        cellClass(v, r.mrr),
                        v === 0 && "text-muted-foreground/30",
                      )}
                    >
                      {v > 0 ? brl(v) : ""}
                    </td>
                  );
                })}
                <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold">
                  {r.total_rec > 0 ? brl(r.total_rec) : <span className="text-warning font-normal">—</span>}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6 + meses.length} className="px-3 py-8 text-center text-muted-foreground">
                  Sem resultados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Verde escuro ≥ 80% MRR · Verde claro &lt; 80% · Âmbar &lt; 30% · Fundo âmbar = sem recebimento
      </p>
    </div>
  );
}

function Th({ children, sticky }: { children: React.ReactNode; sticky?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap",
        sticky && "sticky left-0 z-20 bg-muted/95",
      )}
    >
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
