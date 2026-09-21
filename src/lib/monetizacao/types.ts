import type { BaseEmpresa } from "../clientes-base";
export const PRODUTOS = ["consultoria", "finance", "cella"] as const;
export type Produto = (typeof PRODUTOS)[number];
export type RegistroValor =
  | string
  | number
  | boolean
  | null
  | Record<string, number>
  | {
      id: number;
      name: string;
      open: number;
      loaded: number;
      started: number;
      validated: number;
      capacity: number | null;
    }[];
export const NOMES: Record<Produto | "sem_produto", string> = {
  consultoria: "Consultoria",
  finance: "Finance",
  cella: "Cella",
  sem_produto: "Sem produto",
};
export type Oferta = { status: "elegivel" | "revisar" | "fora_regra"; reason: string };
export interface DrivaRecord {
  cnpj: string;
  queried_at: string | null;
  source_updated_at?: string | null;
  status: string;
  non_simples: boolean | null;
  regime: string | null;
  raw_regime?: string | null;
  adjusted_regime?: string | null;
  simples?: boolean | null;
  mei?: boolean | null;
  revenue_estimate?: number | null;
  group_revenue_estimate?: number | null;
  group_revenue_band?: string | null;
  segment?: string | null;
  cnae?: string | null;
  registration_status?: string | null;
}
export interface Conta {
  base?: BaseEmpresa;
  key: string;
  name: string;
  units: string[];
  unit_label: string | null;
  orgs: number[];
  contact: boolean;
  band: string | null;
  regime: string | null;
  regime_source?: string | null;
  regime_at?: string | null;
  segment: string | null;
  segment_source?: string | null;
  segment_at?: string | null;
  segment_conflict?: boolean;
  band_conflict?: boolean;
  // Situação cadastral na Receita. Empresa não ativa sai das ofertas e fica na lista separada.
  situacao_receita?: "ativa" | "baixada" | "inapta" | "suspensa" | null;
  situacao_receita_fonte?: string | null;
  // Teto legal de faturamento anual pelo porte na Receita (R$ mi): ME 0,36 · EPP 4,8. Não é faixa declarada.
  faturamento_teto?: number | null;
  faturamento_teto_fonte?: string | null;
  regime_conflict?: boolean;
  old_base: boolean;
  matrix: boolean;
  new_commercial: boolean;
  pipedrive_contract: boolean;
  pipedrive_contract_id?: number | null;
  consultoria_priority: boolean;
  finance_candidate: boolean;
  finance: Oferta;
  ecd: boolean;
  driva?: {
    source: string;
    queried_at: string;
    cnpjs_total: number;
    cnpjs_found: number;
    status: string;
    non_simples: boolean | null;
    regime: string | null;
    regime_conflict: boolean;
    group_revenue_band: string | null;
    revenue_estimated: boolean;
    segment: string | null;
  };
  base_origin?: {
    status: "antiga" | "nova" | "divergente" | "confirmar";
    reason: string;
    source: string;
    commercial: boolean;
  };
  consultoria_origin?: {
    status: "retroativa" | "comercial" | "nao_retroativa" | "pendente";
    reason: string;
    checked_at: string;
    ops_ids: number[];
    pipefy_ids: string[];
    commercial_deal_ids: number[];
    non_simples_confirmed: boolean | null;
    regime_source: string | null;
  };
  recon?: {
    bpo_status: "bpo" | "fora_bpo" | "pendente";
    revenue_min: number | null;
    revenue_max: number | null;
    revenue_exact?: number | null;
    revenue_conflict: boolean;
    revenue_label?: string | null;
    revenue_sources?: string[];
    identity_note_ids?: number[];
    pending_checks?: string[];
    checked_at: string;
    reason: string;
    contract_ids: number[];
    products: string[];
    finance_checked_at: string | null;
    crm_existing: number[];
  };
}
export interface Unidade {
  id: number | null;
  key: string;
  name: string;
  classification: string;
  account_keys: string[];
  // Cobertura da carteira. cnpjs é o tamanho ("empresas"); os dois seguintes são procedência e
  // não somam entre si. omie_integrado falso = o Omie da unidade não chega ao Brain.
  cnpjs?: number;
  cnpjs_pipefy?: number;
  cnpjs_omie?: number;
  omie_integrado?: boolean;
}
export type Metrica = "loaded" | "started" | "scheduled" | "meeting" | "validated" | "signed";
export interface Movimento {
  at: string;
  date: string;
  actor_id: number | null;
  source: string;
}
export interface Valor {
  amount: number | null;
  currency: string | null;
  invalid: boolean;
}
export interface Receita {
  total: Valor;
  partners: Valor;
  unit: Valor;
  sum: number | null;
  difference: number | null;
  status: string;
  basis: string;
  unit_name: string | null;
}
export interface Negocio {
  id: number;
  title: string;
  org: string | null;
  org_id: number | null;
  owner: string;
  owner_id: number | null;
  route: Produto | "sem_produto";
  status: string;
  stage_id: number;
  stage: string;
  order: number;
  events: Record<Metrica, Movimento[]>;
  created_at: string;
  started_at: string | null;
  validated_at: string | null;
  signed_on: string | null;
  won_on?: string | null;
  expected_close: string | null;
  revenue: Receita;
  next_activity: string | null;
  history_known: boolean;
  url: string;
  updated_at?: string;
  last_activity_date?: string | null;
  lost_reason?: string | null;
}
export interface Revisao {
  band?: string;
  segment?: string;
  regime?: string;
  // Correção da situação cadastral pelo operador (ex.: inscrição regularizada depois da consulta
  // em lote). É o único caminho de volta para uma conta barrada pela situação na Receita.
  situacao_receita?: "ativa" | "baixada" | "inapta" | "suspensa";
  note?: string;
  demand?: string;
}
export interface ItemLista {
  id: string;
  account_key: string;
  product: Produto;
  review: Revisao;
  status: "draft" | "validated" | "sending" | "sent" | "uncertain" | "blocked";
  deal_id: number | null;
  reason: string | null;
}
export interface Lista {
  id: string;
  nome: string;
  unidade_id: number | null;
  unidade_nome: string;
  revision: number;
  status: "draft" | "validated" | "sent";
  partner: string | null;
  validated_at: string | null;
  created_at: string;
  updated_at: string;
  items: ItemLista[];
}
export interface Plano {
  month: string;
  owner_id: number;
  owner_name: string;
  capacity: number;
  meetings_capacity: number;
  target_contracts: number;
  daily_target: number;
  allocation: Record<Produto, number>;
  rates: Record<Produto, number | null>;
}
export interface Registro {
  id: string;
  kind: "pdi" | "roteiro" | "distribuicao" | "followup";
  title: string;
  body: Record<string, RegistroValor>;
  updated_at: string;
}
export interface BaseMonetizacao {
  base_count?: number;
  catalog_pages?: { after: string | null; through: string; count: number }[];
  scope_signature?: string;
  forecasts: ForecastSource[];
  reservations: { account_key: string; product: Produto; status: string; deal_id: number | null }[];
  accounts: Conta[];
  units: Unidade[];
  cards: Negocio[];
  lists: Lista[];
  plans: Plano[];
  records: Registro[];
  measured_at: string | null;
  catalog_at: string | null;
  sync_status: string;
  sync_error: string | null;
  stages: { id: number; name: string; order: number }[];
  permissions: { view: boolean; manage: boolean; send: boolean; all_units: boolean };
}

export interface ForecastSource {
  drive_url?: string;
  drive_updated_at?: string;
  id: string;
  version: string;
  source_name: string;
  source_date: string;
  sha256: string;
  scope: "front";
  note: string;
  months: string[];
  rows: {
    row: number;
    label: string;
    format: "percent" | "money" | "number";
    values: number[];
    formulas: (string | null)[];
  }[];
}
