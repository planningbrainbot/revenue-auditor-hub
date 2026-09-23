import test from "node:test";
import assert from "node:assert/strict";
import {
  fontesSemAcesso,
  faltasDasDefinicoes,
  motivoSemAcesso,
} from "../src/lib/cockpit-ceo/portas.ts";

const admin = { roles: ["admin"], permissions: ["view.clientes", "view.aquario"] };
const soBase = { roles: ["head"], permissions: ["view.aquario", "view.clientes"] };

test("Admin lê todas as fontes; chave da Base sozinha não abre contas a receber nem Pipefy", () => {
  assert.deepEqual(
    fontesSemAcesso(
      ["contas_receber", "contratos", "central_tratativas", "royalties_apuracao"],
      admin,
    ),
    [],
  );
  assert.deepEqual(fontesSemAcesso(["contas_receber", "contratos_documentos"], soBase), [
    "contas_receber",
    "contratos_documentos",
  ]);
  assert.deepEqual(fontesSemAcesso(["royalties_apuracao"], soBase), ["royalties_apuracao"]);
});

test("Cada definição de cliente ativo exige as próprias fontes", () => {
  const f = faltasDasDefinicoes(soBase);
  assert.deepEqual(f.contrato_omie, []);
  assert.deepEqual(f.recebeu_90d, ["contas_receber"]);
  assert.deepEqual(f.qb_ativos, []);
  assert.deepEqual(f.mrr_positivo, ["contratos_documentos"]);
  assert.match(motivoSemAcesso(f.mrr_positivo), /contratos do Pipefy/);
});

test("Paginação lê até a página curta e propaga erro, sem devolver leitura pela metade", async () => {
  const { todasAsPaginas, PAGINA } = await import("../src/lib/cockpit-ceo/paginar.ts");
  const total = PAGINA * 2 + 5;
  const pedidos = [];
  const linhas = await todasAsPaginas(async (de, ate) => {
    pedidos.push([de, ate]);
    return {
      data: Array.from(
        { length: Math.max(0, Math.min(ate, total - 1) - de + 1) },
        (_, i) => de + i,
      ),
      error: null,
    };
  });
  assert.equal(linhas.length, total);
  assert.deepEqual(pedidos[1], [PAGINA, PAGINA * 2 - 1]);
  await assert.rejects(
    todasAsPaginas(async () => ({ data: null, error: { code: "42501" } })),
    (e) => e.code === "42501",
  );
});
