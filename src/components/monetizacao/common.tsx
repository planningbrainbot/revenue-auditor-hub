import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BaseMonetizacao, Conta, Produto } from "@/lib/monetizacao/types";
import { NOMES } from "@/lib/monetizacao/types";
import { csv, oferta } from "@/lib/monetizacao/model";

export const number = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
export const money = (n: number | null | undefined, currency: string | null = "BRL") =>
  n === null || n === undefined
    ? "A preencher"
    : currency && /^[A-Z]{3}$/.test(currency)
      ? n.toLocaleString("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 })
      : `${n.toLocaleString("pt-BR")} · moeda a preencher`;
export const date = (v: string | null | undefined) =>
  v
    ? new Date(v.length === 10 ? v + "T12:00:00Z" : v).toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      })
    : "A preencher";
export const inputClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1 text-xs font-medium text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
export function Panel({
  title,
  children,
  action,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border bg-card ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
export function Kpi({
  label,
  value,
  hint,
  onClick,
  accent,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  onClick?: () => void;
  accent?: boolean;
}) {
  const content = (
    <>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <span
        className={`my-2 block text-3xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}
      >
        {value}
      </span>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </>
  );
  return onClick ? (
    <button
      onClick={onClick}
      className="rounded-xl border bg-card p-4 text-left transition hover:border-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </button>
  ) : (
    <div className="rounded-xl border bg-card p-4">{content}</div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
    >
      <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
      <div>{children}</div>
    </div>
  );
}
export function LoadingState({ error, retry }: { error?: Error | null; retry: () => void }) {
  return (
    <div className="p-6">
      <Panel
        title={error ? "Não foi possível carregar os dados" : "Carregando carteira e operação…"}
      >
        {error && (
          <>
            <p className="mb-3 text-sm text-muted-foreground">{error.message}</p>
            <Button onClick={retry}>Tentar novamente</Button>
          </>
        )}
      </Panel>
    </div>
  );
}
export function Freshness({
  data,
  refreshing,
  onRefresh,
}: {
  data: BaseMonetizacao;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const stale = !data.measured_at || Date.now() - Date.parse(data.measured_at) > 30 * 60000;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${stale ? "bg-warning" : "bg-success"}`} />
      <span>
        CRM ·{" "}
        {data.measured_at
          ? new Date(data.measured_at).toLocaleString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Primeira sincronização pendente"}
      </span>
      {stale && <span>· atualização pendente</span>}
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing}>
        <RefreshCw className={`mr-1 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Atualizando" : "Atualizar"}
      </Button>
    </div>
  );
}
export function OfertaTag({ account, product }: { account: Conta; product: Produto }) {
  const result = oferta(account, product);
  const colors =
    result.status === "elegivel"
      ? "border-success/30 bg-success/10 text-success"
      : result.status === "revisar"
        ? "border-warning/30 bg-warning/10 text-warning"
        : "text-muted-foreground";
  return (
    <span
      title={result.reason}
      className={`inline-block rounded border px-1.5 py-0.5 text-xs ${colors}`}
    >
      {NOMES[product]} ·{" "}
      {result.status === "elegivel"
        ? "perfil aderente"
        : result.status === "revisar"
          ? "confirmar"
          : "fora do perfil"}
    </span>
  );
}
export function downloadCsv(filename: string, rows: unknown[][]) {
  const url = URL.createObjectURL(new Blob([csv(rows)], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
