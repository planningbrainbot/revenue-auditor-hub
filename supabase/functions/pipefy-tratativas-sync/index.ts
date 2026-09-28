// pipefy-tratativas-sync
//
// Espelha o pipe [PTRS-CLI-02] Tratativas de Churn do Pipefy (307196408) em ops.central_tratativas:
// leitura completa de todos os cards (allCards), upsert por pipefy_card_id e remoção de card que
// saiu do pipe. Full-refresh e não webhook, porque o valor está na reconciliação completa.
//
// Histórico: a versão 14 estava publicada fora do git e era disparada pelo cron do Ops antigo
// (desligado na migração para o banco único, 24/08) e depois por um disparo externo que parou em
// 15/09 17:37 UTC. Esta versão (28/09/2026) entra no repositório e passa a ser agendada pelo
// pg_cron do banco único (job pipefy-tratativas-sync-15min, migration 20260928200000).
//
// O que mudou em relação à 14:
//   - grava a fase (fase_id), o estado do distrato (distrato_estado), o conector do cliente
//     (pipefy_cliente_ids) e quando o card entrou na fase; a Base de clientes lê isso;
//   - o id de fase de "Cliente Recuperado (Ganho)" estava errado (343394577) e virava "open";
//   - a empresa é resolvida só pelos ids dos cards (a leitura de todas as empresas passava do corte
//     de 1000 linhas do PostgREST e perdia empresa sem aviso);
//   - falha também vai para o sync_log (status 'erro'), e leitura vazia não apaga o espelho.
//
// Autenticação: cabeçalho x-planning-sinais-cron (segredo do Vault base_sinais_cron_secret =
// env SINAIS_CRON_SECRET) ou Bearer da service role. Publicar com --no-verify-jwt.
import "../_shared/perfil.ts";
import { cardsQueSairam, linhaDoCard, PIPE_ID, resolverEmpresa } from "./domain.mjs";

const PIPEFY_TOKEN = Deno.env.get("PIPEFY_TOKEN")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");

type Linha = ReturnType<typeof linhaDoCard>;

async function pipefy(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${PIPEFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (!res.ok || data.errors) throw new Error(`Pipefy: ${JSON.stringify(data.errors ?? res.status).slice(0, 400)}`);
  return data.data;
}

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}: ${body.slice(0, 300)}`);
  return body.trim() ? JSON.parse(body) : null;
}

const CARDS = `
query($pipeId: ID!, $after: String) {
  allCards(pipeId: $pipeId, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id title created_at updated_at
      current_phase { id name }
      phases_history { phase { id } firstTimeIn }
      fields { field { id } value array_value }
    } }
  }
}`;

async function lerCards() {
  const cards = [];
  let after: string | null = null;
  for (let pagina = 0; pagina < 200; pagina++) {
    const data = await pipefy(CARDS, { pipeId: PIPE_ID, after });
    cards.push(...data.allCards.edges.map((e: { node: unknown }) => e.node));
    if (!data.allCards.pageInfo.hasNextPage) return cards;
    after = data.allCards.pageInfo.endCursor;
  }
  throw new Error("Pipefy: mais de 200 páginas de cards; leitura interrompida sem gravar.");
}

const lista = (xs: (string | number)[]) => `(${xs.map((x) => `"${String(x).replace(/"/g, "")}"`).join(",")})`;

async function empresasDosCards(linhas: Linha[]) {
  const pipefyIds = [...new Set(linhas.flatMap((l) => l.pipefy_cliente_ids))];
  const deals = [...new Set(linhas.map((l) => l.pipedrive_deal_id).filter((d) => d !== null))];
  const filtros = [
    pipefyIds.length ? `pipefy_record_id.in.${lista(pipefyIds)}` : null,
    deals.length ? `pipedrive_id.in.${lista(deals as number[])}` : null,
  ].filter(Boolean);
  if (!filtros.length) return [];
  return await rest(
    `empresas?select=id,pipefy_record_id,pipedrive_id,created_at&or=(${filtros.join(",")})`,
  );
}

async function registrar(inicio: number, status: "sucesso" | "erro", total: number, detalhes: Record<string, unknown>) {
  await rest("sync_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      fonte: "pipefy_tratativas",
      executado_em: new Date(inicio).toISOString(),
      duracao_segundos: Math.round((Date.now() - inicio) / 1000),
      total_registros: total,
      detalhes: { pipe_id: PIPE_ID, ...detalhes },
      status,
    }]),
  });
}

async function sincronizar(trigger: string) {
  const inicio = Date.now();
  const agora = new Date(inicio).toISOString();
  const cards = await lerCards();
  const linhas = cards.map((c) => linhaDoCard(c, agora));
  const empresas = await empresasDosCards(linhas);
  let resolvidas = 0;
  for (const l of linhas) {
    l.empresa_id = resolverEmpresa(l, empresas);
    if (l.empresa_id !== null) resolvidas++;
  }
  if (linhas.length)
    await rest("central_tratativas?on_conflict=pipefy_card_id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linhas),
    });
  const existentes = ((await rest("central_tratativas?select=pipefy_card_id")) ?? []).map(
    (e: { pipefy_card_id: string }) => e.pipefy_card_id,
  );
  const { sairam, recusado } = cardsQueSairam(linhas.map((l) => l.pipefy_card_id), existentes);
  if (sairam.length)
    await rest(`central_tratativas?pipefy_card_id=in.${lista(sairam)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
  const porEstado: Record<string, number> = {};
  for (const l of linhas) porEstado[l.distrato_estado] = (porEstado[l.distrato_estado] ?? 0) + 1;
  const resumo = {
    trigger,
    cards: linhas.length,
    por_estado: porEstado,
    removidos: sairam.length,
    remocao_recusada: recusado,
    empresa_id_resolvidos: resolvidas,
  };
  await registrar(inicio, "sucesso", linhas.length, resumo);
  return { ok: true, ...resumo, duracao_segundos: Math.round((Date.now() - inicio) / 1000) };
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const porCron = !!CRON && req.headers.get("x-planning-sinais-cron") === CRON;
  if (!porCron && bearer !== SUPA_KEY)
    return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401 });
  let trigger = porCron ? "cron" : "manual";
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.trigger === "string") trigger = body.trigger.slice(0, 20);
  } catch { /* corpo opcional */ }
  const inicio = Date.now();
  try {
    return Response.json(await sincronizar(trigger));
  } catch (err) {
    console.error(err);
    await registrar(inicio, "erro", 0, { trigger, erro: String(err).slice(0, 500) }).catch(() => {});
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
