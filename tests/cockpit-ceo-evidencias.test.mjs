import test from "node:test";
import assert from "node:assert/strict";
import { matrizDeEvidencias } from "../src/lib/cockpit-ceo/evidencias.ts";
import { montarCockpit } from "../src/lib/cockpit-ceo/indicadores.ts";
import { fonteSintetica } from "../src/lib/cockpit-ceo/fixture-sintetica.ts";
import { resolverPeriodo } from "../src/lib/cockpit-ceo/periodo.ts";
import { PERGUNTAS } from "../src/lib/cockpit-ceo/perguntas.ts";

const HOJE = "2026-09-22";
const cockpit = montarCockpit(fonteSintetica(HOJE, `${HOJE}T12:00:00.000Z`), {
  periodo: resolverPeriodo({ periodo: "mes" }, HOJE),
  perimetro: "",
});

test("Matriz de evidências: uma linha por pergunta, com cobertura, fonte, estado dos números e painéis", () => {
  const csv = matrizDeEvidencias(cockpit, "2026-09-22T12:00:00.000Z");
  const linhas = csv.trim().split("\r\n");
  assert.equal(linhas.length, PERGUNTAS.length + 1);
  assert.match(
    linhas[0],
    /^pergunta;frente;texto;origem;exigencia_mapa;pilar;apoios;roadmap;cobertura;estado_dado;implementacao;homologacao;adocao;decisao_pendente;resposta_atual;fonte;responsavel;papel_growth;papel_ops;pendencia;indicadores;paineis;dados;gerado_em$/,
  );
  const r1 = linhas.find((l) => l.startsWith("R1;"));
  assert.match(r1, /meta-bilhao=Não apurado/);
  assert.match(r1, /trajetória: grupo=Dado parcial/);
  assert.match(r1, /sintéticos/);
  const t1 = linhas.find((l) => l.startsWith("T1;"));
  assert.match(t1, /coortes=/);
  assert.doesNotMatch(csv, /\d{14}/, "nenhum CNPJ");
  assert.doesNotMatch(csv, /Cliente Sintético/, "nenhum nome de cliente");
  const r6 = linhas.find((l) => l.startsWith("R6;"));
  assert.match(r6, /ponte: \d+ meses, todos fecham/);
  assert.match(r6, /Desdobramento|desdobramento/);
});

test("Campo com ponto e vírgula, aspas ou quebra de linha sai entre aspas", () => {
  const csv = matrizDeEvidencias(
    { ...cockpit, indicadores: [], trajetoria: null, clientes: null, coortes: null, rede: null },
    "x",
  );
  for (const l of csv.trim().split("\r\n").slice(1)) {
    const aspas = (l.match(/"/g) ?? []).length;
    assert.equal(aspas % 2, 0, l);
  }
});
