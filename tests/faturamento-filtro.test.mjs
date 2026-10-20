// Portal de Faturamento: filtros na URL e a ida e volta com o p_filtro de ops.fat_pedidos
// (src/lib/faturamento/filtro.ts). Contrato docs/design/contratos/faturamento.md §2 e §3; API.md §1.2 e §1.3.
import test from "node:test";
import assert from "node:assert/strict";
import {
  buscaDoFiltro,
  chipsDaBusca,
  colunaParcelas,
  filtroDaBusca,
  frasePeriodo,
  hrefPedidos,
  idsDasEmissoras,
  lerBuscaMeuFaturamento,
  lerBuscaNovo,
  lerBuscaPedidos,
  lerVolta,
  temFiltro,
} from "../src/lib/faturamento/filtro.ts";

const DOC = { id: "c2430000-0000-4000-8000-000000000001", apelido: "DOC" };
const PIS = { id: "c2430000-0000-4000-8000-000000000002", apelido: "PIS" };
const EMISSORAS = [DOC, PIS];
const HUGO = "81200000-0000-4000-8000-0000000000aa";

test("lerBuscaPedidos guarda só o que é válido e tira o padrão da URL", () => {
  assert.deepEqual(lerBuscaPedidos({}), {});
  assert.deepEqual(
    lerBuscaPedidos({
      situacao: "aguardando_ok,lixo,simulado,aguardando_ok",
      pendencia: "ok",
      emissora: "doc, PIS,!!",
      dono: HUGO.toUpperCase(),
      busca: "  cliente x  ",
      ordem: "valor",
      pagina: "3",
    }),
    {
      situacao: "aguardando_ok,simulado",
      pendencia: "ok",
      emissora: "DOC,PIS",
      dono: HUGO,
      busca: "cliente x",
      ordem: "valor",
      pagina: 3,
    },
  );
  // Padrões não ficam: ordem "atualizado" e página 1.
  assert.deepEqual(lerBuscaPedidos({ ordem: "atualizado", pagina: 1 }), {});
  // Lixo sai.
  assert.deepEqual(
    lerBuscaPedidos({ pendencia: "x", dono: "nao-uuid", ordem: "x", pagina: "-2", mes: "2026-13" }),
    {},
  );
});

test("lerBuscaPedidos: o par mês e régua (API.md §1.3)", () => {
  assert.deepEqual(lerBuscaPedidos({ mes: "2026-10", regua: "nota" }), {
    mes: "2026-10",
    regua: "nota",
  });
  // Mês sem régua vale por competência.
  assert.deepEqual(lerBuscaPedidos({ mes: "2026-10" }), { mes: "2026-10", regua: "competencia" });
  // Régua de mês sem mês sai.
  assert.deepEqual(lerBuscaPedidos({ regua: "pagamento" }), {});
  // Atraso não leva mês.
  assert.deepEqual(lerBuscaPedidos({ regua: "atraso", mes: "2026-10" }), { regua: "atraso" });
});

test("lerBuscaPedidos aceita lista como array e simulação como booleano", () => {
  assert.deepEqual(lerBuscaPedidos({ situacao: ["os_criada", "a_faturar"], simulacao: true }), {
    situacao: "os_criada,a_faturar",
    simulacao: "sim",
  });
  assert.deepEqual(lerBuscaPedidos({ simulacao: "nao" }), { simulacao: "nao" });
});

test("lerBuscaMeuFaturamento, lerBuscaNovo e lerVolta", () => {
  assert.deepEqual(lerBuscaMeuFaturamento({ mes: "2026-10", emissora: "doc", lixo: 1 }), {
    mes: "2026-10",
    emissora: "DOC",
  });
  assert.deepEqual(lerBuscaMeuFaturamento({ mes: "out" }), {});
  assert.deepEqual(lerBuscaNovo({ pedido: HUGO, emissora: "doc,pis" }), {
    pedido: HUGO,
    emissora: "DOC",
  });
  assert.deepEqual(lerBuscaNovo({ pedido: "x" }), {});
  assert.equal(
    lerVolta("/faturamento/pedidos?situacao=a_faturar"),
    "/faturamento/pedidos?situacao=a_faturar",
  );
  assert.equal(lerVolta("/faturamento"), "/faturamento");
  assert.equal(lerVolta("//evil.com/faturamento"), undefined);
  assert.equal(lerVolta("https://evil.com"), undefined);
  assert.equal(lerVolta("/clientes"), undefined);
  assert.equal(lerVolta("/faturamentox"), undefined);
});

test("idsDasEmissoras separa o que não está no recorte", () => {
  // Apelido com espaço ("PAC SP") vale.
  assert.deepEqual(idsDasEmissoras("pac sp", [{ id: "x", apelido: "PAC SP" }]), {
    ids: ["x"],
    desconhecidas: [],
  });
  assert.deepEqual(idsDasEmissoras("DOC,PRJ", EMISSORAS), {
    ids: [DOC.id],
    desconhecidas: ["PRJ"],
  });
  assert.deepEqual(idsDasEmissoras(undefined, EMISSORAS), { ids: [], desconhecidas: [] });
});

test("filtroDaBusca monta o p_filtro só com as chaves que têm valor", () => {
  assert.deepEqual(filtroDaBusca({}, EMISSORAS).filtro, { pagina: 1, por_pagina: 50 });
  const { filtro, desconhecidas } = filtroDaBusca(
    {
      situacao: "a_faturar",
      emissora: "DOC,PRJ",
      dono: HUGO,
      mes: "2026-10",
      regua: "pagamento",
      simulacao: "nao",
      busca: "FAT-2026",
      ordem: "vencimento",
      pagina: 2,
    },
    EMISSORAS,
  );
  assert.deepEqual(filtro, {
    situacao: ["a_faturar"],
    emissoras: [DOC.id],
    dono: HUGO,
    mes: "2026-10",
    regua: "pagamento",
    simulacao: false,
    busca: "FAT-2026",
    ordem: "vencimento",
    pagina: 2,
    por_pagina: 50,
  });
  assert.deepEqual(desconhecidas, ["PRJ"]);
  assert.deepEqual(filtroDaBusca({ regua: "atraso" }, EMISSORAS, 20).filtro, {
    regua: "atraso",
    pagina: 1,
    por_pagina: 20,
  });
});

test("drill-down: cada filtro de fat_resumo vira a URL de Pedidos e volta igual (N2)", () => {
  const filtrosDaApi = [
    { situacao: ["a_faturar"] },
    { mes: "2026-10", regua: "nota" },
    { mes: "2026-10", regua: "pagamento" },
    { regua: "atraso" },
    { situacao: ["aguardando_ok"] },
    { pendencia: "ok" },
    { pendencia: "erro" },
    { situacao: ["os_criada", "simulado", "em_conferencia"] },
    { situacao: ["simulado"], emissoras: [PIS.id], simulacao: true },
  ];
  for (const f of filtrosDaApi) {
    const busca = buscaDoFiltro(f, EMISSORAS);
    const { filtro } = filtroDaBusca(busca, EMISSORAS);
    const { pagina, por_pagina, ...semPagina } = filtro;
    assert.deepEqual(semPagina, f, JSON.stringify(f));
    assert.equal(pagina, 1);
    assert.equal(por_pagina, 50);
  }
});

test("drill-down leva o recorte de empresa da tela de origem quando o filtro não traz o seu", () => {
  assert.deepEqual(buscaDoFiltro({ situacao: ["a_faturar"] }, EMISSORAS, { emissora: "DOC" }), {
    situacao: "a_faturar",
    emissora: "DOC",
  });
  // O filtro com empresa vence o da tela.
  assert.deepEqual(buscaDoFiltro({ emissoras: [PIS.id] }, EMISSORAS, { emissora: "DOC" }), {
    emissora: "PIS",
  });
});

test("hrefPedidos monta o link do KpiCard", () => {
  assert.equal(hrefPedidos({}), "/faturamento/pedidos");
  assert.equal(
    hrefPedidos({ situacao: "a_faturar", emissora: "DOC,PIS", pagina: 2 }),
    "/faturamento/pedidos?situacao=a_faturar&emissora=DOC%2CPIS&pagina=2",
  );
  // E o link volta pelo validateSearch.
  const url = new URL(
    `https://x${hrefPedidos({ mes: "2026-10", regua: "nota", emissora: "DOC" })}`,
  );
  assert.deepEqual(lerBuscaPedidos(Object.fromEntries(url.searchParams)), {
    mes: "2026-10",
    regua: "nota",
    emissora: "DOC",
  });
});

test("o chip e a descrição dizem a régua do período", () => {
  assert.equal(frasePeriodo({}), null);
  assert.equal(frasePeriodo({ mes: "2026-10", regua: "nota" }), "Nota emitida em out/2026");
  assert.equal(frasePeriodo({ mes: "2026-10", regua: "pagamento" }), "Pago em out/2026");
  assert.equal(frasePeriodo({ mes: "2026-10", regua: "competencia" }), "Competência out/2026");
  assert.equal(frasePeriodo({ regua: "atraso" }), "Parcela em atraso hoje");
});

test("chips removíveis dos filtros ativos", () => {
  const chips = chipsDaBusca(
    {
      situacao: "a_faturar,os_criada",
      pendencia: "devolvido",
      emissora: "DOC",
      dono: HUGO,
      mes: "2026-10",
      regua: "nota",
      busca: "x",
    },
    (id) => (id === HUGO ? "Hugo" : null),
  );
  assert.deepEqual(
    chips.map((c) => [c.chave, c.valor, c.remove]),
    [
      ["situacao", "A faturar, OS criada", ["situacao"]],
      ["pendencia", "Devolvidos para corrigir", ["pendencia"]],
      ["emissora", "DOC", ["emissora"]],
      ["dono", "Hugo", ["dono"]],
      ["periodo", "Nota emitida em out/2026", ["mes", "regua"]],
      ["busca", "x", ["busca"]],
    ],
  );
  assert.equal(temFiltro({ ordem: "valor", pagina: 3 }), false);
  assert.equal(temFiltro({ pendencia: "ok" }), true);
});

test("a régua acende a coluna de parcelas certa (contrato §3, Colunas)", () => {
  assert.equal(colunaParcelas({ regua: "pagamento" }), "pago_no_mes");
  assert.equal(colunaParcelas({ regua: "atraso" }), "em_atraso");
  assert.equal(colunaParcelas({ regua: "nota" }), null);
  assert.equal(colunaParcelas({}), null);
});
