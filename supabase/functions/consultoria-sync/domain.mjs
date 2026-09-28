// Regras puras da sync da plataforma da Consultoria, separadas para teste
// (tests/base-sinais-sync.test.mjs). A API é a edge function `api-comercial` do projeto do Pedro
// Siqueira: /clientes e /propostas paginados (`pagina`, `por_pagina`, `tem_mais`), header x-api-key.
import { strictDate } from "../_shared/strict-date.mjs";

export const POR_PAGINA = 100;
export const LIMITE_PAGINAS = 100;

const texto = (v) => {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s ? s : null;
};
// A API devolve número; texto com vírgula é lido no formato brasileiro ("1.234,56").
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  const n = typeof v === "number" ? v : Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) ? n : null;
};
const inteiro = (v) => {
  const n = numero(v);
  return n === null ? null : Math.trunc(n);
};
const instante = (v) => {
  const s = texto(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
};
const uuid = (v) => {
  const s = texto(v);
  return s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s) ? s.toLowerCase() : null;
};
/** CNPJ só com os 14 dígitos; qualquer outra coisa é nulo (não casa, e a tabela recusaria). */
export const cnpjOuNulo = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length === 14 ? d : null;
};

/**
 * Cliente da API → linha de ops.consultoria_clientes. `ativo` ausente vale true (é o que a API
 * devolve hoje para todos). Os três campos reservados — `inativo_desde`, `valor_a_recuperar` e
 * `valor_a_recuperar_em` — são os nomes pedidos ao Pedro Siqueira em 28/09; até lá ficam nulos.
 * Devolve null quando falta id ou CNPJ válido (a sync conta e registra no log).
 */
export function linhaCliente(x, agora) {
  const id = uuid(x?.id);
  const cnpj = cnpjOuNulo(x?.cnpj);
  if (!id || !cnpj) return null;
  return {
    id,
    cnpj,
    razao_social: texto(x.razao_social),
    nome_fantasia: texto(x.nome_fantasia),
    grupo_economico: texto(x.grupo_economico),
    parceiro: texto(x.parceiro),
    uf: texto(x.uf),
    municipio: texto(x.municipio),
    cnae: texto(x.cnae),
    cnae_descricao: texto(x.cnae_descricao),
    porte: texto(x.porte),
    regime_tributario: texto(x.regime_tributario),
    situacao_receita: texto(x.situacao_receita),
    ativo: x.ativo === false || x.ativo === "false" ? false : true,
    inativo_desde: strictDate(x.inativo_desde),
    valor_a_recuperar: numero(x.valor_a_recuperar),
    valor_a_recuperar_em: strictDate(x.valor_a_recuperar_em),
    cadastrado_em: instante(x.cadastrado_em),
    atualizado_em: instante(x.atualizado_em),
    payload: x,
    sincronizado_em: agora,
    ausente_desde: null,
  };
}

/** Proposta da API → linha de ops.consultoria_propostas. `status` nulo = aberta (a API não informa). */
export function linhaProposta(x, agora) {
  const id = uuid(x?.id);
  if (!id) return null;
  return {
    id,
    empresa: texto(x.empresa),
    cnpj: cnpjOuNulo(x.cnpj),
    cliente_id: uuid(x.cliente_id),
    produto: texto(x.produto),
    linha_produto: texto(x.linha_produto),
    categoria: texto(x.categoria),
    status: texto(x.status),
    responsavel: texto(x.responsavel),
    parceiro: texto(x.parceiro),
    canal_venda: texto(x.canal_venda),
    unidade: texto(x.unidade),
    data_envio: strictDate(x.data_envio),
    data_ultimo_fup: strictDate(x.data_ultimo_fup),
    data_proximo_fup: strictDate(x.data_proximo_fup),
    tipo_cobranca: texto(x.tipo_cobranca),
    valor_total: numero(x.valor_total),
    valor_fixo: numero(x.valor_fixo),
    percentual_exito: numero(x.percentual_exito),
    num_parcelas: inteiro(x.num_parcelas),
    criada_em: instante(x.criada_em),
    atualizado_em: instante(x.atualizado_em),
    payload: x,
    sincronizado_em: agora,
    ausente_desde: null,
  };
}

/** Várias leituras da mesma coleção (ex.: ativos e inativos) viram uma lista por id. */
export function unicosPorId(listas) {
  const m = new Map();
  for (const l of listas) for (const x of l) if (x?.id && !m.has(x.id)) m.set(x.id, x);
  return [...m.values()];
}

/**
 * Pode marcar como ausente quem não veio? Só com leitura não vazia e sem perder mais da metade do
 * que estava presente: API fora do ar ou paginação quebrada não pode esvaziar a base de sinais.
 */
export function podeMarcarAusentes(lidos, presentesAntes) {
  if (!lidos) return { pode: false, motivo: "leitura vazia" };
  if (presentesAntes >= 20 && lidos < presentesAntes / 2)
    return { pode: false, motivo: `leitura trouxe ${lidos} de ${presentesAntes} presentes` };
  return { pode: true, motivo: null };
}
