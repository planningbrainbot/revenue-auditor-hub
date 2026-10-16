// Consultoria › Funil e Fila de cobrança (src/lib/monetizacao/consultoria-funil.ts) e a URL da tela (busca.ts).
// Dados sintéticos no formato de ops.consultoria_funil_painel() (migration 20261016190000).
import test from "node:test";
import assert from "node:assert/strict";
import {
  dinheiroDe,
  empresasDoPasso,
  montarFila,
  montarFunil,
  motivoDe,
  nivelDe,
  ondeAgir,
  resumoFila,
} from "../src/lib/monetizacao/consultoria-funil.ts";
import { validarBuscaMonetizacao } from "../src/components/monetizacao/busca.ts";

const HOJE = "2026-10-16";
const e = (o) => ({
  chave: o.chave,
  cnpj: null,
  nome: o.chave,
  origem: "inside_sales",
  unidade: "Belém",
  closer: null,
  ganho_em: "2026-05-01",
  mrr: 1000,
  negocios: 1,
  deal: null,
  cnpj_fonte: null,
  regime: null,
  faturamento_teto: null,
  cliente_id: null,
  cadastrado_em: null,
  canais: [],
  projetos: 0,
  abertos: 0,
  auditado: false,
  entregue_em: null,
  etapa: null,
  produto: null,
  dias_na_etapa: null,
  meta_dias: null,
  dias_alem: null,
  identificado: 0,
  aceito: 0,
  negociacao: 0,
  aprovado: 0,
  garantido: 0,
  tem_estoque: false,
  propostas_aceitas: 0,
  faturado: 0,
  faturado_2026: 0,
  recebido: 0,
  recebido_2026: 0,
  a_receber: 0,
  em_atraso: 0,
  tem_fatura: false,
  ultimo_fup: null,
  registro: null,
  ...o,
});

const C = "11111111000101";
const EMPRESAS = [
  e({ chave: "sem-cnpj" }),
  e({ chave: "recente", cnpj: C, ganho_em: "2026-10-10", regime: "Lucro Real" }),
  e({ chave: "real", cnpj: C, regime: "LUCRO REAL" }),
  e({ chave: "simples", cnpj: C, regime: "Simples Nacional" }),
  e({ chave: "pequena", cnpj: C, faturamento_teto: 0.36 }),
  e({ chave: "docs", cnpj: C, cliente_id: "c1", etapa: "fluxo_documentos", dias_alem: 20 }),
  e({ chave: "operacao", cnpj: C, cliente_id: "c2", etapa: "operacao" }),
  e({ chave: "vazio", cnpj: C, cliente_id: "c3", auditado: true, entregue_em: "2026-09-01" }),
  e({ chave: "parado", cnpj: C, cliente_id: "c4", auditado: true, entregue_em: "2026-05-01", identificado: 900 }),
  e({ chave: "novo", cnpj: C, cliente_id: "c5", auditado: true, entregue_em: "2026-10-01", identificado: 100 }),
  e({ chave: "aceitou", cnpj: C, cliente_id: "c6", auditado: true, identificado: 500, aceito: 400, garantido: 60 }),
  e({ chave: "faturou", cnpj: C, cliente_id: "c7", auditado: true, identificado: 300, aceito: 300, tem_fatura: true, faturado: 50, faturado_2026: 50, em_atraso: 50 }),
  e({ chave: "recebeu", cnpj: C, cliente_id: "c8", auditado: true, identificado: 200, aceito: 200, tem_fatura: true, faturado: 40, faturado_2026: 40, recebido: 40, recebido_2026: 40 }),
];

test("nível e motivo: a etapa mais adiantada e por que parou nela", () => {
  const por = Object.fromEntries(EMPRESAS.map((x) => [x.chave, [nivelDe(x), motivoDe(x, HOJE)]]));
  assert.deepEqual(por["sem-cnpj"], [1, "sem_cnpj"]);
  assert.deepEqual(por.recente, [2, "recente"]);
  assert.deepEqual(por.real, [2, "real"]);
  assert.deepEqual(por.simples, [2, "simples"]);
  assert.deepEqual(por.pequena, [2, "pequena"]);
  assert.deepEqual(por.docs, [3, "documentos"]);
  assert.deepEqual(por.operacao, [3, "diagnostico"]);
  assert.deepEqual(por.vazio, [4, "sem_oportunidade"]);
  assert.deepEqual(por.parado, [5, "mais_90"]);
  assert.deepEqual(por.novo, [5, "ate_30"]);
  assert.deepEqual(por.aceitou, [6, "aceitou"]);
  assert.deepEqual(por.faturou, [7, "em_atraso"]);
  assert.deepEqual(por.recebeu, [8, "recebido"]);
});

test("funil cumulativo: só desce, a taxa é o degrau sobre o de cima, e quem parou soma com quem passou", () => {
  const f = montarFunil(EMPRESAS, HOJE, true);
  assert.deepEqual(
    f.map((p) => p.empresas),
    [13, 12, 8, 6, 5, 3, 2, 1],
  );
  for (let i = 1; i < f.length; i++) {
    assert.ok(f[i].empresas <= f[i - 1].empresas);
    assert.equal(f[i].taxa, Math.round((100 * f[i].empresas) / f[i - 1].empresas));
    assert.equal(f[i - 1].pararam + f[i].empresas, f[i - 1].empresas);
    assert.equal(
      f[i - 1].parou.reduce((s, x) => s + x.empresas, 0),
      f[i - 1].pararam,
    );
  }
  assert.equal(f[0].taxa, null);
  assert.equal(f[4].dinheiro, 900 + 100 + 500 + 300 + 200);
  assert.equal(f[6].dinheiro, 90);
  assert.equal(f[7].dinheiro, 40);
  // Sem a porta do Financeiro, o faturado e o recebido não aparecem; o resto aparece.
  const fechado = montarFunil(EMPRESAS, HOJE, false);
  assert.equal(fechado[6].dinheiro, null);
  assert.equal(fechado[4].dinheiro, 2000);
});

test("clique no funil: o degrau, o motivo e os fora do prazo", () => {
  assert.equal(empresasDoPasso(EMPRESAS, "5", HOJE).length, 5);
  assert.deepEqual(
    empresasDoPasso(EMPRESAS, "2-real", HOJE).map((x) => x.chave),
    ["real"],
  );
  assert.deepEqual(
    empresasDoPasso(EMPRESAS, "3-atrasado", HOJE).map((x) => x.chave),
    ["docs"],
  );
});

test("dinheiro de verdade e onde agir", () => {
  const d = dinheiroDe(EMPRESAS, true);
  assert.equal(d.recebido2026, 40);
  assert.equal(d.faturado2026, 90);
  assert.equal(d.garantido, 60);
  assert.equal(d.parado, 1000);
  assert.equal(d.empresasParado, 2);
  assert.equal(dinheiroDe(EMPRESAS, false).faturado2026, null);
  const a = Object.fromEntries(ondeAgir(EMPRESAS, HOJE).map((x) => [x.id, x]));
  assert.equal(a.aceitou.empresas, 1);
  assert.equal(a.aceitou.valor, 400);
  assert.equal(a.parado90.empresas, 1);
  assert.equal(a.atrasados.empresas, 1);
  assert.equal(a.real.empresas, 1);
  assert.equal(a.sem_cnpj.empresas, 1);
});

test("fila: disse sim primeiro, depois em atraso, depois o parado mais antigo; último contato é o mais recente", () => {
  const comContato = EMPRESAS.map((x) =>
    x.chave === "parado"
      ? {
          ...x,
          ultimo_fup: "2026-10-01T10:00:00Z",
          registro: { resultado: "pediu_tempo", nota: "liga sexta", proximo: "2026-10-20", autor: "Jordana", em: "2026-10-14T10:00:00Z", total: 1 },
        }
      : x,
  );
  const fila = montarFila(comContato, HOJE);
  assert.deepEqual(
    fila.map((x) => [x.e.chave, x.grupo]),
    [
      ["aceitou", "aceitou"],
      ["faturou", "atraso"],
      ["parado", "90"],
      ["novo", "recente"],
    ],
  );
  assert.equal(fila[0].valor, 400);
  const parado = fila.find((x) => x.e.chave === "parado");
  assert.equal(parado.ultimoContato.fonte, "brain");
  assert.equal(parado.diasSemContato, 2);
  const r = resumoFila(fila);
  assert.equal(r.empresas, 4);
  assert.equal(r.contatadas7, 1);
  assert.equal(r.nuncaContatadas, 3);
});

test("URL da Consultoria: o Funil é o padrão, o Cruzamento antigo abre o Funil, filtros só valem na Consultoria", () => {
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria" }).visao, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "cruzamento" }).visao, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "cruzamento-consultoria" }).aba, "handoff-consultoria");
  assert.equal(validarBuscaMonetizacao({ aba: "cruzamento-consultoria" }).visao, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "handoff" }).visao, "handoff");
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "fila" }).visao, "fila");
  const b = validarBuscaMonetizacao({
    aba: "handoff-consultoria",
    origem: "goiania,inside_sales",
    passo: "3-real",
    grupo: "aceitou",
  });
  assert.equal(b.origem, "goiania,inside_sales");
  assert.equal(b.passo, "3-real");
  assert.equal(b.grupo, "aceitou");
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria", origem: "x" }).origem, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "handoff-consultoria", passo: "9" }).passo, undefined);
  assert.equal(validarBuscaMonetizacao({ aba: "operacao", passo: "3" }).passo, undefined);
  // As fichas sem CNPJ da Buscar empresa (16/10) abrem pelo link.
  assert.equal(
    validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "empresa", empresa: "tese:cobra rolamentos" }).empresa,
    "tese:cobra rolamentos",
  );
  assert.equal(
    validarBuscaMonetizacao({ aba: "handoff-consultoria", visao: "empresa", empresa: "proposta:gradiente" }).empresa,
    "proposta:gradiente",
  );
});
