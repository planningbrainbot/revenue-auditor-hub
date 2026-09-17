import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { carregarMonetizacao, carregarContasBase } from "@/lib/monetizacao/functions";
import { useAuth } from "./use-auth";
import { loadCatalogPages } from "@/lib/monetizacao/catalog-loader";

import type { BaseMonetizacao } from "@/lib/monetizacao/types";

export function useMonetizacao() {
  const { user } = useAuth();
  const fn = useServerFn(carregarMonetizacao),
    pageFn = useServerFn(carregarContasBase);
  const client = useQueryClient();
  return useQuery({
    queryKey: ["monetizacao", user?.id],
    queryFn: async ({ signal }) => {
      const data = await fn();
      const previous = client.getQueryData<BaseMonetizacao>(["monetizacao", user?.id]);
      if (
        previous?.catalog_at &&
        previous.catalog_at === data.catalog_at &&
        previous.scope_signature === data.scope_signature &&
        previous.base_count === data.base_count
      )
        return { ...data, accounts: previous.accounts, units: previous.units };
      if (!data.catalog_pages || data.base_count === undefined)
        throw new Error("Não foi possível conferir os lotes da carteira.");
      const accounts = await loadCatalogPages(
        data.catalog_pages,
        (page) => pageFn({ data: { after: page.after, through: page.through } }),
        {
          catalog_at: data.catalog_at,
          scope_signature: data.scope_signature,
          base_count: data.base_count,
          signal,
        },
      );
      return {
        ...data,
        accounts,
        units: data.units.map((u) => ({
          ...u,
          account_keys: accounts
            .filter((a) =>
              u.id ? a.unit_ids.includes(u.id) : a.units.includes(u.key) || a.unit_label === u.name,
            )
            .map((a) => a.key),
        })),
      };
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
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
