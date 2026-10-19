/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Próximo passo sugerido pelo Jev para os cards parados da reta final do pipe 39 (14/10/2026). Lógica em logica.ts;
// estado em ops.monetizacao_proximo_passo (migration 20261014190000_monetizacao_proximo_passo.sql). A tela Pré-venda ›
// Hoje mostra a sugestão ao lado de cada card sem próximo passo. Nada é escrito no Pipedrive.
//
// Roda pelo cron de hora em hora nos dias úteis (cabeçalho x-monetizacao-sync), com {"action":"rodar"}; {"dry": true}
// monta os pedidos sem chamar o Jev nem gravar.
//
// Como ligar:
// 1. supabase functions deploy monetizacao-proximo-passo --no-verify-jwt
// 2. secret MONET_PROXIMO_PASSO_ATIVA=sim (kill switch: qualquer outro valor deixa em dry-run).
// Usa OPENROUTER_API_KEY, PIPEDRIVE_TOKEN e MONETIZACAO_SYNC_SECRET, que as outras funções da Monetização já usam.
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import { JEV_ENDPOINT, rodarProximoPasso, type Etapa } from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const OPENROUTER = Deno.env.get("OPENROUTER_API_KEY") || "";
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ATIVA = Deno.env.get("MONET_PROXIMO_PASSO_ATIVA") === "sim";
const TABELA = "monetizacao_proximo_passo";

const { pages } = pipedriveApi(PD);

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

async function jev(pedido: unknown): Promise<any> {
  if (!OPENROUTER) throw new Error("OPENROUTER_API_KEY ausente");
  const res = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENROUTER}`, "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}: ${text.slice(0, 160)}`);
  return JSON.parse(text);
}

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
    const resumo = await rodarProximoPasso({
      cards: async () =>
        (await rest("monetizacao_deals?select=payload&limit=2000")).map((r: any) => r.payload),
      etapas: async () => {
        const [sync] = await rest("monetizacao_sync?select=stages&id=eq.true");
        return (sync?.stages ?? []).map((s: any) => ({
          id: Number(s.id),
          name: String(s.name),
          order: Number(s.order),
        })) as Etapa[];
      },
      anteriores: async () =>
        new Map(
          (await rest(`${TABELA}?select=deal_id,base,gerado_em,versao`)).map((r: any) => [
            Number(r.deal_id),
            r,
          ]),
        ),
      // Notas do card, sem ordenação no servidor (o v1/notes recusa sort com filtro): a lógica ordena.
      notas: (deal) => pages("notes", { deal_id: deal, limit: 50 }),
      jev,
      // Previsão de fechamento pelo Jev para os cards do Forecast sem data esperada (15/10/2026).
      anterioresPrevisao: async () =>
        new Map(
          (await rest("monetizacao_previsao_jev?select=deal_id,base,gerado_em,versao")).map(
            (r: any) => [Number(r.deal_id), r],
          ),
        ),
      gravarPrevisao: async (linha) => {
        await rest("monetizacao_previsao_jev?on_conflict=deal_id", {
          body: linha,
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      },
      // Fila do Forecast (19/10/2026): a última nota do dono de cada card da reta final.
      gravarNotas: async (linhas) => {
        await rest("monetizacao_ultima_nota?on_conflict=deal_id", {
          body: linhas,
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      },
      gravar: async (linha) => {
        await rest(`${TABELA}?on_conflict=deal_id`, {
          body: linha,
          prefer: "resolution=merge-duplicates,return=minimal",
        });
      },
      agora: new Date(),
      ativo: ATIVA && body.dry !== true,
      limite: Number(body.limite) > 0 ? Math.min(Number(body.limite), 80) : 40,
      orcamentoMs: 110_000,
    });
    return json({
      status: resumo.erros.length ? "com_erros" : "ok",
      ...resumo,
      automacao: ATIVA ? "ligada" : "desligada (MONET_PROXIMO_PASSO_ATIVA diferente de sim)",
    });
  } catch (e) {
    return json({ status: "erro", error: (e as Error).message }, 500);
  }
});
