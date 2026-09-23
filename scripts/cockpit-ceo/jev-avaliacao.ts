// Avaliação rotulada do Jev (lote 7): 40 perguntas fictícias, uma chamada cada, em sequência.
//
// Uso: node scripts/cockpit-ceo/jev-avaliacao.ts
// Chave: Keychain do macOS (serviço planning-openrouter-cockpit-piloto), lida no processo, nunca
// impressa. Ledger PRÓPRIO (jev-avaliacao.jsonl), com o teto autorizado pelo dono em 22/09: 50
// requisições e US$ 0,10 de custo informado, sem retry. Pergunta já respondida no ledger não é
// chamada de novo: a resposta registrada é reaproveitada.
// Grava docs/dev_notes/cockpit-ceo-piloto/jev-avaliacao-<data>.json com casos, respostas e métricas.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CASOS_AVALIACAO,
  LIMITES_AVALIACAO,
  baselinePalavras,
  medirAvaliacao,
} from "../../src/lib/cockpit-ceo/jev/avaliacao.ts";
import type { ResultadoCaso } from "../../src/lib/cockpit-ceo/jev/avaliacao.ts";
import {
  criarLedgerArquivo,
  decidirJev,
  obterChaveKeychain,
} from "../../src/lib/cockpit-ceo/jev/adaptador.server.ts";
import {
  JEV_ENDPOINT,
  pedidoRoteamento,
  pilotoJevAtivo,
  resumirOrcamento,
} from "../../src/lib/cockpit-ceo/jev/contrato.ts";
import { hoje as hojeSaoPaulo } from "../../src/lib/monetizacao/model.ts";

process.env.COCKPIT_JEV_PILOTO ??= "1";
if (!pilotoJevAtivo(process.env)) throw new Error("Jev fora do piloto autorizado.");

const caminho = fileURLToPath(
  new URL("../../docs/dev_notes/cockpit-ceo-piloto/jev-avaliacao.jsonl", import.meta.url),
);
const ledger = criarLedgerArquivo(caminho);
const anteriores = new Map(
  (await ledger.ler())
    .filter((r) => r.estado === "ok" && r.exemplo.startsWith("aval:"))
    .map((r) => [r.exemplo.slice(5), r]),
);

const resultados: ResultadoCaso[] = [];
let parar: string | null = null;
for (const caso of CASOS_AVALIACAO) {
  const baseline = baselinePalavras(caso.texto);
  const reg = anteriores.get(caso.id);
  if (reg?.respostas) {
    const f = reg.respostas.frente;
    const d = reg.respostas.pede_dado;
    resultados.push({
      id: caso.id,
      estado: "ok",
      escolha: f?.type === "choice" ? f.choice : "?",
      confianca: f?.type === "choice" ? f.confidence : null,
      pedeDado: d?.type === "noul" ? d.noul : null,
      latenciaMs: reg.latenciaMs ?? 0,
      custoUsd: reg.custoUsd ?? null,
      baseline,
    });
    continue;
  }
  if (parar) {
    resultados.push({ id: caso.id, estado: "bloqueado", codigo: parar, baseline });
    continue;
  }
  const r = await decidirJev(pedidoRoteamento(caso.texto), {
    obterChave: obterChaveKeychain,
    ledger,
    exemplo: "aval:" + caso.id,
    limites: LIMITES_AVALIACAO,
  });
  if (r.estado === "ok") {
    const f = r.respostas.frente;
    const d = r.respostas.pede_dado;
    resultados.push({
      id: caso.id,
      estado: "ok",
      escolha: f.type === "choice" ? f.choice : "?",
      confianca: f.type === "choice" ? f.confidence : null,
      pedeDado: d?.type === "noul" ? d.noul : null,
      latenciaMs: r.latenciaMs,
      custoUsd: r.custoUsd,
      baseline,
    });
    process.stdout.write(".");
  } else {
    resultados.push({
      id: caso.id,
      estado: r.estado === "bloqueado" ? "bloqueado" : "falha",
      codigo: r.codigo,
      baseline,
    });
    process.stdout.write("x");
    // Sem chave ou orçamento: nenhuma chamada a mais. Falha isolada não é repetida.
    if (r.estado === "bloqueado" || r.estado === "sem_chave" || r.estado === "desativado")
      parar = r.codigo;
  }
}
console.log();

const metricas = medirAvaliacao(CASOS_AVALIACAO, resultados);
const orcamento = resumirOrcamento(await ledger.ler(), LIMITES_AVALIACAO);
const quando = new Date().toISOString();
const pasta = fileURLToPath(new URL("../../docs/dev_notes/cockpit-ceo-piloto/", import.meta.url));
mkdirSync(pasta, { recursive: true });
// Data de São Paulo no nome, como os demais registros da homologação.
const arquivo = `${pasta}jev-avaliacao-${hojeSaoPaulo()}.json`;
writeFileSync(
  arquivo,
  JSON.stringify(
    {
      quando,
      endpoint: JEV_ENDPOINT,
      taxonomia: "cockpit-ceo-roteamento-v1",
      limites: LIMITES_AVALIACAO,
      orcamento,
      casos: CASOS_AVALIACAO.map((c) => ({
        ...c,
        resultado: resultados.find((r) => r.id === c.id),
      })),
      metricas,
    },
    null,
    2,
  ) + "\n",
);
console.log(JSON.stringify({ metricas, orcamento }, null, 2));
console.log("Registro:", arquivo.replace(process.cwd() + "/", ""));
