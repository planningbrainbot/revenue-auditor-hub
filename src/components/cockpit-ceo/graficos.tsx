import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { FOCO_VISIVEL } from "@/components/planning";
import { HACHURA_ID, tooltipProps } from "@/lib/planning/grafico";
import type { Estado } from "@/lib/cockpit-ceo/contrato";
import { ESTADOS } from "@/lib/cockpit-ceo/contrato";
import type { SemDado } from "@/lib/cockpit-ceo/visual";
import { cn } from "@/lib/utils";

// Peças dos gráficos do Cockpit do CEO (revisão visual de 28/09/2026).
//
// - `Bloco`: cartão de um gráfico. Título de uma linha, número em destaque e o gráfico. Clicar em
//   qualquer ponto do cartão abre a gaveta; o título é o botão, para o teclado (foco visível, V12).
//   Nenhum parágrafo mora aqui: explicação é da gaveta.
// - `Dica`: tooltip com número, período e universo, lido do próprio ponto (`dica`).
// - `DefsHachura` + `SemDadoGrafico`: ausência desenhada como textura com rótulo, nunca como zero.

export interface DicaDado {
  titulo: string;
  linhas: [string, string][];
  periodo?: string;
  universo?: string;
}

/** Conteúdo do Tooltip do Recharts a partir de `payload[0].payload.dica`. */
export function Dica({
  active,
  payload,
}: {
  active?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any[];
}) {
  const d: DicaDado | undefined = payload?.[0]?.payload?.dica;
  if (!active || !d) return null;
  return (
    <div style={tooltipProps.contentStyle} className="max-w-72 space-y-1 px-3 py-2">
      <p className="font-semibold text-foreground">{d.titulo}</p>
      {d.linhas.map(([r, v]) => (
        <p key={r} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{r}</span>
          <span className="num font-medium text-foreground">{v}</span>
        </p>
      ))}
      {(d.periodo || d.universo) && (
        <p className="border-t pt-1 text-muted-foreground">
          {[d.periodo, d.universo].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}

/** O padrão de hachura, uma vez por página: os gráficos referenciam `url(#planning-hachura)`. */
export function DefsHachura() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <pattern
          id={HACHURA_ID}
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="6" stroke="var(--muted-foreground)" strokeWidth="1.5" />
        </pattern>
      </defs>
    </svg>
  );
}

/** Área hachurada com o estado e o motivo em uma linha: o gráfico que não tem número. */
export function SemDadoGrafico({
  estado,
  motivo,
  altura = "h-40",
}: {
  estado: Estado;
  motivo: string;
  altura?: string;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden rounded-lg border border-dashed",
        altura,
      )}
    >
      <svg aria-hidden className="absolute inset-0 h-full w-full opacity-25">
        <rect width="100%" height="100%" fill={`url(#${HACHURA_ID})`} />
      </svg>
      <p
        className="relative max-w-[90%] truncate rounded bg-card px-2 py-1 text-[13px]"
        title={motivo}
      >
        <span className="font-medium">{ESTADOS[estado]}</span>
        <span className="text-muted-foreground"> · {motivo}</span>
      </p>
    </div>
  );
}

export const ehSemDado = (x: object): x is SemDado =>
  "motivo" in x && "estado" in x && Object.keys(x).length === 2;

/**
 * Cartão de um gráfico. `abrir` abre a gaveta; o cartão inteiro responde ao clique, e o título é o
 * botão que o teclado alcança.
 */
export function Bloco({
  titulo,
  numero,
  complemento,
  selo,
  abrir,
  children,
  className,
  rotulo,
}: {
  titulo: string;
  /** O número principal, em destaque. */
  numero?: ReactNode;
  /** Uma palavra ao lado do número ("por mês", "em aberto"). */
  complemento?: ReactNode;
  selo?: ReactNode;
  abrir: () => void;
  children?: ReactNode;
  className?: string;
  /** Texto do botão para leitor de tela, quando o título sozinho não basta. */
  rotulo?: string;
}) {
  const teclado = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      abrir();
    }
  };
  // Clique em controle de dentro (botão de destino, <details>, exportar) não abre a gaveta.
  const clique = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest("button, a, summary, input, select, label")) return;
    abrir();
  };
  return (
    <section
      onClick={clique}
      onKeyDown={teclado}
      className={cn(
        "group flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-4 transition-colors duration-[120ms] hover:border-input",
        className,
      )}
    >
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="min-w-0">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                abrir();
              }}
              aria-label={rotulo ?? `${titulo}: abrir explicação`}
              className={cn(
                "flex max-w-full items-center gap-1 text-left text-[15px] font-semibold",
                FOCO_VISIVEL,
              )}
            >
              <span className="truncate">{titulo}</span>
              <ChevronRight
                className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </button>
          </h2>
          {numero !== undefined && (
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="num text-3xl font-bold leading-tight">{numero}</span>
              {complemento && (
                <span className="text-[13px] text-muted-foreground">{complemento}</span>
              )}
            </p>
          )}
        </div>
        {selo && <div className="shrink-0">{selo}</div>}
      </header>
      {children && <div className="min-w-0 flex-1">{children}</div>}
    </section>
  );
}

/** Legenda manual (duas ou mais séries), com traço para série tracejada. */
export function Legenda({
  itens,
}: {
  itens: { rotulo: string; cor: string; forma?: "ponto" | "traco" | "tracejado" | "hachura" }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {itens.map((i) => (
        <li key={i.rotulo} className="flex items-center gap-1.5">
          <svg aria-hidden width="16" height="8">
            {i.forma === "hachura" ? (
              <rect width="16" height="8" rx="2" fill={`url(#${HACHURA_ID})`} stroke={i.cor} />
            ) : i.forma === "traco" || i.forma === "tracejado" ? (
              <line
                x1="0"
                y1="4"
                x2="16"
                y2="4"
                stroke={i.cor}
                strokeWidth="2"
                strokeDasharray={i.forma === "tracejado" ? "4 3" : undefined}
              />
            ) : (
              <circle cx="8" cy="4" r="4" fill={i.cor} />
            )}
          </svg>
          {i.rotulo}
        </li>
      ))}
    </ul>
  );
}
