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
export interface Conta {
  key: string;
  name: string;
  units: string[];
  unit_label: string | null;
  orgs: number[];
  contact: boolean;
  band: string | null;
  regime: string | null;
  segment: string | null;
  segment_source?: string | null;
  segment_at?: string | null;
  segment_conflict?: boolean;
  band_conflict?: boolean;
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
}
export interface Unidade {
  id: number | null;
  key: string;
  name: string;
  classification: string;
  account_keys: string[];
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
