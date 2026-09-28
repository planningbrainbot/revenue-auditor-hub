// Domínio das duas syncs dos sinais: pipefy-tratativas-sync e consultoria-sync. Os formatos de
// entrada copiam o que o Pipefy e a API da Consultoria devolveram em 28/09/2026 (sem dado real).
import test from "node:test";
import assert from "node:assert/strict";
import {
  cardsQueSairam,
  estadoDaFase,
  linhaDoCard,
  resolverEmpresa,
} from "../supabase/functions/pipefy-tratativas-sync/domain.mjs";
import {
  cnpjOuNulo,
  linhaCliente,
  linhaProposta,
  podeMarcarAusentes,
  unicosPorId,
} from "../supabase/functions/consultoria-sync/domain.mjs";

const AGORA = "2026-09-28T19:00:00.000Z";
const card = (fase, campos = {}, extra = {}) => ({
  id: "1407360233",
  title: "Empresa Teste",
  created_at: "2026-07-03T16:43:33-03:00",
  updated_at: "2026-09-10T10:00:00-03:00",
  current_phase: fase,
  phases_history: [{ phase: { id: fase.id }, firstTimeIn: "2026-08-01T09:00:00-03:00" }],
  fields: Object.entries(campos).map(([id, v]) =>
    Array.isArray(v)
      ? { field: { id }, value: JSON.stringify(v.map(() => "título")), array_value: v }
      : { field: { id }, value: v, array_value: null },
  ),
  ...extra,
});

test("Fase vira estado do distrato pelo id; fase nova cai pelo nome, e o padrão é tratativa", () => {
  assert.equal(estadoDaFase("343394578", "Churn Confirmado (Perdido)"), "concluido");
  assert.equal(estadoDaFase("343394575", "Cliente Recuperado (Ganho)"), "revertido");
  assert.equal(estadoDaFase("343394573", "Contatar ASAP"), "tratativa");
  // "Decisão do Cliente" é fase final no Pipefy, mas não diz o desfecho.
  assert.equal(estadoDaFase("343394572", "Decisão do Cliente"), "tratativa");
  assert.equal(estadoDaFase("999", "Arquivado"), "concluido");
  assert.equal(estadoDaFase("999", "Cliente retido"), "revertido");
  assert.equal(estadoDaFase("999", "Fase nova qualquer"), "tratativa");
  // O id antigo de "Recuperado" da versão 14 não existe mais e não pode virar "ganho" por acaso.
  assert.equal(estadoDaFase("343394577", "Fase que não existe"), "tratativa");
});

test("Card concluído vira linha com status compatível, data brasileira em ISO e conector do cliente", () => {
  const l = linhaDoCard(
    card(
      { id: "343394578", name: "Churn Confirmado (Perdido)" },
      {
        unidade_de_neg_cio: "Belém",
        mrr_r: "3,500.00",
        data_do_churn: "03/02/2026",
        id_deal_pipedrive: " 62143 ",
        categoria_do_churn: "Preço",
        cliente: ["1370148811"],
      },
    ),
    AGORA,
  );
  assert.equal(l.status, "lost");
  assert.equal(l.distrato_estado, "concluido");
  assert.equal(l.fase_id, "343394578");
  assert.equal(l.data_churn, "2026-02-03");
  assert.equal(l.mrr, 3500);
  assert.equal(l.pipedrive_deal_id, 62143);
  assert.deepEqual(l.pipefy_cliente_ids, ["1370148811"]);
  assert.equal(l.stage_change_time, "2026-08-01T09:00:00-03:00");
  assert.equal(l.sincronizado_em, AGORA);
  assert.equal(l.empresa_id, null);
});

test("Card sem campos (rascunho) não quebra: tudo nulo, estado pela fase", () => {
  const l = linhaDoCard(card({ id: "343394570", name: "Contato Inicial com Cliente" }), AGORA);
  assert.equal(l.distrato_estado, "tratativa");
  assert.equal(l.status, "open");
  assert.equal(l.data_churn, null);
  assert.equal(l.pipedrive_deal_id, null);
  assert.deepEqual(l.pipefy_cliente_ids, []);
  // Data inválida não vira data.
  const ruim = linhaDoCard(card({ id: "343394578", name: "x" }, { data_do_churn: "31/02/2026" }), AGORA);
  assert.equal(ruim.data_churn, null);
});

test("Empresa do card: conector do Pipefy primeiro, depois o negócio, o mais recente", () => {
  const empresas = [
    { id: 10, pipefy_record_id: "1370148811", pipedrive_id: "1", created_at: "2026-01-01" },
    { id: 20, pipefy_record_id: null, pipedrive_id: "62143", created_at: "2026-02-01" },
    { id: 30, pipefy_record_id: null, pipedrive_id: "62143", created_at: "2026-03-01" },
  ];
  assert.equal(resolverEmpresa({ pipefy_cliente_ids: ["1370148811"], pipedrive_deal_id: 62143 }, empresas), 10);
  assert.equal(resolverEmpresa({ pipefy_cliente_ids: [], pipedrive_deal_id: 62143 }, empresas), 30);
  assert.equal(resolverEmpresa({ pipefy_cliente_ids: [], pipedrive_deal_id: null }, empresas), null);
});

test("Remoção do espelho: leitura vazia ou que perde mais da metade não apaga nada", () => {
  assert.deepEqual(cardsQueSairam(["1", "2"], ["1", "2", "3"]), { sairam: ["3"], recusado: null });
  assert.equal(cardsQueSairam([], ["1", "2"]).recusado, "leitura do Pipefy voltou vazia");
  const existentes = Array.from({ length: 30 }, (_, i) => String(i));
  const r = cardsQueSairam(["0", "1"], existentes);
  assert.deepEqual(r.sairam, []);
  assert.match(r.recusado, /removeria 28 de 30/);
});

const clienteApi = (extra = {}) => ({
  id: "EE145DCE-742F-4FD5-99B1-D210BE7957FF",
  razao_social: "EMPRESA TESTE LTDA",
  nome_fantasia: null,
  cnpj: "38400999000139",
  cnpj_raiz: "38400999",
  grupo_economico: null,
  parceiro: null,
  uf: "GO",
  municipio: "ITUMBIARA",
  cnae: "4530703",
  cnae_descricao: "Comércio",
  porte: "EMPRESA DE PEQUENO PORTE",
  regime_tributario: "LUCRO REAL",
  situacao_receita: "ATIVA",
  ativo: true,
  cadastrado_em: "2026-07-26T20:58:55.882864+00:00",
  atualizado_em: "2026-09-28T17:33:33.431663+00:00",
  ...extra,
});

test("Cliente da API vira linha; os campos reservados entram quando a API trouxer", () => {
  const l = linhaCliente(clienteApi(), AGORA);
  assert.equal(l.id, "ee145dce-742f-4fd5-99b1-d210be7957ff");
  assert.equal(l.cnpj, "38400999000139");
  assert.equal(l.ativo, true);
  assert.equal(l.valor_a_recuperar, null);
  assert.equal(l.inativo_desde, null);
  assert.equal(l.ausente_desde, null);
  assert.equal(l.payload.razao_social, "EMPRESA TESTE LTDA");
  const futuro = linhaCliente(
    clienteApi({ ativo: false, inativo_desde: "2026-08-31", valor_a_recuperar: "1.234.567,89", valor_a_recuperar_em: "30/09/2026" }),
    AGORA,
  );
  assert.equal(futuro.ativo, false);
  assert.equal(futuro.inativo_desde, "2026-08-31");
  assert.equal(futuro.valor_a_recuperar, 1234567.89);
  assert.equal(futuro.valor_a_recuperar_em, "2026-09-30");
});

test("Cliente sem id ou sem CNPJ de 14 dígitos é descartado, não gravado pela metade", () => {
  assert.equal(linhaCliente(clienteApi({ cnpj: "123" }), AGORA), null);
  assert.equal(linhaCliente(clienteApi({ id: "x" }), AGORA), null);
  assert.equal(cnpjOuNulo("38.400.999/0001-39"), "38400999000139");
});

test("Proposta da API vira linha; CNPJ nulo fica nulo e status ausente é aberta", () => {
  const l = linhaProposta(
    {
      id: "63cea812-8d01-46f8-80d0-ece7812f1c04",
      empresa: "Empresa",
      cnpj: null,
      cliente_id: null,
      produto: "Recomposição de Créditos PIS/COFINS",
      linha_produto: "projetos_especificos",
      categoria: "Proposta",
      valor_total: 92000,
      percentual_exito: 20,
      num_parcelas: "3",
      data_envio: "2026-04-06",
      criada_em: "2026-05-26T20:45:01.432232+00:00",
    },
    AGORA,
  );
  assert.equal(l.cnpj, null);
  assert.equal(l.status, null);
  assert.equal(l.valor_total, 92000);
  assert.equal(l.percentual_exito, 20);
  assert.equal(l.num_parcelas, 3);
  assert.equal(l.data_envio, "2026-04-06");
  assert.equal(linhaProposta({ id: "nao-uuid" }, AGORA), null);
});

test("Ativos e inativos viram uma lista por id; ausência só com leitura confiável", () => {
  assert.equal(unicosPorId([[{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }]]).length, 3);
  assert.deepEqual(podeMarcarAusentes(679, 679), { pode: true, motivo: null });
  assert.equal(podeMarcarAusentes(0, 679).pode, false);
  assert.equal(podeMarcarAusentes(300, 679).pode, false);
  assert.equal(podeMarcarAusentes(5, 10).pode, true);
});
