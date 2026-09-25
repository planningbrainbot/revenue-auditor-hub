import type { CSSProperties, ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { areaDoCaminho } from "@/lib/areas";
import { corDaArea, iconeDaArea, nomeDaArea, slugVisual } from "@/lib/planning/cores-area";
import { BarraFiltros } from "./barra-filtros";
import { AnelArea, Filete, GradeCirculos } from "./grafismos";
import { Procedencia } from "./procedencia";

/**
 * Cabeçalho único de página (substitui os ~30 cabeçalhos em 9 estilos).
 *
 * O `<h1>` é a pergunta que a tela responde (N1); o nome curto da tela sobe
 * para o eyebrow, ao lado da área. Sem pergunta, o nome curto é o `<h1>` e a
 * tela ainda não está "pronta" (TODO do dono do módulo).
 *
 * A área sai da rota (`areaDoCaminho`) quando não vem por prop, e vira
 * `--area-atual` no container: filete, anel e KpiCard filhos pegam a cor
 * sem ninguém repetir o slug.
 */
export function PageHeader({
  area,
  titulo,
  pergunta,
  descricao,
  procedencia,
  acoes,
  filtros,
  children,
  className,
}: {
  area?: string;
  titulo: string;
  pergunta?: string;
  /** Universo medido: perímetro · período · unidade de contagem. */
  descricao?: ReactNode;
  procedencia?: { fonte: string; atualizadoEm?: string | Date | null; regua?: string };
  acoes?: ReactNode;
  filtros?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const slug = slugVisual(area ?? areaDoCaminho(pathname));
  const nomeArea = nomeDaArea(slug);
  const Icone = iconeDaArea(slug);
  const cor = corDaArea(slug);

  const temEyebrow = !!nomeArea || !!pergunta;

  return (
    <header
      className={cn("relative isolate space-y-4 border-b pb-5", className)}
      style={{ "--area-atual": slug ? cor : "var(--primary)" } as CSSProperties}
    >
      {slug && (
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[45%] max-w-md">
          <GradeCirculos esmaecer="esquerda" style={{ color: cor, opacity: 0.08 }} />
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3">
        <div className="min-w-[min(100%,26rem)] max-w-3xl flex-1 space-y-2">
          {temEyebrow && (
            <div className="flex min-h-6 items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {slug && Icone && <AnelArea area={slug} icone={Icone} tamanho="sm" />}
              {nomeArea && <span>{nomeArea}</span>}
              {nomeArea && pergunta && <Filete className="h-3.5" />}
              {pergunta && <span className="normal-case tracking-normal text-[13px] font-medium">{titulo}</span>}
            </div>
          )}
          <h1 className="text-balance text-2xl font-bold leading-tight tracking-tight text-foreground">
            {pergunta ?? titulo}
          </h1>
          {descricao && <p className="text-sm text-muted-foreground">{descricao}</p>}
        </div>

        {(procedencia || acoes) && (
          <div className="flex min-w-0 max-w-md flex-col items-end gap-3">
            {procedencia && <Procedencia {...procedencia} className="justify-end text-right" />}
            {acoes && <div className="flex flex-wrap items-center justify-end gap-2">{acoes}</div>}
          </div>
        )}
      </div>

      {filtros && <BarraFiltros>{filtros}</BarraFiltros>}
      {children}
    </header>
  );
}

/** Bloco da página. O título é uma pergunta (DESIGN.md §2.4: 16/600). */
export function Secao({
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
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-base font-semibold text-foreground">{titulo}</h2>
          {descricao && <p className="text-[13px] text-muted-foreground">{descricao}</p>}
        </div>
        {acoes && <div className="flex items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </section>
  );
}
