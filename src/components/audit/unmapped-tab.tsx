import { useMemo, useState } from "react";
import { useData, type OrigemBase } from "./data-context";
import type { AuditRegistro } from "@/lib/audit-types";
import { brl, date, num } from "./format";
import { ClientDetailDrawer } from "./client-detail-drawer";
import { OrigemBadge, groupByOrigem } from "./origem-badge";

function UnmappedTable({
  rows,
  tone,
  title,
  showOrigem,
  onSelect,
  origemFor,
}: {
  rows: AuditRegistro[];
  tone: "orange" | "purple" | "amber" | "sky" | "slate";
  title: string;
  showOrigem?: boolean;
  onSelect: (r: AuditRegistro) => void;
  origemFor: (r: AuditRegistro) => OrigemBase;
}) {
  const [q, setQ] = useState("");
  const [cidade, setCidade] = useState("");
  const cidades = useMemo(
    () => Array.from(new Set(rows.map((r) => r.cidade).filter(Boolean))).sort() as string[],
    [rows],
  );
  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return rows.filter((r) => {
      if (cidade && r.cidade !== cidade) return false;
      if (!ql) return true;
      const hay = `${r.razao_social ?? ""} ${r.deal_titulo ?? ""} ${r.cnpj ?? ""} ${r.deal_id ?? ""}`.toLowerCase();
      return hay.includes(ql);
    });
  }, [rows, q, cidade]);

  const toneMap = {
    orange: {
      box: "border-warning/40 bg-warning-soft",
      head: "bg-warning-soft text-warning",
    },
    purple: {
      box: "border-purple-300 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/30",
      head: "bg-purple-100 text-purple-900 dark:bg-purple-900 dark:text-purple-100",
    },
    amber: {
      box: "border-warning/40 bg-warning-soft",
      head: "bg-warning-soft text-warning",
    },
    sky: {
      box: "border-info/40 bg-info-soft",
      head: "bg-info-soft text-info",
    },
    slate: {
      box: "border-border bg-muted",
      head: "bg-muted text-foreground",
    },
  } as const;
  const t = toneMap[tone];

  const inputCls = "h-9 rounded-md border bg-background px-3 text-sm";

  return (
    <div className={`rounded-lg border p-4 shadow-sm ${t.box}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title} ({rows.length})</h3>
        <div className="flex gap-2">
          <input className={inputCls} placeholder="Buscar..." value={q} onChange={(e) => setQ(e.target.value)} />
          <select className={inputCls} value={cidade} onChange={(e) => setCidade(e.target.value)}>
            <option value="">Todas cidades</option>
            {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="max-h-[480px] overflow-auto rounded-md border bg-background">
        <table className="w-full text-sm">
          <thead className={`sticky top-0 text-left text-xs uppercase ${t.head}`}>
            <tr>
              <th className="px-3 py-2">ID</th>
              <th className="px-3 py-2">Razão Social</th>
              <th className="px-3 py-2">CNPJ</th>
              {showOrigem && <th className="px-3 py-2">Base</th>}
              <th className="px-3 py-2">Cidade</th>
              <th className="px-3 py-2">MRR</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Fechamento</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr
                key={`${r.deal_id ?? "x"}-${i}`}
                onClick={() => onSelect(r)}
                className="border-t cursor-pointer hover:bg-muted/50"
              >
                <td className="px-3 py-2 font-mono text-xs">{r.deal_id ?? "—"}</td>
                <td className="px-3 py-2">{r.razao_social ?? r.deal_titulo ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.cnpj ?? "—"}</td>
                {showOrigem && <td className="px-3 py-2"><OrigemBadge value={origemFor(r)} /></td>}
                <td className="px-3 py-2">{r.cidade ?? "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.mrr)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.valor_contrato)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_fechamento)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={showOrigem ? 8 : 7} className="px-3 py-6 text-center text-muted-foreground">Sem resultados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function UnmappedTab() {
  const { stats, registros, getOrigem, origemFilter } = useData();
  const [selected, setSelected] = useState<AuditRegistro | null>(null);

  const origemFor = (r: AuditRegistro): OrigemBase => getOrigem(r);

  const dealSemPlanning = useMemo(
    () => registros.filter((r) => r.status_match === "deal_sem_planning"),
    [registros],
  );
  const planningSemDeal = useMemo(
    () => registros.filter((r) => r.status_match === "planning_sem_deal"),
    [registros],
  );

  const planningGroups = useMemo(
    () => groupByOrigem(planningSemDeal, origemFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [planningSemDeal, getOrigem],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-warning/40 bg-warning-soft p-4 shadow-sm">
          <div className="text-xs font-medium uppercase text-warning">Vendas sem recebimento localizado</div>
          <div className="mt-1 text-3xl font-bold text-warning">{num(stats.deal_sem_planning)}</div>
          <div className="text-xs text-warning/80">
            Vendas fechadas no CRM (Pipedrive) que não foram encontradas no Planning. Investigar: contrato não cadastrado, CNPJ divergente ou duplicidade.
          </div>
        </div>
        <div className="rounded-lg border border-purple-300 bg-purple-50 p-4 shadow-sm dark:border-purple-900 dark:bg-purple-950/30">
          <div className="text-xs font-medium uppercase text-purple-800 dark:text-purple-200">Recebimento sem venda localizada</div>
          <div className="mt-1 text-3xl font-bold text-purple-900 dark:text-purple-100">{num(stats.planning_sem_deal)}</div>
          <div className="mt-1 text-xs text-purple-800/80 dark:text-purple-200/80 space-y-0.5">
            <div>
              <span className="font-semibold">Base Antiga:</span> {num(planningGroups.antiga.length)} (esperado — não está no Pipedrive) ·{" "}
              <span className="font-semibold">Base Nova:</span> {num(planningGroups.nova.length)} (investigar) ·{" "}
              <span className="font-semibold">Sem cadastro:</span> {num(planningGroups.semCadastro.length)}
            </div>
          </div>
        </div>
      </div>

      <UnmappedTable
        rows={dealSemPlanning}
        tone="orange"
        title="Vendas (CRM) sem recebimento"
        showOrigem
        onSelect={setSelected}
        origemFor={origemFor}
      />

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">
          Recebimentos sem venda localizada
          {!origemFilter && " — separados por base"}
        </h3>

        {planningGroups.nova.length > 0 && (
          <UnmappedTable
            rows={planningGroups.nova}
            tone="sky"
            title="Base Nova — investigar (deveria estar no CRM)"
            onSelect={setSelected}
            origemFor={origemFor}
          />
        )}

        {planningGroups.antiga.length > 0 && (
          <UnmappedTable
            rows={planningGroups.antiga}
            tone="amber"
            title="Base Antiga — esperado (não está no Pipedrive)"
            onSelect={setSelected}
            origemFor={origemFor}
          />
        )}

        {planningGroups.semCadastro.length > 0 && (
          <UnmappedTable
            rows={planningGroups.semCadastro}
            tone="slate"
            title="Sem cadastro em empresas — CNPJ desconhecido"
            onSelect={setSelected}
            origemFor={origemFor}
          />
        )}

        {planningSemDeal.length === 0 && (
          <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            Nenhum recebimento sem venda localizada.
          </div>
        )}
      </div>

      <ClientDetailDrawer registro={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}

