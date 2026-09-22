import type { ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { BaseMonetizacao, Conta, Produto } from "@/lib/monetizacao/types";
import { NOMES } from "@/lib/monetizacao/types";
import { csv, oferta } from "@/lib/monetizacao/model";
import { KpiCard, tomDoLegado } from "@/components/planning";

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
// Adaptador: assinatura antiga, desenho do KpiCard do design system (DESIGN
// §1.6). Com `onClick` o card inteiro abre o detalhe (N2); `accent` pintava o
// número de verde (o número "bom" da grade: aptas, conversão) e vira o tom
// `sucesso` do KpiCard, com ícone de status junto da cor (V7).
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
  return (
    <KpiCard
      rotulo={label}
      valor={value}
      nota={hint}
      abrir={onClick ? { onClick } : undefined}
      tom={tomDoLegado(accent)}
    />
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

// A mensagem crua do banco não é para o sócio ler. "canceling statement due to statement
// timeout" apareceu inteira na tela em 22/09, em inglês e minúscula, colada depois de um ponto.
// Aqui ela vira frase, e o texto técnico continua acessível no title, para quem for investigar.
const ERROS_CONHECIDOS: [RegExp, string][] = [
  [/statement timeout/i, "o passo passou do tempo limite no banco"],
  [/deadlock/i, "duas cargas tentaram escrever ao mesmo tempo"],
  [/permission denied/i, "a carga não tem permissão para ler uma das fontes"],
  [/connection|timeout of/i, "a conexão com a fonte caiu no meio da carga"],
];
export const motivoLegivel = (erro: string) =>
  ERROS_CONHECIDOS.find(([re]) => re.test(erro))?.[1] ?? "a carga parou com um erro não previsto";

/** O aviso de carga: diz qual passo caiu, desde quando, e o que continua confiável. */
export function FalhaDeCarga({ data }: { data: BaseMonetizacao }) {
  if (!data.sync_error && data.measured_at) return null;
  if (!data.sync_error)
    return (
      <Notice>
        O CRM ainda não teve uma sincronização concluída. Os indicadores comerciais são liberados
        depois da primeira carga; a lista de empresas não depende dela.
      </Notice>
    );
  const desde = data.measured_at
    ? new Date(data.measured_at).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const catalogoOk =
    !!data.catalog_at &&
    (!data.measured_at || Date.parse(data.catalog_at) > Date.parse(data.measured_at));
  return (
    <Notice>
      <p>
        <strong>Os indicadores comerciais estão parados{desde ? ` desde ${desde}` : ""}.</strong> A
        última tentativa falhou porque{" "}
        <span title={data.sync_error}>{motivoLegivel(data.sync_error)}</span>. Os números de
        reuniões, oportunidades e contratos abaixo são dessa última carga concluída, não de agora.
      </p>
      {catalogoOk && (
        <p className="mt-1">
          A lista de empresas não foi afetada: ela vem de outra carga, que concluiu normalmente.
        </p>
      )}
    </Notice>
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
  // Duas cargas, dois relógios. O catálogo (as empresas) e os indicadores comerciais falham
  // separado: em 22/09 o catálogo tinha 1 minuto e as métricas, 22 horas, e a barra mostrava só
  // as métricas — a tela dizia que a base inteira estava parada, o que não era verdade.
  const idade = (v: string | null) => (v ? Date.now() - Date.parse(v) : Infinity);
  const quando = (v: string | null) =>
    v
      ? new Date(v).toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          day: "2-digit",
          month: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const catalogo = quando(data.catalog_at);
  const metricas = quando(data.measured_at);
  const metricasVelhas = idade(data.measured_at) > 30 * 60000;
  const catalogoVelho = idade(data.catalog_at) > 30 * 60000;
  const stale = metricasVelhas && catalogoVelho;
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span
        className={`h-2 w-2 rounded-full ${
          stale ? "bg-warning" : metricasVelhas || catalogoVelho ? "bg-info" : "bg-success"
        }`}
      />
      <span>Empresas · {catalogo ?? "primeira carga pendente"}</span>
      <span>
        Indicadores · {metricas ?? "primeira carga pendente"}
        {metricasVelhas && metricas ? " (parados)" : ""}
      </span>
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
