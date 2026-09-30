import test from "node:test";
import assert from "node:assert/strict";
import {
  montarEstrategico,
  trimestreIdu,
  trimestreSeguinte,
  compromissosDoFiltro,
  PESO_MINIMO_PACTO,
} from "../src/lib/cockpit-coo/temas/estrategico.ts";
import { lerUnidades } from "../src/lib/cockpit-coo/unidades.ts";
import { lerCompromisso } from "../src/lib/cockpit-coo/compromissos.ts";
import { MAX_NUMEROS } from "../src/lib/cockpit-coo/contrato.ts";

// Cadastro de 29/09/2026 (ops.unidades), com os nomes exatamente como estão no banco.
const CADASTRO = [
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
];
const UNIDADES = lerUnidades(CADASTRO);
const HOJE = "2026-09-29";
const TRI = trimestreIdu(HOJE);

const redeUnidades = (cad) =>
  cad.map((u) => ({
    id: u.id,
    nome: u.nome_da_praca,
    tipo: u.tipo,
    inauguracao: u.data_inauguracao,
  }));
const ap = (unidade_id, mes, receita_base, status = "confirmado") => ({
  unidade_id,
  mes: `${mes}-01`,
  status,
  receita_base,
  receita_base_antiga: 0,
  royalties_valor: 0,
  csc_valor_fixo: 0,
  csc_base_antiga_valor: 0,
});
const meses = (de, ate) => {
  const out = [];
  let [a, m] = de.split("-").map(Number);
  for (;;) {
    const s = `${a}-${String(m).padStart(2, "0")}`;
    out.push(s);
    if (s === ate) return out;
    m += 1;
    if (m === 13) {
      m = 1;
      a += 1;
    }
  }
};

const MADURA = { novos: 20, base: 10, churn: 35, satisfacao: 15, exposicao: 10, enps: 10 };
const RAMP = { novos: 40, base: 10, churn: 15, satisfacao: 15, exposicao: 10, enps: 10 };
const MADURAS = new Set([1, 2, 3, 4]);

/** Apuração do IDU: `metas` diz, por unidade, quais indicadores têm meta (e de onde). */
function iduDe({ metas, ranking, metasNoTrimestre = 0, proximoMetas = 0, hoje = HOJE }) {
  const apuracao = [];
  for (let id = 1; id <= 8; id++) {
    const pesos = MADURAS.has(id) ? MADURA : RAMP;
    for (const [indicador, peso] of Object.entries(pesos)) {
      const origem = metas[id]?.[indicador] ?? null;
      apuracao.push({
        unidade_id: id,
        indicador,
        peso,
        meta: origem ? 1 : null,
        meta_origem: origem,
      });
    }
  }
  const tri = trimestreIdu(hoje);
  return {
    ok: true,
    dado: {
      trimestre: tri,
      ranking: ranking.map(([unidade_id, idu, faixa = null]) => ({
        unidade_id,
        unidade: CADASTRO.find((c) => c.id === unidade_id).nome_da_praca,
        curva: MADURAS.has(unidade_id) ? "Madura" : "Ramp-up",
        idu,
        faixa,
        base_efetiva: null,
        pilar_fraco: null,
      })),
      apuracao,
      metasNoTrimestre,
      proximo: { trimestre: trimestreSeguinte(tri), metas: proximoMetas },
    },
  };
}

// O retrato de 29/09/2026: só o churn (meta fixa) em todas, e Curitiba com a meta de base (0).
const SO_CHURN = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8].map((id) => [
    id,
    id === 1 ? { churn: "fixa", base: "unidade" } : { churn: "fixa" },
  ]),
);
const IDU_HOJE = iduDe({
  metas: SO_CHURN,
  ranking: [1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, "100.0", "Superação"]),
  metasNoTrimestre: 1,
  proximoMetas: 0,
});

// Pacto completo: as oito com crescimento e churn pactuados.
const TODAS_PACTUADAS = Object.fromEntries(
  [1, 2, 3, 4, 5, 6, 7, 8].map((id) => [id, { novos: "rede", base: "rede", churn: "fixa" }]),
);

const REDE_VAZIA = { ok: true, dado: { unidades: redeUnidades(CADASTRO), apuracoes: [] } };
const EXTRA_VAZIO = { okrs: [], compromissos: [], clickupConectado: false };

const numero = (l, id) => l.numeros.find((n) => n.id === id);
const alertas = (l, regra) => l.alertas.filter((a) => a.regra === regra);

// ---------------------------------------------------------------------------------------------

test("trimestre do IDU: fim exclusivo e trimestre seguinte", () => {
  assert.deepEqual(TRI, {
    chave: "2026-T3",
    rotulo: "T3/2026",
    inicio: "2026-07-01",
    fim: "2026-10-01",
  });
  assert.deepEqual(trimestreSeguinte(TRI), {
    chave: "2026-T4",
    rotulo: "T4/2026",
    inicio: "2026-10-01",
    fim: "2027-01-01",
  });
  assert.equal(trimestreSeguinte(trimestreIdu("2026-12-15")).chave, "2027-T1");
});

test("no máximo 6 números, com ids únicos e explicação completa", () => {
  const l = montarEstrategico({ idu: IDU_HOJE, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", HOJE);
  assert.equal(l.tema, "estrategico");
  assert.ok(l.numeros.length <= MAX_NUMEROS);
  assert.equal(l.numeros.length, 6);
  assert.equal(new Set(l.numeros.map((n) => n.id)).size, 6);
  for (const n of l.numeros) {
    assert.ok(n.explicacao.oQueDiz && n.explicacao.comoCalcula && n.explicacao.dono, n.id);
    assert.ok(n.fonte && !/ops\.|_/.test(n.fonte), `fonte legível em ${n.id}: ${n.fonte}`);
  }
  assert.ok(l.graficos.length >= 1 && l.graficos.length <= 2);
});

test("perímetro: filtro vazio mostra as 15; números da rede ignoram internas e unidades em implantação", () => {
  const idu = iduDe({
    metas: TODAS_PACTUADAS,
    // Goiânia (9) e São Bernardo (12) com nota alta não podem entrar: não são rede em operação.
    ranking: [
      [1, 80],
      [2, 74.9],
      [3, 75],
      [4, 100],
      [5, 30],
      [6, 90],
      [7, null],
      [8, 60],
      [9, 100],
      [12, 100],
    ],
  });
  // Faturamento: Goiânia e São Bernardo com valores enormes, confirmados, em todos os meses.
  const apuracoes = [];
  for (const m of meses("2026-06", "2026-08")) {
    for (const id of [1, 2, 3, 5, 6, 7, 8]) apuracoes.push(ap(id, m, 100));
    apuracoes.push(ap(4, m, 400));
    apuracoes.push(ap(9, m, 1_000_000));
    apuracoes.push(ap(12, m, 500_000));
  }
  const l = montarEstrategico(
    { idu, rede: { ok: true, dado: { unidades: redeUnidades(CADASTRO), apuracoes } } },
    EXTRA_VAZIO,
    UNIDADES,
    "",
    HOJE,
  );
  assert.equal(
    l.universo,
    "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria",
  );
  // Pacto: 80, 75, 100, 90 ≥ 75 entre as oito em operação (74,9, 30, 60 e sem nota ficam fora).
  const pacto = numero(l, "unidades-no-pacto");
  assert.equal(pacto.estado, "disponivel");
  assert.equal(pacto.valor, 4);
  assert.equal(pacto.cobertura, "rede");
  assert.equal(pacto.nota, "de 8 unidades em operação");
  // Faturamento: 7 × 100 + 400 = 1.100 por mês, 3 meses = 3.300 (sem Goiânia nem São Bernardo).
  const fat = numero(l, "faturamento-rede-12m");
  assert.equal(fat.valor, 3300);
  assert.equal(fat.cobertura, "rede");
  // Unidades em implantação: as três regionais sem inauguração, com os nomes (ordem do cadastro lido).
  const impl = numero(l, "unidades-implantacao");
  assert.equal(impl.valor, 3);
  assert.equal(impl.nota, "Recife, São Bernardo e Sorocaba");
  assert.deepEqual(
    impl.dados.linhas.map((x) => [x[0], x[1]]),
    [
      ["Recife", "nenhuma"],
      ["São Bernardo", "ago/2026"],
      ["Sorocaba", "nenhuma"],
    ],
  );
  // O cadastro velho vira aviso, não número.
  assert.ok(
    l.avisos.some((a) =>
      a.startsWith("São Bernardo tem apuração de royalties confirmada com receita"),
    ),
  );
});

test("filtro 'propria': todo número de cobertura rede fica não apurado, nunca zero", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    EXTRA_VAZIO,
    UNIDADES,
    "propria",
    HOJE,
  );
  assert.equal(l.universo, "4 unidades · 4 de operação própria");
  for (const id of [
    "unidades-no-pacto",
    "faturamento-rede-12m",
    "concentracao-rede",
    "unidades-implantacao",
  ]) {
    const n = numero(l, id);
    assert.equal(n.cobertura, "rede", id);
    assert.equal(n.estado, "nao_apurado", id);
    assert.equal(n.valor, null, id);
    assert.equal(n.motivo, "só existe na rede regional", id);
  }
  // Sem pacto no recorte, sem alerta de pacto.
  assert.equal(alertas(l, "pacto-sem-metas").length, 0);
  assert.equal(alertas(l, "pacto-proximo-sem-metas").length, 0);
  // Goiânia sozinha também.
  const g = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    EXTRA_VAZIO,
    UNIDADES,
    "9",
    HOJE,
  );
  assert.equal(numero(g, "unidades-no-pacto").motivo, "só existe na rede regional");
});

test("unidade em implantação sozinha: fora dos números de desempenho, mas conta em implantação", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    EXTRA_VAZIO,
    UNIDADES,
    "13",
    HOJE,
  );
  const pacto = numero(l, "unidades-no-pacto");
  assert.equal(pacto.estado, "nao_apurado");
  assert.equal(pacto.motivo, "Recife está em implantação: o IDU começa na inauguração");
  assert.equal(numero(l, "faturamento-rede-12m").estado, "nao_apurado");
  assert.equal(numero(l, "concentracao-rede").estado, "nao_apurado");
  assert.equal(numero(l, "unidades-implantacao").valor, 1);
});

test("pacto sem metas (retrato de 29/09): não apurado com o motivo, e as decisões viram alerta crítico", () => {
  const l = montarEstrategico({ idu: IDU_HOJE, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", HOJE);
  const pacto = numero(l, "unidades-no-pacto");
  // Todas com IDU 100 e nenhuma conta: a nota mede só o churn.
  assert.equal(pacto.estado, "nao_apurado");
  assert.equal(pacto.valor, null);
  assert.equal(
    pacto.motivo,
    `o Pacto do T3/2026 não tem metas cadastradas: 1 meta gravada para 8 unidades em operação, e nenhuma com meta em ao menos ${PESO_MINIMO_PACTO} dos 100 pontos da régua`,
  );
  // Curitiba tem 45 pontos com meta (churn 35 + base 10): abaixo de 50.
  const curitiba = pacto.dados.linhas.find((x) => x[0] === "Curitiba");
  assert.equal(curitiba[4], 45);
  assert.equal(curitiba[6], "não");

  const [a] = alertas(l, "pacto-sem-metas");
  assert.equal(a.gravidade, "critico");
  assert.equal(a.titulo, "Rede · Pacto T3/2026 sem metas cadastradas");
  assert.equal(a.chave, "coo:estrategico:pacto-sem-metas:rede:2026-t3");
  assert.equal(a.destino.rota, "/idu");
  assert.deepEqual(a.destino.search, { trimestre: "2026-T3" });
  assert.match(a.limiar, /menos de 50 dos 100 pontos/);

  // O T4 abre em 01/10 (2 dias) sem nenhuma meta: é a decisão desta sexta.
  const [p] = alertas(l, "pacto-proximo-sem-metas");
  assert.equal(p.gravidade, "critico");
  assert.equal(p.titulo, "Rede · metas do Pacto T4/2026 não cadastradas");
  assert.deepEqual(p.destino.search, { trimestre: "2026-T4" });
  assert.match(p.limiar, /abre em 01\/10\/2026 \(2 dias\)/);

  const g = l.graficos.find((x) => x.id === "idu-por-unidade");
  assert.equal(g.estado, "nao_apurado");
  assert.deepEqual(g.pontos, []);
});

test("metas do próximo trimestre só são cobradas nos 30 dias antes de ele abrir", () => {
  const hoje = "2026-08-15"; // 47 dias antes de 01/10
  const idu = iduDe({ metas: SO_CHURN, ranking: [], proximoMetas: 0, hoje });
  const l = montarEstrategico({ idu, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", hoje);
  assert.equal(alertas(l, "pacto-proximo-sem-metas").length, 0);
  // Com metas gravadas no próximo trimestre, também não.
  const idu2 = iduDe({ metas: SO_CHURN, ranking: [], proximoMetas: 3 });
  const l2 = montarEstrategico({ idu: idu2, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", HOJE);
  assert.equal(alertas(l2, "pacto-proximo-sem-metas").length, 0);
});

test("pacto parcial: só conta quem tem metas cadastradas (50 pontos é o limiar, inclusive)", () => {
  const metas = {
    1: { novos: "unidade", base: "unidade", churn: "fixa" }, // 65
    2: { novos: "tier", base: "tier", churn: "fixa" }, // 65
    3: { novos: "rede", base: "rede", churn: "rede" }, // 65
    5: { novos: "rede", base: "rede" }, // ramp-up: 40 + 10 = 50, no limiar
    6: { churn: "fixa" }, // 15
    4: { churn: "fixa" }, // 35
    7: { churn: "fixa" },
    8: { churn: "fixa" },
  };
  const idu = iduDe({
    metas,
    ranking: [
      [1, 80],
      [2, "74.9"],
      [3, 75],
      [5, 30],
      [4, 100], // sem pacto cadastrado: fora da contagem mesmo com 100
    ],
  });
  const l = montarEstrategico({ idu, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", HOJE);
  const pacto = numero(l, "unidades-no-pacto");
  assert.equal(pacto.estado, "parcial");
  assert.equal(pacto.valor, 2); // Curitiba (80) e Belém (75)
  assert.equal(pacto.nota, "4 de 8 unidades com metas cadastradas");
  assert.equal(pacto.tom, "atencao");
  const [a] = alertas(l, "pacto-sem-metas");
  assert.equal(a.titulo, "Rede · 4 unidades sem metas no Pacto T3/2026");
  assert.equal(a.peso, 400);
  const g = l.graficos.find((x) => x.id === "idu-por-unidade");
  assert.equal(g.estado, "parcial");
  assert.deepEqual(
    g.pontos.map((p) => [p.rotulo, p.idu]),
    [
      ["Curitiba", 80],
      ["Belém", 75],
      ["Patos de Minas", 74.9],
      ["Campo Novo", 30],
    ],
  );
});

test("pacto de uma unidade: nota do IDU e destino que abre a linha dela", () => {
  const idu = iduDe({ metas: TODAS_PACTUADAS, ranking: [[4, "100.0", "Superação"]] });
  const l = montarEstrategico({ idu, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "4", HOJE);
  const pacto = numero(l, "unidades-no-pacto");
  assert.equal(pacto.estado, "disponivel");
  assert.equal(pacto.valor, 1);
  assert.equal(pacto.nota, "IDU 100 · Superação");
  assert.deepEqual(pacto.destino.search, { trimestre: "2026-T3", unidade: "4" });
  assert.equal(alertas(l, "pacto-sem-metas").length, 0);
});

test("fonte do IDU e da apuração sem acesso ou fora do ar: estado próprio, valor nulo", () => {
  const l = montarEstrategico(
    {
      idu: {
        ok: false,
        estado: "acesso_insuficiente",
        motivo: "sua conta não tem a permissão de ver o IDU",
      },
      rede: {
        ok: false,
        estado: "fonte_indisponivel",
        motivo: "a consulta de apuração de royalties falhou",
      },
    },
    EXTRA_VAZIO,
    UNIDADES,
    "",
    HOJE,
  );
  const pacto = numero(l, "unidades-no-pacto");
  assert.equal(pacto.estado, "acesso_insuficiente");
  assert.equal(pacto.valor, null);
  for (const id of ["faturamento-rede-12m", "concentracao-rede"]) {
    assert.equal(numero(l, id).estado, "fonte_indisponivel", id);
    assert.equal(numero(l, id).valor, null, id);
  }
  // Implantação não depende da apuração: o cadastro já responde.
  assert.equal(numero(l, "unidades-implantacao").valor, 3);
  assert.equal(numero(l, "unidades-implantacao").dados.linhas[0][1], null);
  assert.equal(alertas(l, "pacto-sem-metas").length, 0);
});

test("faturamento com janela curta: parcial, rótulo com os meses, motivo do mês que interrompe", () => {
  const apuracoes = [];
  // Maio sem Maceió (inaugurada em 05/2026): mês incompleto, interrompe a janela.
  for (const id of [1, 2, 3, 4, 5, 6, 7]) apuracoes.push(ap(id, "2026-05", 100));
  for (const m of meses("2026-06", "2026-08")) {
    for (const id of [1, 2, 3, 5, 6, 7, 8]) apuracoes.push(ap(id, m, 100));
    apuracoes.push(ap(4, m, 400));
  }
  // Setembro em rascunho não entra.
  apuracoes.push(ap(4, "2026-09", 9999, "rascunho"));
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: { ok: true, dado: { unidades: redeUnidades(CADASTRO), apuracoes } } },
    EXTRA_VAZIO,
    UNIDADES,
    "",
    HOJE,
  );
  const fat = numero(l, "faturamento-rede-12m");
  assert.equal(fat.estado, "parcial");
  assert.equal(fat.valor, 3300);
  assert.equal(fat.rotulo, "Faturamento da rede · 3 meses");
  assert.equal(fat.nota, "só jun–ago/2026 completos");
  assert.equal(
    fat.motivo,
    "3 de 12 meses fechados completos; em mai/2026, 1 unidade já inaugurada está sem apuração confirmada: Maceió",
  );
  assert.equal(fat.delta, undefined, "sem os mesmos meses do ano anterior, sem crescimento");
  assert.match(fat.explicacao.atencao, /Sem crescimento/);
  assert.equal(fat.dataDado, "2026-08-31");
  assert.deepEqual(fat.destino.search, { mes: "2026-08" });

  // Concentração na mesma janela: Rio = 1.200 ÷ 3.300 = 36,4%.
  const conc = numero(l, "concentracao-rede");
  assert.equal(conc.estado, "parcial");
  assert.equal(conc.valor, 36.4);
  assert.equal(conc.nota, "Rio de Janeiro, jun–ago/2026");
});

test("faturamento com 24 meses completos: 12 meses, crescimento sobre o ano anterior e concentração", () => {
  // Rede de duas unidades inauguradas em 2024; Goiânia e São Bernardo com valores que não podem entrar.
  const cad = [
    { id: 2, nome_da_praca: "Patos de Minas", tipo: "regional", data_inauguracao: "2024-01-01" },
    { id: 4, nome_da_praca: "Rio de Janeiro", tipo: "regional", data_inauguracao: "2024-01-01" },
    { id: 9, nome_da_praca: "Goiânia", tipo: "interna", data_inauguracao: null },
    { id: 12, nome_da_praca: "São Bernardo", tipo: "regional", data_inauguracao: null },
  ];
  const un = lerUnidades(cad);
  const apuracoes = [];
  for (const m of meses("2024-09", "2025-08")) apuracoes.push(ap(4, m, 1000), ap(2, m, 500));
  for (const m of meses("2025-09", "2026-08"))
    apuracoes.push(ap(4, m, 1500), ap(2, m, 500), ap(9, m, 99_999));
  apuracoes.push(ap(12, "2026-08", 7777));
  const dados = {
    idu: IDU_HOJE,
    rede: { ok: true, dado: { unidades: redeUnidades(cad), apuracoes } },
  };

  const l = montarEstrategico(dados, EXTRA_VAZIO, un, "", HOJE);
  const fat = numero(l, "faturamento-rede-12m");
  // 12 × (1.500 + 500) = 24.000; ano anterior 12 × (1.000 + 500) = 18.000; +33,3%.
  assert.equal(fat.estado, "disponivel");
  assert.equal(fat.rotulo, "Faturamento da rede · 12 meses");
  assert.equal(fat.valor, 24000);
  assert.deepEqual(fat.delta, {
    valor: 33.3,
    rotulo: "sobre set/2024–ago/2025",
    sentido: "maior-melhor",
  });
  assert.equal(fat.nota, "set/2025–ago/2026");
  assert.deepEqual(fat.tendencia.valores, Array(12).fill(2000));

  const conc = numero(l, "concentracao-rede");
  assert.equal(conc.estado, "disponivel");
  assert.equal(conc.rotulo, "Peso da maior unidade na rede");
  assert.equal(conc.valor, 75); // 18.000 ÷ 24.000
  assert.equal(conc.nota, "Rio de Janeiro, set/2025–ago/2026");

  // Filtro do Rio: o faturamento é o dele (18.000, +50%), e o peso é contra a rede inteira.
  const rio = montarEstrategico(dados, EXTRA_VAZIO, un, "4", HOJE);
  assert.equal(numero(rio, "faturamento-rede-12m").valor, 18000);
  assert.equal(numero(rio, "faturamento-rede-12m").delta.valor, 50);
  assert.equal(numero(rio, "concentracao-rede").rotulo, "Peso de Rio de Janeiro na rede");
  assert.equal(numero(rio, "concentracao-rede").valor, 75);
  const patos = montarEstrategico(dados, EXTRA_VAZIO, un, "2", HOJE);
  assert.equal(numero(patos, "concentracao-rede").valor, 25);
});

test("faturamento sem nenhuma apuração confirmada: não apurado, nunca R$ 0", () => {
  const l = montarEstrategico({ idu: IDU_HOJE, rede: REDE_VAZIA }, EXTRA_VAZIO, UNIDADES, "", HOJE);
  const fat = numero(l, "faturamento-rede-12m");
  assert.equal(fat.estado, "nao_apurado");
  assert.equal(fat.valor, null);
  assert.equal(numero(l, "concentracao-rede").valor, null);
});

// ---------------------------------------------------------------------------------------------
// OKRs
// ---------------------------------------------------------------------------------------------

const kr = (dia, departamento, kr_id, progresso) => ({
  dia,
  kr_id,
  departamento,
  objetivo: null,
  kr_nome: kr_id,
  progresso,
  origem: null,
});
const OKRS = [
  kr("2026-09-01", "CEO · Pedro Araujo", "a", 0.1),
  kr("2026-09-01", "Receitas · Pedro Luca", "d", 0.9),
  kr("2026-09-02", "CEO · Pedro Araujo", "a", 0.5),
  kr("2026-09-02", "CEO · Pedro Araujo", "b", 0.3),
  kr("2026-09-02", "CEO · Pedro Araujo", "c", null),
  kr("2026-09-02", "Receitas · Pedro Luca", "d", null),
  kr("2026-09-02", "Receitas · Pedro Luca", "e", null),
  kr("2026-09-02", "Operações · Victor", "f", 0.7),
  kr("2026-09-02", "Novos Sócios . Paulo", "g", "0.6667"),
];

test("OKRs da Expansão: média das KRs medidas de todos os departamentos no último dia, foto parada = parcial", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { ...EXTRA_VAZIO, okrs: OKRS },
    UNIDADES,
    "",
    HOJE,
  );
  const n = numero(l, "okrs-expansao");
  // (0,5 + 0,3 + 0,7 + 0,6667) ÷ 4 = 0,541675 → 54,2%. Esperado em 02/09: 33 ÷ 153 dias = 21,6%.
  assert.equal(n.valor, 54.2);
  assert.deepEqual(n.meta, { valor: 21.6, rotulo: "esperado em 02/09" });
  assert.equal(n.estado, "parcial");
  assert.equal(n.motivo, "a foto diária de OKRs parou em 02/09/2026");
  assert.equal(n.nota, "4 de 7 KRs medidas");
  assert.equal(n.tom, "sucesso");
  assert.equal(n.dataDado, "2026-09-02");
  assert.equal(n.cobertura, "grupo");
  // O filtro de unidade não muda o número (OKR é da matriz).
  const f = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { ...EXTRA_VAZIO, okrs: OKRS },
    UNIDADES,
    "propria",
    HOJE,
  );
  assert.equal(numero(f, "okrs-expansao").valor, 54.2);

  const [sem] = alertas(l, "okr-sem-medicao");
  assert.equal(alertas(l, "okr-sem-medicao").length, 1);
  assert.equal(sem.titulo, "Receitas · nenhuma das 2 KRs medida");
  assert.equal(sem.gravidade, "atencao");
  assert.equal(sem.chave, "coo:estrategico:okr-sem-medicao:rede:receitas-2026-08");
  const [parada] = alertas(l, "okr-foto-parada");
  assert.equal(parada.titulo, "OKRs · foto diária parada desde 02/09/2026");
  assert.equal(parada.gravidade, "atencao");
  assert.equal(parada.peso, 27);
  assert.match(parada.limiar, /mais de 2 dias.*integração do ClickUp/);
});

test("OKRs: foto de 2 dias não é parada; foto vazia é fonte indisponível, sem KR medida é não apurado", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { ...EXTRA_VAZIO, okrs: OKRS },
    UNIDADES,
    "",
    "2026-09-04",
  );
  assert.equal(numero(l, "okrs-expansao").estado, "disponivel");
  assert.equal(alertas(l, "okr-foto-parada").length, 0);

  const vazia = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    EXTRA_VAZIO,
    UNIDADES,
    "",
    HOJE,
  );
  assert.equal(numero(vazia, "okrs-expansao").estado, "fonte_indisponivel");
  assert.equal(numero(vazia, "okrs-expansao").valor, null);
  assert.equal(alertas(vazia, "okr-foto-parada").length, 0);

  const semMedida = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { ...EXTRA_VAZIO, okrs: [kr("2026-09-02", "Comercial · Renan", "x", null)] },
    UNIDADES,
    "",
    HOJE,
  );
  const n = numero(semMedida, "okrs-expansao");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  assert.equal(n.motivo, "nenhuma KR medida na foto de 02/09/2026");
});

// ---------------------------------------------------------------------------------------------
// Compromissos
// ---------------------------------------------------------------------------------------------

const SEXTA = "2026-10-02";
const AGORA = "2026-10-02T15:00:00.000Z";
const esp = (id, tema, unidade, prazo, concluida_em = null) => ({
  id,
  parent_id: null,
  lista_id: "l1",
  lista_nome: "Compromissos",
  pasta_id: "p1",
  pasta_nome: "Rotina Semanal",
  nome: `Compromisso ${id}`,
  url: `https://app.clickup.com/t/${id}`,
  status: concluida_em ? "concluído" : "a fazer",
  status_tipo: concluida_em ? "closed" : "open",
  concluida: Boolean(concluida_em),
  donos: [{ id: "u1", nome: "Paulo", email: null }],
  prazo,
  criada_em: "2026-09-20T12:00:00.000Z",
  atualizada_em: "2026-10-01T12:00:00.000Z",
  concluida_em,
  tags: [],
  tema,
  unidade,
  origem: null,
  prioridade: null,
});
const COMPROMISSOS = [
  esp("A", "Growth", "Curitiba", "2026-09-29T15:00:00.000Z", "2026-09-29T18:00:00.000Z"), // no prazo
  esp("B", "CS e RH", "Rede", "2026-09-30T15:00:00.000Z", "2026-10-01T12:00:00.000Z"), // com atraso
  esp("C", "Estratégico", "Belém", "2026-10-01T15:00:00.000Z"), // vencido há 1 dia
  esp("D", "Monetização", "Goiânia", "2026-10-03T15:00:00.000Z"), // aberto no prazo
  esp("E", "Financeiro e Operações", "Belém", "2026-09-10T12:00:00.000Z"), // vencido há 22 dias
  esp("F", "Growth", null, "2026-09-25T12:00:00.000Z"), // vencido há 7 dias
  esp("G", "Estratégico", "Recife", "2026-10-09T15:00:00.000Z"), // aberto, semana que vem
].map((l) => lerCompromisso(l, [], AGORA));

test("compromissos sem ClickUp conectado: não apurado com o motivo, gráfico sem dado, sem alerta", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { okrs: [], compromissos: COMPROMISSOS, clickupConectado: false },
    UNIDADES,
    "",
    SEXTA,
  );
  const n = numero(l, "compromissos-no-prazo");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  assert.equal(
    n.motivo,
    "o ClickUp ainda não está conectado (token em Administração › Chaves de Integração)",
  );
  const g = l.graficos.find((x) => x.id === "revisao-semana");
  assert.equal(g.estado, "nao_apurado");
  assert.equal(g.motivo, n.motivo);
  assert.equal(alertas(l, "compromisso-vencido").length, 0);
  // Sem ClickUp, a tabela da implantação não inventa zero compromisso.
  assert.equal(numero(l, "unidades-implantacao").dados.linhas[1][2], null);
});

test("compromissos da semana: taxa no prazo, revisão por tema e alerta de vencido há 14+ dias", () => {
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { okrs: [], compromissos: COMPROMISSOS, clickupConectado: true },
    UNIDADES,
    "",
    SEXTA,
  );
  // Semana 28/09 a 04/10: A no prazo, B com atraso, C vencido; D aberto no prazo fica fora da taxa.
  const n = numero(l, "compromissos-no-prazo");
  assert.equal(n.estado, "disponivel");
  assert.equal(n.valor, 33.3);
  assert.equal(n.nota, "1 de 3 no prazo");
  const g = l.graficos.find((x) => x.id === "revisao-semana");
  assert.equal(g.estado, "disponivel");
  assert.deepEqual(
    g.pontos.map((p) => [p.rotulo, p.noPrazo, p.comAtraso, p.vencidos, p.abertos]),
    [
      ["Seg · Growth", 1, 0, 0, 0],
      ["Ter · Financeiro e Operações", 0, 0, 0, 0],
      ["Qua · CS e RH", 0, 1, 0, 0],
      ["Qui · Monetização", 0, 0, 0, 1],
      ["Sex · Estratégico", 0, 0, 1, 0],
    ],
  );
  // Só E passou de 14 dias (F está há 7).
  const v = alertas(l, "compromisso-vencido");
  assert.equal(v.length, 1);
  assert.equal(v[0].titulo, "Belém · vencido há 22 dias: Compromisso E");
  assert.equal(v[0].unidade, "Belém");
  assert.equal(v[0].gravidade, "critico");
  assert.equal(v[0].chave, "coo:estrategico:compromisso-vencido:belem:e");
  assert.equal(v[0].destino.rota, "/cockpit-coo/compromissos");
  // Implantação: Recife com um compromisso aberto e nenhum vencido.
  const recife = numero(l, "unidades-implantacao").dados.linhas.find((x) => x[0] === "Recife");
  assert.deepEqual(recife.slice(2), [1, 0]);
});

test("compromissos no recorte de unidade: zero quando lido e contado, não apurado sem nada devido", () => {
  const extra = { okrs: [], compromissos: COMPROMISSOS, clickupConectado: true };
  // Belém: C vencido na semana → 0% (a fonte foi lida e contou zero no prazo).
  const belem = montarEstrategico({ idu: IDU_HOJE, rede: REDE_VAZIA }, extra, UNIDADES, "3", SEXTA);
  assert.equal(numero(belem, "compromissos-no-prazo").estado, "disponivel");
  assert.equal(numero(belem, "compromissos-no-prazo").valor, 0);
  // Rede regional: A (Curitiba), B ("Rede") e C (Belém) → 1 de 3.
  const rede = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    extra,
    UNIDADES,
    "rede",
    SEXTA,
  );
  assert.equal(numero(rede, "compromissos-no-prazo").valor, 33.3);
  // Operação própria: só D (Goiânia), ainda no prazo → nada devido, não é 0%.
  const propria = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    extra,
    UNIDADES,
    "propria",
    SEXTA,
  );
  const n = numero(propria, "compromissos-no-prazo");
  assert.equal(n.estado, "nao_apurado");
  assert.equal(n.valor, null);
  assert.equal(n.motivo, "nenhuma tarefa da semana venceu ou foi concluída ainda (1 no prazo)");
  // Compromisso sem unidade (F) só entra em todas; Goiânia (D) fica fora da rede.
  assert.deepEqual(
    compromissosDoFiltro(COMPROMISSOS, UNIDADES, "rede").map((c) => c.id),
    ["A", "B", "C", "E", "G"],
  );
  assert.equal(compromissosDoFiltro(COMPROMISSOS, UNIDADES, "").length, 7);
});

test("alertas: chaves únicas e estáveis entre duas montagens", () => {
  const dados = { idu: IDU_HOJE, rede: REDE_VAZIA };
  const extra = { okrs: OKRS, compromissos: COMPROMISSOS, clickupConectado: true };
  const a = montarEstrategico(dados, extra, UNIDADES, "", SEXTA).alertas.map((x) => x.chave);
  const b = montarEstrategico(dados, extra, UNIDADES, "", SEXTA).alertas.map((x) => x.chave);
  assert.deepEqual(a, b);
  assert.equal(new Set(a).size, a.length);
  for (const x of montarEstrategico(dados, extra, UNIDADES, "", SEXTA).alertas) {
    assert.ok(x.limiar, x.chave);
    assert.ok(!x.titulo.includes("\n"), x.chave);
  }
});

test("sexta: tarefa de área vencida vira um alerta por área, não um por tarefa", () => {
  const area = (id, prazo) => ({
    ...esp(id, null, null, prazo),
    pasta_nome: "Operações · Victor",
    lista_nome: "Garantir um modelo financeiro sustentável",
    nome: `EBITDA ${id}`,
  });
  const cs = [
    ...COMPROMISSOS,
    ...[area("jan", "2026-02-10T12:00:00.000Z"), area("fev", "2026-03-10T12:00:00.000Z"), area("mar", "2026-04-10T12:00:00.000Z")].map(
      (l) => lerCompromisso(l, [], AGORA),
    ),
    // Vencida há 5 dias: ainda não passou por duas sextas.
    lerCompromisso(area("recente", "2026-09-27T12:00:00.000Z"), [], AGORA),
  ];
  const l = montarEstrategico(
    { idu: IDU_HOJE, rede: REDE_VAZIA },
    { okrs: [], compromissos: cs, clickupConectado: true },
    UNIDADES,
    "",
    SEXTA,
  );
  const daArea = l.alertas.filter((a) => a.regra === "area-tarefas-vencidas");
  assert.deepEqual(daArea.map((a) => [a.gravidade, a.titulo]), [
    ["atencao", "Operações · 3 tarefas vencidas há 14 dias ou mais no ClickUp"],
  ]);
  assert.equal(daArea[0].chave, "coo:estrategico:area-tarefas-vencidas:rede:operacoes-2026-09-28");
  // O compromisso da rotina vencido há 22 dias continua com o alerta crítico dele.
  assert.equal(l.alertas.filter((a) => a.regra === "compromisso-vencido").length, 1);
  assert.equal(l.alertas.some((a) => a.titulo.includes("EBITDA")), false);
});
