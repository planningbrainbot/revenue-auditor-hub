// Seletor de seção das três telas com duas bases (16/10/2026, pedido do Pedro): Operação diária, Pré-venda e Forecast.
// Base antiga = pipe 39 (pré-venda com cadência), como sempre foi; Base nova = pipe 40 (Onboarding | Diagnóstico de
// Oportunidades). A seção vai para a URL (`base=nova`, N7); a antiga é o padrão e não vai.
import type { BuscaMonetizacao } from "./busca";
import { Segmentado } from "./pre-venda-comum";

export function SeletorBase({
  busca,
  mudarBusca,
}: {
  busca: BuscaMonetizacao;
  mudarBusca: (patch: Partial<BuscaMonetizacao>) => void;
}) {
  return (
    <Segmentado
      rotulo="Base"
      opcoes={[
        { chave: "antiga", rotulo: "Base antiga · pipe 39" },
        { chave: "nova", rotulo: "Base nova · pipe 40" },
      ]}
      valor={busca.base === "nova" ? "nova" : "antiga"}
      // Trocar de base limpa o que é só de uma delas: pessoa e card (nova), pré-vendedor, produto e unidade (antiga).
      mudar={(v) =>
        mudarBusca({
          base: v === "nova" ? "nova" : undefined,
          pessoa: undefined,
          card: undefined,
          responsavel: undefined,
          produto: undefined,
          unidade: undefined,
          regime: undefined,
          ligacao: undefined,
          falta: undefined,
          antipadrao: undefined,
          ficha: undefined,
          atencao: undefined,
          grafico: undefined,
        })
      }
    />
  );
}
