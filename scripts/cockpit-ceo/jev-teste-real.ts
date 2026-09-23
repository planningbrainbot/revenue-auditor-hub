// Teste real do Jev (piloto do Cockpit do CEO): UMA requisição com o e-mail fictício da missão.
//
// Uso: node scripts/cockpit-ceo/jev-teste-real.ts
// Chave: Keychain do macOS (serviço planning-openrouter-cockpit-piloto), lida no processo, nunca
// impressa. O orçamento é o mesmo ledger do preview: 10 requisições, US$ 0,10, sem retry.
// Grava docs/dev_notes/cockpit-ceo-piloto/jev-live-<data>.json com a resposta, sem a chave.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  EMAIL_FICTICIO,
  JEV_ENDPOINT,
  payloadTesteEmail,
} from "../../src/lib/cockpit-ceo/jev/contrato.ts";
import { caminhoLedger, testeEmailPiloto } from "../../src/lib/cockpit-ceo/jev/piloto.server.ts";

process.env.COCKPIT_JEV_PILOTO ??= "1";

const quando = new Date();
const resultado = await testeEmailPiloto();
const pasta = join(process.cwd(), "docs/dev_notes/cockpit-ceo-piloto");
mkdirSync(pasta, { recursive: true });
const arquivo = join(
  pasta,
  `jev-live-${quando
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z")}.json`,
);
writeFileSync(
  arquivo,
  JSON.stringify(
    {
      quando: quando.toISOString(),
      endpoint: JEV_ENDPOINT,
      textoFicticio: EMAIL_FICTICIO,
      perguntas: payloadTesteEmail().questions,
      resultado,
      ledger: caminhoLedger().replace(process.cwd() + "/", ""),
    },
    null,
    2,
  ) + "\n",
);

console.log(
  "Resultado:",
  resultado.estado,
  "estado" in resultado && resultado.estado !== "ok"
    ? `(${resultado.codigo}: ${resultado.mensagem})`
    : "",
);
if (resultado.estado === "ok") {
  console.log("Modelo retornado:", resultado.modeloRetornado, "| provedor:", resultado.provedor);
  console.log("Duração medida:", resultado.latenciaMs, "ms");
  console.log(
    "Custo informado:",
    resultado.custoUsd === null ? "NÃO informado pelo fornecedor" : `US$ ${resultado.custoUsd}`,
  );
  console.log("Tokens:", resultado.tokens);
  console.log("Respostas:", JSON.stringify(resultado.respostas, null, 2));
}
console.log("Orçamento:", JSON.stringify(resultado.orcamento ?? null));
console.log("Registro:", arquivo.replace(process.cwd() + "/", ""));
