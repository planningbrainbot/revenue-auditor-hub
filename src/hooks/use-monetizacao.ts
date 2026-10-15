import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { carregarMonetizacao, carregarContasBase } from "@/lib/monetizacao/functions";
import { useAuth } from "./use-auth";
import { loadCatalogPages } from "@/lib/monetizacao/catalog-loader";
import { juntarCarteira } from "@/lib/monetizacao/juntar-carteira";

import type { BaseMonetizacao } from "@/lib/monetizacao/types";

/**
 * `esperarCarteira` (padrão): a carga só fica pronta com a carteira da Base, como sempre foi (Base de clientes, Aquário,
 * Cockpits). Sem esperar: a Operação, a Pré-venda e o Forecast abrem com os cards e a carteira chega depois.
 */
export function useMonetizacao({ esperarCarteira = true }: { esperarCarteira?: boolean } = {}) {
  const { user } = useAuth();
  const fn = useServerFn(carregarMonetizacao),
    pageFn = useServerFn(carregarContasBase);
  // Duas etapas (15/10/2026, banco saturado): a carga da Monetização (cards, listas, etapas) abre a tela sozinha; a
  // carteira da Base (~10 mil contas em páginas) vem depois, em segundo plano. Antes a tela só abria com a carteira
  // inteira, e com o banco carregado as páginas estouravam o limite de 8 s e a Operação ficava em "Carregando".
  const principal = useQuery({
    queryKey: ["monetizacao", user?.id],
    queryFn: () => fn(),
    enabled: !!user,
    // A carga do Pipedrive roda a cada 5 minutos; recarregar a cada minuto em cada aba aberta (Monetização e
    // Cockpits) só pesava no banco.
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const base = principal.data;
  const carteira = useQuery({
    queryKey: [
      "monetizacao-carteira",
      user?.id,
      base?.catalog_at,
      base?.scope_signature,
      base?.base_count,
      base?.sinais_at?.tratativas,
      base?.sinais_at?.consultoria,
    ],
    queryFn: ({ signal }) =>
      loadCatalogPages(
        base!.catalog_pages!,
        (page) => pageFn({ data: { after: page.after, through: page.through } }),
        {
          catalog_at: base!.catalog_at,
          scope_signature: base!.scope_signature,
          base_count: base!.base_count!,
          signal,
        },
      ),
    enabled:
      !!user &&
      !!base &&
      !base.catalogo_indisponivel &&
      !!base.catalog_pages &&
      base.base_count !== undefined,
    // A carteira só muda quando o carimbo muda (a chave); enquanto a nova carrega, fica a anterior.
    staleTime: Infinity,
    placeholderData: keepPreviousData,
    retry: 1,
  });
  const carteiraPendente =
    !!base && !base.catalogo_indisponivel && !carteira.data && !carteira.isError;
  const data: BaseMonetizacao | undefined = !base
    ? undefined
    : esperarCarteira && carteiraPendente
      ? undefined
      : carteira.data
        ? juntarCarteira(base, carteira.data as Parameters<typeof juntarCarteira>[1])
        : {
            ...base,
            accounts: [],
            catalogo_indisponivel: base.catalogo_indisponivel || carteira.isError || undefined,
            carteira_carregando: carteira.isFetching || carteira.isPending,
          };
  return { ...principal, data };
}
export function useAtualizarMonetizacao() {
  const qc = useQueryClient();
  return () => {
    qc.setQueriesData<BaseMonetizacao>({ queryKey: ["monetizacao"] }, (d) =>
      d ? { ...d, catalog_at: null } : d,
    );
    return qc.invalidateQueries({ queryKey: ["monetizacao"] });
  };
}
