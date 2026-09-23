import { useMemo, useState } from "react";
import { useData, type OrigemBase } from "./data-context";
import type { AuditRegistro } from "@/lib/audit-types";
import { brl, date, num } from "./format";
import { MatchBadge, PagamentoBadge, TipoBadge } from "./badges";
import { cn } from "@/lib/utils";
import { ClientDetailDrawer } from "./client-detail-drawer";

function OrigemBadge({ value }: { value: OrigemBase }) {
  if (value === "Base Antiga") {
    return (
      <span className="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
        Base Antiga
      </span>
    );
  }
  if (value === "Base Nova") {
    return (
      <span className="inline-flex items-center rounded-full bg-info-soft px-2 py-0.5 text-xs font-medium text-info">
        Base Nova
      </span>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

type SortKey =
  | "deal_id" | "razao_social" | "cidade" | "tipo_contrato" | "mrr"
  | "valor_contrato" | "data_fechamento" | "data_primeiro_pag"
  | "dias_ate_primeiro_pag" | "meses_pagos" | "total_pago" | "status_pagamento" | "status_match";

const PAGE_SIZE = 30;

function diasClass(d: number | null) {
  if (d == null) return "";
  if (d <= 45) return "text-success font-medium";
  if (d <= 90) return "text-warning font-medium";
  return "text-danger font-semibold";
}

export function DetailTab() {
  const { registros, getOrigem } = useData();
  const [q, setQ] = useState("");
  const [cidade, setCidade] = useState("");
  const [statusPag, setStatusPag] = useState("");
  const [tipo, setTipo] = useState("");
  const [statusMatch, setStatusMatch] = useState("");
  const [origem, setOrigem] = useState<"" | "Base Nova" | "Base Antiga" | "sem">("");
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("data_fechamento");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<AuditRegistro | null>(null);

  const origemFor = (r: AuditRegistro): OrigemBase => getOrigem(r);

  const cidades = useMemo(
    () => Array.from(new Set(registros.map((r) => r.cidade).filter(Boolean))).sort() as string[],
    [registros],
  );

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return registros.filter((r) => {
      if (ql) {
        const hay = `${r.razao_social ?? ""} ${r.deal_titulo ?? ""} ${r.cnpj ?? ""} ${r.deal_id ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (cidade && r.cidade !== cidade) return false;
      if (statusPag && r.status_pagamento !== statusPag) return false;
      if (tipo && r.tipo_contrato !== tipo) return false;
      if (statusMatch && r.status_match !== statusMatch) return false;
      if (origem) {
        const o = getOrigem(r);
        if (origem === "sem" ? o !== null : o !== origem) return false;
      }
      return true;
    });
  }, [registros, q, cidade, statusPag, tipo, statusMatch, origem, getOrigem]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = (a as unknown as Record<SortKey, unknown>)[sortKey];
      const bv = (b as unknown as Record<SortKey, unknown>)[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const slice = sorted.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("desc"); }
    setPage(0);
  }

  const inputCls = "h-9 rounded-md border bg-background px-3 text-sm";
  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th
      onClick={() => toggleSort(k)}
      className="cursor-pointer select-none px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
    >
      {children} {sortKey === k && (sortDir === "asc" ? "▲" : "▼")}
    </th>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-6">
        <input className={inputCls} placeholder="Buscar nome / CNPJ / ID..." value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        <select className={inputCls} value={cidade} onChange={(e) => { setCidade(e.target.value); setPage(0); }}>
          <option value="">Todas as cidades</option>
          {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={inputCls} value={statusPag} onChange={(e) => { setStatusPag(e.target.value); setPage(0); }}>
          <option value="">Status pagamento</option>
          <option value="adimplente">Adimplente</option>
          <option value="inadimplente">Inadimplente</option>
          <option value="recente">Recente</option>
          <option value="sem_dados">Sem dados</option>
        </select>
        <select className={inputCls} value={tipo} onChange={(e) => { setTipo(e.target.value); setPage(0); }}>
          <option value="">Tipo contrato</option>
          <option value="Recorrente">Recorrente</option>
          <option value="Avulso (On-Time)">Avulso (On-Time)</option>
        </select>
        <select className={inputCls} value={statusMatch} onChange={(e) => { setStatusMatch(e.target.value); setPage(0); }}>
          <option value="">Match status</option>
          <option value="matched">Vinculado</option>
          <option value="deal_sem_planning">Venda sem recebimento localizado</option>
          <option value="planning_sem_deal">Recebimento sem venda localizada</option>
        </select>
        <select
          className={inputCls}
          value={origem}
          onChange={(e) => { setOrigem(e.target.value as typeof origem); setPage(0); }}
        >
          <option value="">Todas as bases</option>
          <option value="Base Nova">Base Nova</option>
          <option value="Base Antiga">Base Antiga</option>
          <option value="sem">Sem cadastro</option>
        </select>
      </div>

      <div className="text-xs text-muted-foreground">
        {num(sorted.length)} resultados · página {currentPage + 1} de {pageCount}
      </div>

      <div className="overflow-auto rounded-lg border bg-card shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <Th k="deal_id">ID</Th>
              <Th k="razao_social">Razão Social</Th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">CNPJ</th>
              <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Base</th>
              <Th k="cidade">Cidade</Th>
              <Th k="tipo_contrato">Tipo</Th>
              <Th k="mrr">MRR</Th>
              <Th k="valor_contrato">Valor</Th>
              <Th k="data_fechamento">Fechamento</Th>
              <Th k="data_primeiro_pag">1º Pag.</Th>
              <Th k="dias_ate_primeiro_pag">Dias</Th>
              <Th k="meses_pagos">Meses</Th>
              <Th k="total_pago">Total Pago</Th>
              <Th k="status_pagamento">Status</Th>
              <Th k="status_match">Match</Th>
            </tr>
          </thead>
          <tbody>
            {slice.map((r: AuditRegistro, i) => (
              <tr
                key={`${r.deal_id ?? "x"}-${i}`}
                onClick={() => setSelected(r)}
                className={cn(
                  "border-t cursor-pointer hover:bg-muted/50",
                  r.status_pagamento === "inadimplente" && "bg-danger-soft/70 hover:bg-danger-soft/70",
                )}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.deal_id ?? "—"}</td>
                <td className="px-3 py-2 font-medium">{r.razao_social ?? r.deal_titulo ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.cnpj ?? "—"}</td>
                <td className="px-3 py-2"><OrigemBadge value={origemFor(r)} /></td>
                <td className="px-3 py-2">{r.cidade ?? "—"}</td>
                <td className="px-3 py-2"><TipoBadge value={r.tipo_contrato} /></td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.mrr)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.valor_contrato)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_fechamento)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_primeiro_pag)}</td>
                <td className={cn("px-3 py-2", diasClass(r.dias_ate_primeiro_pag))}>
                  {r.dias_ate_primeiro_pag ?? "—"}
                </td>
                <td className="px-3 py-2">{r.meses_pagos ?? 0}</td>
                <td className="px-3 py-2 whitespace-nowrap">{brl(r.total_pago)}</td>
                <td className="px-3 py-2"><PagamentoBadge value={r.status_pagamento} /></td>
                <td className="px-3 py-2"><MatchBadge value={r.status_match} /></td>
              </tr>
            ))}
            {slice.length === 0 && (
              <tr><td colSpan={15} className="px-3 py-8 text-center text-muted-foreground">Sem resultados.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={currentPage === 0}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          ← Anterior
        </button>
        <span className="text-sm text-muted-foreground">{currentPage + 1} / {pageCount}</span>
        <button
          type="button"
          disabled={currentPage >= pageCount - 1}
          onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
          className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-50"
        >
          Próxima →
        </button>
      </div>

      <ClientDetailDrawer registro={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  );
}
