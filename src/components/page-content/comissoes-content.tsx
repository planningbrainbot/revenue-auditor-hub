import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DataProvider, BaseFilterSelect, RefreshButton, useData } from "@/components/audit/data-context";
import { brl, date, num } from "@/components/audit/format";
import { cn } from "@/lib/utils";
import { KpiCard } from "@/components/planning";

const PIPEDRIVE_DEAL_URL = "https://grupoplanning.pipedrive.com/deal/";

const ALL = "__all__";

function ComissoesTable() {
  const { registros } = useData();
  const [q, setQ] = useState("");
  const [closerFilter, setCloserFilter] = useState(ALL);
  const [sdrFilter, setSdrFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState<"all" | "pago" | "sem_pag">("all");

  // Só vendas efetivamente registradas no Pipedrive — são as que geram comissão.
  const vendas = useMemo(() => registros.filter((r) => r.deal_id != null), [registros]);

  const closers = useMemo(
    () => Array.from(new Set(vendas.map((r) => r.closer).filter((v): v is string => !!v))).sort(),
    [vendas],
  );
  const sdrs = useMemo(
    () => Array.from(new Set(vendas.map((r) => r.sdr).filter((v): v is string => !!v))).sort(),
    [vendas],
  );

  const stats = useMemo(() => {
    const total = vendas.length;
    const comPag = vendas.filter((r) => r.pagou).length;
    const semCloser = vendas.filter((r) => !r.closer).length;
    const semSdr = vendas.filter((r) => !r.sdr).length;
    return { total, comPag, semPag: total - comPag, semCloser, semSdr };
  }, [vendas]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase().trim();
    return vendas.filter((r) => {
      if (statusFilter === "pago" && !r.pagou) return false;
      if (statusFilter === "sem_pag" && r.pagou) return false;
      if (closerFilter !== ALL && (r.closer ?? "—") !== closerFilter) return false;
      if (sdrFilter !== ALL && (r.sdr ?? "—") !== sdrFilter) return false;
      if (ql) {
        const hay = `${r.deal_titulo ?? ""} ${r.razao_social ?? ""} ${r.cnpj ?? ""} ${r.deal_id ?? ""}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [vendas, q, closerFilter, sdrFilter, statusFilter]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Apuração de Comissões</h2>
        <p className="text-xs text-muted-foreground">
          Vendas fechadas no Pipedrive × 1º pagamento recebido, por Closer e SDR — use para conferir se a venda foi
          realizada antes de apurar a comissão.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Vendas" value={num(stats.total)} />
        <Kpi label="Com 1º pagamento" value={num(stats.comPag)} tone="ok" />
        <Kpi label="Sem nenhum pag." value={num(stats.semPag)} tone="warn" />
        <Kpi label="Sem Closer atribuído" value={num(stats.semCloser)} tone="warn" />
        <Kpi label="Sem SDR atribuído" value={num(stats.semSdr)} tone="warn" />
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="h-9 w-64 rounded-md border bg-background px-3 text-sm"
          placeholder="Buscar nome / razão social / CNPJ..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={closerFilter}
          onChange={(e) => setCloserFilter(e.target.value)}
        >
          <option value={ALL}>Todos os Closers</option>
          {closers.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={sdrFilter}
          onChange={(e) => setSdrFilter(e.target.value)}
        >
          <option value={ALL}>Todos os SDRs</option>
          {sdrs.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
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
              <Th>Nome</Th>
              <Th>CNPJ</Th>
              <Th>Razão Social</Th>
              <Th>Pipedrive</Th>
              <Th>Data da Venda</Th>
              <Th>Closer</Th>
              <Th>SDR</Th>
              <Th>Status 1º Pgto</Th>
              <Th>Valor Pgto</Th>
              <Th>Data Pgto</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={`${r.deal_id}-${i}`} className={cn("border-t", !r.pagou && "bg-warning-soft/60")}>
                <td className="px-3 py-2 font-medium">{r.deal_titulo ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.cnpj ?? "—"}</td>
                <td className="px-3 py-2">{r.razao_social ?? "—"}</td>
                <td className="px-3 py-2">
                  <a
                    href={`${PIPEDRIVE_DEAL_URL}${r.deal_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {r.deal_id} <ExternalLink className="h-3 w-3" />
                  </a>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_fechamento)}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.closer ?? <span className="text-muted-foreground">—</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.sdr ?? <span className="text-muted-foreground">—</span>}
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
                <td className="px-3 py-2 whitespace-nowrap">{r.pagou ? brl(r.valor_primeiro_pag) : "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{date(r.data_primeiro_pag)}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
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
// §1.6). O `tone` pintava só o número; cor sozinha não é status (V7), então
// fica aceito e ignorado.
function Kpi({ label, value }: { label: string; value: string; tone?: "ok" | "warn" }) {
  return <KpiCard rotulo={label} valor={value} />;
}

export function ComissoesContent() {
  return (
    <DataProvider>
      <div className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-end gap-2 px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Base:</span>
          <BaseFilterSelect />
          <RefreshButton />
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <ComissoesTable />
      </div>
    </DataProvider>
  );
}
