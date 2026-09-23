import type { ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Faixa dos filtros da tela. O estado de cada filtro mora na URL
 * (`useFiltroNaUrl`, N7); a barra só dá a moldura e o "Limpar", que aparece
 * quando quem usa passa `aoLimpar` (normalmente: quando há filtro ativo).
 */
export function BarraFiltros({
  children,
  aoLimpar,
  className,
}: {
  children: ReactNode;
  aoLimpar?: () => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Filtros"
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2",
        className,
      )}
    >
      <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      {children}
      {aoLimpar && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={aoLimpar}
          className="ml-auto text-muted-foreground"
        >
          <X className="size-4" aria-hidden />
          Limpar filtros
        </Button>
      )}
    </div>
  );
}

/** Filtro aplicado, removível com um clique. */
export function ChipFiltro({
  rotulo,
  valor,
  aoRemover,
}: {
  rotulo: string;
  valor: ReactNode;
  aoRemover: () => void;
}) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-full border bg-muted pl-2.5 pr-1 text-[13px]">
      <span className="text-muted-foreground">{rotulo}:</span>
      <span className="font-medium">{valor}</span>
      <button
        type="button"
        onClick={aoRemover}
        aria-label={`Remover filtro ${rotulo}`}
        className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors duration-[120ms] hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
