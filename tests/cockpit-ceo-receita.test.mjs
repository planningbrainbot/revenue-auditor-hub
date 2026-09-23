import test from "node:test";
import assert from "node:assert/strict";
import {
  resumirLeitura,
  META_ANUAL,
  ANO_ALVO,
  MEDIA_MENSAL_NECESSARIA,
} from "../src/lib/cockpit-ceo/receita.ts";

const HOJE = "2026-09-22";
const destino = {
  rota: "/financeiro",
  search: {},
  rotulo: "x",
  mesmoRecorte: false,
  observacao: "",
};
const leitura = (linhas, extra = {}) => ({
  id: "grupo",
  titulo: "Empresas do grupo",
  definicao: "def",
  fonte: "fonte",
  estado: "disponivel",
  nota: null,
  linhas,
  cobertura: [],
  destino,
  ...extra,
});
const meses = (de, n) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1 + i, 1));
    return d.toISOString().slice(0, 7);
  });

test("Meta de 2030 em números: R$ 1 bi no ano, R$ 83,3 mi por mês", () => {
  assert.equal(META_ANUAL, 1_000_000_000);
  assert.equal(ANO_ALVO, 2030);
  assert.equal(Math.round(MEDIA_MENSAL_NECESSARIA), 83_333_333);
});

test("Histórico curto: soma e média dos meses fechados, sem 12 meses e sem crescimento inventado", () => {
  const linhas = meses("2026-01", 9).flatMap((mes, i) => [
    { mes, chave: "A", valor: 6_000_000 + i },
    { mes, chave: "B", valor: 4_000_000 },
  ]);
  const r = resumirLeitura(leitura(linhas), HOJE);
  assert.equal(r.historicoDesde, "2026-01");
  assert.equal(r.fechados.meses, 8, "setembro está em andamento e fica de fora");
  assert.equal(r.fechados.de, "2026-01");
  assert.equal(r.fechados.ate, "2026-08");
  assert.equal(r.doze, null);
  assert.equal(r.crescimentoAnualNecessario, null);
  assert.equal(r.estado, "parcial");
  assert.ok(Math.abs(r.fechados.media - 80_000_028 / 8) < 0.01);
  assert.ok(Math.abs(r.multiploNecessario - MEDIA_MENSAL_NECESSARIA / r.fechados.media) < 1e-9);
  assert.ok(r.serie.at(-1).parcial && r.serie.at(-1).mes === "2026-09");
  assert.ok(r.notas.some((n) => /8 de 12 meses/.test(n)));
  const soma = r.porChave.reduce((s, x) => s + x.participacao, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9);
});

test("Doze meses fechados completos dão crescimento anual necessário até dez/2030", () => {
  const linhas = meses("2024-09", 25).map((mes) => ({ mes, chave: "U", valor: 1_500_000 }));
  const r = resumirLeitura(leitura(linhas, { id: "rede" }), HOJE);
  assert.equal(r.fechados.meses, 12);
  assert.equal(r.fechados.de, "2025-09");
  assert.equal(r.fechados.ate, "2026-08");
  assert.equal(r.doze, 18_000_000);
  assert.ok(Math.abs(r.anosAteAlvo - 52 / 12) < 1e-9, "de ago/2026 a dez/2030");
  const esperado = Math.pow(META_ANUAL / 18_000_000, 1 / (52 / 12)) - 1;
  assert.ok(Math.abs(r.crescimentoAnualNecessario - esperado) < 1e-9);
  assert.equal(r.estado, "disponivel");
});

test("Mês faltando no meio não vira zero: quebra os 12 meses e fica nomeado", () => {
  const linhas = meses("2025-09", 12)
    .filter((m) => m !== "2026-03")
    .map((mes) => ({ mes, chave: "U", valor: 1_000_000 }));
  const r = resumirLeitura(leitura(linhas), HOJE);
  assert.equal(r.doze, null);
  assert.ok(r.notas.some((n) => /2026-03/.test(n) || /03\/2026/.test(n)));
  assert.equal(r.fechados.meses, 5, "só os meses contíguos até o último fechado");
});

test("Leitura sem acesso não mostra número nenhum", () => {
  const r = resumirLeitura(
    leitura([], { estado: "acesso_insuficiente", nota: "Sem acesso ao Financeiro." }),
    HOJE,
  );
  assert.equal(r.estado, "acesso_insuficiente");
  assert.equal(r.fechados, null);
  assert.equal(r.multiploNecessario, null);
  assert.deepEqual(r.serie, []);
});

// ── Construtores das leituras a partir das fontes ────────────────────────────
import {
  extrairFaturamento,
  montarLeituraGrupo,
  montarLeituraRede,
} from "../src/lib/cockpit-ceo/receita-fontes.ts";

const faturamentoCru = {
  definicao: "Receita Bruta de Vendas (Estrutura_DRE 1.1.) · fictício",
  escopo: { recortes_excluidos: ["negocios-estruturados", "finance"] },
  serie: [
    {
      competencia: "2026-01-01",
      receita: 6_000_000.1,
      parcial: false,
      lancamentos: 10,
      clientes: 3,
    },
    { competencia: "2026-02-01", receita: 5_000_000, parcial: false, lancamentos: 9, clientes: 3 },
    { competencia: "2026-08-01", receita: 6_900_000, parcial: true, lancamentos: 8, clientes: 2 },
  ],
  meses: [
    {
      competencia: "2026-01-01",
      parcial: false,
      motivo: "fechamento",
      sem_cobertura: false,
      sem_lancamento: false,
    },
    {
      competencia: "2026-02-01",
      parcial: false,
      motivo: "AUSÊNCIAS DECLARADAS: empresa X em zero",
      sem_cobertura: false,
      sem_lancamento: false,
    },
    {
      competencia: "2026-08-01",
      parcial: true,
      motivo: "Mês EM CURSO",
      sem_cobertura: false,
      sem_lancamento: false,
    },
  ],
  meses_fora_da_cobertura: ["2025-12-01", "2026-09-01"],
  linhas: [{ cliente: "Cliente Fictício de Teste SA", receita: 1 }],
  totais: { receita_total_escopo: 17_900_000.1 },
  excluido_pelos_recortes: { receita: 1_719_770.02 },
  excluido_do_faturamento: { receita: 55_012.81 },
};

test("Faturamento do Financeiro: só agregados atravessam; nome de cliente fica no servidor", () => {
  const f = extrairFaturamento(faturamentoCru);
  assert.ok(!JSON.stringify(f).includes("Cliente Fictício"));
  assert.deepEqual(f.recortesExcluidos, ["negocios-estruturados", "finance"]);
  assert.equal(f.total, 17_900_000.1);
  assert.equal(f.serie.length, 3);
  assert.throws(() => extrairFaturamento({ serie: "x" }), /formato/);
});

test("Grupo: série do Faturamento, meses parciais da fonte, recortes fora declarados com valor", () => {
  const l = montarLeituraGrupo({ acesso: true, faturamento: extrairFaturamento(faturamentoCru) });
  assert.equal(l.id, "grupo");
  assert.equal(l.estado, "disponivel");
  assert.deepEqual(
    l.linhas.map((x) => [x.mes, x.valor]),
    [
      ["2026-01", 6_000_000.1],
      ["2026-02", 5_000_000],
      ["2026-08", 6_900_000],
    ],
  );
  assert.deepEqual(l.parciaisFonte, ["2026-08"]);
  assert.equal(l.notasPorMes["2026-02"], "AUSÊNCIAS DECLARADAS: empresa X em zero");
  assert.ok(l.cobertura.some((c) => /finance/.test(c) && /1\.719\.770,02/.test(c)));
  assert.ok(l.cobertura.some((c) => /55\.012,81/.test(c)));
  assert.ok(
    l.cobertura.some((c) => /12\/2025/.test(c)),
    "mês sem fechamento declarado",
  );
  assert.match(l.definicao, /receita bruta/i);
  assert.equal(l.destino.rota, "/financeiro");
});

test("Grupo: série que não fecha com o total da fonte vira parcial com aviso", () => {
  const f = extrairFaturamento({ ...faturamentoCru, totais: { receita_total_escopo: 1 } });
  const l = montarLeituraGrupo({ acesso: true, faturamento: f });
  assert.equal(l.estado, "parcial");
  assert.ok(l.cobertura.some((c) => /não fecha/.test(c)));
});

test("Grupo sem acesso ou com falha: nunca receita zero", () => {
  const sem = montarLeituraGrupo({
    acesso: false,
    motivo: "Sem acesso ao Financeiro.",
    faturamento: null,
  });
  assert.equal(sem.estado, "acesso_insuficiente");
  assert.equal(sem.linhas.length, 0);
  assert.match(sem.nota, /Sem acesso ao Financeiro/);
  const erro = montarLeituraGrupo({ acesso: true, erro: "tempo esgotado", faturamento: null });
  assert.equal(erro.estado, "fonte_indisponivel");
  assert.match(erro.nota, /tempo esgotado/);
});

test("Rede: apuração de royalties confirmada; unidade inaugurada e sem apuração torna o mês parcial", () => {
  const l = montarLeituraRede({
    acesso: true,
    unidades: [
      { id: 1, nome: "Unidade Um", tipo: "regional", inauguracao: "2025-01-01" },
      { id: 2, nome: "Unidade Dois", tipo: "regional", inauguracao: "2026-07-01" },
      { id: 3, nome: "Unidade Três", tipo: "regional", inauguracao: null },
      { id: 9, nome: "Unidade Interna", tipo: "interna", inauguracao: null },
    ],
    apuracoes: [
      {
        unidade_id: 1,
        mes: "2026-06-01",
        status: "confirmado",
        receita_base: 1000,
        receita_base_antiga: 200,
      },
      {
        unidade_id: 1,
        mes: "2026-07-01",
        status: "confirmado",
        receita_base: 1100,
        receita_base_antiga: null,
      },
      {
        unidade_id: 1,
        mes: "2026-08-01",
        status: "confirmado",
        receita_base: 1300,
        receita_base_antiga: 0,
      },
      {
        unidade_id: 2,
        mes: "2026-08-01",
        status: "confirmado",
        receita_base: 500,
        receita_base_antiga: 0,
      },
      {
        unidade_id: 3,
        mes: "2026-08-01",
        status: "confirmado",
        receita_base: 50,
        receita_base_antiga: 0,
      },
      {
        unidade_id: 2,
        mes: "2026-09-01",
        status: "rascunho",
        receita_base: 0,
        receita_base_antiga: 0,
      },
    ],
  });
  assert.equal(l.id, "rede");
  assert.equal(l.estado, "disponivel");
  assert.deepEqual(
    l.linhas.map((x) => [x.mes, x.chave, x.valor]),
    [
      ["2026-06", "Unidade Um", 1200],
      ["2026-07", "Unidade Um", 1100],
      ["2026-08", "Unidade Um", 1300],
      ["2026-08", "Unidade Dois", 500],
      ["2026-08", "Unidade Três", 50],
    ],
  );
  assert.deepEqual(
    l.parciaisFonte,
    ["2026-07"],
    "Unidade Dois inaugurou em julho e não tem julho apurado",
  );
  assert.match(l.notasPorMes["2026-07"], /Unidade Dois/);
  assert.ok(l.cobertura.some((c) => /sem data de inauguração/.test(c) && /1 unidade/.test(c)));
  assert.ok(l.cobertura.some((c) => /rascunho/.test(c)));
  assert.ok(!JSON.stringify(l).includes("Unidade Interna"));
  assert.match(l.definicao, /apuração/);
  assert.equal(l.destino.rota, "/royalties");
  assert.equal(
    montarLeituraRede({ acesso: false, unidades: [], apuracoes: [] }).estado,
    "acesso_insuficiente",
  );
  assert.equal(
    montarLeituraRede({ acesso: true, erro: "x", unidades: [], apuracoes: [] }).estado,
    "fonte_indisponivel",
  );
});

test("Mês marcado parcial pela fonte sai da janela de meses fechados", () => {
  const linhas = meses("2026-01", 8).map((mes) => ({ mes, chave: "G", valor: 6_000_000 }));
  const r = resumirLeitura(leitura(linhas, { parciaisFonte: ["2026-08"] }), HOJE);
  assert.equal(r.fechados.ate, "2026-07");
  assert.equal(r.fechados.meses, 7);
  assert.ok(r.serie.find((s) => s.mes === "2026-08").parcial);
  assert.ok(r.notas.some((n) => /08\/2026/.test(n) && /parcial pela fonte/.test(n)));
});
