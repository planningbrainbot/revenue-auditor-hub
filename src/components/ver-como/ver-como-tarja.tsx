import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/use-permissions";
import { encerrarVerComo } from "@/lib/ver-como.functions";

/**
 * A tarja de quem está simulando uma unidade.
 *
 * Existe por um motivo só, e é o mais importante da feature: com metade do
 * menu escondido e os números caindo para os de uma praça, a tela da simulação
 * é indistinguível de uma perda de acesso. Sem a tarja, o caminho de volta é
 * deslogar — e o primeiro reflexo de quem esquece a simulação ligada é abrir
 * um chamado dizendo que o sistema quebrou.
 *
 * Fica FORA do recorte simulado de propósito: ela pergunta ao servidor pela
 * simulação, não pelas permissões do sócio, então continua aparecendo mesmo
 * quando o papel vestido não alcança nada.
 */
export function VerComoTarja() {
  const { verComo } = usePermissions();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const encerrarFn = useServerFn(encerrarVerComo);

  const sair = useMutation({
    mutationFn: () => encerrarFn(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["my-perms"] });
      toast.success("Você voltou para a sua visão.");
      // Volta para a porta de entrada: a página em que a pessoa estava pode ser
      // do menu do sócio, e sair da simulação nela deixaria um endereço aberto
      // que o menu já não oferece.
      navigate({ to: "/inicio" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!verComo?.ativo) return null;

  return (
    <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-1.5 text-xs text-warning">
      <Eye className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">
        Você está vendo como o sócio de <strong>{verComo.unidade}</strong>. As telas mostram só essa
        unidade.
      </span>
      <button
        type="button"
        disabled={sair.isPending}
        onClick={() => sair.mutate()}
        className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 font-medium transition hover:bg-warning/20 disabled:opacity-50"
      >
        {sair.isPending ? "Saindo…" : "Sair da visão"}
      </button>
    </div>
  );
}
