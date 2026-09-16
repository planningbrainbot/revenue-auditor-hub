import { baseRetroativaConsultoria, disponibilidade, FAIXAS, normal, oferta } from "./model.ts";
import { ofertaRecon } from "./recon.ts";
import { PRODUTOS } from "./types.ts";
import type { BaseMonetizacao, Conta, Produto } from "./types";

export const ORIGENS_BASE = {
  antiga: "Base antiga",
  nova: "Base nova",
  divergente: "Origem divergente",
  confirmar: "Origem a confirmar",
} as const;
export type OrigemBase = keyof typeof ORIGENS_BASE;
export const origemBase = (a: Conta): OrigemBase => a.base_origin?.status || "confirmar";
// A conta retroativa sem regime continua visível para qualificação; não vira apta para envio.
export const potencialConsultoria = (a: Conta) =>
  baseRetroativaConsultoria(a) && oferta(a, "consultoria").status !== "fora_regra";
export const situacaoInicialProduto = (p: Produto | "") =>
  p === "consultoria" ? "potential" : p ? "eligible" : "";
export type PortfolioFilters = {
  query: string;
  band: string;
  drivaBand: string;
  segment: string;
  contact: string;
  regime: string;
  origin: OrigemBase | "";
  product: Produto | "";
  status: string;
  overlap: boolean;
  unit: string;
};
export const EMPTY_PORTFOLIO_FILTERS: PortfolioFilters = {
  query: "",
  band: "",
  drivaBand: "",
  segment: "",
  contact: "",
  regime: "",
  origin: "",
  product: "",
  status: "",
  overlap: false,
  unit: "",
};

export function filtrarCarteira(
  accounts: Conta[],
  f: PortfolioFilters,
  data: Pick<BaseMonetizacao, "cards" | "reservations" | "units">,
): Conta[] {
  return accounts
    .filter((a) => {
      if (f.unit && !data.units.find((u) => u.key === f.unit)?.account_keys.includes(a.key))
        return false;
      if (f.origin && origemBase(a) !== f.origin) return false;
      if (f.query && !normal([a.name, a.segment, a.unit_label].join(" ")).includes(normal(f.query)))
        return false;
      if (f.band === "unknown" && a.band) return false;
      if (f.drivaBand && a.driva?.group_revenue_band !== f.drivaBand) return false;
      if (f.band.startsWith("exact:") && a.band !== f.band.slice(6)) return false;
      if (
        f.band &&
        f.band !== "unknown" &&
        !f.band.startsWith("exact:") &&
        (FAIXAS[a.band || ""]?.[0] ?? -1) < Number(f.band)
      )
        return false;
      if (f.segment === "unknown" ? !!a.segment : f.segment && a.segment !== f.segment)
        return false;
      if (f.regime === "unknown" ? !!a.regime : f.regime && normal(a.regime) !== normal(f.regime))
        return false;
      if (f.contact && String(a.contact) !== f.contact) return false;
      if (
        f.overlap &&
        PRODUTOS.filter((p) => oferta(a, p).status === "elegivel").length +
          Number(ofertaRecon(a).status === "elegivel") <
          2
      )
        return false;
      if (f.product) {
        const result = oferta(a, f.product).status;
        const state = f.status || situacaoInicialProduto(f.product);
        if (state === "potential" && (f.product !== "consultoria" || !potencialConsultoria(a)))
          return false;
        if (state === "review" && result !== "revisar") return false;
        if (state === "excluded" && result !== "fora_regra") return false;
        if (["eligible", "free", "occupied"].includes(state) && result !== "elegivel") return false;
        if (
          state === "free" &&
          !disponibilidade(a, f.product, data.cards, undefined, data.reservations).free
        )
          return false;
        if (
          state === "occupied" &&
          disponibilidade(a, f.product, data.cards, undefined, data.reservations).free
        )
          return false;
      }
      return true;
    })
    .sort(
      (a, b) =>
        (FAIXAS[b.band || ""]?.[0] ?? -1) - (FAIXAS[a.band || ""]?.[0] ?? -1) ||
        a.name.localeCompare(b.name, "pt-BR"),
    );
}
