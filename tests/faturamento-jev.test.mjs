// Portal de Faturamento, T5: a montagem dos pedidos ao Jev (src/lib/faturamento/jev.ts). Opções do catálogo
// mais `nenhum`, pré-filtro acima de 25 serviços, `criteria` em toda pergunta, `state` abaixo de 12 mil
// caracteres e nenhum dado pessoal (CPF, CNPJ, e-mail, telefone, nome do cliente) no que sai.
import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUCOES_SUGESTAO,
  LIMIAR_AVISO,
  LIMIAR_SUGESTAO,
  MAX_OPCOES,
  MAX_STATE,
  OPCAO_NENHUM,
  jevFaturamentoLigado,
  lerConferencia,
  lerSugestao,
  limparTexto,
  pedacosDoNome,
  pedidoConferencia,
  pedidoSugestao,
  preFiltrar,
} from "../src/lib/faturamento/jev.ts";
import { validarPedido } from "../src/lib/cockpit-ceo/jev/contrato.ts";

const servico = (n, descricao, o = {}) => ({
  id: `id-${n}`,
  codigo_omie: `9${n}`,
  codigo: `SRV${String(n).padStart(5, "0")}`,
  descricao,
  codigo_lc116: "17.01",
  codigo_municipal: "170101/17.01",
  categoria: "1.01.85",
  ...o,
});

const PAC = [
  servico(1, "Honorários Contábeis", { codigo_lc116: "17.19" }),
  servico(2, "Honorários de Encerramento"),
  servico(8, "BPO Financeiro"),
  servico(10, "Honorários Fiscal"),
  servico(11, "Honorários folha de pagamento"),
];

// 42 serviços, como o catálogo da DOC em 20/10/2026.
const DOC = Array.from({ length: 40 }, (_, i) =>
  servico(100 + i, `Serviço genérico número ${i + 1}`),
).concat([
  servico(200, "Alteração de contrato social (QSA/administração/capital social)"),
  servico(201, "Abertura de CNO - Cadastro Nacional de Obras - Abertura e Baixa"),
]);

const TUDO_PESSOAL = [
  "Cliente: MAGALHAES MATARELI ADMINISTRACAO DE BENS LTDA",
  "CNPJ 57.351.558/0001-39 e também 57351558000139",
  "alfanumérico 12.ABC.345/01DE-35",
  "CPF 123.456.789-09",
  "financeiro@cliente.com.br",
  "Fone (31) 99876-5432",
  "Empresa do cliente a faturar: PROGRESSO AGROINDUSTRIAL LTDA",
  "link https://exemplo.com/boleto?x=1",
  "Contato: José da Silva Pereira",
].join("\n");

test("liga só com FATURAMENTO_JEV=1", () => {
  assert.equal(jevFaturamentoLigado({ FATURAMENTO_JEV: "1" }), true);
  assert.equal(jevFaturamentoLigado({ FATURAMENTO_JEV: "0" }), false);
  assert.equal(jevFaturamentoLigado({}), false);
});

test("limparTexto tira documento, e-mail, telefone, link e o nome do cliente", () => {
  const t = limparTexto(TUDO_PESSOAL, [
    "José da Silva Pereira",
    "Magalhães Mataréli Administração de Bens Ltda",
  ]);
  for (const proibido of [
    "57.351.558",
    "57351558000139",
    "12.ABC.345",
    "123.456.789-09",
    "financeiro@",
    "99876",
    "PROGRESSO",
    "MAGALHAES",
    "exemplo.com",
    "José",
  ])
    assert.ok(!t.includes(proibido), `vazou: ${proibido}\n${t}`);
  assert.match(t, /\[documento\]/);
  assert.match(t, /\[e-mail\]/);
  assert.match(t, /\[telefone\]/);
  assert.match(t, /\[cliente\]/);
  // Texto de trabalho fica como estava.
  assert.equal(
    limparTexto("Alteração contratual 2026 · troca de sócio"),
    "Alteração contratual 2026 · troca de sócio",
  );
  // Palavra comum não vira documento.
  assert.equal(limparTexto("Reprocessamento contábil de 2025"), "Reprocessamento contábil de 2025");
});

test("pedaços do nome: palavras de 3 letras ou mais, sem acento, da mais longa para a mais curta", () => {
  assert.deepEqual(
    pedacosDoNome([
      "FORTALEZA EMPREENDIMENTOS IMOBILIARIOS LTDA",
      "Fortaleza Empreendimentos",
      null,
    ]),
    ["empreendimentos", "imobiliarios", "fortaleza"],
  );
  // Preposição, artigo e tipo de sociedade não identificam; palavra de 1 ou 2 letras também não.
  assert.deepEqual(pedacosDoNome(["Casa das Artes do Sul S.A. EIRELI"]), ["artes", "casa", "sul"]);
  assert.deepEqual(pedacosDoNome(["João Lúcio"]), ["lucio", "joao"]);
  assert.deepEqual(pedacosDoNome([undefined, ""]), []);
});

test("o nome do cliente sai aos pedaços: Grupo Fortaleza com o tomador FORTALEZA EMPREENDIMENTOS (M6)", () => {
  const nomes = ["FORTALEZA EMPREENDIMENTOS IMOBILIARIOS LTDA"];
  const projeto = limparTexto("Grupo Fortaleza · reestruturação societária", nomes);
  assert.ok(!/fortaleza/i.test(projeto), projeto);
  assert.equal(projeto, "Grupo [cliente] · reestruturação societária");
  // Acento e caixa não salvam o nome; palavras seguidas viram um marcador só.
  assert.equal(
    limparTexto("Consultoria para a Fortaléza Empreendimentos Imobiliários, 2026", nomes),
    "Consultoria para a [cliente], 2026",
  );
  // Pedaço dentro de outra palavra fica (não é o nome): "Fortalezas" não é "Fortaleza".
  assert.equal(limparTexto("Fortalezas do Norte", nomes), "Fortalezas do Norte");
  // O que vai ao Jev (sugestão e conferência) já sai sem o nome.
  const servicos = [servico(1, "Assessoria societária")];
  const sug = pedidoSugestao({
    descricao: "Reestruturação da Fortaleza Empreendimentos",
    projeto: "Grupo Fortaleza",
    servicos,
    nomesParaTirar: nomes,
  });
  assert.ok(
    !/fortaleza|empreendimentos/i.test(JSON.stringify(sug.pedido)),
    JSON.stringify(sug.pedido),
  );
  const conf = pedidoConferencia({
    descricao: "Reestruturação da Fortaleza Empreendimentos",
    servico: servicos[0],
    valor: 1000,
    nomesParaTirar: nomes,
  });
  assert.ok(!/fortaleza|empreendimentos/i.test(JSON.stringify(conf)), JSON.stringify(conf));
});

test("até 25 serviços, todos viram opção, mais `nenhum`; a chave é o código do serviço", () => {
  const m = pedidoSugestao({
    emissora: "PAC",
    projeto: "",
    descricao: "Folha de pagamento mensal",
    valor: 1500,
    servicos: PAC,
  });
  const q = m.pedido.questions.servico;
  assert.equal(q.type, "choice");
  assert.deepEqual(Object.keys(q.criteria), [
    "SRV00001",
    "SRV00002",
    "SRV00008",
    "SRV00010",
    "SRV00011",
    OPCAO_NENHUM,
  ]);
  assert.equal(q.criteria.SRV00001, "Honorários Contábeis [LC 116 17.19]");
  assert.equal(m.mapa.SRV00011, "id-11");
  assert.equal(m.filtrado, false);
  assert.equal(m.opcoes, 6);
  assert.equal(q.instructions, INSTRUCOES_SUGESTAO);
  // O pedido segue o contrato do OpenRouter: criteria em toda pergunta (validarPedido do adaptador).
  assert.doesNotThrow(() => validarPedido(m.pedido));
  assert.deepEqual(m.pedido.state, {
    emissora: "PAC",
    projeto: "(sem projeto)",
    descricao: "Folha de pagamento mensal",
    valor: "R$ 1.500,00",
  });
});

test("acima de 25 serviços, o pré-filtro guarda os 25 mais prováveis pela descrição", () => {
  const m = pedidoSugestao({
    emissora: "DOC",
    projeto: "Societário",
    descricao: "Alteração do contrato social para troca de sócio",
    valor: null,
    servicos: DOC,
  });
  const chaves = Object.keys(m.pedido.questions.servico.criteria);
  assert.equal(chaves.length, MAX_OPCOES + 1);
  assert.equal(m.filtrado, true);
  assert.equal(chaves[0], "SRV00200"); // o que mais casa vem primeiro
  assert.ok(chaves.includes(OPCAO_NENHUM));
  assert.equal(preFiltrar(PAC, "qualquer coisa").length, PAC.length);
  assert.equal(preFiltrar(DOC, "obras CNO abertura")[0].codigo, "SRV00201");
});

test("nada de dado pessoal no que vai ao Jev, nem no state nem nas opções", () => {
  const m = pedidoSugestao({
    emissora: "DOC",
    projeto: "Contrato do cliente 57.351.558/0001-39",
    descricao: TUDO_PESSOAL,
    valor: 1,
    servicos: DOC,
    nomesParaTirar: ["José da Silva Pereira", "MAGALHAES MATARELI ADMINISTRACAO DE BENS LTDA"],
  });
  const saida = JSON.stringify(m.pedido);
  for (const proibido of [
    "57.351.558",
    "57351558000139",
    "12.ABC.345",
    "123.456.789",
    "@cliente",
    "99876",
    "MAGALHAES",
    "PROGRESSO",
    "José",
  ])
    assert.ok(!saida.includes(proibido), `vazou: ${proibido}`);
  assert.deepEqual(Object.keys(m.pedido.state).sort(), [
    "descricao",
    "emissora",
    "projeto",
    "valor",
  ]);
  const c = pedidoConferencia({
    emissora: "DOC",
    servico: DOC[40],
    descricao: TUDO_PESSOAL,
    valor: 1,
    nomesParaTirar: ["José da Silva Pereira"],
  });
  const saidaC = JSON.stringify(c);
  for (const proibido of ["57.351.558", "financeiro@", "99876", "José"])
    assert.ok(!saidaC.includes(proibido), `vazou: ${proibido}`);
  assert.deepEqual(Object.keys(c.state).sort(), ["descricao_nota", "emissora", "servico", "valor"]);
});

test("o state fica abaixo de 12 mil caracteres mesmo com descrição enorme", () => {
  const enorme = "Alteração contratual com muitos detalhes. ".repeat(2_000);
  const m = pedidoSugestao({
    emissora: "DOC",
    projeto: "x",
    descricao: enorme,
    valor: 1,
    servicos: DOC,
  });
  assert.ok(JSON.stringify(m.pedido.state).length <= MAX_STATE);
  const c = pedidoConferencia({ emissora: "DOC", servico: DOC[40], descricao: enorme, valor: 1 });
  assert.ok(JSON.stringify(c.state).length <= MAX_STATE);
});

test("catálogo sem código único usa chaves s01, s02…", () => {
  const sem = [servico(1, "A", { codigo: null }), servico(2, "B", { codigo: null })];
  const m = pedidoSugestao({
    emissora: "X",
    projeto: "",
    descricao: "a",
    valor: null,
    servicos: sem,
  });
  assert.deepEqual(Object.keys(m.pedido.questions.servico.criteria), ["s01", "s02", OPCAO_NENHUM]);
  assert.deepEqual(m.mapa, { s01: "id-1", s02: "id-2" });
});

test("a conferência é um noul com criteria true e false", () => {
  const c = pedidoConferencia({
    emissora: "DOC",
    servico: DOC[40],
    descricao: "Troca de sócio",
    valor: 1500,
  });
  assert.equal(c.questions.combina.type, "noul");
  assert.deepEqual(Object.keys(c.questions.combina.criteria), ["true", "false"]);
  assert.doesNotThrow(() => validarPedido(c));
  assert.equal(
    c.state.servico,
    "Alteração de contrato social (QSA/administração/capital social) (SRV00200) [LC 116 17.01]",
  );
});

test("lerSugestao: escolha, confiança e top-3 com o serviço", () => {
  const m = pedidoSugestao({
    emissora: "PAC",
    projeto: "",
    descricao: "folha",
    valor: null,
    servicos: PAC,
  });
  const s = lerSugestao(
    {
      type: "choice",
      choice: "SRV00011",
      confidence: 0.98,
      probabilities: { SRV00011: 0.98, SRV00001: 0.01, nenhum: 0.005, SRV00008: 0.005 },
    },
    m.mapa,
    PAC,
  );
  assert.equal(s.servicoId, "id-11");
  assert.equal(s.codigo, "SRV00011");
  assert.equal(s.confianca, 0.98);
  assert.deepEqual(
    s.top3.map((x) => [x.codigo, x.probabilidade]),
    [
      ["SRV00011", 0.98],
      ["SRV00001", 0.01],
      [null, 0.01],
    ],
  );
  const nenhum = lerSugestao(
    { type: "choice", choice: "nenhum", confidence: 0.9, probabilities: null },
    m.mapa,
    PAC,
  );
  assert.equal(nenhum.servicoId, null);
  assert.equal(lerSugestao(undefined, m.mapa, PAC), null);
});

test("lerConferencia: avisa só com não combina e confiança ≥ 0,7", () => {
  assert.equal(LIMIAR_AVISO, 0.7);
  assert.equal(LIMIAR_SUGESTAO, 0.5);
  assert.deepEqual(lerConferencia({ type: "noul", noul: 0.9 }), {
    combina: true,
    confianca: 0.9,
    avisar: false,
  });
  assert.deepEqual(lerConferencia({ type: "noul", noul: 0.2 }), {
    combina: false,
    confianca: 0.8,
    avisar: true,
  });
  assert.deepEqual(lerConferencia({ type: "noul", noul: 0.4 }), {
    combina: false,
    confianca: 0.6,
    avisar: false,
  });
  assert.equal(lerConferencia(undefined), null);
});
