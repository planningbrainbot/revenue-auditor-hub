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

/**
 * Uma mutation só para todas as ações: `variables.acao` diz qual está em curso ("Enviando…").
 * `aoRecusar` roda quando o banco recusa porque a situação mudou (55000), por exemplo pedir o cancelamento
 * com o faturamento em curso: quem chama fecha o diálogo, e o `toast` diz a frase do banco.
 */
export function useAcaoPedido(
  aoConcluir?: (acao: AcaoExecutavel) => void,
  aoRecusar?: (acao: AcaoExecutavel) => void,
) {
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
        case "reenviar_pipefy": {
          const r = desembrulhar(await tesouraria({ data: { id, acao: "reenviar_pipefy" } }));
          return r.reenfileirados === 0
            ? `Nada do Pipefy de ${alvo.numero} estava em erro.`
            : `O card de ${alvo.numero} voltou para a fila do Pipefy.`;
        }
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
    // O botão só volta depois da releitura: antes dela, a tela ainda mostraria a ação na situação antiga, e um
    // segundo clique daria 55000 (revisão de 20/10/2026).
    onSuccess: async (mensagem, { acao }) => {
      toast.success(mensagem);
      await reler();
      aoConcluir?.(acao);
    },
    onError: (e, { acao }) => {
      toast.error(e instanceof Error ? e.message : "A ação não foi feita.");
      // A situação mudou: relê para os botões dizerem a verdade, e o diálogo aberto fecha.
      if (e instanceof ErroFaturamento && e.tipo === "transicao") {
        void reler();
        aoRecusar?.(acao);
      }
    },
  });
}
