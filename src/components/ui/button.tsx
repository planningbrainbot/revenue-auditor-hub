import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/*
 * `default` é A ação principal da tela ou do bloco (DESIGN §8): verde da marca
 * com texto #04110b. O resto é `outline`, `ghost` ou `link`. Foco em anel de
 * 2px com offset, visível só no teclado; controle com no mínimo 32px de altura.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-[background-color,border-color,color,box-shadow,translate] duration-120 ease-planning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary font-semibold text-primary-foreground hover:-translate-y-px hover:bg-[color-mix(in_oklab,var(--primary),white_14%)] hover:shadow-md hover:shadow-primary/25 active:translate-y-0 active:bg-primary active:shadow-none",
        destructive:
          "bg-destructive font-semibold text-destructive-foreground hover:bg-[color-mix(in_oklab,var(--destructive),black_10%)] active:bg-destructive",
        outline:
          "border border-input bg-transparent text-foreground hover:border-primary-text hover:text-primary-text",
        secondary:
          "border border-border bg-surface-elevated text-foreground hover:border-input hover:bg-muted",
        ghost: "text-foreground hover:bg-muted",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-[13px]",
        lg: "h-10 rounded-md px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
