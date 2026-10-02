// handoff-consultoria-sync
//
// Espelha o que a tela Handoff Consultoria (`/monetizacao?aba=handoff-consultoria`) precisa:
//   - os cards do Onboarding Cliente da Expansão (Pipefy 307173656) com o CNPJ, que o card não tem
//     em campo: sai dos conectores (contrato, Data Base de empresas) e, na falta, do Pipedrive;
//   - a receita da PAT (a empresa que fatura a Consultoria) por CNPJ e mês, do Financial Brain.
// Grava em ops.handoff_consultoria_onboarding e ops.handoff_consultoria_pat (migration 20261002180000).
//
// Só lê fora do banco: nenhuma mutation no Pipefy, nenhuma escrita no Pipedrive.
// A edge function antiga `pipefy-contrato-onboarding-link` não é usada nem consertada: a automação
// nativa do Pipefy 308120505 já cria o card de onboarding a partir do contrato.
//
// Agendada por pg_cron a cada 30 minutos (job handoff-consultoria-sync-30min).
// Segredos: PIPEFY_TOKEN, PIPEDRIVE_TOKEN, FINANCEIRO_SUPABASE_URL, FINANCEIRO_SERVICE_ROLE_KEY,
// SINAIS_CRON_SECRET (todos já existem no projeto). Publicar com --no-verify-jwt.
import { sincronizar } from "./sync.mjs";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FIN_URL = (Deno.env.get("FINANCEIRO_SUPABASE_URL") ?? "").replace(/\/+$/, "");
const FIN_KEY = Deno.env.get("FINANCEIRO_SERVICE_ROLE_KEY") ?? "";
const PIPEFY = Deno.env.get("PIPEFY_TOKEN") ?? "";
const PIPEDRIVE = Deno.env.get("PIPEDRIVE_TOKEN") ?? "";
const CRON = Deno.env.get("SINAIS_CRON_SECRET");

/** PostgREST com o schema declarado: sem o perfil, o banco único lê `public` e devolve vazio sem erro. */
function postgrest(base: string, chave: string, schema: string) {
  return async (caminho: string, init: RequestInit = {}) => {
    const res = await fetch(`${base}/rest/v1/${caminho}`, {
      ...init,
      headers: {
        apikey: chave,
        Authorization: `Bearer ${chave}`,
        "Content-Type": "application/json",
        "Accept-Profile": schema,
        "Content-Profile": schema,
        ...(init.headers ?? {}),
      },
    });
    const corpo = await res.text();
    if (!res.ok)
      throw new Error(`PostgREST ${init.method ?? "GET"} ${caminho.split("?")[0]} → ${res.status}: ${corpo.slice(0, 300)}`);
    return corpo.trim() ? JSON.parse(corpo) : null;
  };
}

const io = {
  ops: postgrest(SUPA_URL, SUPA_KEY, "ops"),
  fin: postgrest(FIN_URL, FIN_KEY, "public"),
  async pipefy(query: string, variables: Record<string, unknown> = {}) {
    for (let tentativa = 0; ; tentativa++) {
      const res = await fetch("https://api.pipefy.com/graphql", {
        method: "POST",
        headers: { Authorization: `Bearer ${PIPEFY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if ((res.status === 429 || res.status >= 500) && tentativa < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
        continue;
      }
      if (!res.ok) throw new Error(`Pipefy HTTP ${res.status}`);
      return await res.json();
    }
  },
  async pipedrive(caminho: string) {
    for (let tentativa = 0; ; tentativa++) {
      const res = await fetch(`https://api.pipedrive.com/v1/${caminho}`, { headers: { "x-api-token": PIPEDRIVE } });
      if (res.status === 429 && tentativa < 3) {
        await new Promise((r) => setTimeout(r, 2000 * (tentativa + 1)));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Pipedrive ${caminho.split("?")[0]} HTTP ${res.status}`);
      return await res.json();
    }
  },
};

async function registrar(inicio: number, status: string, total: number, detalhes: Record<string, unknown>) {
  await io.ops("sync_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      fonte: "handoff_consultoria",
      executado_em: new Date(inicio).toISOString(),
      duracao_segundos: Math.round((Date.now() - inicio) / 1000),
      total_registros: total,
      detalhes,
      status,
    }]),
  });
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const porCron = !!CRON && req.headers.get("x-planning-sinais-cron") === CRON;
  if (!porCron && bearer !== SUPA_KEY)
    return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const trigger = typeof body?.trigger === "string" ? body.trigger.slice(0, 20) : porCron ? "cron" : "manual";
  const inicio = Date.now();
  try {
    if (!PIPEFY || !PIPEDRIVE) throw new Error("PIPEFY_TOKEN ou PIPEDRIVE_TOKEN ausente nos segredos da função.");
    if (!FIN_URL || !FIN_KEY) throw new Error("FINANCEIRO_SUPABASE_URL ou FINANCEIRO_SERVICE_ROLE_KEY ausente.");
    const { resumo } = await sincronizar(io, { agora: new Date(inicio).toISOString(), trigger });
    await registrar(inicio, resumo.status, resumo.cards ?? 0, resumo);
    return Response.json({ ok: true, ...resumo, duracao_segundos: Math.round((Date.now() - inicio) / 1000) });
  } catch (err) {
    console.error(err);
    await registrar(inicio, "erro", 0, { trigger, erro: String(err).slice(0, 500) }).catch(() => {});
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
