// Recorrente do Portal de Faturamento (E2, 29/10/2026), parte das telas: filtros na URL, números, prazo em dias
// úteis com feriado, agrupamento por projeto, respostas por motivo, instrução do corte e o CSV da tesouraria.
// Contratos docs/design/contratos/faturamento-contratos.md e faturamento-corte.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  csvDoCorte,
  diasUteisEntre,
  diferenca,
  faltaNaResposta,
  fechaLogo,
  filtrarContratos,
  filtrarCorte,
  gruposPorProjeto,
  lerBuscaContratos,
  lerBuscaCorte,
  mesAnteriorCurto,
  numerosDoCorte,
  numerosDoMes,
  respostasDaLinha,
  rotuloCompetencia,
  seloDaLinha,
  selosDoMotivo,
  textoDiferenca,
  textoInstrucao,
  textoPosCorte,
  valorDigitado,
} from "../src/lib/faturamento/recorrente.ts";

const AGORA = new Date("2026-11-10T15:00:00Z"); // terça, 12h em São Paulo
/** O Intl põe espaço inquebrável depois do "R$". */
const sp = (s) => s.replace(/\u00a0/g, " ");

const linha = (o = {}) => ({
  id: o.id ?? "00000000-0000-4000-8000-000000000001",
  emissora: { id: "e1", apelido: "PAC" },
  codigo_contrato: 1,
  numero_contrato: "2021/0045",
  documento: "11222333000181",
  cliente_nome: "Cliente A Ltda",
  projeto: "GRUPO A",
  servico: "Honorários contábeis",
  dia_faturamento: 15,
  data_faturamento: "2026-11-15",
  data_corte: "2026-11-13",
  responder_ate: "2026-11-13T02:59:59Z",
  vigencia_inicial: "2025-01-01",
  vigencia_final: null,
  valor_contrato: 20000,
  valor_mes_anterior: 16000,
  motivos: ["valor"],
  situacao: "precisa_resposta",
  valor_faturar: 20000,
  instrucao: "como_esta",
  acao_contrato: null,
  pos_corte: null,
  notas_valor: null,
  notas_numeros: null,
  aberta: true,
  pode_responder: true,
  resposta: null,
  feito_omie: null,
  repassado_para: null,
  motivo_nao_faturar: null,
  ...o,
});

test("busca de Contratos do mês: só o que está no formato entra", () => {
  assert.deepEqual(
    lerBuscaContratos({
      mes: "2026-11",
      empresa: "pac",
      motivo: "valor",
      situacao: "precisa_resposta",
      higiene: "prazo",
      dia: "15",
      busca: "  cliente ",
      contrato: "00000000-0000-4000-8000-00000000000A",
    }),
    {
      mes: "2026-11",
      empresa: "PAC",
      motivo: "valor",
      situacao: "precisa_resposta",
      higiene: "prazo",
      dia: 15,
      busca: "cliente",
      contrato: "00000000-0000-4000-8000-00000000000a",
    },
  );
  assert.deepEqual(
    lerBuscaContratos({ mes: "2026-13", motivo: "x", dia: "40", contrato: "1" }),
    {},
  );
  assert.equal(lerBuscaContratos({ empresa: "todas" }).empresa, "todas");
});

test("prazo em dias úteis: o feriado de 15/11 e o fim de semana não contam", () => {
  assert.equal(diasUteisEntre("2026-11-10", "2026-11-12"), 2);
  assert.equal(diasUteisEntre("2026-11-13", "2026-11-17"), 2, "sábado, domingo (15/11) e segunda");
  assert.equal(diasUteisEntre("2026-11-19", "2026-11-23"), 1, "20/11 é feriado");
  assert.equal(
    fechaLogo(linha({ responder_ate: "2026-11-13T02:59:59Z" }), AGORA),
    true,
    "12/11 23:59 em SP",
  );
  assert.equal(fechaLogo(linha({ responder_ate: "2026-11-18T02:59:59Z" }), AGORA), false);
  assert.equal(fechaLogo(linha({ situacao: "fatura_sozinho" }), AGORA), false);
});

test("números do mês: precisam de resposta, faturam sozinhos, respondidos e higiene", () => {
  const ls = [
    linha(),
    linha({
      id: "2",
      situacao: "fatura_sozinho",
      motivos: [],
      valor_contrato: 1000,
      valor_faturar: 1000,
    }),
    linha({
      id: "3",
      situacao: "ajustado",
      valor_faturar: 18000,
      resposta: {
        tipo: "ajustar",
        valor: 18000,
        permanente: false,
        vigencia: null,
        motivo: "x",
        em: "2026-11-05T12:00:00Z",
        por: null,
      },
    }),
    linha({ id: "6", situacao: "encerrado", motivos: ["encerrado_omie"], valor_faturar: null }),
    linha({
      id: "4",
      situacao: "precisa_resposta",
      motivos: ["sumiu"],
      valor_contrato: 3000,
      responder_ate: "2026-11-30T02:59:59Z",
    }),
    linha({ id: "5", situacao: "automacao_omie", motivos: [] }),
  ];
  const n = numerosDoMes(ls, AGORA);
  assert.deepEqual(n.precisa_resposta, { quantidade: 2, valor: 23000 });
  assert.deepEqual(n.fatura_sozinho, { quantidade: 1, valor: 1000 });
  assert.deepEqual(n.respondidos, { quantidade: 1, valor: 18000 });
  assert.deepEqual(n.higiene, { prazo: 1, vence: 0, sumiu: 1 });
  assert.equal(filtrarContratos(ls, { situacao: "respondidos" }, AGORA).length, 1);
  assert.equal(filtrarContratos(ls, { higiene: "sumiu" }, AGORA)[0].id, "4");
  assert.equal(filtrarContratos(ls, { busca: "11.222.333" }, AGORA).length, 6, "CNPJ com máscara");
  assert.equal(filtrarContratos(ls, { busca: "cliente a" }, AGORA).length, 6, "sem acento e caixa");
});

test("grupos por projeto: pendente em cima, sem projeto no fim, automação à parte", () => {
  const { grupos, automacao } = gruposPorProjeto([
    linha({ id: "a", projeto: "ZETA", situacao: "fatura_sozinho", motivos: [] }),
    linha({ id: "b", projeto: null, situacao: "precisa_resposta" }),
    linha({
      id: "c",
      projeto: "ALFA",
      situacao: "fatura_sozinho",
      motivos: [],
      valor_contrato: 10,
    }),
    linha({ id: "d", projeto: "ALFA", situacao: "precisa_resposta" }),
    linha({ id: "e", projeto: "ALFA", situacao: "automacao_omie", motivos: [] }),
  ]);
  assert.deepEqual(
    grupos.map((g) => [g.projeto, g.linhas.map((l) => l.id)]),
    [
      ["ALFA", ["d", "c"]],
      ["Sem projeto", ["b"]],
      ["ZETA", ["a"]],
    ],
  );
  assert.deepEqual(
    automacao.map((l) => l.id),
    ["e"],
  );
});

test("selos e diferença: o mês anterior aparece no selo e a diferença tem sinal", () => {
  assert.equal(rotuloCompetencia("2026-11-01"), "nov/2026");
  assert.equal(mesAnteriorCurto("2026-11-01"), "out");
  assert.equal(mesAnteriorCurto("2027-01-01"), "dez");
  const s = selosDoMotivo(
    linha({ motivos: ["valor", "vence"], vigencia_final: "2026-11-30" }),
    "2026-11-01",
  );
  assert.deepEqual(
    s.map((x) => [sp(x.texto), x.tom]),
    [
      ["Era R$ 16.000,00 em out", "atencao"],
      ["Vence em 30/11", "atencao"],
    ],
  );
  assert.equal(
    selosDoMotivo(linha({ motivos: ["novo"], vigencia_inicial: "2026-10-01" }), "2026-11-01")[0]
      .texto,
    "Contrato novo",
  );
  assert.equal(
    selosDoMotivo(linha({ motivos: ["novo"], vigencia_inicial: "2024-07-01" }), "2026-11-01")[0]
      .texto,
    "Sem nota em out",
    "contrato antigo que só não faturou no mês anterior",
  );
  assert.equal(sp(textoDiferenca(diferenca(linha()))), "+R$ 4.000,00 (+25%)");
  assert.equal(diferenca(linha({ valor_mes_anterior: 20000 })), null);
  assert.equal(
    seloDaLinha(linha({ pos_corte: "faturado_diferente" })).rotulo,
    "Faturado diferente",
  );
});

test("respostas por motivo e o que falta antes de salvar", () => {
  assert.deepEqual(respostasDaLinha({ motivos: ["valor"] }), [
    "confirmar",
    "ajustar",
    "nao_faturar",
    "cliente_saiu",
  ]);
  assert.deepEqual(respostasDaLinha({ motivos: ["vence"] }), [
    "confirmar",
    "ajustar",
    "nao_faturar",
    "renovar",
    "encerrar",
    "cliente_saiu",
  ]);
  assert.deepEqual(respostasDaLinha({ motivos: ["sumiu"] }), [
    "faturar_mes",
    "renovar",
    "cliente_saiu",
  ]);
  assert.equal(
    faltaNaResposta("ajustar", { valor: "", motivo: "x" }, "2026-11-15"),
    "Informe o valor deste mês.",
  );
  assert.equal(
    faltaNaResposta("ajustar", { valor: "1.500,00", motivo: " " }, "2026-11-15"),
    "Escreva o motivo.",
  );
  assert.equal(
    faltaNaResposta("ajustar", { valor: "1.500,00", motivo: "reajuste" }, "2026-11-15"),
    null,
  );
  assert.equal(
    faltaNaResposta("renovar", { vigencia: "2026-11-01" }, "2026-11-15"),
    "A nova vigência precisa ir além deste faturamento.",
  );
  assert.equal(valorDigitado("1.500,50"), 1500.5);
  assert.equal(valorDigitado("1500.5"), 1500.5);
  assert.equal(valorDigitado("abc"), null);
});

test("lista do corte: instrução, números, depois do corte e CSV com ; e acento", () => {
  const ls = [
    linha({
      instrucao: "como_esta",
      situacao: "fatura_sozinho",
      valor_faturar: 20000,
      pos_corte: "faturado",
      notas_numeros: "4321",
    }),
    linha({
      id: "2",
      instrucao: "outro_valor",
      situacao: "ajustado",
      valor_faturar: 18000,
      resposta: {
        tipo: "ajustar",
        valor: 18000,
        permanente: true,
        vigencia: null,
        motivo: "renegociado; cliente",
        em: "2026-11-05T12:00:00Z",
        por: { id: "u", nome: "Daniel Faria" },
      },
      acao_contrato: "mudar_valor",
    }),
    linha({
      id: "3",
      instrucao: "nao_faturar",
      situacao: "sem_resposta",
      valor_faturar: null,
      motivo_nao_faturar: "o dono não respondeu até o prazo",
    }),
  ];
  const n = numerosDoCorte(ls);
  assert.deepEqual(n.como_esta, { quantidade: 1, valor: 20000 });
  assert.deepEqual(n.outro_valor, { quantidade: 1, valor: 18000 });
  assert.equal(n.nao_faturar.quantidade, 1);
  const pendente = linha({
    id: "9",
    instrucao: "nao_faturar",
    situacao: "precisa_resposta",
    valor_faturar: null,
  });
  assert.deepEqual(numerosDoCorte([...ls, pendente]).nao_faturar, { quantidade: 1, aguardando: 1 });
  assert.match(sp(textoInstrucao(pendente)), /^Aguardando o dono · responde até 12\/11 23:59$/);
  assert.equal(filtrarCorte(ls, { instrucao: "contrato" })[0].id, "2");
  assert.equal(
    sp(textoInstrucao(ls[1])),
    "Faturar R$ 18.000,00 (contrato: R$ 20.000,00) · renegociado; cliente",
  );
  assert.equal(textoInstrucao(ls[2]), "Não faturar · o dono não respondeu até o prazo");
  assert.equal(textoPosCorte(ls[0], false), "Faturado (4321)");
  assert.equal(textoPosCorte(ls[1], true), "Na lista");
  const csv = sp(csvDoCorte(ls)).split("\n");
  assert.equal(
    csv[0],
    "Empresa;Contrato;Cliente;CNPJ/CPF;Valor do contrato;Faturar;Instrução;Contrato no Omie",
  );
  assert.match(
    csv[2],
    /;18000,00;"Faturar R\$ 18\.000,00 \(contrato: R\$ 20\.000,00\) · renegociado; cliente";Mudar o valor/,
  );
  assert.deepEqual(
    lerBuscaCorte({ dia: "2026-11-13", instrucao: "contrato", situacao: "faturado" }),
    {
      dia: "2026-11-13",
      instrucao: "contrato",
    },
  );
});
