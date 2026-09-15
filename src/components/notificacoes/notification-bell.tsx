import { Bell } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useNavigate } from "@tanstack/react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useMarcarNotificacaoLida,
  useMarcarTodasNotificacoesLidas,
  useNotificacoes,
} from "@/hooks/use-notificacoes";
import type { Notificacao } from "@/lib/notificacoes.functions";

export function NotificationBell() {
  const { isAdmin } = usePermissions();
  const { data } = useNotificacoes();
  const marcarLida = useMarcarNotificacaoLida();
  const marcarTodas = useMarcarTodasNotificacoesLidas();
  const navigate = useNavigate();

  if (!isAdmin) return null;

  const notificacoes = data?.notificacoes ?? [];
  const naoLidas = data?.naoLidas ?? 0;

  function handleClickNotificacao(n: Notificacao) {
    if (!n.lida) marcarLida.mutate(n.id);
    navigate({ to: "/unidades" });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="relative rounded-full border border-border bg-background p-1.5 text-foreground transition hover:bg-accent"
          aria-label="Notificações"
        >
          <Bell className="h-4 w-4" />
          {naoLidas > 0 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white">
              {naoLidas > 9 ? "9+" : naoLidas}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0 text-sm">Notificações</DropdownMenuLabel>
          {naoLidas > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => marcarTodas.mutate()}
            >
              Marcar todas como lidas
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {notificacoes.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">
            Nenhuma notificação ainda.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            {notificacoes.map((n) => (
              <DropdownMenuItem
                key={n.id}
                onSelect={() => handleClickNotificacao(n)}
                className="flex flex-col items-start gap-0.5 whitespace-normal py-2"
              >
                <div className="flex w-full items-center gap-1.5">
                  {!n.lida && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-600" />}
                  <span
                    className={`text-xs font-medium ${n.lida ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {n.titulo}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{n.mensagem}</p>
                <span className="text-[10px] text-muted-foreground">
                  {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
