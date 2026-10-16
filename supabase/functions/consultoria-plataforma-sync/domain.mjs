// Regras puras da consultoria-plataforma-sync, separadas para teste
// (tests/consultoria-plataforma-sync.test.mjs). A fonte é o Supabase da plataforma da Consultoria (Pedro Siqueira),
// lido pelo PostgREST com o login técnico planning.brain.bot@gmail.com (papel Comercial).

export const POR_PAGINA = 1000;
export const LIMITE_PAGINAS = 50;

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
/** CNPJ ou CPF só com dígitos; o resto é nulo (não casa). */
export const documento = (v) => {
  const d = digitos(v);
  return d.length === 14 || d.length === 11 ? d : null;
};
const texto = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
};

/**
 * As tabelas lidas, na ordem de leitura. `ordem` é a chave única da paginação (PostgREST não garante ordem sem ela);
 * `filtro` vai na query; `chave` monta o id da linha no espelho; `cliente`, `projeto`, `cnpj` e `nome` são as
 * colunas de casamento da ficha (ops.consultoria_empresa_ficha).
 */
export const TABELAS = [
  { tabela: "clientes", ordem: "id", cliente: (x) => x.id, cnpj: (x) => documento(x.cnpj_norm ?? x.cnpj), nome: (x) => x.razao_social },
  {
    tabela: "projetos_gestao",
    ordem: "id",
    cliente: (x) => x.cliente_id,
    projeto: (x) => x.id,
    cnpj: (x) => documento(x.cnpj),
    nome: (x) => x.razao_social,
  },
  {
    tabela: "v_painel_prazo_card",
    ordem: "projeto_id",
    chave: (x) => x.projeto_id,
    cliente: (x) => x.cliente_id,
    projeto: (x) => x.projeto_id,
    cnpj: (x) => documento(x.cnpj),
  },
  { tabela: "oportunidades", ordem: "id", projeto: (x) => x.projeto_id, nome: (x) => x.empresa },
  {
    tabela: "projeto_temas",
    ordem: "projeto_id,tema_id",
    chave: (x) => `${x.projeto_id}|${x.tema_id}`,
    projeto: (x) => x.projeto_id,
  },
  { tabela: "temas_tributarios", ordem: "id" },
  { tabela: "projeto_fups", ordem: "id", projeto: (x) => x.projeto_id },
  {
    tabela: "projeto_gestores",
    ordem: "projeto_id,gestor_id,area",
    chave: (x) => `${x.projeto_id}|${x.gestor_id}|${x.area ?? ""}`,
    projeto: (x) => x.projeto_id,
  },
  { tabela: "gestores", ordem: "id" },
  { tabela: "projeto_area_registro", ordem: "id", projeto: (x) => x.projeto_id },
  {
    tabela: "vw_linha_do_tempo",
    ordem: "id",
    // Só o histórico de projeto, proposta e retificação; classificação de fatura e cronograma da Reforma ficam fora.
    filtro: "entidade_tipo=in.(projeto_gestao,proposta,retificacao)",
  },
  { tabela: "retificacoes", ordem: "id", cliente: (x) => x.cliente_id, projeto: (x) => x.projeto_id },
  {
    tabela: "propostas",
    ordem: "id",
    cliente: (x) => x.cliente_id,
    cnpj: (x) => documento(x.cnpj_norm ?? x.cnpj),
    nome: (x) => x.empresa,
  },
  {
    tabela: "estoque_credito",
    ordem: "id",
    cliente: (x) => x.cliente_id,
    projeto: (x) => x.projeto_id,
    cnpj: (x) => documento(x.cnpj),
    nome: (x) => x.razao_social,
  },
  { tabela: "estoque_saldos", ordem: "id", cliente: (x) => x.cliente_id },
  { tabela: "estoque_movimentos", ordem: "id" },
  { tabela: "estoque_utilizacoes", ordem: "id" },
  { tabela: "faturamentos", ordem: "id", cnpj: (x) => documento(x.cnpj), nome: (x) => x.razao_social },
  {
    tabela: "recebimentos",
    ordem: "id",
    cnpj: (x) => documento(x.cliente_cnpj_cpf),
    nome: (x) => x.cliente_razao_social ?? x.cliente_nome,
  },
  {
    tabela: "provisoes_recebimento",
    ordem: "id",
    cnpj: (x) => documento(x.cliente_cnpj),
    nome: (x) => x.cliente_razao_social,
  },
  { tabela: "classificacao_cliente", ordem: "id", cnpj: (x) => documento(x.cnpj_norm), nome: (x) => x.cliente_nome },
  { tabela: "canais_venda", ordem: "id" },
  { tabela: "parceiros", ordem: "id" },
];

/** Um registro da plataforma → linha do espelho. Sem id, fica fora (a sync conta). */
export function linhaEspelho(spec, x) {
  const id = texto(spec.chave ? spec.chave(x) : x?.id);
  if (!id || !x || typeof x !== "object") return null;
  return {
    id,
    cliente_id: texto(spec.cliente?.(x)),
    projeto_id: texto(spec.projeto?.(x)),
    cnpj: spec.cnpj?.(x) ?? null,
    nome: texto(spec.nome?.(x)),
    dados: x,
  };
}

/** Caminho de uma página no PostgREST da plataforma. */
export function caminhoPagina(spec, pagina) {
  const qs = [
    "select=*",
    spec.filtro,
    `order=${spec.ordem}`,
    `limit=${POR_PAGINA}`,
    `offset=${pagina * POR_PAGINA}`,
  ].filter(Boolean);
  return `${spec.tabela}?${qs.join("&")}`;
}

/** Situação da rodada: erro só quando nada foi gravado; com alguma tabela falhando, parcial. */
export function statusRodada(resultados) {
  const falhas = resultados.filter((r) => r.erro).length;
  if (!resultados.length || falhas === resultados.length) return "erro";
  return falhas ? "parcial" : "sucesso";
}
