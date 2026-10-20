import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import type { AssistenteServico } from "@/components/faturamento/novo-pedido";
import {
  conferirDescricao,
  estadoJevFaturamento,
  sugerirServico,
} from "@/lib/faturamento/jev.functions";

// O assistente do Novo pedido (T5): sugestão de serviço e aviso de descrição, pelo Jev. Só existe quando o
// servidor diz que está ligado (FATURAMENTO_JEV=1); sem isso, o hook devolve `undefined` e o botão e o aviso
// não aparecem (contrato: "não é falta de permissão, então não aparece desabilitado").

export function useAssistenteServico(): AssistenteServico | undefined {
  const { user } = useAuth();
  const estadoFn = useServerFn(estadoJevFaturamento);
  const sugerirFn = useServerFn(sugerirServico);
  const conferirFn = useServerFn(conferirDescricao);
  const estado = useQuery({
    queryKey: ["faturamento", "jev", user?.id],
    enabled: !!user?.id,
    queryFn: () => estadoFn(),
    staleTime: 10 * 60_000,
    retry: false,
  });
  const ligado = !!estado.data?.ligado;

  return useMemo<AssistenteServico | undefined>(() => {
    if (!ligado) return undefined;
    return {
      async sugerir(e) {
        const r = await sugerirFn({
          data: {
            emissora: e.emissoraId,
            projeto: e.projeto,
            descricao: e.descricao,
            valor: e.valor,
            nomeCliente: e.nomeCliente,
          },
        });
        // Tempo esgotado, falha ou desligado: a tela diz "Não deu para sugerir agora" e segue.
        if (!r.ok || r.dados.estado !== "ok") throw new Error("sem sugestão");
        const s = r.dados.sugestao;
        return { servicoId: s?.servicoId ?? null, confianca: s?.confianca ?? null };
      },
      async conferirDescricao(e) {
        const r = await conferirFn({
          data: {
            emissora: e.emissoraId,
            servico: e.servicoId,
            descricao: e.descricao,
            valor: e.valor,
            nomeCliente: e.nomeCliente,
          },
        });
        // Só avisa com "não combina" e confiança ≥ 0,7; qualquer falha não mostra nada.
        return !(r.ok && r.dados.estado === "ok" && r.dados.conferencia?.avisar);
      },
    };
  }, [ligado, sugerirFn, conferirFn]);
}
