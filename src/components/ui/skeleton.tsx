import { cn } from "@/lib/utils";

// Brilho que atravessa o bloco (`.skeleton-shimmer` em styles.css): carregando
// tem cara de carregando, e não de caixa vazia (N4). Parado em reduced-motion.
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("skeleton-shimmer relative overflow-hidden rounded-md bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
