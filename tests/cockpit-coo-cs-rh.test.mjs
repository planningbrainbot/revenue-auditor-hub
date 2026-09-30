// Tema Qua · CS e RH do Cockpit do COO: regras de montagem sobre dados sintéticos.
// Os valores esperados foram calculados à mão (conta no comentário de cada caso), não pela função.
import test from "node:test";
import assert from "node:assert/strict";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";
import { MAX_NUMEROS } from "../src/lib/cockpit-coo/contrato.ts";
import {
  montarCsRh,
  dataSaoPaulo,
  diasEntre,
  inicioDoTrimestre,
  notaNps,
} from "../src/lib/cockpit-coo/temas/cs-rh.ts";

const HOJE = "2026-09-29"; // T3/2026: 01/07 a 29/09

// Cadastro de 29/09/2026 (ops.unidades).
const UNIDADES = lerUnidades([
  { id: 1, nome_da_praca: "Curitiba", tipo: "regional", data_inauguracao: "2025-04-01" },
  { id: 2, nome_da_praca: "Patos de Minas", tipo: "regional", data_inauguracao: "2024-08-01" },
  { id: 3, nome_da_praca: "Belém", tipo: "regional", data_inauguracao: "2025-06-01" },
  { id: 4, nome_da_praca: "Rio de Janeiro", tipo: "regional", data_inauguracao: "2024-07-01" },
  { id: 5, nome_da_praca: "Campo Novo", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 6, nome_da_praca: "São Luis", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 7, nome_da_praca: "Fortaleza", tipo: "regional", data_inauguracao: "2026-04-01" },
  { id: 8, nome_da_praca: "Maceió", tipo: "regional", data_inauguracao: "2026-05-01" },
  { id: 9, nome_da_praca: "Goiânia", tipo: "interna", data_inauguracao: null },
  { id: 10, nome_da_praca: "Construção Civil", tipo: "interna", data_inauguracao: null },
  { id: 11, nome_da_praca: "Consultoria", tipo: "interna", data_inauguracao: null },
  { id: 12, nome_da_praca: "São Bernardo", tipo: "regional", data_inauguracao: null },
  { id: 13, nome_da_praca: "Recife", tipo: "regional", data_inauguracao: null },
  { id: 14, nome_da_praca: "Sorocaba", tipo: "regional", data_inauguracao: null },
  { id: 15, nome_da_praca: "São Paulo", tipo: "interna", data_inauguracao: null },
]);

const trat = (id, status, unidade, data_churn, deal, criado) => ({
  id,
  status,
  unidade,
  data_churn,
  pipedrive_deal_id: deal,
  pipefy_criado_em: criado,
  created_at: criado,
});
const pesq = (id, unidade, nota, data_envio, canal = "whatsapp", created_at = null) => ({
  id,
  unidade,
  nps_recomendacao: nota,
  data_envio,
  created_at: created_at ?? (data_envio ? `${data_envio}T12:00:00+00:00` : null),
  canal_resposta: canal,
});
const aud = (id, unidade, fase, finalizada, prazo) => ({
  pipefy_card_id: id,
  unidade,
  fase_atual: fase,
  auditoria_finalizada: finalizada,
  prazo_atual: prazo,
});

function dados() {
  return {
    tratativas: {
      ok: true,
      atualizadoEm: "2026-09-29T11:00:00+00:00",
      linhas: [
        trat(1, "lost", "Patos de Minas", "2026-08-13", 101, "2026-08-14T17:25:52+00:00"),
        trat(2, "lost", "Fortaleza", "2026-07-21", 102, "2026-07-28T16:19:13+00:00"),
        trat(3, "lost", "Maceió", "2026-07-20", 103, "2026-07-20T19:01:03+00:00"), // deal sem contrato
        trat(4, "lost", "Belém", "2026-02-03", 104, "2026-07-03T19:43:33+00:00"), // T1: fora
        trat(5, "open", "Belém", null, 105, "2026-07-06T13:36:48+00:00"), // 85 dias
        trat(6, "open", "Curitiba", null, 106, "2026-09-24T12:00:00+00:00"), // 5 dias
        trat(7, "open", "Itaúna", null, 107, "2026-07-01T12:00:00+00:00"), // fora do cadastro
        trat(8, "lost", "Patos de Minas", "2026-10-05", 108, "2026-09-28T12:00:00+00:00"), // futuro
      ],
    },
    contratos: {
      ok: true,
      linhas: [
        { pipedrive_deal_id: "101", mrr_mensal: 12000 },
        { pipedrive_deal_id: "102", mrr_mensal: "2900" },
        { pipedrive_deal_id: "102", mrr_mensal: 100 }, // dois contratos no mesmo negócio: 3000
        { pipedrive_deal_id: "104", mrr_mensal: 97500 },
        { pipedrive_deal_id: "105", mrr_mensal: 4052 },
        { pipedrive_deal_id: "108", mrr_mensal: 9999 },
      ],
    },
    carteira: {
      ok: true,
      linhas: [
        { unidade: "Belém", num_contratos: 100, mrr_total: 100000 },
        { unidade: "Patos de Minas", num_contratos: 30, mrr_total: "200000.00" },
        { unidade: "Fortaleza", num_contratos: 20, mrr_total: 30000 },
        { unidade: "Maceió", num_contratos: 60, mrr_total: 80000 },
        { unidade: "Curitiba", num_contratos: 120, mrr_total: 70000 },
        { unidade: "Matriz", num_contratos: 145, mrr_total: 1000000 }, // Goiânia, sem card na Central
        { unidade: "Campo Novo", num_contratos: 23, mrr_total: 30000 },
        { unidade: "Itaúna", num_contratos: 1, mrr_total: 5000 },
        { unidade: "São Bernardo", num_contratos: 29, mrr_total: 40000 },
      ],
    },
    metaChurn: { ok: true, valor: null },
    nps: {
      ok: true,
      atualizadoEm: "2026-09-25T20:00:00+00:00",
      linhas: [
        // Belém: 11 enviadas, 6 respostas (10, 9, 9, 7, 3 por ligação, 2) → NPS (3−2)/6 = 17
        pesq(101, "Belém", "10", "2026-08-24"),
        pesq(102, "Belém", "9", "2026-08-24"),
        pesq(103, "Belém", "9", "2026-08-24"),
        pesq(104, "Belém", "7", "2026-08-24"),
        pesq(105, "Belém", "3", "2026-08-24", "ligacao"),
        pesq(106, "Belém", "2", "2026-09-25"),
        pesq(107, "Belém", null, "2026-08-24"),
        pesq(108, "Belém", "Sem Resposta", "2026-08-24"),
        pesq(109, "Belém", "", "2026-08-24"),
        pesq(110, "Belém", null, "2026-08-24"),
        pesq(111, "Belém", null, "2026-08-24"),
        // Campo Novo: 2 enviadas, 1 detrator sem ligação há 33 dias
        pesq(201, "Campo Novo", "5", "2026-08-27"),
        pesq(202, "Campo Novo", null, "2026-08-27"),
        // Rio: 3 enviadas (uma sem data de envio, pela criação em setembro), 1 promotor
        pesq(301, "Rio de Janeiro", "10", null, "whatsapp", "2026-09-10T15:00:00+00:00"),
        pesq(302, "Rio de Janeiro", null, "2026-09-10"),
        pesq(303, "Rio de Janeiro", null, "2026-09-10"),
        // "São Luís" com acento casa com "São Luis" do cadastro
        pesq(401, "São Luís", "9", "2026-09-03"),
        pesq(402, "São Luis", null, "2026-09-03"),
        // Fortaleza: detrator com ligação registrada
        pesq(501, "Fortaleza", "6", "2026-09-01"),
        // Matriz = Goiânia, só em junho (T2 e fora da janela de 90 dias)
        pesq(601, "Matriz", "3", "2026-06-11"),
        pesq(602, "Matriz", null, "2026-06-11"),
        // sem unidade: fica fora
        pesq(701, null, "10", "2026-08-24"),
        // Recife em implantação: fora do NPS, dentro do alerta
        pesq(801, "Recife", "0", "2026-09-20"),
      ],
    },
    ligacoes: { ok: true, pesquisaIds: [501, 107], atualizadoEm: "2026-09-03T12:00:00+00:00" },
    auditorias: {
      ok: true,
      atualizadoEm: "2026-09-29T10:00:00+00:00",
      linhas: [
        aud("a1", "Curitiba", "Solicitações Enviadas", false, "2026-06-05T15:00:00+00:00"), // 116 dias
        aud("a2", "Curitiba", "Documentos Recebidos", false, null), // sem prazo
        aud("a3", "Campo Novo", "Solicitações Enviadas", false, "2026-09-10T12:00:00+00:00"), // 19 dias
        aud("a4", "Matriz", "Documentos Recebidos", false, "2026-06-19T12:00:00+00:00"), // 102 dias
        aud("a5", "Belém", "Projeto Concluído", false, "2026-06-01T12:00:00+00:00"), // fase final
        aud("a6", "Rio de Janeiro", "Solicitações Enviadas", true, "2026-06-01T12:00:00+00:00"), // finalizada
        aud("a7", "Comercial", "Solicitações Enviadas", false, "2026-06-01T12:00:00+00:00"), // fora do cadastro
        aud("a8", "Sorocaba", "Documentos Recebidos", false, "2026-10-15T12:00:00+00:00"), // no prazo
      ],
    },
    pessoas: {
      ok: true,
      atualizadoEm: "2026-09-28T16:14:31+00:00",
      linhas: [
        { id: 1, unidade_id: 8, data_admissao: "2026-09-14" },
        { id: 2, unidade_id: 8, data_admissao: "2026-09-22" },
        { id: 3, unidade_id: 8, data_admissao: "2026-10-01" }, // futura
        { id: 4, unidade_id: 3, data_admissao: "2026-09-03" },
        { id: 5, unidade_id: 3, data_admissao: "2026-08-12" }, // mês anterior
        { id: 6, unidade_id: null, data_admissao: "2026-09-01" }, // sem unidade
        { id: 7, unidade_id: 1, data_admissao: "2025-01-10" },
        { id: 8, unidade_id: 4, data_admissao: "2024-05-01" },
        { id: 9, unidade_id: 2, data_admissao: "2024-01-01" },
        { id: 10, unidade_id: 8, data_admissao: null },
      ],
    },
  };
}

const num = (l, id) => l.numeros.find((n) => n.id === id);

test("datas: São Paulo, dias corridos e início do trimestre", () => {
  assert.equal(dataSaoPaulo("2026-07-06T13:36:48+00:00"), "2026-07-06");
  assert.equal(dataSaoPaulo("2026-07-06 02:10:00+00"), "2026-07-05"); // 23h10 do dia 5 em Brasília
  assert.equal(dataSaoPaulo("2026-08-13"), "2026-08-13");
  assert.equal(dataSaoPaulo(null), null);
  assert.equal(dataSaoPaulo("lixo"), null);
  assert.equal(diasEntre("2026-07-06", HOJE), 85);
  assert.equal(inicioDoTrimestre(HOJE), "2026-07-01");
  assert.equal(inicioDoTrimestre("2026-10-01"), "2026-10-01");
  assert.equal(notaNps("10"), 10);
  assert.equal(notaNps("0"), 0);
  assert.equal(notaNps("Sem Resposta"), null);
  assert.equal(notaNps(""), null);
  assert.equal(notaNps("11"), null);
});

test("no máximo 6 números, cada um com dono, fonte, cobertura e explicação", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  assert.equal(l.tema, "cs-rh");
  assert.ok(l.numeros.length <= MAX_NUMEROS);
  assert.deepEqual(
    l.numeros.map((n) => n.id),
    [
      "churn-trimestre",
      "tratativas-abertas",
      "nps-trimestre",
      "auditorias-em-andamento",
      "admissoes-mes",
      "vagas-abertas",
    ],
  );
  for (const n of l.numeros) {
    assert.ok(n.explicacao.oQueDiz && n.explicacao.comoCalcula && n.explicacao.dono, n.id);
    assert.ok(n.fonte, n.id);
    // Nenhum número do tema é "só rede": a Central, o NPS e o cadastro têm linha de qualquer unidade.
    assert.equal(n.cobertura, "todas", n.id);
    if (n.estado !== "disponivel" && n.estado !== "parcial") assert.equal(n.valor, null, n.id);
  }
  assert.equal(l.universo, "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria");
  assert.equal(l.graficos.length, 1);
});

test("churn no trimestre: MRR do contrato ÷ carteira de quem usa a Central; sem card é sem registro", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const n = num(l, "churn-trimestre");
  // Usam a Central: Belém 100.000, Patos 200.000, Fortaleza 30.000, Maceió 80.000, Curitiba 70.000
  // = 480.000. Perdido no T3: Patos 12.000 + Fortaleza 3.000 (dois contratos) = 15.000; Maceió sem
  // contrato; Belém é de fevereiro; o card de outubro é futuro. 15.000 ÷ 480.000 = 3,125% → 3,1.
  // Goiânia (1.000.000) não entra: nunca lançou card. Com ela seria 1,0%.
  assert.equal(n.valor, 3.1);
  assert.equal(n.estado, "parcial");
  assert.equal(n.nota, "3 clientes perdidos no T3/2026");
  assert.match(n.motivo, /sem registro: .*Goiânia/);
  assert.match(n.motivo, /1 card sem contrato para dar o MRR \(Maceió\)/);
  assert.deepEqual(n.meta, { valor: 5, rotulo: "meta padrão do IDU" });
  assert.equal(n.tom, undefined);
  const linha = (nome) => n.dados.linhas.find((x) => x[0] === nome);
  assert.deepEqual(linha("Goiânia"), ["Goiânia", 1000000, null, null, "sem registro"]);
  assert.deepEqual(linha("Fortaleza"), ["Fortaleza", 30000, 1, 3000, 10]);
  assert.deepEqual(linha("Belém"), ["Belém", 100000, 0, 0, 0]);
  assert.deepEqual(linha("Maceió"), ["Maceió", 80000, 1, 0, "sem MRR"]);
  // Em implantação não entra em número de desempenho.
  assert.equal(linha("São Bernardo"), undefined);
  assert.equal(n.dados.linhas.length, 12);
});

test("churn: meta gravada da rede aparece ao lado e acende quando é superada", () => {
  const d = dados();
  d.metaChurn = { ok: true, valor: 2 };
  const n = num(montarCsRh(d, UNIDADES, "", HOJE), "churn-trimestre");
  assert.deepEqual(n.meta, { valor: 2, rotulo: "meta da rede no IDU" });
  assert.equal(n.tom, "perigo");
  // Sem leitura da meta, nenhuma meta (não inventa os 5%).
  d.metaChurn = { ok: false, estado: "acesso_insuficiente", motivo: "x" };
  assert.equal(num(montarCsRh(d, UNIDADES, "", HOJE), "churn-trimestre").meta, undefined);
});

test("churn: operação própria sem card na Central é não apurado, nunca 0%", () => {
  const n = num(montarCsRh(dados(), UNIDADES, "propria", HOJE), "churn-trimestre");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  assert.equal(n.motivo, "nenhuma unidade do filtro lança churn na Central de Tratativas");
  const g = montarCsRh(dados(), UNIDADES, "propria", HOJE).graficos[0];
  assert.equal(g.estado, "nao_apurado");
  assert.ok(g.pontos.every((p) => p.churn === null));
});

test("churn: unidade que usa a Central e não perdeu cliente no trimestre tem zero de fato", () => {
  const n = num(montarCsRh(dados(), UNIDADES, "1", HOJE), "churn-trimestre"); // Curitiba
  assert.equal(n.valor, 0);
  assert.equal(n.estado, "parcial");
  assert.equal(n.nota, "0 clientes perdidos no T3/2026");
  assert.deepEqual(n.destino.search, {
    aba: "tratativas",
    status: "lost",
    de: "2026-07-01",
    ate: HOJE,
    unidade: "Curitiba",
  });
});

test("unidade em implantação: fora do desempenho, dentro da fila", () => {
  const l = montarCsRh(dados(), UNIDADES, "13", HOJE); // Recife
  assert.equal(num(l, "churn-trimestre").estado, "nao_apurado");
  assert.match(num(l, "churn-trimestre").motivo, /Recife está em implantação/);
  assert.equal(num(l, "nps-trimestre").estado, "nao_apurado");
  assert.equal(l.graficos[0].estado, "nao_apurado");
  // O detrator de Recife ainda vira alerta: é cliente a atender, não desempenho.
  assert.deepEqual(
    l.alertas.map((a) => a.titulo),
    ["Recife · detrator sem ligação há 9 dias"],
  );
});

test("gráfico: churn por unidade, maior primeiro, sem registro e sem MRR por último", () => {
  const g = montarCsRh(dados(), UNIDADES, "", HOJE).graficos[0];
  assert.equal(g.titulo, "Onde a carteira está perdendo cliente?");
  assert.equal(g.tipo, "barras-h");
  assert.equal(g.estado, "parcial");
  // Fortaleza 3.000 ÷ 30.000 = 10; Patos 12.000 ÷ 200.000 = 6; Belém e Curitiba 0.
  assert.deepEqual(
    g.pontos.map((p) => [p.rotulo, p.churn]),
    [
      ["Fortaleza", 10],
      ["Patos de Minas", 6],
      ["Belém", 0],
      ["Curitiba", 0],
      ["Campo Novo", null],
      ["Construção Civil", null],
      ["Consultoria", null],
      ["Goiânia", null],
      ["Maceió", null],
      ["Rio de Janeiro", null],
      ["São Luis", null],
      ["São Paulo", null],
    ],
  );
});

test("tratativas abertas: conta as do cadastro, idade pela criação do card", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const n = num(l, "tratativas-abertas");
  // Belém (85 dias) e Curitiba (5 dias); a de Itaúna não é unidade do cadastro.
  assert.equal(n.valor, 2);
  assert.equal(n.estado, "disponivel");
  assert.equal(n.nota, "a mais antiga está aberta há 85 dias");
  assert.equal(n.tom, "perigo");
  assert.match(n.explicacao.atencao, /1 tratativa aberta sem unidade do cadastro ficou fora/);
  assert.match(n.explicacao.atencao, /Sem nenhum card na Central: .*Goiânia/);
  // Filtro sem nenhuma aberta: zero lido da fonte é zero.
  const p = num(montarCsRh(dados(), UNIDADES, "propria", HOJE), "tratativas-abertas");
  assert.equal(p.valor, 0);
  assert.equal(p.nota, "nenhuma tratativa aberta");
});

test("alerta de tratativa: limiar de 10 dias, crítico acima de 30", () => {
  const d = dados();
  d.tratativas.linhas = [
    trat(1, "open", "Maceió", null, 1, "2026-09-19T12:00:00+00:00"), // 10 dias: não alerta
    trat(2, "open", "Fortaleza", null, 2, "2026-09-18T12:00:00+00:00"), // 11 dias: atenção
    trat(3, "open", "Rio de Janeiro", null, 3, "2026-08-29T12:00:00+00:00"), // 31 dias: crítico
    trat(4, "open", "Rio de Janeiro", null, 4, "2026-09-10T12:00:00+00:00"), // 19 dias
  ];
  const l = montarCsRh(d, UNIDADES, "", HOJE);
  const tr = l.alertas.filter((a) => a.regra === "tratativa-aberta");
  assert.deepEqual(
    tr.map((a) => [a.titulo, a.gravidade, a.peso]),
    [
      ["Rio de Janeiro · 2 tratativas de cancelamento abertas há mais de 10 dias", "critico", 31],
      ["Fortaleza · tratativa de cancelamento aberta há 11 dias", "atencao", 11],
    ],
  );
  assert.equal(tr[0].chave, "coo:cs-rh:tratativa-aberta:rio-de-janeiro:t3-2026");
  assert.equal(tr[0].unidade, "Rio de Janeiro");
  assert.equal(tr[0].destino.rota, "/painel-cs");
  assert.ok(tr[0].limiar.includes("10 dias"));
});

test("NPS no trimestre: unidades em operação, com nota de 0 a 10, e taxa de resposta", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const n = num(l, "nps-trimestre");
  // Enviadas no T3 em unidade em operação: Belém 11, Campo Novo 2, Rio 3, São Luis 2, Fortaleza 1
  // = 19. Respostas: 6 + 1 + 1 + 1 + 1 = 10. Promotores 5 (10, 9, 9, 10, 9), detratores 4 (3, 2, 5, 6).
  // NPS = (5 − 4) ÷ 10 = 10. Taxa 10 ÷ 19 = 52,6%. Goiânia (junho), Recife (implantação) e a
  // pesquisa sem unidade ficam fora.
  assert.equal(n.valor, 10);
  assert.equal(n.estado, "disponivel");
  assert.equal(n.nota, "10 respostas de 19 pesquisas (52,6%)");
  assert.equal(n.tom, "atencao");
  assert.match(n.explicacao.atencao, /1 pesquisa sem unidade do cadastro ficou fora/);
  const linha = (nome) => n.dados.linhas.find((x) => x[0] === nome);
  assert.deepEqual(linha("Belém"), ["Belém", 11, 6, 17]); // (3 − 2) ÷ 6 = 16,7 → 17
  assert.deepEqual(linha("Campo Novo"), ["Campo Novo", 2, 1, null]); // amostra < 5
  assert.deepEqual(linha("São Luis"), ["São Luis", 2, 1, null]);
  assert.deepEqual(linha("Goiânia"), ["Goiânia", 0, 0, null]); // própria entra no perímetro
  assert.equal(linha("Recife"), undefined);
});

test("NPS: amostra pequena e trimestre sem pesquisa não viram número", () => {
  const cn = num(montarCsRh(dados(), UNIDADES, "5", HOJE), "nps-trimestre"); // Campo Novo
  assert.equal(cn.estado, "nao_apurado");
  assert.equal(cn.valor, null);
  assert.equal(cn.motivo, "só 1 resposta no T3/2026; abaixo de 5 o NPS não é calculado");
  assert.equal(cn.nota, "1 de 2 pesquisas respondidas (50%)");
  const go = num(montarCsRh(dados(), UNIDADES, "9", HOJE), "nps-trimestre"); // Goiânia
  assert.equal(go.estado, "nao_apurado");
  assert.equal(go.motivo, "nenhuma pesquisa enviada no T3/2026");
});

test("alerta de detrator: sem ligação e sem resposta por ligação, crítico após 7 dias", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const det = l.alertas.filter((a) => a.regra === "detrator-sem-ligacao");
  // Campo Novo 27/08 (33 dias) e Recife 20/09 (9 dias): críticos. Belém 25/09 (4 dias): atenção.
  // Belém nota 3 veio por ligação; Fortaleza tem ligação registrada; Goiânia é de junho (> 90 dias).
  assert.deepEqual(
    det.map((a) => [a.titulo, a.gravidade, a.peso]),
    [
      ["Campo Novo · detrator sem ligação há 33 dias", "critico", 33],
      ["Recife · detrator sem ligação há 9 dias", "critico", 9],
      ["Belém · detrator sem ligação há 4 dias", "atencao", 4],
    ],
  );
  assert.equal(det[0].destino.rota, "/nps");
  assert.equal(det[0].destino.search.categoria, "detrator");
  // Sem leitura das ligações, a regra não é avaliada (todo detrator pareceria sem ligação).
  const d = dados();
  d.ligacoes = { ok: false, estado: "acesso_insuficiente", motivo: "sem acesso" };
  const l2 = montarCsRh(d, UNIDADES, "", HOJE);
  assert.equal(l2.alertas.filter((a) => a.regra === "detrator-sem-ligacao").length, 0);
  assert.ok(l2.avisos.some((a) => a.includes("ligações do NPS")));
});

test("auditorias em andamento: régua da tela, prazo vencido e alerta acima de 30 dias", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const n = num(l, "auditorias-em-andamento");
  // Em andamento no cadastro: Curitiba 2, Campo Novo 1, Goiânia (Matriz) 1, Sorocaba 1 = 5.
  // Vencidas: a1 (116 dias), a3 (19), a4 (102) = 3. "Comercial" não é unidade.
  assert.equal(n.valor, 5);
  assert.equal(n.nota, "3 com prazo vencido");
  assert.equal(n.tom, "perigo");
  assert.match(n.explicacao.atencao, /1 projeto está sem prazo no card/);
  assert.match(n.explicacao.atencao, /1 projeto sem unidade do cadastro ficou fora/);
  const au = l.alertas.filter((a) => a.regra === "auditoria-prazo-vencido");
  assert.deepEqual(
    au.map((a) => [a.titulo, a.gravidade, a.peso]),
    [
      ["Curitiba · auditoria interna com prazo vencido há 116 dias", "atencao", 116],
      ["Goiânia · auditoria interna com prazo vencido há 102 dias", "atencao", 102],
    ],
  );
});

test("admissões no mês: cadastro de Gente, parcial quando falta unidade cadastrada", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  const n = num(l, "admissoes-mes");
  // Setembro até 29/09: Maceió 14/09 e 22/09, Belém 03/09 = 3. A de 01/10 é futura; a sem unidade
  // fica fora (e é dita).
  assert.equal(n.valor, 3);
  assert.equal(n.estado, "parcial");
  assert.match(n.motivo, /^10 de 15 unidades sem ninguém no cadastro de Gente/);
  assert.match(n.explicacao.atencao, /1 admissão do mês sem unidade no cadastro ficou fora/);
  assert.equal(n.explicacao.dono, "Heloísa (Gente e Gestão)");
  assert.deepEqual(
    n.dados.linhas.find((x) => x[0] === "Goiânia"),
    ["Goiânia", null, "sem registro"],
  );
  assert.deepEqual(n.dados.linhas.find((x) => x[0] === "Maceió"), ["Maceió", 2, 4]);
  // Unidade com cadastro: número cheio. Sem cadastro: não apurado, não 0.
  const belem = num(montarCsRh(dados(), UNIDADES, "3", HOJE), "admissoes-mes");
  assert.equal(belem.valor, 1);
  assert.equal(belem.estado, "disponivel");
  const propria = num(montarCsRh(dados(), UNIDADES, "propria", HOJE), "admissoes-mes");
  assert.equal(propria.estado, "nao_apurado");
  assert.equal(propria.valor, null);
});

test("vagas abertas: sempre não apurado, com a Heloísa como dona da lacuna", () => {
  for (const filtro of ["", "rede", "propria", "3"]) {
    const n = num(montarCsRh(dados(), UNIDADES, filtro, HOJE), "vagas-abertas");
    assert.equal(n.estado, "nao_apurado");
    assert.equal(n.valor, null);
    assert.equal(n.motivo, "o recrutamento roda no PandaPé, sem integração com o Brain");
    assert.equal(n.explicacao.dono, "Heloísa (Gente e Gestão)");
    assert.match(n.explicacao.atencao, /tabela de vagas/);
    assert.equal(n.destino, null);
  }
});

test("fonte que falha derruba só a sua parte", () => {
  const d = dados();
  d.tratativas = { ok: false, estado: "fonte_indisponivel", motivo: "a consulta de tratativas falhou" };
  d.pessoas = { ok: false, estado: "acesso_insuficiente", motivo: "sua conta não lê o cadastro de pessoas por inteiro" };
  const l = montarCsRh(d, UNIDADES, "", HOJE);
  for (const id of ["churn-trimestre", "tratativas-abertas"]) {
    assert.equal(num(l, id).estado, "fonte_indisponivel", id);
    assert.equal(num(l, id).valor, null, id);
  }
  assert.equal(num(l, "admissoes-mes").estado, "acesso_insuficiente");
  assert.equal(num(l, "admissoes-mes").valor, null);
  assert.equal(l.graficos[0].estado, "fonte_indisponivel");
  // O resto segue.
  assert.equal(num(l, "nps-trimestre").valor, 10);
  assert.equal(num(l, "auditorias-em-andamento").valor, 5);
  assert.equal(l.alertas.filter((a) => a.regra === "tratativa-aberta").length, 0);
  assert.ok(!l.fontes.some((f) => f.fonte.includes("Central")));
  // Contratos sem leitura: sem MRR não há churn (não vira 0%).
  const d2 = dados();
  d2.contratos = { ok: false, estado: "fonte_indisponivel", motivo: "a consulta de contratos falhou" };
  assert.equal(num(montarCsRh(d2, UNIDADES, "", HOJE), "churn-trimestre").estado, "fonte_indisponivel");
});

test("alertas em ordem: crítico antes de atenção, maior peso primeiro, chave estável", () => {
  const l = montarCsRh(dados(), UNIDADES, "", HOJE);
  assert.deepEqual(
    l.alertas.map((a) => a.titulo),
    [
      "Belém · tratativa de cancelamento aberta há 85 dias",
      "Campo Novo · detrator sem ligação há 33 dias",
      "Recife · detrator sem ligação há 9 dias",
      "Curitiba · auditoria interna com prazo vencido há 116 dias",
      "Goiânia · auditoria interna com prazo vencido há 102 dias",
      "Belém · detrator sem ligação há 4 dias",
    ],
  );
  const chaves = l.alertas.map((a) => a.chave);
  assert.equal(new Set(chaves).size, chaves.length);
  assert.deepEqual(chaves, montarCsRh(dados(), UNIDADES, "", HOJE).alertas.map((a) => a.chave));
  // O filtro recorta os alertas pela unidade.
  assert.deepEqual(
    montarCsRh(dados(), UNIDADES, "rede", HOJE).alertas.map((a) => a.unidade),
    ["Belém", "Campo Novo", "Recife", "Curitiba", "Belém"],
  );
});
