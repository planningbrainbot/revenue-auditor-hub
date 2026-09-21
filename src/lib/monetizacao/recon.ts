import { situacaoForaDeOferta } from "./model.ts";
import type { Conta, Oferta } from "./types";

export const GRUPOS_RECON = {
  identidade: "CNPJ divergente",
  inativa: "Inativa na Receita · baixada, inapta ou suspensa",
  elegivel: "Aptas",
  confirmar_bpo: "Acima de R$ 5 mi · confirmar BPO",
  faixa_limite: "Faixa atravessa R$ 5 mi",
  divergencia: "Faturamento divergente",
  sem_faturamento: "Sem faturamento informado",
  bpo: "Excluídas por BPO",
  abaixo_corte: "Até R$ 5 mi",
} as const;
export type GrupoRecon = keyof typeof GRUPOS_RECON;

export function grupoRecon(a: Conta): GrupoRecon {
  if (a.base?.identity_conflict) return "identidade";
  // Antes do corte por faturamento: "fora_regra" por situação cadastral não é prova de faturar
  // pouco, e cair em "Até R$ 5 mi" afirmaria um valor que ninguém apurou.
  if (situacaoForaDeOferta(a)) return "inativa";
  const r = a.recon;
  if (r?.bpo_status === "bpo") return "bpo";
  if (r?.revenue_conflict || a.band_conflict) return "divergencia";
  if (ofertaRecon(a).status === "elegivel") return "elegivel";
  if (ofertaRecon(a).status === "fora_regra") return "abaixo_corte";
  const above =
    r?.revenue_exact != null
      ? r.revenue_exact > 5_000_000
      : r?.revenue_min != null && r.revenue_min > 5_000_000;
  if (above) return "confirmar_bpo";
  if (r?.revenue_min != null && r.revenue_max != null && r.revenue_max > 5_000_000)
    return "faixa_limite";
  return "sem_faturamento";
}

export function potencialRecon(a: Conta): boolean {
  return ["elegivel", "confirmar_bpo", "faixa_limite"].includes(grupoRecon(a));
}

export function faturamentoRecon(a: Conta): string {
  return a.recon?.revenue_label || a.band || "A confirmar";
}

export function ofertaRecon(a: Conta): Oferta {
  if (a.base?.identity_conflict)
    return { status: "revisar", reason: "CNPJ divergente entre fontes; revisar a identidade." };
  const parada = situacaoForaDeOferta(a);
  if (parada) return { status: "fora_regra", reason: parada };
  const r = a.recon;
  if (!r) return { status: "revisar", reason: "Contrato e carteira BPO ainda não conferidos." };
  if (r.bpo_status === "bpo") return { status: "fora_regra", reason: r.reason };
  if (r.revenue_conflict || a.band_conflict)
    return { status: "revisar", reason: "Fontes divergem sobre o faturamento anual." };
  const above =
    r.revenue_exact != null
      ? r.revenue_exact > 5_000_000
      : r.revenue_min != null && r.revenue_min > 5_000_000;
  const below =
    r.revenue_exact != null
      ? r.revenue_exact <= 5_000_000
      : r.revenue_max != null && r.revenue_max <= 5_000_000;
  if (below) return { status: "fora_regra", reason: "Faturamento anual de até R$ 5 milhões." };
  if (!above)
    return {
      status: "revisar",
      reason:
        "Confirmar faturamento anual acima de R$ 5 milhões; a faixa atual não comprova o corte.",
    };
  if (r.bpo_status !== "fora_bpo") return { status: "revisar", reason: r.reason };
  return {
    status: "elegivel",
    reason:
      "Acima de R$ 5 milhões e contratos conferidos sem BPO contábil, fiscal, folha ou financeiro.",
  };
}
