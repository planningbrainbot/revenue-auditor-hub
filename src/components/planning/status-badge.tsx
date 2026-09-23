import type { ReactNode } from "react";
import {
  CircleCheck,
  Info,
  Minus,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Selo de status de NEGÓCIO: sempre ícone + palavra, nunca cor sozinha
 * (DESIGN.md §4). Cinco tons, e só cinco. Estado do DADO (parcial, não
 * apurado, sem acesso) não é status de negócio: vai no `KpiCard.estado`.
 */
export type TomStatus = "sucesso" | "atencao" | "perigo" | "info" | "neutro";

const CLASSES: Record<TomStatus, string> = {
  sucesso: "bg-success-soft text-success",
  atencao: "bg-warning-soft text-warning",
  perigo: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  neutro: "bg-muted text-muted-foreground",
};

const ICONES: Record<TomStatus, LucideIcon> = {
  sucesso: CircleCheck,
  atencao: TriangleAlert,
  perigo: OctagonAlert,
  info: Info,
  neutro: Minus,
};

export function StatusBadge({
  tom,
  children,
  icone,
  className,
}: {
  tom: TomStatus;
  children: ReactNode;
  /** Troca o ícone padrão do tom; `false` tira (só quando a palavra basta sozinha). */
  icone?: LucideIcon | false;
  className?: string;
}) {
  const Icone = icone === false ? null : (icone ?? ICONES[tom]);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium leading-5",
        CLASSES[tom],
        className,
      )}
    >
      {Icone && <Icone className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />}
      {children}
    </span>
  );
}
