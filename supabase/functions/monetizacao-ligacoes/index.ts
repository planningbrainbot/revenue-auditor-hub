/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Avaliação automática das ligações da pré-venda da Monetização (pipe 39). Pedido do Pedro em 09/10/2026.
//
// A cada 5 minutos (cron monetizacao-ligacoes-5min, cabeçalho x-monetizacao-sync, {"action":"rodar"}):
//   captura as ligações da Api4Com nos cards do pipe 39 → escolhe a mais longa de cada card (≥ 60 s, com mp3) →
//   transcreve UMA pela OpenRouter (modelo com áudio) → avalia UMA contra o script v2 → escreve as duas notas no card.
// Lógica em logica.ts e rubrica-ligacao.ts (sem API do Deno; testes em tests/monetizacao-ligacoes.test.mjs).
// Estado em ops.monetizacao_ligacoes e ops.monetizacao_ligacao_avaliacoes (migration 20261009150000).
// {"dry": true} não escreve em lugar nenhum e responde o que faria.
//
// Como ligar (nesta ordem):
// 1. publicar esta função ANTES da migration, sem JWT, como as outras do cron:
//    supabase functions deploy monetizacao-ligacoes --no-verify-jwt
// 2. aplicar a migration 20261009150000_monetizacao_pre_venda.sql (tabelas, RPCs da tela e o cron). Sem os secrets
//    abaixo, a rodada só captura (lê o Pipedrive e grava no nosso banco).
// 3. MONET_LIGACOES_ATIVA=sim liga transcrição e avaliação (custo na OpenRouter, OPENROUTER_API_KEY já existe).
// 4. MONET_LIGACOES_NOTAS=sim liga as notas no card do Pipedrive.
// Opcionais: MONET_LIGACOES_MODELO_TRANSCRICAO (padrão google/gemini-3.8-flash) e MONET_LIGACOES_MODELO_AVALIACAO
// (padrão anthropic/claude-sonnet-5.5).
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import {
  LIMITE_MP3_BYTES,
  criarIa,
  rodarLigacoes,
  type Ligacao,
  type LinhaAvaliacao,
  type PipedriveLigacoes,
  type StoreLigacoes,
} from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const OPENROUTER = Deno.env.get("OPENROUTER_API_KEY") || "";
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ATIVA = Deno.env.get("MONET_LIGACOES_ATIVA") === "sim";
const NOTAS = Deno.env.get("MONET_LIGACOES_NOTAS") === "sim";
const MODELO_TRANSCRICAO = Deno.env.get("MONET_LIGACOES_MODELO_TRANSCRICAO") || undefined;
const MODELO_AVALIACAO = Deno.env.get("MONET_LIGACOES_MODELO_AVALIACAO") || undefined;
const LIGACOES = "monetizacao_ligacoes";
const AVALIACOES = "monetizacao_ligacao_avaliacoes";
/** Colunas que a rodada lê da avaliação (sem a transcrição, que só a avaliação precisa). */
const COLUNAS_LINHA =
  "deal_id,activity_id,user_id,pessoa,empresa,inicio,duracao_seg,mp3_url,status,erro,avaliacao,nota,regua_versao," +
  "nota_qualificacao_id,nota_avaliacao_id,tentativas,custo_usd,modelos,notas_em,atualizado_em";

const { pd, pages } = pipedriveApi(PD);

const pipedrive: PipedriveLigacoes = {
  pages: (path, params = {}) => pages(path, params),
  post: (path, payload) => pd(path, {}, payload),
  put: (path, payload) => pd(path, {}, payload, "PUT"),
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

const lotes = <T>(xs: T[], n = 100): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const ids = (xs: number[]) => xs.map((x) => Number(x)).filter((x) => Number.isFinite(x));

const store: StoreLigacoes = {
  async dealsDoPipe() {
    const mapa = new Map<number, string | null>();
    for (let de = 0; ; de += 1000) {
      const lote: any[] = await rest(
        `monetizacao_deals?select=id,org:payload->>org,title:payload->>title&order=id&limit=1000&offset=${de}`,
      );
      for (const d of lote) mapa.set(Number(d.id), d.org || d.title || null);
      if (lote.length < 1000) return mapa;
    }
  },
  async ligacoesPorAtividade(lista) {
    const saida: Ligacao[] = [];
    for (const l of lotes(ids(lista)))
      saida.push(...(await rest(`${LIGACOES}?activity_id=in.(${l.join(",")})&select=*`)));
    return saida;
  },
  async gravarLigacoes(linhas) {
    const agora = new Date().toISOString();
    for (const l of lotes(linhas))
      await rest(`${LIGACOES}?on_conflict=activity_id`, {
        body: l.map((x) => ({ ...x, atualizado_em: agora })),
        prefer: "resolution=merge-duplicates,return=minimal",
      });
  },
  async ligacoesDosDeals(deals) {
    const saida: Ligacao[] = [];
    for (const l of lotes(ids(deals)))
      saida.push(...(await rest(`${LIGACOES}?deal_id=in.(${l.join(",")})&select=*`)));
    return saida;
  },
  async avaliacoesDosDeals(deals) {
    const saida: LinhaAvaliacao[] = [];
    for (const l of lotes(ids(deals)))
      saida.push(
        ...(await rest(`${AVALIACOES}?deal_id=in.(${l.join(",")})&select=${COLUNAS_LINHA}`)),
      );
    return saida;
  },
  async gravarAvaliacao(linha) {
    await rest(`${AVALIACOES}?on_conflict=deal_id`, {
      body: linha,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  },
  async atualizarAvaliacao(deal, patch, se = {}) {
    let filtro = `deal_id=eq.${Number(deal)}`;
    if (se.activity_id === null) filtro += "&activity_id=is.null";
    else if (se.activity_id !== undefined) filtro += `&activity_id=eq.${Number(se.activity_id)}`;
    if (se.status?.length) filtro += `&status=in.(${se.status.join(",")})`;
    const r = await rest(`${AVALIACOES}?${filtro}&select=deal_id`, {
      method: "PATCH",
      body: { atualizado_em: new Date().toISOString(), ...patch },
    });
    return Array.isArray(r) && r.length > 0;
  },
  async proximaParaTranscrever(travadaAntesDe) {
    const ou = encodeURIComponent(
      `(status.eq.pendente,and(status.eq.transcrevendo,atualizado_em.lt."${travadaAntesDe}"))`,
    );
    const r = await rest(
      `${AVALIACOES}?or=${ou}&order=atualizado_em.asc&limit=1&select=${COLUNAS_LINHA}`,
    );
    return r?.[0] ?? null;
  },
  async proximaParaAvaliar() {
    const r = await rest(
      `${AVALIACOES}?status=eq.transcrita&order=atualizado_em.asc&limit=1&select=${COLUNAS_LINHA},transcricao`,
    );
    return r?.[0] ?? null;
  },
  async paraNotas(limite) {
    return await rest(
      `${AVALIACOES}?status=eq.avaliada&notas_em=is.null&order=atualizado_em.asc&limit=${Number(limite)}&select=${COLUNAS_LINHA}`,
    );
  },
};

/** Baixa o mp3 público da Api4Com, com teto de tamanho. Erro HTTP sai como "áudio HTTP <status>". */
async function baixar(url: string, timeoutMs: number): Promise<Uint8Array> {
  const res = await fetch(url, {
    headers: { "User-Agent": "planning-monetizacao-ligacoes/1" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok || !res.body) throw new Error(`áudio HTTP ${res.status}`);
  const reader = res.body.getReader();
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    tamanho += value.byteLength;
    if (tamanho > LIMITE_MP3_BYTES) {
      await reader.cancel();
      throw Object.assign(new Error(`áudio acima de ${LIMITE_MP3_BYTES / 1048576} MB`), {
        definitivo: true,
      });
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(tamanho);
  let i = 0;
  for (const p of partes) {
    bytes.set(p, i);
    i += p.byteLength;
  }
  return bytes;
}

const ia = criarIa({
  fetcher: fetch,
  chave: OPENROUTER,
  modeloTranscricao: MODELO_TRANSCRICAO,
  modeloAvaliacao: MODELO_AVALIACAO,
});

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
    const resumo = await rodarLigacoes({
      pd: pipedrive,
      store,
      ia,
      baixar,
      agora: new Date(),
      ativa: ATIVA,
      notas: NOTAS,
      dry: body.dry === true,
    });
    return json(resumo);
  } catch (e) {
    return json({ status: "erro", error: (e as Error).message }, 500);
  }
});
