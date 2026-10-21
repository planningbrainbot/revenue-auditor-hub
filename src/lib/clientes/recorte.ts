// Recorte da Base por região, porte e segmento (Pedro, 21/10/2026: "filtros muito bonitos na primeira tela,
// especialmente de região, segmento e porte"). Leitura pura do que a conta já traz; nada aqui grava nem mexe na regra de
// cliente. Imports relativos com extensão: os testes (tests/base-recorte.test.mjs) importam este arquivo no Node.
import { limiteFaturamento, normal } from "../monetizacao/model.ts";
import type { Conta } from "../monetizacao/types";

export const REGIOES = ["Norte", "Nordeste", "Centro-Oeste", "Sudeste", "Sul"] as const;
/** Valor do filtro para a conta sem UF (nem da empresa nem da unidade). */
export const SEM_UF = "sem_uf";

/** Regiões do IBGE (a mesma tabela de `ops.monetizacao_uf_regiao`). */
export const REGIAO_DA_UF: Record<string, (typeof REGIOES)[number]> = {
  AC: "Norte",
  AP: "Norte",
  AM: "Norte",
  PA: "Norte",
  RO: "Norte",
  RR: "Norte",
  TO: "Norte",
  AL: "Nordeste",
  BA: "Nordeste",
  CE: "Nordeste",
  MA: "Nordeste",
  PB: "Nordeste",
  PE: "Nordeste",
  PI: "Nordeste",
  RN: "Nordeste",
  SE: "Nordeste",
  DF: "Centro-Oeste",
  GO: "Centro-Oeste",
  MT: "Centro-Oeste",
  MS: "Centro-Oeste",
  ES: "Sudeste",
  MG: "Sudeste",
  RJ: "Sudeste",
  SP: "Sudeste",
  PR: "Sul",
  RS: "Sul",
  SC: "Sul",
};

/**
 * UF da praça de cada unidade (`ops.monetizacao_unidades`, 21/10/2026), pelo nome sem acento. Em 21/10 só 3.276 dos
 * 6.703 clientes tinham UF da empresa; o resto herda a da unidade que o atende. Unidade nova fora daqui cai em "Sem UF".
 */
const UF_DA_UNIDADE: Record<string, string> = {
  belem: "PA",
  "campo novo": "MT",
  curitiba: "PR",
  fortaleza: "CE",
  goiania: "GO",
  itauna: "MG",
  maceio: "AL",
  "patos de minas": "MG",
  recife: "PE",
  "sao bernardo": "SP",
  "sao luis": "MA",
  sorocaba: "SP",
  "sudeste (rj)": "RJ",
};

/** Porte pelo faturamento anual: a faixa declarada (ou estimada pela DataStone) e, sem ela, o porte na Receita. */
export const PORTES = [
  { chave: "micro", rotulo: "Micro", dica: "até R$ 500 mil por ano", nivel: 1 },
  { chave: "pequena", rotulo: "Pequena", dica: "até R$ 4,8 mi por ano", nivel: 2 },
  { chave: "media", rotulo: "Média", dica: "de R$ 4,8 mi a R$ 78 mi", nivel: 3 },
  { chave: "grande", rotulo: "Grande", dica: "acima de R$ 78 mi", nivel: 4 },
  { chave: "sem_porte", rotulo: "Sem porte", dica: "sem faixa nem porte na Receita", nivel: 0 },
] as const;
export type Porte = (typeof PORTES)[number]["chave"];

export const SEM_SEGMENTO = "Sem segmento";
/**
 * O cadastro tem o segmento do Pipefy, e a DataStone escreve outros nomes em caixa alta. Os da DataStone viram o
 * segmento do cadastro mais próximo; grafias diferentes do mesmo segmento viram uma. Só o rótulo muda: o campo da conta
 * continua como veio.
 */
const SEGMENTO_DO_CADASTRO: Record<string, string> = {
  "construcao civil": "Construção Civil",
  "industria da construcao": "Construção Civil",
  varejo: "Distribuição e Varejo",
  atacado: "Distribuição e Varejo",
  "outros servicos": "Serviços",
  "servicos administrativos": "Serviços",
  "servicos profissionais e tecnicos": "Serviços",
  "servicos de saneamento basico": "Serviços",
  "escritorios de advocacia": "Serviços",
  "servicos de saude": "Saúde",
  "servicos de educacao": "Educação",
  "industria automotiva": "Automotivo",
  "bens de capital": "Indústria",
  "papel e celulose": "Indústria",
  siderurgia: "Indústria",
  "produtos de agropecuaria": "Agronegócio",
  outros: "Outros",
  "nao informado": SEM_SEGMENTO,
};

export function segmentoDaConta(a: Pick<Conta, "segment">): string {
  const s = a.segment?.trim();
  if (!s) return SEM_SEGMENTO;
  const doCadastro = SEGMENTO_DO_CADASTRO[normal(s)];
  if (doCadastro) return doCadastro;
  // Caixa alta sem tradução: só a primeira letra fica maiúscula, para não gritar no meio dos outros.
  return s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

export function porteDaConta(a: Conta): Porte {
  if (normal(a.band) === "sem movimentacao") return "micro";
  const l = limiteFaturamento(a);
  if (!l) return "sem_porte";
  const [min, max] = l;
  if (max !== null && max <= 0.5) return "micro";
  if (max !== null && max <= 4.8) return "pequena";
  if (min >= 78) return "grande";
  if (min >= 4.8) return "media";
  return "sem_porte";
}

export type FonteUf = "empresa" | "unidade";

/** A UF da conta: a da empresa (`ops.base_conta_uf`) e, sem ela, a da praça da primeira unidade que a atende. */
export function ufDaConta(
  a: Conta,
  nomeDaUnidade: (chave: string) => string | undefined,
): { uf: string | null; fonte: FonteUf | null } {
  const daEmpresa = a.finance_regiao?.uf?.toUpperCase();
  if (daEmpresa && REGIAO_DA_UF[daEmpresa]) return { uf: daEmpresa, fonte: "empresa" };
  for (const k of a.units ?? []) {
    const uf = UF_DA_UNIDADE[normal(nomeDaUnidade(k))];
    if (uf) return { uf, fonte: "unidade" };
  }
  return { uf: null, fonte: null };
}

/** O que o recorte lê de cada conta, calculado uma vez por carga. */
export interface PerfilRecorte {
  regiao: string;
  uf: string;
  fonteUf: FonteUf | null;
  porte: Porte;
  segmento: string;
}

export function perfilRecorte(
  a: Conta,
  nomeDaUnidade: (chave: string) => string | undefined,
): PerfilRecorte {
  const { uf, fonte } = ufDaConta(a, nomeDaUnidade);
  return {
    regiao: uf ? REGIAO_DA_UF[uf] : SEM_UF,
    uf: uf ?? SEM_UF,
    fonteUf: fonte,
    porte: porteDaConta(a),
    segmento: segmentoDaConta(a),
  };
}

/** O recorte escolhido. Dentro de um filtro as opções somam (OU); entre filtros vale a interseção (E). */
export interface RecorteBase {
  regiao: string[];
  uf: string[];
  porte: string[];
  segmento: string[];
}
export type Faceta = keyof RecorteBase;
export const RECORTE_VAZIO: RecorteBase = { regiao: [], uf: [], porte: [], segmento: [] };
export const temRecorte = (r: RecorteBase) =>
  !!(r.regiao.length || r.uf.length || r.porte.length || r.segmento.length);

/**
 * A conta passa no recorte? `ignorar` deixa um filtro de fora, para contar as opções dele com os outros aplicados. A UF
 * mora dentro da região: ignorar a região ignora a UF também.
 */
export function passaRecorte(p: PerfilRecorte, r: RecorteBase, ignorar?: Faceta): boolean {
  if (ignorar !== "regiao" && r.regiao.length && !r.regiao.includes(p.regiao)) return false;
  if (ignorar !== "regiao" && ignorar !== "uf" && r.uf.length && !r.uf.includes(p.uf)) return false;
  if (ignorar !== "porte" && r.porte.length && !r.porte.includes(p.porte)) return false;
  if (ignorar !== "segmento" && r.segmento.length && !r.segmento.includes(p.segmento)) return false;
  return true;
}

/** Contagem de cada opção de um filtro, com os outros filtros aplicados. */
export function contarFaceta(
  contas: readonly Conta[],
  perfil: (a: Conta) => PerfilRecorte,
  r: RecorteBase,
  faceta: Faceta,
): Map<string, number> {
  const c = new Map<string, number>();
  for (const a of contas) {
    const p = perfil(a);
    if (!passaRecorte(p, r, faceta)) continue;
    c.set(p[faceta], (c.get(p[faceta]) ?? 0) + 1);
  }
  return c;
}

/** As contas de uma opção de um filtro, com os outros aplicados: o número da opção, empresa por empresa. */
export function contasDaOpcao(
  contas: readonly Conta[],
  perfil: (a: Conta) => PerfilRecorte,
  r: RecorteBase,
  faceta: Faceta,
  valor: string,
): Conta[] {
  return contas.filter((a) => {
    const p = perfil(a);
    return p[faceta] === valor && passaRecorte(p, r, faceta);
  });
}

/** Rótulo de uma opção, para chip, gaveta e CSV. */
export function rotuloDaOpcao(faceta: Faceta, valor: string): string {
  if (faceta === "porte") return PORTES.find((p) => p.chave === valor)?.rotulo ?? valor;
  if ((faceta === "regiao" || faceta === "uf") && valor === SEM_UF) return "Sem UF";
  return valor;
}
