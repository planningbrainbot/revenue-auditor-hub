import { useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePermissions } from "@/hooks/use-permissions";
import { cn } from "@/lib/utils";

/**
 * "Forçar atualização" das duas abas. O servidor (`assertAdmin`) recusa quem
 * não é admin; antes o botão aparecia para todos e só falhava no clique. Agora
 * fica desabilitado com o motivo à vista (N8), em vez de escondido.
 */
export function BotaoAtualizarPipefy({
  atualizando,
  onClick,
}: {
  atualizando: boolean;
  onClick: () => void;
}) {
  const { isAdmin, loading } = usePermissions();
  const bloqueado = !loading && !isAdmin;
  const idMotivo = useId();

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {bloqueado && (
        <span id={idMotivo} className="text-[13px] text-muted-foreground">
          Só admin atualiza o Pipefy
        </span>
      )}
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={atualizando || loading || bloqueado}
        aria-describedby={bloqueado ? idMotivo : undefined}
        onClick={onClick}
      >
        <RefreshCw className={cn("size-4", atualizando && "animate-spin")} aria-hidden />
        Forçar atualização
      </Button>
    </div>
  );
}
