// Ensaio da handoff-consultoria-sync contra as fontes REAIS, sem gravar nada.
//
// Roda o mesmo `sincronizar` da Edge Function (supabase/functions/handoff-consultoria-sync/sync.mjs)
// com `gravar: false` e uma camada de rede que recusa escrita: o PostgREST do banco único e o do
// Financial Brain só aceitam GET (o RPC de faturamento é a única exceção, e é leitura); o Pipefy
// recusa mutation; o Pipedrive só recebe GET. As chaves de serviço vêm da Management API na hora e
// ficam só em memória.
//
//   SUPABASE_ACCESS_TOKEN=… PIPEFY_TOKEN=… PIPEDRIVE_TOKEN=… \
//     node scripts/monetizacao/handoff-consultoria-ensaio.mjs <saida.json>
//
// A saída tem nome de empresa e CNPJ: grave fora do repositório.
import { writeFileSync } from "node:fs";
import { sincronizar } from "../../supabase/functions/handoff-consultoria-sync/sync.mjs";

const BRAIN = "npknehhyyzelmrbbxvtu";
const FIN = "itpddzjfrgrbathcqbpo";
const { SUPABASE_ACCESS_TOKEN: PAT, PIPEFY_TOKEN, PIPEDRIVE_TOKEN } = process.env;
const saida = process.argv[2];
if (!PAT || !PIPEFY_TOKEN || !PIPEDRIVE_TOKEN || !saida) {
  console.error(
    "uso: SUPABASE_ACCESS_TOKEN=… PIPEFY_TOKEN=… PIPEDRIVE_TOKEN=… node handoff-consultoria-ensaio.mjs <saida.json>",
  );
  process.exit(2);
}
const UA = { "User-Agent": "planning-handoff-consultoria-ensaio/1.0" };

async function chaveDeServico(ref) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}`, ...UA },
  });
  if (!r.ok) throw new Error(`api-keys ${ref}: HTTP ${r.status}`);
  const k = (await r.json()).find((x) => x.name === "service_role");
  if (!k?.api_key) throw new Error(`sem service_role em ${ref}`);
  return k.api_key;
}

function soLeitura(ref, chave, schema, liberados = []) {
  return async (caminho, init = {}) => {
    const metodo = (init.method ?? "GET").toUpperCase();
    if (metodo !== "GET" && !liberados.some((p) => caminho.startsWith(p)))
      throw new Error(`ensaio recusou ${metodo} ${caminho.split("?")[0]}`);
    const res = await fetch(`https://${ref}.supabase.co/rest/v1/${caminho}`, {
      ...init,
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "Accept-Profile": schema,
        "Content-Profile": schema,
        ...UA,
      },
    });
    const corpo = await res.text();
    if (!res.ok)
      throw new Error(
        `${ref} ${metodo} ${caminho.split("?")[0]} → ${res.status}: ${corpo.slice(0, 300)}`,
      );
    return corpo.trim() ? JSON.parse(corpo) : null;
  };
}

const [kBrain, kFin] = await Promise.all([chaveDeServico(BRAIN), chaveDeServico(FIN)]);
let chamadas = { pipefy: 0, pipedrive: 0 };
const opsLeitura = soLeitura(BRAIN, kBrain, "ops");
const io = {
  // Antes da migration as tabelas do handoff não existem: o ensaio age como a primeira rodada.
  ops: (caminho, init) =>
    caminho.startsWith("handoff_consultoria_") && !process.env.ENSAIO_TABELAS_EXISTEM
      ? Promise.resolve([])
      : opsLeitura(caminho, init),
  // O RPC de faturamento é POST no PostgREST, mas é leitura (função STABLE do Financeiro).
  fin: soLeitura(FIN, kFin, "public", ["rpc/fn_faturamento_mensal"]),
  async pipefy(query, variables = {}) {
    if (/^\s*mutation/i.test(query)) throw new Error("ensaio recusou mutation no Pipefy");
    chamadas.pipefy++;
    const r = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PIPEFY_TOKEN}`,
        "Content-Type": "application/json",
        ...UA,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!r.ok) throw new Error(`Pipefy HTTP ${r.status}`);
    return r.json();
  },
  async pipedrive(caminho) {
    chamadas.pipedrive++;
    const r = await fetch(`https://api.pipedrive.com/v1/${caminho}`, {
      headers: { "x-api-token": PIPEDRIVE_TOKEN, ...UA },
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Pipedrive ${caminho.split("?")[0]} HTTP ${r.status}`);
    return r.json();
  },
};

const t0 = Date.now();
const r = await sincronizar(io, { gravar: false, trigger: "ensaio" });
writeFileSync(saida, JSON.stringify(r, null, 1));
console.log(
  JSON.stringify(
    { ...r.resumo, chamadas, segundos: Math.round((Date.now() - t0) / 1000) },
    null,
    1,
  ),
);
