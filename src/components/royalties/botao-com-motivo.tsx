import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Botão desabilitado que diz por quê (N8). Botão `disabled` não recebe foco
 * nem hover, então o motivo mora num invólucro focável com tooltip e
 * `aria-label`: quem navega por teclado ouve o motivo, quem passa o mouse lê.
 */
export function BotaoComMotivo({
  motivo,
  children,
  variant = "default",
  size,
  className,
}: {
  motivo: string;
  children: ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={`Indisponível: ${motivo}`}
            className={cn(
              "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              className,
            )}
          >
            <Button
              type="button"
              variant={variant}
              size={size}
              disabled
              tabIndex={-1}
              aria-hidden
              className="pointer-events-none w-full gap-2"
            >
              {children}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{motivo}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
