// Régua das listas da Base de clientes, somente leitura, com o código do app.
//
// Por que não SQL: "retroativa", "fora do Simples" e os sinais novos (distrato e Consultoria) são
// recalculados na leitura por `aplicarBase` e `oferta`; um SQL sobre o perfil gravado dá número
// errado (memória "regua-listas-base-clientes"). Aqui a conta é montada como a tela monta
// (`carregarBaseReal`: mesmas tabelas, mesmo catálogo) e a situação por produto sai de
// `estadoProduto`, a mesma função da lista.
//
// Uso: SUPABASE_ACCESS_TOKEN=... node scripts/base-sinais/regua.mjs [saida.json]
// A saída tem só agregados e, à parte, as chaves técnicas por situação (para comparar antes e
// depois). Nenhum nome, CNPJ ou contato vai para o arquivo. Grave a saída fora do repositório.
import { writeFileSync } from "node:fs";
import { carregarBaseReal } from "../cockpit-ceo/carga-real.mjs";
import { estadoProduto, potencialConsultoria } from "../../src/lib/monetizacao/portfolio.ts";
import { ofertaRecon } from "../../src/lib/monetizacao/recon.ts";
import { PRODUTOS } from "../../src/lib/monetizacao/types.ts";

const { base, contagem } = await carregarBaseReal();
const accounts = base.accounts;
// Simulação antes de publicar: SINAIS_SIMULADOS=<json {key: {distrato, consultoria}}> (saída do
// ensaio da migration em transação desfeita). Depois de publicar, o catálogo já traz os sinais.
if (process.env.SINAIS_SIMULADOS) {
  const { readFileSync } = await import("node:fs");
  const mapa = JSON.parse(readFileSync(process.env.SINAIS_SIMULADOS, "utf8"));
  for (const a of accounts)
    if (a.base) {
      a.base.distrato = mapa[a.key]?.distrato ?? null;
      a.base.consultoria = mapa[a.key]?.consultoria ?? null;
    }
}
const dados = { cards: base.cards, reservations: base.reservations, units: base.units, lists: base.lists };

const porProduto = {};
const chaves = {};
for (const p of PRODUTOS) {
  const n = { elegivel: 0, revisar: 0, fora_regra: 0, free: 0, occupied: 0, so_omie: 0, qualificar: 0, review: 0, excluded: 0 };
  chaves[p] = { elegivel: [], free: [], qualificar: [] };
  for (const a of accounts) {
    const e = estadoProduto(a, p, dados);
    n[e.perfil.status]++;
    n[e.situacao]++;
    if (e.perfil.status === "elegivel") chaves[p].elegivel.push(a.key);
    if (e.situacao === "free") chaves[p].free.push(a.key);
    if (e.situacao === "qualificar") chaves[p].qualificar.push(a.key);
  }
  porProduto[p] = n;
}
porProduto.consultoria.potential = accounts.filter(potencialConsultoria).length;
chaves.consultoria.potential = accounts.filter(potencialConsultoria).map((a) => a.key);
// Carteira retroativa de Consultoria por motivo (mesma função dos cartões e de "Entenda os números").
const { baseRetroativaConsultoria } = await import("../../src/lib/monetizacao/model.ts");
const { motivoConsultoria, estadoDistrato } = await import("../../src/lib/monetizacao/portfolio.ts");
porProduto.consultoria.retroativa_por_motivo = {};
for (const a of accounts.filter(baseRetroativaConsultoria)) {
  const m = motivoConsultoria(a);
  porProduto.consultoria.retroativa_por_motivo[m] = (porProduto.consultoria.retroativa_por_motivo[m] ?? 0) + 1;
}
const foraDaTabelaPadrao = accounts.filter((a) => estadoDistrato(a) === "concluido").length;
const recon = { elegivel: 0, revisar: 0, fora_regra: 0 };
for (const a of accounts) recon[ofertaRecon(a).status]++;

// Sinais novos: presentes só quando o catálogo já os traz (depois da migration).
const sinais = {
  distrato: {},
  consultoria: {},
};
for (const a of accounts) {
  const d = a.base?.distrato?.estado;
  if (d) sinais.distrato[d] = (sinais.distrato[d] ?? 0) + 1;
  const c = a.base?.consultoria;
  if (c?.cliente) sinais.consultoria["cliente_" + c.cliente.casamento] = (sinais.consultoria["cliente_" + c.cliente.casamento] ?? 0) + 1;
  if (c?.propostas?.length) {
    const incerta = c.propostas.every((x) => x.casamento === "nome");
    const k = incerta ? "proposta_so_por_nome" : "proposta_por_cnpj";
    sinais.consultoria[k] = (sinais.consultoria[k] ?? 0) + 1;
  }
}

const saida = {
  medido_em: new Date().toISOString(),
  catalog_at: base.catalog_at,
  contas: accounts.length,
  sem_catalogo: contagem.semCatalogo,
  por_produto: porProduto,
  recon,
  fora_da_tabela_padrao_por_distrato: foraDaTabelaPadrao,
  sinais,
  chaves,
};
const arquivo = process.argv[2];
if (arquivo) writeFileSync(arquivo, JSON.stringify(saida));
const { chaves: _omitido, ...resumo } = saida;
console.log(JSON.stringify(resumo, null, 2));
