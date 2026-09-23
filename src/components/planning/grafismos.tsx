import { useId, type CSSProperties } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { corDaArea } from "@/lib/planning/cores-area";

/**
 * Os grafismos de apoio do manual da marca, traduzidos para a interface
 * (spec §2.2, DESIGN.md §6): degrau, anel de área, grade de círculos e filete.
 * Dão identidade nos detalhes, sem tirar área de dado. Cor sempre por token.
 */

/**
 * Seta em degrau do manual: reta curta, sobe um degrau, segue em diagonal até
 * a ponta. É o ícone de tendência do delta de KPI, no lugar da seta genérica.
 * A cor vem de fora (`className`), porque quem decide se subir é bom é o
 * sentido do indicador, não o desenho.
 */
export function Degrau({
  sentido,
  className,
}: {
  sentido: "sobe" | "desce" | "estavel";
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("size-4 shrink-0", className)}
    >
      {sentido === "estavel" ? (
        <>
          <path d="M1.5 8h12" />
          <path d="M10.5 5l3 3-3 3" />
        </>
      ) : (
        // "desce" é o espelho vertical do mesmo desenho.
        <g transform={sentido === "desce" ? "matrix(1 0 0 -1 0 16)" : undefined}>
          <path d="M1.5 13.5H5V10h2.5l6-6" />
          <path d="M9.25 4h4.25v4.25" />
        </g>
      )}
    </svg>
  );
}

/**
 * Anel grosso na cor da área com o ícone dentro: o glifo da área no seletor,
 * no eyebrow do cabeçalho e na porta de entrada. Nunca em tabela nem como
 * ícone de status.
 */
export function AnelArea({
  area,
  icone: Icone,
  tamanho = "md",
  className,
}: {
  area: string;
  icone: LucideIcon;
  tamanho?: "sm" | "md";
  className?: string;
}) {
  const cor = corDaArea(area);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border-[2.5px]",
        tamanho === "sm" ? "size-6" : "size-8",
        className,
      )}
      style={{ borderColor: cor, color: cor }}
    >
      <Icone
        className={tamanho === "sm" ? "size-3" : "size-4"}
        strokeWidth={tamanho === "sm" ? 2.25 : 2}
      />
    </span>
  );
}

/**
 * Grade de círculos de contorno, como os patterns do manual. Textura de fundo
 * a ~7% de opacidade em estado vazio e na faixa do cabeçalho. Nunca atrás de
 * número, tabela ou gráfico (V14). Posição e cor vêm do `className`
 * (`absolute …`, `text-…`); `esmaecer` apaga a borda para a textura não
 * terminar num corte seco.
 */
export function GradeCirculos({
  className,
  esmaecer,
  style,
}: {
  className?: string;
  esmaecer?: "esquerda" | "radial";
  style?: CSSProperties;
}) {
  const id = useId().replace(/:/g, "");
  const padrao = `gc-p-${id}`;
  const mascara = `gc-m-${id}`;
  const degrade = `gc-g-${id}`;
  return (
    <svg
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 h-full w-full", className)}
      style={{ opacity: 0.07, ...style }}
    >
      <defs>
        <pattern id={padrao} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="7" cy="7" r="6" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
        {esmaecer === "esquerda" && (
          <linearGradient id={degrade} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="white" stopOpacity="0" />
            <stop offset="0.7" stopColor="white" stopOpacity="1" />
          </linearGradient>
        )}
        {esmaecer === "radial" && (
          <radialGradient id={degrade} cx="0.5" cy="0.5" r="0.6">
            <stop offset="0" stopColor="white" stopOpacity="1" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
        )}
        {esmaecer && (
          <mask id={mascara}>
            <rect width="100%" height="100%" fill={`url(#${degrade})`} />
          </mask>
        )}
      </defs>
      <rect
        width="100%"
        height="100%"
        fill={`url(#${padrao})`}
        mask={esmaecer ? `url(#${mascara})` : undefined}
      />
    </svg>
  );
}

/**
 * Filete vertical de 3px na cor da área. Sem `area`, usa a `--area-atual` que
 * a casca ou o `PageHeader` definem; sem nenhuma, o verde da marca.
 */
export function Filete({ area, className }: { area?: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block w-[3px] shrink-0 rounded-full", className)}
      style={{
        backgroundColor: area ? corDaArea(area) : "var(--area-atual, var(--primary))",
      }}
    />
  );
}
