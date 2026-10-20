// Portal de Faturamento: o formulário do pedido (src/lib/faturamento/formulario.ts) e a consulta da Receita
// (src/lib/faturamento/receita.ts). Contrato docs/design/contratos/faturamento-novo.md; API.md §1.8, §1.10,
// §2.9 e Mudanças (CNPJ alfanumérico).
import test from "node:test";
import assert from "node:assert/strict";
import {
  competenciaDoFormulario,
  dadosParaSalvar,
  descricaoPadrao,
  documentoValido,
  emailValido,
  erroDoDocumento,
  errosDoCampo,
  formularioDoPedido,
  formularioVazio,
  fraseAoEnviar,
  juntarEmails,
  lerValor,
  mascararDocumento,
  normalizarDocumento,
  normalizarProjeto,
  parcelasDoFormulario,
  pendenciasLocais,
  resumoParcelas,
  rotuloEnviar,
  tipoDoDocumento,
  valorParaDigitar,
} from "../src/lib/faturamento/formulario.ts";
import { dadosDaCnpja, LimiteDeChamadas } from "../src/lib/faturamento/receita.ts";

const completo = (o = {}) => ({
  ...formularioVazio({ emissora_id: "e1", dono_id: "d1" }),
  tomador_documento: "11.222.333/0001-81",
  tomador_nome: "CLIENTE EXEMPLO LTDA",
  emails_envio: ["financeiro@cliente.com.br"],
  projeto: "Alteração contratual 2026",
  servico_id: "s1",
  descricao_nf: "Alteração de contrato social",
  valor: "1.500,00",
  documento: "nf",
  forma: "avulso",
  meio: "boleto",
  primeiro_vencimento: "2026-11-13",
  observacoes: "Cliente pediu a nota até o dia 10.",
  ...o,
});

test("documento: CPF e CNPJ com dígito, inclusive o CNPJ alfanumérico da Receita", () => {
  assert.equal(documentoValido("11.222.333/0001-81"), true);
  assert.equal(documentoValido("11222333000182"), false);
  assert.equal(documentoValido("123.456.789-09"), true);
  assert.equal(documentoValido("12345678900"), false);
  assert.equal(documentoValido("00000000000000"), false);
  // Exemplo da Receita (IN RFB 2.229/2024): 12.ABC.345/01DE-35.
  assert.equal(documentoValido("12.ABC.345/01DE-35"), true);
  assert.equal(documentoValido("12.abc.345/01de-35"), true);
  assert.equal(documentoValido("12ABC34501DE36"), false);
  // Letra nos dígitos verificadores não vale; CPF com letra também não.
  assert.equal(documentoValido("12ABC34501DEA5"), false);
  assert.equal(documentoValido("1234567890A"), false);
  assert.equal(normalizarDocumento("12.abc.345/01de-35"), "12ABC34501DE35");
  assert.equal(tipoDoDocumento("12ABC34501DE35"), "pj");
  assert.equal(tipoDoDocumento("123.456.789-09"), "pf");
  assert.equal(tipoDoDocumento("123"), null);
});

test("documento: a mensagem de erro diz o que falta", () => {
  assert.equal(erroDoDocumento("pj", ""), "Informe o CNPJ.");
  assert.equal(erroDoDocumento("pj", "11222"), "O CNPJ tem 14 caracteres.");
  assert.equal(
    erroDoDocumento("pj", "12ABC34501DEAB"),
    "Os dois últimos caracteres do CNPJ são números.",
  );
  assert.equal(erroDoDocumento("pj", "11222333000182"), "CNPJ com dígito verificador errado.");
  assert.equal(erroDoDocumento("pj", "12ABC34501DE35"), null);
  assert.equal(erroDoDocumento("pf", "1234567890A"), "O CPF tem 11 números.");
  assert.equal(erroDoDocumento("pf", "123.456.789-09"), null);
});

test("documento: a máscara enquanto digita aceita letra só no CNPJ", () => {
  assert.equal(mascararDocumento("pj", "12abc34501de35"), "12.ABC.345/01DE-35");
  assert.equal(mascararDocumento("pj", "11222333000181"), "11.222.333/0001-81");
  assert.equal(mascararDocumento("pj", "1122"), "11.22");
  assert.equal(mascararDocumento("pj", "11.222.333/0001-81999"), "11.222.333/0001-81");
  assert.equal(mascararDocumento("pf", "12345678909"), "123.456.789-09");
  assert.equal(mascararDocumento("pf", "123a45"), "123.45");
});

test("valor: lê o formato brasileiro e o com ponto decimal", () => {
  assert.equal(lerValor("1.500,00"), 1500);
  assert.equal(lerValor("1500,5"), 1500.5);
  assert.equal(lerValor("1500.50"), 1500.5);
  assert.equal(lerValor("R$ 16.000,00"), 16000);
  assert.equal(lerValor("1500"), 1500);
  assert.equal(lerValor(""), null);
  assert.equal(lerValor("abc"), null);
  assert.equal(lerValor("1,234"), null);
  assert.equal(valorParaDigitar(1500), "1.500,00");
});

test("e-mails, projeto, parcelas e competência", () => {
  assert.equal(emailValido("a@b.com"), true);
  assert.equal(emailValido("a@b"), false);
  assert.deepEqual(juntarEmails(["A@B.com"], ["a@b.com", " c@d.com "]), ["a@b.com", "c@d.com"]);
  assert.equal(normalizarProjeto("  Alteração   contratual "), "Alteração contratual");
  assert.equal(parcelasDoFormulario({ forma: "avulso", parcelas: "5" }), 1);
  assert.equal(parcelasDoFormulario({ forma: "parcelado", parcelas: "3" }), 3);
  assert.equal(parcelasDoFormulario({ forma: null, parcelas: "3" }), null);
  // A competência acompanha o 1º vencimento até a pessoa mudar à mão.
  assert.equal(
    competenciaDoFormulario({
      competencia: "",
      competencia_manual: false,
      primeiro_vencimento: "2026-11-13",
    }),
    "2026-11",
  );
  assert.equal(
    competenciaDoFormulario({
      competencia: "2026-10",
      competencia_manual: true,
      primeiro_vencimento: "2026-11-13",
    }),
    "2026-10",
  );
  assert.equal(
    competenciaDoFormulario({
      competencia: "",
      competencia_manual: false,
      primeiro_vencimento: "",
    }),
    null,
  );
  assert.equal(
    descricaoPadrao("Alteração de contrato social", " Projeto  X ", "2026-11"),
    "Alteração de contrato social · Projeto X · nov/2026",
  );
});

test("dadosParaSalvar monta o p_dados com todas as chaves de §1.10", () => {
  const d = dadosParaSalvar(
    completo({ tomador_documento: "12.abc.345/01de-35", emails_envio: ["X@Y.com", "x@y.com"] }),
  );
  assert.deepEqual(Object.keys(d).sort(), [
    "competencia",
    "confirmou_emissora",
    "departamento",
    "descricao_nf",
    "documento",
    "dono_id",
    "emails_envio",
    "emissora_id",
    "forma",
    "meio",
    "observacoes",
    "parcelas",
    "primeiro_vencimento",
    "projeto",
    "servico_id",
    "tomador_documento",
    "tomador_nome",
    "tomador_tipo",
    "valor",
  ]);
  assert.equal(d.tomador_documento, "12ABC34501DE35");
  assert.deepEqual(d.emails_envio, ["x@y.com"]);
  assert.equal(d.valor, 1500);
  assert.equal(d.parcelas, 1);
  assert.equal(d.competencia, "2026-11-01");
  // Vazio vai como null (limpa), não como texto vazio.
  const vazio = dadosParaSalvar(formularioVazio());
  assert.equal(vazio.projeto, null);
  assert.equal(vazio.valor, null);
  assert.equal(vazio.tomador_documento, null);
});

test("pendências locais: nada falta num pedido completo; cada campo diz o seu", () => {
  assert.deepEqual(pendenciasLocais(completo(), { contratoEmOutra: false, bloqueio: null }), []);
  const erros = pendenciasLocais(formularioVazio(), { contratoEmOutra: false, bloqueio: null });
  const campos = [...new Set(erros.map((e) => e.campo))];
  assert.deepEqual(campos, [
    "emissora_id",
    "dono_id",
    "tomador_documento",
    "tomador_nome",
    "emails_envio",
    "projeto",
    "servico_id",
    "descricao_nf",
    "valor",
    "documento",
    "forma",
    "meio",
    "primeiro_vencimento",
    "observacoes",
  ]);
  // CA-04: com contrato em outra empresa, enviar pede a marca.
  assert.deepEqual(
    errosDoCampo(
      pendenciasLocais(completo(), { contratoEmOutra: true, bloqueio: null }),
      "confirmou_emissora",
    ),
    ["Confirme a empresa que fatura."],
  );
  assert.deepEqual(
    pendenciasLocais(completo({ confirmou_emissora: true }), {
      contratoEmOutra: true,
      bloqueio: null,
    }),
    [],
  );
  // CA-05: CNPJ inapto barra o envio com o motivo do banco.
  const motivo = "CNPJ BAIXADA na Receita desde 2024-02-01. O envio fica bloqueado.";
  assert.deepEqual(
    errosDoCampo(
      pendenciasLocais(completo(), { contratoEmOutra: false, bloqueio: motivo }),
      "tomador_documento",
    ),
    [motivo],
  );
  // Parcelado de 2 a 36; e-mail inválido aparece pelo nome.
  assert.deepEqual(
    errosDoCampo(
      pendenciasLocais(completo({ forma: "parcelado", parcelas: "1" }), {
        contratoEmOutra: false,
        bloqueio: null,
      }),
      "parcelas",
    ),
    ["Parcelado vai de 2 a 36 parcelas."],
  );
  assert.deepEqual(
    errosDoCampo(
      pendenciasLocais(completo({ emails_envio: ["ruim@"] }), {
        contratoEmOutra: false,
        bloqueio: null,
      }),
      "emails_envio",
    ),
    ["E-mail inválido: ruim@."],
  );
});

test("o rótulo do botão e a frase do rodapé mudam com o dono (RF-P05)", () => {
  assert.equal(rotuloEnviar({ souDono: true, nomeDono: "Hugo Silva" }), "Enviar");
  assert.equal(
    rotuloEnviar({ souDono: false, nomeDono: "Hugo Silva" }),
    "Enviar para o OK de Hugo",
  );
  assert.equal(
    fraseAoEnviar({ souDono: true, nomeDono: null, apelido: "DOC", simulacao: false }),
    "O pedido vai para a fila do Omie da DOC e depois para a tesouraria faturar.",
  );
  assert.equal(
    fraseAoEnviar({ souDono: false, nomeDono: "Hugo Silva", apelido: "DOC", simulacao: true }),
    "Você não é o dono da receita: o pedido vai para o OK de Hugo antes de ir ao Omie. O Omie da DOC está em simulação: o pedido percorre o fluxo, mas nada é gravado lá.",
  );
  assert.equal(
    resumoParcelas([{ valor: 5333.33 }, { valor: 5333.34 }]),
    "R$ 5.333,33 + R$ 5.333,34",
  );
});

test("formularioDoPedido lê um rascunho salvo", () => {
  const ficha = {
    pedido: {
      emissora: { id: "e1" },
      dono: { id: "d1", nome: "Hugo" },
      tomador: { tipo: "pj", documento: "11222333000181", nome: "CLIENTE" },
      emails_envio: ["a@b.com"],
      projeto: "P",
      servico: { id: "s1" },
      descricao_nf: "D",
      valor: 1500,
      documento: "recibo",
      forma: "parcelado",
      parcelas: 3,
      meio: "pix",
      primeiro_vencimento: "2026-11-13",
      competencia: "2026-10-01",
      departamento: "Financeiro",
      observacoes: "O",
      confirmou_emissora: true,
    },
  };
  const f = formularioDoPedido(ficha);
  assert.equal(f.valor, "1.500,00");
  assert.equal(f.parcelas, "3");
  assert.equal(f.competencia, "2026-10");
  assert.equal(f.competencia_manual, true); // outubro ≠ mês do vencimento (novembro)
  assert.equal(f.servico_id, "s1");
  assert.equal(f.confirmou_emissora, true);
});

test("CNPJá aberta → p_dados de fat_receita_cnpj_gravar", () => {
  const agora = new Date("2026-10-20T15:00:00Z");
  assert.deepEqual(
    dadosDaCnpja(
      {
        alias: "Planning",
        company: { name: "PLANNING DOC ASSESSORIA PARALEGAL LTDA" },
        status: { id: 2, text: "Ativa" },
        statusDate: "2023-02-27",
        address: { city: "Goiânia", state: "go" },
        emails: [
          { address: "Fin@Planning.com.br" },
          { address: "fin@planning.com.br" },
          { domain: "x" },
        ],
      },
      agora,
    ),
    {
      fonte: "CNPJá aberta",
      razao_social: "PLANNING DOC ASSESSORIA PARALEGAL LTDA",
      nome_fantasia: "Planning",
      situacao: "ATIVA",
      situacao_desde: "2023-02-27",
      municipio: "Goiânia",
      uf: "GO",
      emails: ["fin@planning.com.br"],
      consultado_em: "2026-10-20T15:00:00.000Z",
    },
  );
  assert.equal(
    dadosDaCnpja({ company: { name: "X" }, status: { text: "Baixada" } }, agora).situacao,
    "BAIXADA",
  );
  assert.equal(
    dadosDaCnpja({ company: { name: "X" }, status: { id: 4 } }, agora).situacao,
    "INAPTA",
  );
  // Resposta sem o mínimo não vira cache vazio.
  assert.equal(dadosDaCnpja({}, agora), null);
  assert.equal(dadosDaCnpja(null, agora), null);
});

test("limite de chamadas à CNPJá: janela deslizante", () => {
  const l = new LimiteDeChamadas(3, 60_000);
  assert.equal(l.tentar(0), true);
  assert.equal(l.tentar(1_000), true);
  assert.equal(l.tentar(2_000), true);
  assert.equal(l.tentar(3_000), false);
  assert.equal(l.tentar(60_001), true); // a primeira saiu da janela
  assert.equal(l.tentar(60_002), false);
});
