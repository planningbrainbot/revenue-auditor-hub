import * as React from "react";

import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * Card que abre algo (drill-down, ficha, sheet). No hover a borda vai para
   * `input` e acende o filete de 3px na cor da área (spec §2.5): o card DIZ que
   * abre. Card sem `interativo` não reage a hover — nem sombra, nem cursor.
   * A área vem de `--area-atual`, definida pela casca; fora dela, verde.
   *
   * Só dá o VISUAL (cursor, filete, anel de foco). O Card continua `<div>`,
   * sem `tabIndex` nem `role`: sozinho não recebe foco nem responde a Enter.
   * Quem usa `interativo` tem de dar o comportamento: envolver num `<Link>` /
   * `<a>` / `<button>` (aí o foco é do envoltório, e o anel do card só acende
   * se o envoltório repassar `focus-visible`), ou passar `role="button"`,
   * `tabIndex={0}`, `onClick` e `onKeyDown` para Enter/Espaço. Não há
   * `asChild` aqui. Para card de número, prefira o `KpiCard` com `abrir`, que
   * já vira link ou botão.
   */
  interativo?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interativo = false, ...props }, ref) => (
    <div
      ref={ref}
      data-interativo={interativo || undefined}
      className={cn(
        "rounded-xl border bg-card text-card-foreground",
        interativo &&
          "relative cursor-pointer transition-[border-color] duration-120 ease-planning before:pointer-events-none before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-[var(--area-atual,var(--primary))] before:opacity-0 before:transition-opacity before:duration-120 hover:border-input hover:before:opacity-100 focus-visible:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:before:opacity-100",
        className,
      )}
      {...props}
    />
  ),
);
Card.displayName = "Card";

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex flex-col gap-1 p-4", className)} {...props} />
  ),
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("text-base font-semibold leading-snug tracking-tight", className)}
      {...props}
    />
  ),
);
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("text-[13px] text-muted-foreground", className)} {...props} />
  ),
);
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("p-4 pt-0", className)} {...props} />
  ),
);
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center p-4 pt-0", className)} {...props} />
  ),
);
CardFooter.displayName = "CardFooter";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
