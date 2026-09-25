import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { BaseMonetizacao, Conta, Negocio, Produto } from "@/lib/monetizacao/types";
import { NOMES } from "@/lib/monetizacao/types";
import { csv, LIMITE_CARGA_PARADA_MS, oferta } from "@/lib/monetizacao/model";
import { KpiCard, Secao, tomDoLegado, type EstadoKpi } from "@/components/planning";

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
/** Foco visível dos controles locais (V12): o mesmo anel do `Button`, com afastamento do fundo. */
export const FOCO_VISIVEL =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
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
// `estado`, `procedencia` e `nota` passam direto ao KpiCard (moldura da Monetização): as abas
// marcam "parcial" com `estadoKpiEvento` (Z1/Z2) sem trocar de componente. `nota` vence `hint`.
export function Kpi({
  label,
  value,
  hint,
  nota,
  onClick,
  accent,
  estado,
  procedencia,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  nota?: ReactNode;
  onClick?: () => void;
  accent?: boolean;
  estado?: EstadoKpi;
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null };
}) {
  return (
    <KpiCard
      rotulo={label}
      valor={value}
      nota={nota ?? hint}
      abrir={onClick ? { onClick } : undefined}
      tom={tomDoLegado(accent)}
      estado={estado}
      procedencia={procedencia}
    />
  );
}

/**
 * `Secao` do design system com o corpo em cartão: substitui o `Panel` nas visões de
 * Monetização (o `Panel` continua para as telas de Clientes, que ainda não migraram).
 * O título é a pergunta do bloco quando o contrato da aba já tem uma.
 */
export function SecaoCartao({
  titulo,
  descricao,
  acoes,
  children,
  className,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Secao titulo={titulo} descricao={descricao} acoes={acoes} className={className}>
      <div className="rounded-xl border bg-card p-4">{children}</div>
    </Secao>
  );
}

/** Texto de apoio (régua, ressalva): muted, sem cor de alerta. Não é estado de tela. */
export function NotaApoio({ children }: { children: ReactNode }) {
  return <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>;
}

// ---------------------------------------------------------------------------
// Motivo do botão desabilitado (moldura, N8)

export const MOTIVO_ESCOPO_GERAL = "Exige acesso a todas as unidades (escopo geral).";

/** Escrita e sync exigem `view.monetizacao` e escopo de todas as unidades (conferidos na RPC). */
export const podeEscrever = (data: BaseMonetizacao) =>
  data.permissions.view && data.permissions.all_units;

/** `MOTIVO_ESCOPO_GERAL` quando falta escopo; `null` quando pode. */
export const motivoSemEscopo = (data: BaseMonetizacao) =>
  podeEscrever(data) ? null : MOTIVO_ESCOPO_GERAL;

/**
 * `Button` que diz por que está desabilitado. Não usa o atributo `disabled` (que tira o
 * ponteiro e o foco, e o tooltip nunca abriria): fica `aria-disabled`, bloqueia clique e
 * envio de formulário, e tem o mesmo estilo de desabilitado do `Button`. É sempre o mesmo
 * elemento, com ou sem motivo, para o foco não se perder quando `disabled` alterna. O motivo
 * vai no tooltip e, para leitor de tela, num texto oculto ligado por `aria-describedby`.
 * Com lista, o primeiro motivo verdadeiro ganha (ex.: escopo antes do campo que falta).
 */
export function BotaoComMotivo({
  motivo,
  disabled,
  onClick,
  className,
  ...props
}: ButtonProps & { motivo?: string | null | (string | null | false | undefined)[] }) {
  const id = useId();
  const texto = Array.isArray(motivo) ? motivo.find(Boolean) || null : motivo || null;
  const bloqueado = !!disabled;
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip open={texto ? undefined : false}>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-disabled={bloqueado || undefined}
            aria-describedby={texto ? id : undefined}
            className={cn(
              className,
              bloqueado &&
                "cursor-not-allowed opacity-50 hover:translate-y-0 hover:shadow-none active:translate-y-0",
            )}
            onClick={(e) => {
              if (bloqueado) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              onClick?.(e);
            }}
          />
        </TooltipTrigger>
        {texto && <TooltipContent>{texto}</TooltipContent>}
      </Tooltip>
      {texto && (
        <span id={id} className="sr-only">
          {texto}
        </span>
      )}
    </TooltipProvider>
  );
}

// ---------------------------------------------------------------------------
// Regras Z1 (carga parada) e Z2 (negócio sem histórico lido), só apresentação

const HORA_SP: Intl.DateTimeFormatOptions = {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};
/** "23/09, 20:20" em São Paulo; `null` sem data. */
export const horaDaCarga = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", HORA_SP) : null;

export type EstadoDaCarga = {
  /** O CRM nunca concluiu uma carga (`measured_at` nulo): KPIs de evento em `indisponivel`. */
  nuncaSincronizou: boolean;
  /** Z1: a última tentativa falhou (`sync_error`) e há carga anterior; os números são dela. */
  parada: boolean;
  /** Hora da última carga concluída ("23/09, 20:20"), quando existe. */
  desde?: string;
  /** Motivo em português da falha, quando há `sync_error`. */
  motivo?: string;
};

export function estadoDaCarga(data: BaseMonetizacao): EstadoDaCarga {
  const desde = horaDaCarga(data.measured_at) ?? undefined;
  return {
    nuncaSincronizou: !data.measured_at,
    parada: !!data.sync_error && !!data.measured_at,
    desde,
    motivo: data.sync_error ? motivoLegivel(data.sync_error) : undefined,
  };
}

/** Z2: quantos negócios do recorte não têm histórico lido (só têm `loaded` e `signed`). */
export const semHistorico = (cards: Negocio[]) => cards.filter((c) => !c.history_known).length;

/**
 * Estado de um KPI de evento (trabalhado, reunião, validada…) sobre `cards` (o recorte que o
 * número conta). Carga nunca feita → `indisponivel`; carga parada (Z1) ou negócio sem
 * histórico no recorte (Z2) → `parcial` com a nota do porquê; senão `ok` sem nota.
 * Uso nas abas: `<Kpi {...estadoKpiEvento(data, rows)} … />` ou `nota` somada à nota própria.
 */
export function estadoKpiEvento(
  data: BaseMonetizacao,
  cards: Negocio[],
): { estado: "ok" | "parcial" | "indisponivel"; nota?: string } {
  const carga = estadoDaCarga(data);
  if (carga.nuncaSincronizou)
    return { estado: "indisponivel", nota: "O CRM ainda não concluiu a primeira carga." };
  const notas: string[] = [];
  if (carga.parada) notas.push(`última carga ${carga.desde}`);
  const n = semHistorico(cards);
  if (n) notas.push(`${n} ${n === 1 ? "negócio" : "negócios"} sem histórico lido`);
  return notas.length ? { estado: "parcial", nota: notas.join(" · ") } : { estado: "ok" };
}

/** Procedência da moldura, com "parado desde {hora}" quando a carga parou (Z1). */
export const FONTE_MONETIZACAO = "Pipedrive, pipeline 39, via carga da Monetização";
export function procedenciaMonetizacao(data: BaseMonetizacao) {
  const carga = estadoDaCarga(data);
  return {
    fonte: carga.parada ? `${FONTE_MONETIZACAO} · parado desde ${carga.desde}` : FONTE_MONETIZACAO,
    atualizadoEm: data.measured_at,
  };
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
  motivoAtualizar,
}: {
  data: BaseMonetizacao;
  refreshing: boolean;
  onRefresh: () => void;
  /** Tooltip do Atualizar (ex.: sem escopo geral, ele só relê a tela). */
  motivoAtualizar?: string | null;
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
  const metricasVelhas = idade(data.measured_at) > LIMITE_CARGA_PARADA_MS;
  const catalogoVelho = idade(data.catalog_at) > LIMITE_CARGA_PARADA_MS;
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
      <BotaoComMotivo
        variant="outline"
        size="sm"
        onClick={onRefresh}
        disabled={refreshing}
        motivo={motivoAtualizar}
      >
        <RefreshCw className={`mr-1 h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
        {refreshing ? "Atualizando" : "Atualizar"}
      </BotaoComMotivo>
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
