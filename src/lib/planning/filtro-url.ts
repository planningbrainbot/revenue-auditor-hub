import { useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";

/**
 * Filtro, período, perímetro e aba moram na URL (NAVEGACAO.md N7).
 *
 * Recarregar ou compartilhar o link tem que reproduzir a tela. Em 17 telas a
 * aba vivia em `useState` e voltava para a primeira ao recarregar; este hook é
 * o caminho curto para não repetir isso.
 *
 * Funciona em qualquer rota, com ou sem `validateSearch`: lê o search sem
 * `strict` e grava com `replace` (trocar filtro não empilha histórico, o
 * "voltar" continua levando para a tela anterior). Ressalva: se a rota tiver
 * `validateSearch` que devolve só as chaves que conhece, a chave nova é
 * descartada na validação; a rota precisa repassar o resto (`...search`) ou
 * declarar a chave.
 *
 * O valor igual ao padrão sai da URL, para o link "limpo" continuar sendo o
 * link da tela sem filtro.
 */
type ValorFiltro = string | number | boolean | string[];

// `useFiltroNaUrl("aba", "resumo")` devolve `string`, não o literal "resumo":
// o valor da URL pode ser qualquer outra aba.
type Largo<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : string[];

export function useFiltroNaUrl<T extends ValorFiltro>(
  chave: string,
  padrao: T,
): [Largo<T>, (valor: Largo<T> | undefined) => void] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useNavigate();

  const valor = coagir(search[chave], padrao) as unknown as Largo<T>;

  const definir = useCallback(
    (novo: Largo<T> | undefined) => {
      const vazio =
        novo === undefined ||
        novo === "" ||
        (Array.isArray(novo) && novo.length === 0) ||
        JSON.stringify(novo) === JSON.stringify(padrao);
      void navigate({
        to: ".",
        search: ((prev: Record<string, unknown>) => ({
          ...prev,
          [chave]: vazio ? undefined : novo,
        })) as never,
        replace: true,
        resetScroll: false,
      });
    },
    [chave, navigate, padrao],
  );

  return [valor, definir];
}

/** Tira várias chaves da URL de uma vez (o "Limpar" da BarraFiltros). */
export function useLimparFiltrosNaUrl(chaves: string[]): () => void {
  const navigate = useNavigate();
  const lista = chaves.join("\u0000");
  return useCallback(() => {
    const remover = lista.split("\u0000");
    void navigate({
      to: ".",
      search: ((prev: Record<string, unknown>) => {
        const proximo = { ...prev };
        for (const c of remover) delete proximo[c];
        return proximo;
      }) as never,
      replace: true,
      resetScroll: false,
    });
  }, [lista, navigate]);
}

// O TanStack já desserializa JSON do search ("?n=3" chega como 3), mas um link
// colado à mão pode trazer o tipo errado; na dúvida, vale o padrão.
function coagir<T extends ValorFiltro>(bruto: unknown, padrao: T): T {
  if (bruto === undefined || bruto === null) return padrao;
  if (Array.isArray(padrao)) {
    if (Array.isArray(bruto)) return bruto.map(String) as T;
    return (typeof bruto === "string" && bruto ? [bruto] : padrao) as T;
  }
  switch (typeof padrao) {
    case "number": {
      const n = typeof bruto === "number" ? bruto : Number(bruto);
      return (Number.isFinite(n) ? n : padrao) as T;
    }
    case "boolean":
      if (typeof bruto === "boolean") return bruto as T;
      return (bruto === "true" ? true : bruto === "false" ? false : padrao) as T;
    default:
      return String(bruto) as T;
  }
}
