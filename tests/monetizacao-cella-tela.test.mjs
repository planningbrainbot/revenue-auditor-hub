// Aba Cella: contrato pelo vínculo do envio, teses e outros negócios do cliente, honorário de 20% do crédito, parte
// da Planning, recortes e lados divergentes.
import test from "node:test";
import assert from "node:assert/strict";
import { filtrarCella, montarCella, resumoCella } from "../src/lib/monetizacao/cella.ts";

const bruto = {
  sync: { rodado_em: "2026-10-22T18:00:00Z", status: "ok" },
  cards: [
    {
      id: 94348,
      pipe: 39,
      nome: "Matrocar",
      url: "u",
      status: "won",
      etapa: "8 · Proposta enviada",
      dono: "Matheus",
      unidade: "Goiânia",
    },
    {
      id: 98022,
      pipe: 39,
      nome: "Alves e Freitas",
      url: "u",
      status: "won",
      etapa: "8 · Proposta enviada",
      dono: "Matheus",
      unidade: "Maceió",
    },
    {
      id: 94757,
      pipe: 39,
      nome: "Impersik",
      url: "u",
      status: "open",
      etapa: "9 · Stand by",
      dono: "Matheus",
      unidade: null,
    },
    {
      id: 94315,
      pipe: 39,
      nome: "Coopdiesel",
      url: "u",
      status: "open",
      etapa: "8 · Proposta enviada",
      dono: "Matheus",
      unidade: null,
    },
  ],
  envios: [
    { deal_id: 94348, estado: "encerrado", cella_deal_id: 2121 },
    { deal_id: 98022, estado: "encerrado", cella_deal_id: 2224 },
    { deal_id: 94757, estado: "parado_deles", cella_deal_id: 2135 },
    { deal_id: 94315, estado: "ativo", cella_deal_id: 2138 },
  ],
  negocios: [
    {
      cella_deal_id: 2121,
      deal_id: 94348,
      principal: true,
      titulo: "Radar Tributário",
      status: "won",
      stage_id: 36,
      valor: "0",
      data_contrato: "2026-09-25",
    },
    {
      cella_deal_id: 2122,
      deal_id: 94348,
      principal: false,
      titulo: "LC224",
      status: "open",
      stage_id: 36,
      valor: "100000",
      data_contrato: null,
    },
    {
      cella_deal_id: 2224,
      deal_id: 98022,
      principal: true,
      titulo: "Radar Tributário",
      status: "won",
      stage_id: 36,
      valor: 0,
      data_contrato: "2026-10-05",
    },
    {
      cella_deal_id: 2135,
      deal_id: 94757,
      principal: true,
      titulo: "Radar Tributário",
      status: "lost",
      stage_id: 36,
      valor: 0,
      data_contrato: null,
    },
    {
      cella_deal_id: 2136,
      deal_id: 94757,
      principal: false,
      titulo: "Assessoria Mensal",
      status: "lost",
      stage_id: 36,
      valor: 6500,
      data_contrato: null,
    },
    {
      cella_deal_id: 2138,
      deal_id: 94315,
      principal: true,
      titulo: "Radar Tributário",
      status: "open",
      stage_id: 36,
      valor: 0,
      data_contrato: null,
    },
  ],
};

test("contrato, teses e honorário de 20% do crédito", () => {
  const linhas = montarCella(bruto, "2026-10-22");
  const matrocar = linhas.find((l) => l.deal_id === 94348);
  assert.equal(matrocar.assinadoEm, "2026-09-25");
  assert.equal(matrocar.diasDesdeAssinatura, 27);
  assert.equal(matrocar.credito, 100000);
  assert.equal(matrocar.honorario, 20000);
  assert.equal(matrocar.planning, 5000);
  assert.equal(matrocar.semValor, false);
  const alves = linhas.find((l) => l.deal_id === 98022);
  assert.equal(alves.semValor, true);
  // Assessoria Mensal não é tese: fica fora do crédito.
  const impersik = linhas.find((l) => l.deal_id === 94757);
  assert.equal(impersik.teses.length, 0);
  assert.equal(impersik.outros[0].titulo, "Assessoria Mensal");
  assert.equal(impersik.divergente, true);
});

test("resumo e recortes", () => {
  const linhas = montarCella(bruto, "2026-10-22");
  const r = resumoCella(linhas);
  assert.deepEqual(
    {
      a: r.assinados,
      s: r.semValor,
      c: r.credito,
      h: r.honorario,
      p: r.planning,
      ab: r.abertos,
      d: r.divergentes,
    },
    { a: 2, s: 1, c: 100000, h: 20000, p: 5000, ab: 1, d: 1 },
  );
  assert.deepEqual(
    filtrarCella(linhas, "contratos").map((l) => l.deal_id),
    [94348, 98022],
  );
  assert.deepEqual(
    filtrarCella(linhas, "sem-valor").map((l) => l.deal_id),
    [98022],
  );
  assert.deepEqual(
    filtrarCella(linhas, "abertos").map((l) => l.deal_id),
    [94315],
  );
  assert.deepEqual(
    filtrarCella(linhas, "divergentes").map((l) => l.deal_id),
    [94757],
  );
});

test("nome do card: título sem o sufixo do envio, org só quando é outra", async () => {
  const { nomeDoCard } = await import("../src/lib/monetizacao/cella.ts");
  assert.equal(
    nomeDoCard("Alves e Freitas Engenharia · CELLA [AQ:5671d676]", "Alves"),
    "Alves e Freitas Engenharia",
  );
  assert.equal(nomeDoCard("Rh Numbers (cópia) (cópia)", "RH Numbers Ltda"), "Rh Numbers");
  assert.equal(nomeDoCard(null, "Coopdiesel"), "Coopdiesel");
  const linhas = montarCella(
    {
      ...bruto,
      cards: [
        { ...bruto.cards[0], titulo: "TECH MED", nome: "REVENDEDOR PHILIPS" },
        {
          ...bruto.cards[1],
          titulo: "Alves e Freitas · CELLA",
          nome: "Alves e Freitas Engenharia",
        },
      ],
    },
    "2026-10-22",
  );
  assert.equal(linhas[0].nome, "TECH MED");
  assert.equal(linhas[0].org, "REVENDEDOR PHILIPS");
  assert.equal(linhas[1].org, null);
});
