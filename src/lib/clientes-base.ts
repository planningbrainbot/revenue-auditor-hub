import type { Conta } from "./monetizacao/types";
export type BaseEmpresa = {
  key: string;
  cnpjs: string[];
  empresa_ids: number[];
  pipefy_ids: string[];
  pipedrive_ids: string[];
  omie_units: string[];
  omie_records: number;
  contact_count: number;
  contact: boolean;
  ecd: { cnpj: string; year: number; source: string; registered_at: string }[];
  declared_origin: string[];
  pending_fields?: string[];
  identity_conflict?: boolean;
  origin: "nova" | "antiga" | "confirmar";
  origin_reason: string;
  origin_evidence?: {
    version: string;
    contracts: { cnpj: string; first_start: string; source: string; checked_at: string }[];
  };
  tax_evidence?: {
    non_simples: boolean | null;
    conflict: boolean;
    covered: boolean;
    checked_at: string | null;
    sources: string[];
  };
  responsible: string | null;
  validated_at: string | null;
  synced_at: string | null;
  source_status: "ok" | "absent" | "pending" | "not_linked";
  needs_validation: boolean;
  needs_source_correction: boolean;
};
export type Refinamento = "" | "cnpj" | "contato" | "ecd";
export function passaRefinamento(a: Conta, gate: Refinamento) {
  const m = a.base;
  if (!gate) return true;
  if (!m?.cnpjs.length) return false;
  if (gate === "cnpj") return true;
  if (!m.contact) return false;
  return gate === "contato" || m.ecd.length > 0;
}
export function aplicarBase(a: Conta, m: BaseEmpresa | undefined): Conta {
  if (!m) return a;
  return {
    ...a,
    base: m,
    contact: m.contact,
    ecd: m.ecd.length > 0,
    old_base: m.origin === "antiga",
    regime_conflict: a.regime_conflict || m.tax_evidence?.conflict === true,
    base_origin: {
      status: m.origin,
      reason: m.origin_reason,
      source: "Base única · Pipefy / Omie / Pipedrive",
      commercial: a.new_commercial,
    },
    consultoria_origin:
      m.origin === "antiga"
        ? {
            ...a.consultoria_origin,
            status: "retroativa",
            reason: m.origin_reason,
            checked_at: m.validated_at || "",
            ops_ids: m.empresa_ids,
            pipefy_ids: m.pipefy_ids,
            commercial_deal_ids: a.consultoria_origin?.commercial_deal_ids || [],
            non_simples_confirmed:
              m.tax_evidence?.non_simples ?? a.consultoria_origin?.non_simples_confirmed ?? null,
            regime_source:
              m.tax_evidence?.non_simples != null
                ? m.tax_evidence.sources.join(" / ")
                : (a.consultoria_origin?.regime_source ?? a.regime_source ?? null),
          }
        : a.consultoria_origin,
  };
}
