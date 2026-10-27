// Regra de cliente na Base (Pedro, 15/10/2026, "Base à Prova de Criança", versão 14). A regra mora no banco
// (ops.base_conta_situacao, migration 20261015170000) e chega em `base.situacao`; aqui, a leitura na tela e o espelho
// nas ofertas (foraDaRegraDeCliente, espelho de ops.monetizacao_offer_issue).
import test from "node:test";
import assert from "node:assert/strict";
import {
  casaBusca,
  contarFaixas,
  ehCliente,
  ehExCliente,
  faixaDe,
  foraDaBase,
  porCerteza,
  totalClientes,
} from "../src/lib/clientes/regra-cliente.ts";
import { foraDaRegraDeCliente, fornecedorForaDeOferta, oferta } from "../src/lib/monetizacao/model.ts";

const sit = (estado, grau = null, motivo = `motivo ${estado}`) => ({
  estado,
  grau,
  rotulo: estado,
  cita: estado === "cliente" ? "sim" : estado === "a_confirmar" ? "confirmar" : "nao",
  motivo,
});
const conta = (nome, situacao, extra = {}) => ({
  key: nome,
  name: nome,
  segment: null,
  unit_label: "Curitiba",
  base: {
    key: nome,
    cnpjs: ["12345678000190"],
    empresa_ids: [1],
    pipefy_ids: ["p1"],
    pipedrive_ids: [],
    omie_units: [],
    omie_records: 0,
    contact_count: 0,
    contact: true,
    ecd: [],
    declared_origin: ["Base Antiga"],
    origin: "antiga",
    origin_reason: "",
    responsible: null,
    validated_at: null,
    synced_at: null,
    source_status: "ok",
    needs_validation: false,
    needs_source_correction: false,
    prova: { nivel: "comprovado", motivo: "Prova de cliente: ECD na Planning.", provas: ["ecd"], pago_em: [] },
    situacao,
    ...extra,
  },
});

test("A faixa sai da situação: grau de 4 a 1 para cliente, o resto pelo estado, e 'a calcular' sem situação", () => {
  assert.equal(faixaDe(sit("cliente", 4)), "g4");
  assert.equal(faixaDe(sit("cliente", 1)), "g1");
  assert.equal(faixaDe(sit("a_confirmar")), "a_confirmar");
  assert.equal(faixaDe(sit("nao_cliente")), "nao_cliente");
  assert.equal(faixaDe(sit("ex_cliente")), "ex_cliente");
  assert.equal(faixaDe(sit("fornecedor")), "fornecedor");
  assert.equal(faixaDe(null), "sem_situacao");
  assert.equal(faixaDe(undefined), "sem_situacao");
});

test("Clientes pela regra somam os quatro graus; ex-cliente e a confirmar ficam fora", () => {
  const contas = [
    conta("a", sit("cliente", 4)),
    conta("b", sit("cliente", 3)),
    conta("c", sit("cliente", 2)),
    conta("d", sit("cliente", 1)),
    conta("e", sit("a_confirmar")),
    conta("f", sit("ex_cliente")),
    conta("g", null),
  ];
  const c = contarFaixas(contas);
  assert.equal(totalClientes(c), 4);
  assert.equal(c.a_confirmar, 1);
  assert.equal(c.ex_cliente, 1);
  assert.equal(c.sem_situacao, 1);
  assert.deepEqual(contas.filter(ehCliente).map((a) => a.name), ["a", "b", "c", "d"]);
  assert.deepEqual(contas.filter(ehExCliente).map((a) => a.name), ["f"]);
});

test("Só 'não é cliente' sai da Base (27/10); a confirmar, ex-cliente, fornecedor, grupo e conta nova ficam", () => {
  const contas = [
    conta("a", sit("cliente", 4)),
    conta("b", sit("nao_cliente")),
    conta("c", sit("a_confirmar")),
    conta("d", sit("ex_cliente")),
    conta("e", sit("fornecedor")),
    conta("f", sit("grupo")),
    conta("g", null),
  ];
  assert.deepEqual(contas.filter(foraDaBase).map((a) => a.name), ["b"]);
});

test("A lista vai da maior certeza para a menor, e o nome desempata", () => {
  const contas = [
    conta("Zeta", sit("cliente", 1)),
    conta("Alfa", sit("nao_cliente")),
    conta("Beta", sit("cliente", 4)),
    conta("Gama", sit("cliente", 4)),
    conta("Delta", sit("a_confirmar")),
  ];
  assert.deepEqual(contas.sort(porCerteza).map((a) => a.name), ["Beta", "Gama", "Zeta", "Delta", "Alfa"]);
});

test("A busca acha pelo nome sem acento e pelos dígitos do CNPJ", () => {
  const a = conta("INTECH BOATING S/A", sit("a_confirmar"));
  assert.ok(casaBusca(a, "intech"));
  assert.ok(casaBusca(a, "12.345.678"));
  assert.ok(!casaBusca(a, "gol"));
  assert.ok(casaBusca(conta("Açaí da Esquina", sit("cliente", 2)), "acai"));
});

test("Ofertas: só cliente pela regra entra; a conta sem situação segue só as regras de prova", () => {
  assert.equal(foraDaRegraDeCliente(conta("c", sit("cliente", 3))), null);
  const fora = foraDaRegraDeCliente(conta("n", sit("nao_cliente", null, "Não é cliente: só a ECD.")));
  assert.equal(fora.status, "fora_regra");
  assert.equal(fora.reason, "Não é cliente: só a ECD. Fora das ofertas.");
  // ECD na Planning é prova, mas sozinha não faz cliente: sai de todas as ofertas, Recon inclusive.
  const so_ecd = conta("x", sit("nao_cliente", null, "Não é cliente: só a ECD."));
  assert.equal(fornecedorForaDeOferta(so_ecd).status, "fora_regra");
  for (const p of ["consultoria", "finance", "cella"]) assert.equal(oferta(so_ecd, p).status, "fora_regra", p);
  // Duas tags no Omie: fornecedor pela regra, fora.
  assert.equal(foraDaRegraDeCliente(conta("f", sit("fornecedor"))).status, "fora_regra");
  // Sem situação (antes da atualização da carteira): nada muda.
  assert.equal(foraDaRegraDeCliente(conta("s", null)), null);
});
