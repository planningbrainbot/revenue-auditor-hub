import test from "node:test";
import assert from "node:assert/strict";
import { contractEvidence } from "../supabase/functions/base-clientes-sync/omie.mjs";
const contracts = [{ cabecalho: { nCodCtr: 1, nCodCli: 10, dVigInicial: "31/03/2025" } }];
const client = { codigo_cliente_omie: 10, cnpj_cpf: "11222333000181" };
test("usa vigência inicial; cadastro e pagamento não substituem o campo", () => {
  const result = contractEvidence("Planning CWB 01", contracts, [client], "2026-09-17");
  assert.equal(result.contracts[0].vigencia_inicial, "2025-03-31");
  assert.deepEqual(result.taxes, []);
});
test("espaços de IDs por aplicativo e presença explícita do Simples", () => {
  const one = contractEvidence(
    "Planning CWB 01",
    contracts,
    [{ ...client, optante_simples_nacional: "N" }],
    "2026-09-17",
  );
  const two = contractEvidence(
    "Planning CWB 02",
    contracts,
    [{ ...client, optante_simples_nacional: "S" }],
    "2026-09-17",
  );
  assert.notEqual(one.taxes[0].registro_fonte, two.taxes[0].registro_fonte);
  assert.equal(one.taxes[0].fora_simples, true);
  assert.equal(two.taxes[0].fora_simples, false);
  assert.throws(() => contractEvidence("Outro projeto", contracts, [client], "2026-09-17"));
  assert.throws(() => contractEvidence("Curitiba", contracts, [], "2026-09-17"));
});
test("data impossível e CPF não viram vigência ou CNPJ válido", () => {
  const result = contractEvidence(
    "Curitiba",
    [{ cabecalho: { ...contracts[0].cabecalho, dVigInicial: "31/02/2025" } }],
    [{ ...client, cnpj_cpf: "12345678901" }],
    "2026-09-17",
  );
  assert.equal(result.contracts[0].cnpj, null);
  assert.equal(result.contracts[0].vigencia_inicial, null);
});
