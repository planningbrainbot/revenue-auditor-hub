import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * Selo não é botão: não reage a hover. Os tons de status (sucesso, atencao,
 * perigo, info, neutro) usam o fundo *-soft com o texto do tom, que passa
 * 4,5:1 nos dois temas (styles.css). Status de negócio vai com ícone + palavra
 * — prefira `StatusBadge` de components/planning, que monta isso por cima.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm border px-2 py-0.5 text-xs font-semibold leading-4 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "border-input text-foreground",
        sucesso: "border-transparent bg-success-soft text-success",
        atencao: "border-transparent bg-warning-soft text-warning",
        perigo: "border-transparent bg-danger-soft text-danger",
        info: "border-transparent bg-info-soft text-info",
        neutro: "border-transparent bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
