import type { Conta } from "./monetizacao/types";
/**
 * Pedido de distrato, lido da Central de Tratativas do Pipefy (pipe 307196408) por
 * ops.base_conta_sinais. `tratativa` pode reverter; `concluido` é churn confirmado; `revertido` é
 * cliente retido. Com mais de um card, vale a tratativa aberta, depois o concluído.
 */
export type EstadoDistrato = "tratativa" | "concluido" | "revertido";
export type SinalDistrato = {
  estado: EstadoDistrato;
  fase: string | null;
  card_id: string;
  data_churn: string | null;
  categoria: string | null;
  casamento: "pipefy" | "negocio";
  cards: number;
  atualizado_em: string | null;
  sincronizado_em: string | null;
};
/**
 * Tags do cadastro do Omie (migration 20260929180000, `omie-tags-sync`), somando todos os cadastros dos CNPJs da
 * conta em todos os Omie, Matriz inclusive. `fornecedor` = Fornecedor ou Transportadora sem Cliente;
 * `pessoa_interna` = Funcionário, Sócio, CLT, PJ ou Estágio sem Cliente nem Fornecedor; `sem_tag` = está no
 * Omie sem nenhuma dessas. Ausente = nenhum CNPJ da conta está no Omie.
 */
export type ClasseOmie =
  "cliente" | "cliente_e_fornecedor" | "fornecedor" | "pessoa_interna" | "sem_tag";
export type SinalOmie = {
  classe: ClasseOmie;
  cliente_em: string[];
  fornecedor_em: string[];
  sincronizado_em: string | null;
};
/** Casamento com a plataforma da Consultoria: CNPJ completo, raiz (mesma pessoa jurídica) ou nome. */
export type CasamentoConsultoria = "cnpj" | "raiz" | "nome";
export type SinalConsultoria = {
  cliente: {
    casamento: "cnpj" | "raiz";
    cnpj: string;
    razao_social: string | null;
    ativo: boolean;
    inativo_desde: string | null;
    valor_a_recuperar: number | null;
    valor_a_recuperar_em: string | null;
    regime_tributario: string | null;
    parceiro: string | null;
    cadastrado_em: string | null;
  } | null;
  propostas: {
    id: string;
    categoria: string | null;
    status: string | null;
    produto: string | null;
    linha_produto: string | null;
    valor_total: number | null;
    tipo_cobranca: string | null;
    percentual_exito: number | null;
    data_envio: string | null;
    data_ultimo_fup: string | null;
    data_proximo_fup: string | null;
    responsavel: string | null;
    casamento: CasamentoConsultoria;
  }[];
  sincronizado_em: string | null;
};
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
  /** Sinais externos (migration 20260928200000). Ausente = sem card nem casamento. */
  distrato?: SinalDistrato | null;
  consultoria?: SinalConsultoria | null;
  /** Tags do cadastro do Omie (migration 20260929180000). */
  omie?: SinalOmie | null;
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
