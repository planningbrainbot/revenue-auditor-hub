// Calibração dos limiares do Jev na conversa (24/09/2026).
//
// Uso: node scripts/cockpit-ceo/conversa-jev-calibrar.ts
// Chave: Keychain (serviço em COCKPIT_IA_KEYCHAIN_SERVICO, padrão planning-openrouter-cockpit-2),
// lida no processo e nunca impressa. Ledger próprio e cumulativo (jev-calibracao.jsonl): no máximo
// 80 requisições e US$ 0,02 no total, sem renovar entre rodadas; pergunta já respondida no ledger é
// reaproveitada, não chamada de novo. Só o texto fictício do conjunto rotulado sai daqui.
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { criarLedgerArquivo, decidirJev } from "../../src/lib/cockpit-ceo/jev/adaptador.server.ts";
import { resumirOrcamento } from "../../src/lib/cockpit-ceo/jev/contrato.ts";
import { CASOS_CALIBRACAO } from "../../src/lib/cockpit-ceo/conversa/calibracao.ts";
import { decidirEncaminhamento, pedidoConversa } from "../../src/lib/cockpit-ceo/conversa/jev.ts";

const PASTA = new URL("../../docs/dev_notes/cockpit-ceo-conversa/", import.meta.url);
mkdirSync(fileURLToPath(PASTA), { recursive: true });
const ledger = criarLedgerArquivo(fileURLToPath(new URL("jev-calibracao.jsonl", PASTA)));
const LIMITES = { tentativas: 80, custoUsd: 0.02 };
const servico = process.env.COCKPIT_IA_KEYCHAIN_SERVICO ?? "planning-openrouter-cockpit-2";
const obterChave = () =>
  new Promise<string | null>((ok) =>
    execFile("/usr/bin/security", ["find-generic-password", "-s", servico, "-w"], (e, out) =>
      ok(e ? null : String(out).trim() || null),
    ),
  );

const anteriores = new Map(
  (await ledger.ler())
    .filter((r) => r.estado === "ok" && r.exemplo.startsWith("cal:"))
    .map((r) => [r.exemplo.slice(4), r]),
);
const linhas = [];
for (const c of CASOS_CALIBRACAO) {
  let respostas = anteriores.get(c.id)?.respostas;
  let latenciaMs = anteriores.get(c.id)?.latenciaMs ?? null;
  if (!respostas) {
    const r = await decidirJev(pedidoConversa(c.pergunta, c.contexto ?? ""), {
      obterChave,
      ledger,
      exemplo: "cal:" + c.id,
      limites: LIMITES,
      timeoutMs: 15_000,
    });
    if (r.estado !== "ok") {
      console.log(`${c.id}: ${r.estado} ${r.codigo}`);
      linhas.push({ caso: c, erro: r.codigo });
      continue;
    }
    respostas = r.respostas;
    latenciaMs = r.latenciaMs;
  }
  const dom = respostas.dominio as {
    choice: string;
    probabilities?: Record<string, number> | null;
    confidence?: number | null;
  };
  const amb = respostas.ambigua as { noul: number };
  const p = dom.probabilities?.[dom.choice] ?? dom.confidence ?? 0;
  linhas.push({ caso: c, escolha: dom.choice, p, noul: amb.noul, latenciaMs });
}

// Varredura de limiar: para cada limiar, quantas perguntas o Jev restringe (acima dele), quantas
// dessas estão certas, e quantas vão para o modelo com todas as ferramentas (abaixo dele).
const avaliadas = linhas.filter((l) => "escolha" in l) as {
  caso: (typeof CASOS_CALIBRACAO)[number];
  escolha: string;
  p: number;
  noul: number;
  latenciaMs: number | null;
}[];
const certa = (l: (typeof avaliadas)[number]) =>
  l.escolha === l.caso.dominio || (l.caso.aceitos ?? []).includes(l.escolha as never);
const varredura = [0.5, 0.6, 0.7, 0.8, 0.9].map((lim) => {
  const acima = avaliadas.filter((l) => l.p >= lim);
  return {
    limiar: lim,
    restringidas: acima.length,
    restringidasCertas: acima.filter(certa).length,
    restringidasErradas: acima.filter((l) => !certa(l)).map((l) => `${l.caso.id}→${l.escolha}`),
    paraOModeloSemDica: avaliadas.length - acima.length,
  };
});
const ambVarredura = [0.5, 0.6, 0.7, 0.8].map((lim) => {
  const pede = avaliadas.filter((l) => l.noul >= lim && !l.caso.contexto);
  return {
    limiar: lim,
    pedeEsclarecimento: pede.map((l) => l.caso.id),
    acertos: avaliadas.filter((l) => !l.caso.contexto && l.noul >= lim === l.caso.ambigua).length,
    total: avaliadas.filter((l) => !l.caso.contexto).length,
  };
});
const comLimiar = avaliadas.map((l) => ({
  id: l.caso.id,
  esperado: l.caso.dominio,
  escolha: l.escolha,
  p: Math.round(l.p * 100) / 100,
  ambigua: Math.round(l.noul * 100) / 100,
  certa: certa(l),
  encaminhamento: (({ modo, dominio, esclarecer, motivo }) => ({
    modo,
    dominio,
    esclarecer,
    motivo,
  }))(
    decidirEncaminhamento(
      {
        estado: "ok",
        respostas: {
          dominio: {
            type: "choice",
            choice: l.escolha,
            confidence: l.p,
            probabilities: { [l.escolha]: l.p },
          },
          ambigua: { type: "noul", noul: l.noul },
        },
      },
      !!l.caso.contexto,
    ),
  ),
}));
const orcamento = resumirOrcamento(await ledger.ler(), LIMITES);
const saida = {
  em: new Date().toISOString(),
  casos: CASOS_CALIBRACAO.length,
  respondidos: avaliadas.length,
  acertoDominio: avaliadas.filter(certa).length,
  varreduraDominio: varredura,
  varreduraAmbiguidade: ambVarredura,
  latenciaMedianaMs: [...avaliadas.map((l) => l.latenciaMs ?? 0)].sort((a, b) => a - b)[
    Math.floor(avaliadas.length / 2)
  ],
  orcamento,
  casosDetalhe: comLimiar,
};
writeFileSync(fileURLToPath(new URL("jev-calibracao.json", PASTA)), JSON.stringify(saida, null, 2));
console.log(JSON.stringify({ ...saida, casosDetalhe: undefined }, null, 2));
