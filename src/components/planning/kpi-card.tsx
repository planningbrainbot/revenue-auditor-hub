import type { CSSProperties, ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { CircleDashed, Lock, Unplug } from "lucide-react";
import { cn } from "@/lib/utils";
import { partesDoLink } from "@/lib/areas";
import { corDaArea } from "@/lib/planning/cores-area";
import { Degrau } from "./grafismos";
import { Procedencia } from "./procedencia";
import { StatusBadge } from "./status-badge";

/**
 * O card de número do Brain. Substitui as 20 versões locais e os ~70 inline
 * (spec §1): o mesmo número tem a mesma cara em toda área.
 *
 * O que ele garante, e por quê:
 * - Ausência não é zero (N4). Fora do estado `ok`/`parcial` o valor NUNCA
 *   aparece: "não apurado", "fonte indisponível" e "sem acesso" mostram "—" ou
 *   cadeado com o motivo. Quem passa `valor={0}` enquanto carrega mente.
 * - Meta ao lado do realizado (N13), nunca somada a ele.
 * - Procedência na última linha (N3), discreta, sem cor de alerta.
 * - Só reage a hover se abre algo (N2, V11): com `abrir`, o card inteiro vira
 *   link ou botão, ganha o filete da área e diz "Abrir registros →". Sem
 *   `abrir`, nem borda nem cursor mudam, para não prometer um clique que não
 *   existe.
 */
export type EstadoKpi = "ok" | "parcial" | "nao-apurado" | "indisponivel" | "sem-acesso";

export type KpiCardProps = {
  rotulo: string;
  valor: ReactNode;
  unidade?: string;
  /** Variação em % (12 = +12%). `rotulo` completa a frase: "vs ago". */
  delta?: { valor: number; rotulo?: string; sentido?: "maior-melhor" | "menor-melhor" };
  /**
   * Meta do período. A porcentagem atingida aparece quando `progresso` (0–1)
   * vem pronto ou quando `valor` e `meta.valor` são números.
   */
  meta?: { valor: ReactNode; rotulo?: string; progresso?: number };
  estado?: EstadoKpi;
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null };
  /** Drill-down: o card inteiro abre os registros que compõem o número. */
  abrir?: { href?: string; onClick?: () => void; rotulo?: string };
  /** Cor do filete no hover. Sem ela, a área da página (`--area-atual`). */
  area?: string;
  className?: string;
};

const NUM = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function KpiCard({
  rotulo,
  valor,
  unidade,
  delta,
  meta,
  estado = "ok",
  procedencia,
  abrir,
  area,
  className,
}: KpiCardProps) {
  const mostraValor = estado === "ok" || estado === "parcial";
  // Sem acesso não abre nada: o destino também estaria fechado.
  const clicavel = !!abrir && (!!abrir.href || !!abrir.onClick) && estado !== "sem-acesso";

  const progresso =
    meta?.progresso ??
    (typeof valor === "number" && typeof meta?.valor === "number" && meta.valor !== 0
      ? valor / meta.valor
      : undefined);

  const conteudo = (
    <>
      {clicavel && (
        <span
          aria-hidden
          className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[var(--filete)] opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}

      <div className="flex min-h-5 items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase leading-5 tracking-wider text-muted-foreground">
          {rotulo}
        </span>
        {estado === "parcial" && <StatusBadge tom="atencao">parcial</StatusBadge>}
        {/* Absoluto para não roubar largura do rótulo enquanto está invisível. */}
        {clicavel && estado !== "parcial" && (
          <span className="absolute right-3 top-3.5 whitespace-nowrap rounded-md bg-card px-1 text-xs font-medium leading-5 text-primary-text opacity-0 transition-opacity duration-[120ms] ease-out group-hover:opacity-100 group-focus-visible:opacity-100">
            {abrir?.rotulo ?? "Abrir registros"} →
          </span>
        )}
      </div>

      <div className="mt-2 flex min-h-9 items-baseline gap-1.5">
        {mostraValor ? (
          <>
            <span className="num text-[30px] font-bold leading-9 tracking-tight text-foreground">
              {valor}
            </span>
            {unidade && (
              <span className="text-sm font-medium text-muted-foreground">{unidade}</span>
            )}
          </>
        ) : (
          <Ausencia estado={estado} />
        )}
      </div>

      {mostraValor && (delta || meta) && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            {delta && <Delta {...delta} />}
            {meta && (
              <span className="num text-muted-foreground">
                {meta.rotulo ?? "meta"} {meta.valor}
                {progresso !== undefined && ` · ${NUM.format(progresso * 100)}%`}
              </span>
            )}
          </div>
          {progresso !== undefined && <BarraMeta progresso={progresso} />}
        </div>
      )}

      {procedencia && (
        // Quebra em até duas linhas em vez de cortar numa só: cortada, a linha
        // mostrava "atualizado em 23…" e escondia justo a data (N3).
        <Procedencia
          fonte={procedencia.fonte}
          atualizadoEm={procedencia.atualizadoEm}
          className="mt-auto items-start pt-3 [&>svg]:mt-px [&>span:last-child]:line-clamp-2"
        />
      )}
    </>
  );

  const base = cn(
    "group relative flex h-full min-w-0 flex-col rounded-xl border bg-card p-4 text-left text-card-foreground",
    className,
  );
  const interativo =
    "cursor-pointer outline-none transition-colors duration-[120ms] ease-out hover:border-input focus-visible:border-input focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
  const estilo = { "--filete": area ? corDaArea(area) : "var(--area-atual, var(--primary))" } as CSSProperties;

  if (clicavel && abrir?.href) {
    if (abrir.href.startsWith("/")) {
      const { to, search } = partesDoLink(abrir.href);
      return (
        <Link
          to={to as never}
          search={search as never}
          onClick={abrir.onClick}
          className={cn(base, interativo)}
          style={estilo}
        >
          {conteudo}
        </Link>
      );
    }
    return (
      <a href={abrir.href} onClick={abrir.onClick} className={cn(base, interativo)} style={estilo}>
        {conteudo}
      </a>
    );
  }
  if (clicavel && abrir?.onClick) {
    return (
      <button type="button" onClick={abrir.onClick} className={cn(base, interativo, "w-full")} style={estilo}>
        {conteudo}
      </button>
    );
  }
  return <div className={base}>{conteudo}</div>;
}

function Delta({
  valor,
  rotulo,
  sentido = "maior-melhor",
}: {
  valor: number;
  rotulo?: string;
  sentido?: "maior-melhor" | "menor-melhor";
}) {
  const direcao = valor > 0 ? "sobe" : valor < 0 ? "desce" : "estavel";
  // A cor vem do sentido do indicador, não da seta: churn que desce é bom.
  const bom = sentido === "maior-melhor" ? valor > 0 : valor < 0;
  const cor = direcao === "estavel" ? "text-muted-foreground" : bom ? "text-success" : "text-danger";
  const sinal = valor > 0 ? "+" : valor < 0 ? "−" : "";
  return (
    <span className={cn("num inline-flex items-center gap-1 font-semibold", cor)}>
      <Degrau sentido={direcao} />
      {sinal}
      {NUM.format(Math.abs(valor))}%
      {rotulo && <span className="font-normal text-muted-foreground">{rotulo}</span>}
    </span>
  );
}

function BarraMeta({ progresso }: { progresso: number }) {
  const pct = Math.max(0, Math.min(1, progresso)) * 100;
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progresso * 100)}
      aria-label="Realizado da meta"
    >
      <div
        className={cn("h-full rounded-full", progresso >= 1 ? "bg-success" : "bg-primary-text")}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const AUSENCIAS = {
  "nao-apurado": { icone: CircleDashed, texto: "não apurado" },
  indisponivel: { icone: Unplug, texto: "fonte indisponível" },
  "sem-acesso": { icone: Lock, texto: "sem acesso" },
} as const;

function Ausencia({ estado }: { estado: Exclude<EstadoKpi, "ok" | "parcial"> }) {
  const { icone: Icone, texto } = AUSENCIAS[estado];
  return (
    <>
      {estado === "sem-acesso" ? (
        <Lock className="size-5 self-center text-muted-foreground" aria-hidden />
      ) : (
        <span className="text-[30px] font-bold leading-9 text-muted-foreground" aria-hidden>
          —
        </span>
      )}
      <span className="inline-flex items-center gap-1 self-center text-[13px] text-muted-foreground">
        {estado !== "sem-acesso" && <Icone className="size-3.5" aria-hidden />}
        {texto}
      </span>
    </>
  );
}

/** Grade de KPIs: 2 colunas no celular, até 6 no desktop (DESIGN.md §9). */
export function KpiGrade({
  children,
  colunas = 4,
  className,
}: {
  children: ReactNode;
  colunas?: 2 | 3 | 4 | 6;
  className?: string;
}) {
  const grade = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    6: "grid-cols-2 md:grid-cols-3 xl:grid-cols-6",
  }[colunas];
  return <div className={cn("grid gap-3", grade, className)}>{children}</div>;
}
