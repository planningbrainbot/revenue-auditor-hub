import test from "node:test";
import assert from "node:assert/strict";
import { conferirResposta, numerosDosResultados, resumoDaLeitura } from "../src/lib/cockpit-coo/perguntar.ts";

const RESULTADO = {
  tema: "Ter · Financeiro e Operações",
  numeros: [
    { id: "saldo", rotulo: "Saldo em caixa", valor: 1950000, unidade: "reais", estado: "disponivel", nota: "12 de 15 empresas" },
    { id: "folego", rotulo: "Fôlego", valor: 4.5, unidade: "meses", estado: "parcial" },
  ],
  okr: { progressoPct: 44.5, krs: { noRitmo: 3 } },
};

test("número com origem fica; número inventado derruba a frase inteira", () => {
  const r = conferirResposta(
    "O saldo em caixa é de R$ 1,95 mi, em 12 de 15 empresas. O fôlego é de 4,5 meses. A inadimplência é de 7%.",
    [RESULTADO],
    "Como está o caixa?",
  );
  assert.equal(r.texto, "O saldo em caixa é de R$ 1,95 mi, em 12 de 15 empresas. O fôlego é de 4,5 meses.");
  assert.deepEqual(r.descartadas, ["A inadimplência é de 7%."]);
});

test("percentual aceita a fração guardada (0,45 ↔ 45%) e anos não contam como número", () => {
  const r = conferirResposta("O progresso é de 44,5% em 2026.", [{ progresso: 0.445 }], "");
  assert.deepEqual(r.descartadas, []);
  const r2 = conferirResposta("Três KRs estão no ritmo: 3 de 10.", [RESULTADO], "");
  assert.deepEqual(r2.descartadas, ["Três KRs estão no ritmo: 3 de 10."], "10 não veio de lugar nenhum");
});

test("números dos textos dos resultados e da pergunta também têm origem", () => {
  assert.ok(numerosDosResultados([{ nota: "12 de 15 empresas" }]).includes(15));
  const r = conferirResposta("Nos últimos 30 dias não houve mudança.", [], "O que mudou nos últimos 30 dias?");
  assert.deepEqual(r.descartadas, []);
});

test("resumo da leitura leva estado e motivo, não a explicação longa", () => {
  const l = {
    tema: "cs-rh",
    universo: "15 unidades",
    numeros: [
      {
        id: "vagas",
        rotulo: "Vagas abertas",
        valor: null,
        unidade: "contas",
        estado: "nao_apurado",
        motivo: "PandaPé sem integração",
        cobertura: "todas",
        fonte: "PandaPé",
        dataDado: null,
        destino: null,
        explicacao: { oQueDiz: "longo", comoCalcula: "longo", dono: "Heloísa" },
      },
    ],
    alertas: [],
    graficos: [],
    fontes: [],
    avisos: [],
  };
  const r = resumoDaLeitura(l);
  assert.equal(r.numeros[0].motivo, "PandaPé sem integração");
  assert.equal(r.numeros[0].explicacao, undefined);
});
