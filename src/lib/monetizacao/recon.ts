import type { Conta, Oferta } from "./types";

export function ofertaRecon(a: Conta): Oferta {
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
