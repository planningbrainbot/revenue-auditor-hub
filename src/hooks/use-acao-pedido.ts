import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useReler } from "@/hooks/use-faturamento";
import { desembrulhar, ErroFaturamento } from "@/lib/faturamento/erros";
import {
  acaoTesourariaFaturamento,
  aprovarPedidoFaturamento,
  atualizarStatusFaturamento,
  cancelarPedidoFaturamento,
  devolverPedidoFaturamento,
  reenviarPedidoFaturamento,
} from "@/lib/faturamento/faturamento.functions";
import type { AcaoExecutavel, AlvoPedido } from "@/lib/faturamento/ficha";
import { diaEHora } from "@/lib/faturamento/formato";

// As ações do ciclo de vida do pedido (Ficha e Fila da tesouraria). Quem pode é o banco; isto só chama a
// RPC certa, diz o resultado num toast e relê a área.

/** Uma mutation só para todas as ações: `variables.acao` diz qual está em curso ("Enviando…"). */
export function useAcaoPedido(aoConcluir?: (acao: AcaoExecutavel) => void) {
  const reler = useReler();
  const aprovar = useServerFn(aprovarPedidoFaturamento);
  const devolver = useServerFn(devolverPedidoFaturamento);
  const reenviar = useServerFn(reenviarPedidoFaturamento);
  const tesouraria = useServerFn(acaoTesourariaFaturamento);
  const cancelar = useServerFn(cancelarPedidoFaturamento);
  const atualizar = useServerFn(atualizarStatusFaturamento);

  return useMutation({
    mutationFn: async ({
      acao,
      alvo,
      motivo,
    }: {
      acao: AcaoExecutavel;
      alvo: AlvoPedido;
      motivo?: string;
    }) => {
      const id = alvo.id;
      switch (acao) {
        case "aprovar": {
          const r = desembrulhar(await aprovar({ data: { id } }));
          return r.simulacao_emissora
            ? "OK dado. Simulação: nada vai ao Omie."
            : `OK dado. Vai ao Omie da ${alvo.apelido}.`;
        }
        case "devolver": {
          // Antes do OK devolve o dono (fat_pedido_devolver); depois do Omie, a tesouraria (fat_tesouraria_acao).
          const r =
            alvo.status === "aguardando_ok"
              ? desembrulhar(await devolver({ data: { id, motivo: motivo ?? "" } }))
              : desembrulhar(
                  await tesouraria({ data: { id, acao: "devolver", motivo: motivo ?? "" } }),
                );
          return `Devolvido a ${r.devolvido_a?.nome ?? alvo.autor ?? "quem escreveu o pedido"}.`;
        }
        case "reenviar":
          desembrulhar(await reenviar({ data: { id } }));
          return `Reenviado: ${alvo.numero} voltou para a fila do Omie.`;
        case "conferir":
          desembrulhar(await tesouraria({ data: { id, acao: "em_conferencia" } }));
          return `${alvo.numero} em conferência.`;
        case "faturar":
          desembrulhar(await tesouraria({ data: { id, acao: "faturar" } }));
          return alvo.simulacao
            ? `Faturando ${alvo.numero} em simulação: nada é emitido no Omie.`
            : `Faturando ${alvo.numero}: a nota sai quando o Omie responder.`;
        case "pedir_cancelamento":
          desembrulhar(await cancelar({ data: { id, motivo: motivo ?? "" } }));
          return "Cancelamento pedido. A tesouraria cancela no Omie e confirma aqui.";
        case "confirmar_cancelamento":
          desembrulhar(await cancelar({ data: { id, motivo: null } }));
          return `${alvo.numero} cancelado.`;
        case "atualizar_status": {
          const r = desembrulhar(await atualizar({ data: { id } }));
          const quando = r.tentar_em ? diaEHora(r.tentar_em) : null;
          return r.enfileirado
            ? `Leitura pedida${quando ? `: o Omie é lido em ${quando}` : ""}.`
            : `Já havia uma leitura na fila${quando ? ` (${quando})` : ""}.`;
        }
      }
    },
    onSuccess: (mensagem, { acao }) => {
      toast.success(mensagem);
      void reler();
      aoConcluir?.(acao);
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "A ação não foi feita.");
      // A situação mudou: relê para os botões dizerem a verdade.
      if (e instanceof ErroFaturamento && e.tipo === "transicao") void reler();
    },
  });
}
