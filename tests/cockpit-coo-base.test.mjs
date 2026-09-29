import test from "node:test";
import assert from "node:assert/strict";
import {
  TEMAS,
  ORDEM_TEMAS,
  temaDoDia,
  departamentoBase,
  temasDoDepartamento,
  ordenarAlertas,
} from "../src/lib/cockpit-coo/contrato.ts";
import {
  chaveUnidade,
  lerUnidades,
  unidadesDoFiltro,
  acharUnidade,
  universo,
  filtroValido,
} from "../src/lib/cockpit-coo/unidades.ts";

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

test("rotina: cada dia útil tem um tema, e o fim de semana abre a sexta", () => {
  assert.equal(ORDEM_TEMAS.length, 5);
  assert.deepEqual(
    ORDEM_TEMAS.map((t) => TEMAS[t].dia),
    [1, 2, 3, 4, 5],
  );
  assert.equal(temaDoDia("2026-09-28"), "growth"); // segunda
  assert.equal(temaDoDia("2026-09-29"), "financeiro-operacoes"); // terça
  assert.equal(temaDoDia("2026-09-30"), "cs-rh");
  assert.equal(temaDoDia("2026-10-01"), "monetizacao");
  assert.equal(temaDoDia("2026-10-02"), "estrategico");
  assert.equal(temaDoDia("2026-10-03"), "estrategico"); // sábado
  assert.equal(temaDoDia("2026-10-04"), "estrategico"); // domingo
});

test("departamentos do ClickUp: casa pelo nome antes do dono, com · ou .", () => {
  assert.equal(departamentoBase("Operações · Victor"), "Operações");
  assert.equal(departamentoBase("Novos Sócios . Paulo"), "Novos Sócios");
  assert.equal(departamentoBase("Relacionamento & CS · Ana"), "Relacionamento & CS");
  assert.deepEqual(temasDoDepartamento("Operações · Victor"), ["financeiro-operacoes"]);
  assert.deepEqual(temasDoDepartamento("Receitas · Pedro Luca"), ["monetizacao"]);
  assert.deepEqual(temasDoDepartamento("Performance & Tech · Mikael"), ["growth"]);
  assert.deepEqual(temasDoDepartamento("CEO · Pedro Araujo"), ["estrategico"]);
  assert.deepEqual(temasDoDepartamento("Novos Sócios . Paulo"), ["estrategico"]);
  // Pasta que nenhum tema acompanha não some por engano em outro tema.
  assert.deepEqual(temasDoDepartamento("Rotina Semanal"), []);
});

test("todos os nove departamentos do quadro de 02/09 caem em exatamente um tema", () => {
  const pastas = [
    "Auditoria & Qualidade · Amanda/Sumaya",
    "CEO · Pedro Araujo",
    "Comercial · Renan",
    "Marketing · Simão e Tiago",
    "Novos Sócios . Paulo",
    "Operações · Victor",
    "Performance & Tech · Mikael",
    "Receitas · Pedro Luca",
    "Relacionamento & CS · Ana",
  ];
  for (const p of pastas) assert.equal(temasDoDepartamento(p).length, 1, p);
});

test("chave de unidade: igual a ops.base_unidade(), com os apelidos de Goiânia e do Rio", () => {
  assert.equal(chaveUnidade("Goiânia"), "goiania");
  assert.equal(chaveUnidade("Matriz"), "goiania");
  assert.equal(chaveUnidade("Goiânia / Matriz"), "goiania");
  assert.equal(chaveUnidade("Partners"), "goiania");
  assert.equal(chaveUnidade("Sudeste (RJ)"), "rio de janeiro");
  assert.equal(chaveUnidade("  São   Luís "), "sao luis");
  assert.equal(chaveUnidade("São Luis"), "sao luis");
  assert.equal(chaveUnidade(null), "");
  assert.equal(chaveUnidade("São Bernardo do Campo"), "sao bernardo");
  assert.equal(chaveUnidade("Campo Novo do Parecis"), "campo novo");
});

test("perímetro: todas as 15 unidades entram, em dois grupos", () => {
  const u = lerUnidades(CADASTRO);
  assert.equal(u.length, 15);
  assert.equal(u.filter((x) => x.grupo === "rede").length, 11);
  assert.equal(u.filter((x) => x.grupo === "propria").length, 4);
  const goiania = u.find((x) => x.id === 9);
  assert.equal(goiania.grupo, "propria");
  assert.equal(goiania.emOperacao, true);
  // Regional sem inauguração está em implantação.
  for (const id of [12, 13, 14]) assert.equal(u.find((x) => x.id === id).emOperacao, false);
  assert.equal(u.filter((x) => x.grupo === "rede" && x.emOperacao).length, 8);
});

test("filtro de unidade: vazio, grupo, id; id desconhecido volta para todas", () => {
  const u = lerUnidades(CADASTRO);
  assert.equal(unidadesDoFiltro(u, "").length, 15);
  assert.equal(unidadesDoFiltro(u, "rede").length, 11);
  assert.deepEqual(
    unidadesDoFiltro(u, "propria").map((x) => x.id).sort((a, b) => a - b),
    [9, 10, 11, 15],
  );
  assert.deepEqual(unidadesDoFiltro(u, "9").map((x) => x.nome), ["Goiânia"]);
  assert.equal(unidadesDoFiltro(u, "999").length, 15);
  assert.equal(filtroValido(u, "999"), false);
  assert.equal(filtroValido(u, "rede"), true);
});

test("acharUnidade casa os textos das fontes com o cadastro", () => {
  const u = lerUnidades(CADASTRO);
  assert.equal(acharUnidade(u, "Matriz").id, 9);
  assert.equal(acharUnidade(u, "SAO LUIS").id, 6);
  assert.equal(acharUnidade(u, "Itaúna"), null);
  assert.equal(acharUnidade(u, "1436672162"), null);
});

test("universo numa linha", () => {
  const u = lerUnidades(CADASTRO);
  assert.equal(
    universo(u, ""),
    "15 unidades · 11 da rede regional (8 em operação) · 4 de operação própria",
  );
  assert.equal(universo(u, "rede"), "11 unidades · 11 da rede regional (8 em operação)");
  assert.equal(universo(u, "13"), "Recife · rede regional · em implantação");
  assert.equal(universo(u, "9"), "Goiânia · operação própria");
});

test("alertas: crítico antes de atenção; dentro da gravidade, o maior peso", () => {
  const a = (chave, gravidade, peso) => ({ chave, gravidade, peso, titulo: chave });
  assert.deepEqual(
    ordenarAlertas([a("x", "atencao", 900), a("y", "critico", 1), a("z", "critico", 50)]).map(
      (x) => x.chave,
    ),
    ["z", "y", "x"],
  );
});
