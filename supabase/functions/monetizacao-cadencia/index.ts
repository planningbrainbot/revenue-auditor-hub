/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Cadência da pré-venda da Monetização (pipe 39 do Pipedrive). Pedido do Pedro em 09/10/2026.
//
// Quando um card sai de "1 · Base elegível" (274) e entra em "2 · Abordagem iniciada" (276), o Brain cria no card as
// 19 atividades da régua (regua.ts: e-mail, ligação, WhatsApp e a tarefa de descarte do D10), com dia útil e horário
// de São Paulo. Quando o card sai da 276 (avança, volta, perde, ganha, é apagado), a cadência é encerrada e só as
// atividades dela que ainda não foram feitas são apagadas. Card que entrou na 276 sem vir da 274 não recebe.
// Lógica em logica.ts (sem API do Deno, testada no Node: tests/monetizacao-cadencia.test.mjs); estado em
// ops.monetizacao_cadencia (migration 20261009120000_monetizacao_cadencia.sql).
//
// Roda pelo cron a cada 5 minutos (cabeçalho x-monetizacao-sync), com {"action":"rodar"}; {"dry": true} não escreve
// nada e responde o que faria.
//
// Como ligar:
// 1. publicar esta função ANTES da migration, sem JWT, como as outras do cron:
//    supabase functions deploy monetizacao-cadencia --no-verify-jwt
// 2. secret MONET_CADENCIA_INICIO com o instante ISO a partir do qual a entrada na 276 conta (card que já estava na
//    etapa antes disso não recebe). Sem ele, nada é criado.
// 3. secret MONET_CADENCIA_ATIVA=sim. Kill switch: qualquer outro valor deixa a função em dry-run (não escreve no
//    Pipedrive nem no banco).
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import {
  rodarCadencia,
  type LinhaCadencia,
  type PipedriveCadencia,
  type StoreCadencia,
} from "./logica.ts";
import { REGUA, VERSAO_REGUA } from "./regua.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ATIVA = Deno.env.get("MONET_CADENCIA_ATIVA") === "sim";
const INICIO = Deno.env.get("MONET_CADENCIA_INICIO") || null;
const TABELA = "monetizacao_cadencia";

const { pd, pages } = pipedriveApi(PD);

/** DELETE no Pipedrive v1. O `pd` comum só faz DELETE com corpo; aqui vai sem. O erro nunca leva a URL (token). */
async function apagar(path: string): Promise<void> {
  const res = await fetch(
    `https://api.pipedrive.com/v1/${path}?${new URLSearchParams({ api_token: PD })}`,
    { method: "DELETE", signal: AbortSignal.timeout(25000) },
  );
  if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (!body?.success) throw new Error("Pipedrive não confirmou a exclusão");
}

const pipedrive: PipedriveCadencia = {
  get: (path, params = {}) => pd(path, params),
  pages: (path, params = {}) => pages(path, params),
  post: (path, payload) => pd(path, {}, payload),
  del: apagar,
};

async function rest(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
): Promise<any> {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, {
    method: init.method || (init.body === undefined ? "GET" : "POST"),
    headers: {
      apikey: ADMIN,
      Authorization: `Bearer ${ADMIN}`,
      "Content-Type": "application/json",
      "Accept-Profile": "ops",
      "Content-Profile": "ops",
      Prefer: init.prefer || "return=representation",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`ops.${path.split("?")[0]}: ${json?.message || res.status}`);
  return json;
}

const store: StoreCadencia = {
  async linhasDosDeals(deals) {
    const linhas: LinhaCadencia[] = [];
    for (let i = 0; i < deals.length; i += 100) {
      const lote = deals.slice(i, i + 100).map(Number);
      linhas.push(...(await rest(`${TABELA}?deal_id=in.(${lote.join(",")})&select=*`)));
    }
    return linhas;
  },
  ativas: () => rest(`${TABELA}?status=eq.ativa&select=*&order=criado_em`),
  async inserir(linha) {
    const r = await rest(`${TABELA}?on_conflict=deal_id,entrou_em`, {
      body: linha,
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    return Array.isArray(r) && r.length > 0;
  },
  async atualizar(deal, entrouEm, patch) {
    await rest(
      `${TABELA}?deal_id=eq.${Number(deal)}&entrou_em=eq.${encodeURIComponent(entrouEm)}`,
      { method: "PATCH", body: patch, prefer: "return=minimal" },
    );
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método inválido" }, 405);
  if (!SEGREDO || req.headers.get("x-monetizacao-sync") !== SEGREDO)
    return json({ error: "Sem acesso" }, 401);
  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== "rodar") return json({ error: "Ação inválida" }, 400);
    const ativo = ATIVA && body.dry !== true;
    const resumo = await rodarCadencia({
      pd: pipedrive,
      store,
      agora: new Date(),
      inicio: INICIO,
      ativo,
      regua: REGUA,
      versao: VERSAO_REGUA,
    });
    return json({
      ...resumo,
      automacao: ATIVA ? "ligada" : "desligada (MONET_CADENCIA_ATIVA diferente de sim)",
    });
  } catch (e) {
    return json({ status: "erro", error: (e as Error).message }, 500);
  }
});
