// Revisão visual do Cockpit do CEO (28/09/2026): os modelos dos gráficos calculam o que dizem,
// ausência nunca vira zero, e todo gráfico tem explicação completa para a gaveta.
import test from "node:test";
import assert from "node:assert/strict";
import { montarCockpit } from "../src/lib/cockpit-ceo/indicadores.ts";
import { fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";
import { resolverPeriodo } from "../src/lib/cockpit-ceo/periodo.ts";
import { MEDIA_MENSAL_NECESSARIA } from "../src/lib/cockpit-ceo/receita.ts";
import {
  agregarFranqueadora,
  agregarOmie,
  agregarTratativas,
  mesesFechados,
  modeloChurn,
  modeloComposicao,
  modeloEntrega,
  modeloFranqueadora,
  modeloPonte,
  modeloRedeMrr,
  modeloTrajetoria,
  taxasDaPonte,
} from "../src/lib/cockpit-ceo/visual.ts";
import { IDS_VISAO, contextoParaConversa, explicar } from "../src/lib/cockpit-ceo/explicacoes.ts";
import { ORDEM_FRENTES } from "../src/lib/cockpit-ceo/contrato.ts";
import { PERGUNTAS } from "../src/lib/cockpit-ceo/perguntas.ts";

const HOJE = "2026-09-28";
const AGORA = `${HOJE}T12:00:00.000Z`;
const cockpitDe = (fonte) =>
  montarCockpit(fonte, { periodo: resolverPeriodo({}, HOJE), perimetro: "" });
const sintetico = () => cockpitDe(fonteSintetica(HOJE, AGORA));
const cent = (v) => Math.round(v * 100);

test("trajetória: degraus = média × ritmo^n, ritmo leva a média à meta em 2030", () => {
  const t = modeloTrajetoria(sintetico());
  assert.equal(t.ano, 2026);
  const fechados = t.pontos.filter((p) => !p.parcial);
  const media = fechados.reduce((s, p) => s + p.valor, 0) / fechados.length;
  assert.equal(cent(t.media), cent(media));
  assert.ok(Math.abs(t.ritmo - Math.pow(MEDIA_MENSAL_NECESSARIA / media, 1 / 4)) < 1e-12);
  assert.deepEqual(
    t.degraus.map((d) => d.ano),
    [2026, 2027, 2028, 2029, 2030],
  );
  for (const [n, d] of t.degraus.entries())
    assert.ok(Math.abs(d.media - media * Math.pow(t.ritmo, n)) < 1, `degrau ${d.ano}`);
  assert.equal(t.degraus.at(-1).media, MEDIA_MENSAL_NECESSARIA);
  assert.equal(cent(t.distancia * t.media), cent(MEDIA_MENSAL_NECESSARIA));
  // O mês em curso entra na linha como parcial e fica fora da média.
  assert.equal(t.pontos.at(-1).mes, "2026-09");
  assert.equal(t.pontos.at(-1).parcial, true);
});

test("ponte: a cascata sai do nível anterior e chega ao atual ao centavo", () => {
  const p = modeloPonte(sintetico());
  assert.equal(p.degraus[0].tipo, "nivel");
  assert.equal(p.degraus.at(-1).tipo, "nivel");
  const movimentos = p.degraus.filter((d) => d.tipo !== "nivel");
  const soma = movimentos.reduce((s, d) => s + cent(d.valor), cent(p.anterior));
  assert.equal(soma, cent(p.atual));
  assert.equal(cent(movimentos.at(-1).ate), cent(p.atual));
  assert.ok(p.piso < Math.min(...p.degraus.flatMap((d) => [d.de, d.ate])));
});

test("ponte que não fecha não é desenhada", () => {
  const c = sintetico();
  c.empresa.ponte.ultimo = { ...c.empresa.ponte.ultimo, fecha: false };
  assert.equal(modeloPonte(c).estado, "parcial");
});

test("composição soma o total e separa recorrente, não recorrente e sem marcação", () => {
  const m = modeloComposicao(sintetico().visual);
  assert.equal(cent(m.recorrente + m.naoRecorrente + m.semClassificacao), cent(m.total));
  assert.ok(m.semClassificacao > 0);
  assert.equal(cent(m.itens.reduce((s, i) => s + i.participacao, 0) * 100), 10000);
});

test("churn: cinco fórmulas lado a lado, média entre o menor e o maior mês", () => {
  const fs = modeloChurn(sintetico(), sintetico().visual);
  assert.deepEqual(
    fs.map((f) => f.id),
    ["omie-contratos", "omie-valor", "tratativas", "saida-faturamento", "saida-honorarios"],
  );
  for (const f of fs) {
    assert.ok(f.media !== null, f.id);
    assert.ok(f.min.taxa <= f.media && f.media <= f.max.taxa, f.id);
  }
});

test("churn sem base não vira 0%: a taxa fica nula e a fórmula sem número diz o motivo", () => {
  const meses = agregarTratativas([], [], HOJE);
  assert.ok(meses.every((m) => m.taxa === null));
  const c = sintetico();
  const semOmie = {
    ...c.visual,
    omie: { estado: "acesso_insuficiente", motivo: "sua conta não lê contratos do Omie" },
  };
  const f = modeloChurn(c, semOmie).find((x) => x.id === "omie-contratos");
  assert.equal(f.media, null);
  assert.equal(f.estado, "acesso_insuficiente");
  assert.match(f.motivo, /Omie/);
});

test("Omie: ativo é situação 10 com valor; encerramento conta no mês da vigência final", () => {
  const r = agregarOmie(
    [
      {
        unidade: "A",
        situacao: "10",
        valorMensal: 100,
        vigenciaInicial: "2025-01-01",
        vigenciaFinal: null,
      },
      {
        unidade: "A",
        situacao: "10",
        valorMensal: 0,
        vigenciaInicial: "2025-01-01",
        vigenciaFinal: null,
      },
      {
        unidade: "B",
        situacao: "90",
        valorMensal: 50,
        vigenciaInicial: "2025-01-01",
        vigenciaFinal: null,
      },
      {
        unidade: "B",
        situacao: "99",
        valorMensal: 30,
        vigenciaInicial: "2025-01-01",
        vigenciaFinal: "2026-08-20",
      },
    ],
    HOJE,
  );
  assert.deepEqual(r.unidades, [{ unidade: "A", mrr: 100, contratos: 1 }]);
  const ago = r.porContrato.find((m) => m.mes === "2026-08");
  assert.equal(ago.saidas, 1);
  assert.equal(ago.base, 4);
  const set = r.porContrato.find((m) => m.mes === "2026-07");
  assert.equal(set.saidas, 0);
  assert.equal(r.porValor.find((m) => m.mes === "2026-08").saidas, 30);
});

test("saída de faturamento pela ponte: base = quem faturou no mês anterior", () => {
  const [m] = taxasDaPonte([
    {
      mes: "2026-08",
      expansao: { clientes: 3 },
      contracao: { clientes: 2 },
      estaveis: 4,
      semFaturamento: { clientes: 1 },
    },
  ]);
  assert.equal(m.base, 10);
  assert.equal(m.taxa, 0.1);
});

test("franqueadora: mês sem título fica sem número; cancelado não conta", () => {
  const meses = agregarFranqueadora([
    { vencimento: "2026-08-10", status: "RECEBIDO", valor: 100 },
    { vencimento: "2026-08-12", status: "ATRASADO", valor: 40 },
    { vencimento: "2026-08-12", status: "CANCELADO", valor: 999 },
    { vencimento: "2026-09-02", status: "recebido", valor: 10 },
  ]);
  assert.deepEqual(meses[0], {
    mes: "2026-08",
    faturado: 140,
    recebido: 100,
    emAberto: 40,
    titulos: 2,
  });
  const c = sintetico();
  const m = modeloFranqueadora(
    { ...c.visual, franqueadora: { estado: "ok", meses, ultimaCarga: null } },
    HOJE,
  );
  assert.equal(m.meses.length, 12);
  const vazio = m.meses.find((x) => x.mes === "2026-05");
  assert.equal(vazio.semTitulo, true);
  assert.equal("faturado" in vazio, false);
  assert.equal(m.meses.at(-1).parcial, true);
});

test("rede: participação da maior unidade e total ao centavo", () => {
  const r = modeloRedeMrr(sintetico().visual);
  assert.equal(cent(r.unidades.reduce((s, u) => s + u.mrr, 0)), cent(r.total));
  assert.equal(r.maior.unidade, r.unidades[0].unidade);
  assert.ok(r.unidades.every((u, i) => i === 0 || u.mrr <= r.unidades[i - 1].mrr));
});

test("entrega: gargalo é a fase com mais clientes há mais de 30 dias", () => {
  const e = modeloEntrega(sintetico());
  const max = Math.max(...e.fases.map((f) => f.acima30));
  assert.equal(e.fases.find((f) => f.fase === e.gargalo).acima30, max);
  assert.ok(!e.fases.some((f) => f.fase === "Concluído"));
});

test("fonte fora vira estado com motivo em todo gráfico novo, nunca zero", () => {
  const f = fonteSintetica(HOJE, AGORA);
  const c = cockpitDe({ ...f, visual: { estado: "erro", erro: "falhou", resposta: null } });
  assert.equal(c.visual, null);
  assert.equal(c.visualAviso, "falhou");
  for (const m of [
    modeloComposicao(c.visual),
    modeloRedeMrr(c.visual),
    modeloFranqueadora(c.visual, HOJE),
  ]) {
    assert.ok(m.estado && m.motivo, JSON.stringify(m));
    assert.equal("total" in m, false);
  }
});

const CAMPOS = ["oQueDiz", "comoSeCalcula", "fonte", "periodo", "dono"];

test("toda gaveta tem o que diz, cálculo, fonte, período e dono", () => {
  const c = sintetico();
  const ids = [
    ...IDS_VISAO,
    ...ORDEM_FRENTES.map((f) => `frente-${f}`),
    ...PERGUNTAS.slice(0, 5).map((p) => `pergunta-${p.id}`),
    ...c.indicadores.map((i) => `indicador-${i.id}`),
    "painel-caixa",
    "painel-onboarding",
  ];
  for (const id of ids) {
    const e = explicar(c, id, AGORA);
    assert.ok(e, id);
    for (const k of CAMPOS) assert.ok(e[k] && String(e[k]).length > 1, `${id}.${k}`);
    assert.ok(Array.isArray(e.atencao), id);
  }
  assert.equal(explicar(c, "inexistente"), null);
});

test("todo gráfico da Visão executiva tem número e dados desenhados", () => {
  const c = sintetico();
  for (const id of IDS_VISAO) {
    const e = explicar(c, id, AGORA);
    assert.ok(e.valor, `${id} sem número`);
    assert.ok(e.dados.length > 0, `${id} sem dados`);
  }
});

test("a conversa recebe o gráfico com título, período e os números desenhados", () => {
  const e = explicar(sintetico(), "trajetoria", AGORA);
  const t = contextoParaConversa(e);
  assert.match(t, /Trajetória rumo ao bilhão/);
  assert.match(t, /Degrau 2030/);
  assert.match(t, /D0 pendente/);
});

test("meses fechados terminam no mês anterior ao de hoje", () => {
  const m = mesesFechados(HOJE);
  assert.equal(m.length, 12);
  assert.equal(m.at(-1), "2026-08");
  assert.equal(m[0], "2025-09");
});

test("os números do contexto do gráfico são lidos como números mostrados na conversa", async () => {
  const { lerNumeros } = await import("../src/lib/cockpit-ceo/conversa/conferir.ts");
  const e = explicar(sintetico(), "rede-mrr", AGORA);
  const lidos = lerNumeros(contextoParaConversa(e)).map((n) => n.valor);
  assert.ok(lidos.length >= e.dados.length);
});
