import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ syncPainelCs ============
// Versão server-side da Edge Function pipefy-cs-onboarding-sync (que roda a
// cada 15min via pg_cron) — permite forçar uma atualização imediata pelo
// botão da tela /painel-cs. Mesma lógica de mapeamento; manter as duas em
// sincronia se as fases do pipe 307173656 mudarem (esse pipe é editado com
// frequência pelo usuário direto na UI do Pipefy).
const PIPE_ID = "307173656";

// Ordem real das fases no pipe (confirmada via GraphQL em 22/07/2026).
export const FASES_ORDEM: string[] = [
  "Nova venda",
  "Contrato assinado - Disponível para atuar",
  "Handoff [comercial + cs]",
  "Sessão raio-x [CS + Cliente]",
  "Pré Kickoff [ops + cs]",
  "kickoff com [Cliente + ops + cs]",
  "Setup técnico",
  "Check-out Onboarding",
  "Concluído",
];

function faseOrdem(nome: string | null | undefined): number {
  if (!nome) return 999;
  const idx = FASES_ORDEM.indexOf(nome.trim());
  return idx === -1 ? 999 : idx;
}

// Campo "Unidade" vem do Start Form como "Planning <Unidade>" (ex: "Planning
// Fortaleza") — normaliza pro nome canônico usado no resto do app
// (UNIDADES_REDE em src/lib/unidades-rede.ts). "Sudeste" é o rename conhecido
// pra Rio de Janeiro nesse pipe (ver project_pipedrive_pipefy_onboarding_sync).
function canonicalUnidade(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const base = raw.trim().replace(/^planning\s+/i, "").trim();
  if (!base) return null;
  if (base.toLowerCase() === "sudeste") return "Rio de Janeiro";
  if (base.toLowerCase() === "campo novo do parecis") return "Campo Novo";
  return base;
}

const CARDS_QUERY = `
  query($pipeId: ID!, $after: String) {
    allCards(pipeId: $pipeId, first: 30, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          createdAt
          updated_at
          done
          current_phase { name }
          phases_history { phase { name } firstTimeIn lastTimeOut }
          fields { field { id } value }
        }
      }
    }
  }
`;

async function pipefyGraphql(token: string, query: string, variables: Record<string, unknown>) {
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json();
  if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllCards(token: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cards: any[] = [];
  let after: string | null = null;
  while (true) {
    const data = await pipefyGraphql(token, CARDS_QUERY, { pipeId: PIPE_ID, after });
    const conn = data.allCards;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cards.push(...conn.edges.map((e: any) => e.node));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return cards;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(card: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const history = (card.phases_history ?? []).map((h: any) => ({
    fase: h.phase?.name ?? null,
    entrou_em: h.firstTimeIn ?? null,
    saiu_em: h.lastTimeOut ?? null,
  }));
  const atual = history[history.length - 1];
  const faseAtual: string | null = card.current_phase?.name ?? null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldMap = new Map<string, string>((card.fields ?? []).map((f: any) => [f.field.id, f.value]));
  return {
    pipefy_card_id: String(card.id),
    titulo: card.title ?? null,
    fase_atual: faseAtual,
    fase_atual_ordem: faseOrdem(faseAtual),
    entrou_fase_atual_em: atual?.entrou_em ?? null,
    criado_em: card.createdAt ?? null,
    concluido: !!card.done,
    unidade: canonicalUnidade(fieldMap.get("unidade_1")),
    fases_history: history,
    update_time: card.updated_at ?? null,
    synced_at: new Date().toISOString(),
  };
}

export const syncPainelCs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ total: number; removidos: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    const start = Date.now();
    const cards = await fetchAllCards(pipefyToken);
    const rows = cards.map(mapCard);

    const { error: upsertErr } = await supabase
      .from("cs_onboarding_cards")
      .upsert(rows, { onConflict: "pipefy_card_id" });
    if (upsertErr) throw new Error(upsertErr.message);

    const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
    const { data: existing, error: exErr } = await supabase
      .from("cs_onboarding_cards")
      .select("pipefy_card_id");
    if (exErr) throw new Error(exErr.message);
    const staleIds = (existing ?? [])
      .map((e: { pipefy_card_id: string }) => String(e.pipefy_card_id))
      .filter((id: string) => !currentIds.has(id));

    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from("cs_onboarding_cards")
        .delete()
        .in("pipefy_card_id", staleIds);
      if (delErr) throw new Error(delErr.message);
    }

    const duracao = Math.round((Date.now() - start) / 1000);
    await supabase.from("sync_log").insert({
      fonte: "pipefy_painel_cs",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: { pipe_id: PIPE_ID, cards: rows.length, removidos: staleIds.length, trigger: "manual" },
      status: "sucesso",
    });

    return { total: rows.length, removidos: staleIds.length };
  });
