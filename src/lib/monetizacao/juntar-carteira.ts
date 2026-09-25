import type { BaseMonetizacao } from "./types";

// Junta os lotes do catálogo à carga de Monetização: cada unidade recebe as chaves das contas dela.
// Uma regra só, usada pela tela (useMonetizacao) e pelo servidor da conversa do Cockpit do CEO.
export function juntarCarteira<
  A extends { key: string; unit_ids: number[]; units: string[]; unit_label?: string | null },
>(data: BaseMonetizacao, accounts: A[]): BaseMonetizacao {
  return {
    ...data,
    accounts: accounts as unknown as BaseMonetizacao["accounts"],
    units: data.units.map((u) => ({
      ...u,
      account_keys: accounts
        .filter((a) =>
          u.id ? a.unit_ids.includes(u.id) : a.units.includes(u.key) || a.unit_label === u.name,
        )
        .map((a) => a.key),
    })),
  };
}
