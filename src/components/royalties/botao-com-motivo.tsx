import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Botão desabilitado que diz por quê (N8). Botão `disabled` não recebe foco
 * nem hover, então quem faz o papel de botão é o invólucro: focável,
 * `role="button"` com `aria-disabled`, e o nome acessível leva o rótulo E o
 * motivo ("Fechar apuração, indisponível: …"). O `<Button>` de dentro é só
 * desenho (fora da árvore de acessibilidade); o motivo também aparece em
 * tooltip para quem usa o mouse.
 */
export function BotaoComMotivo({
  rotulo,
  motivo,
  icone,
  variant = "default",
  size,
  className,
}: {
  rotulo: string;
  motivo: string;
  icone?: ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive" | "secondary";
  size?: "default" | "sm";
  className?: string;
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            aria-disabled="true"
            aria-label={`${rotulo}, indisponível: ${motivo}`}
            className={cn(
              "inline-flex cursor-not-allowed rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
              {icone}
              {rotulo}
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">{motivo}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
