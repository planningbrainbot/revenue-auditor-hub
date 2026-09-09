import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ syncAuditoriaInterna ============
// Versão server-side da Edge Function pipefy-auditoria-interna-sync (que roda
// a cada 15min via pg_cron) — permite forçar uma atualização imediata pelo
// botão da tela Auditoria Interna. Mesma lógica de mapeamento de campos;
// manter as duas em sincronia se os field_id do pipe 307181077 mudarem.
const PIPE_ID = "307181077";

const F_UNIDADE = "nome_da_unidade_franqueada";
const F_EMPRESA = "empresa_auditada";
const F_TIPO_PROJETO = "tipo_de_projeto";
const F_COMPLEXIDADE = "complexidade_fiscal";
const F_TIPO_EMPRESA = "tipo_de_empresa";
const F_SETOR = "setor_de_atua_o";
const F_STATUS_SOLICITACAO = "status_da_solicita_o";
const F_DATA_INICIO_CONTRATO = "data_de_in_cio_do_projeto";
const F_DATA_CONCLUSAO = "data_de_conclus_o";
const F_AUDITORIA_FINALIZADA = "auditoria_finalizada";
const F_CLASSIFICACAO = "classifica_o_dos_apontamentos";
const F_OPORTUNIDADES = "oportunidades_identificadas";
const F_CONTINGENCIAS = "conting_ncias_indetificadas";
const F_EQUIPE = "equipe_designada";
const F_AVALIACAO_SUCESSO = "avalia_o_de_sucesso";
const F_FATURAMENTO = "faturamento_do_periodo_analisado";

const CARDS_QUERY = `
  query($pipeId: ID!, $after: String) {
    allCards(pipeId: $pipeId, first: 30, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          current_phase { name }
          due_date
          updated_at
          fields { field { id } value }
        }
      }
    }
  }
`;

function parseJsonArrayField(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) return arr.join(", ") || null;
  } catch {
    // não era JSON — devolve o texto cru
  }
  return raw;
}

function parseBrDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

// Campo de texto livre no Pipefy: chega como "R$ 2.691.472,74", " 1.261.824,20 " ou "0,00".
function parseValorBr(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const limpo = String(raw).replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isNaN(n) ? null : n;
}

// Extrai todos os valores "R$ 1.234,56" de um texto livre e soma.
function sumReais(text: string | null | undefined): number | null {
  if (!text) return null;
  const matches = text.match(/R\$\s?([\d.]+,\d{2})/g);
  if (!matches || matches.length === 0) return null;
  let total = 0;
  for (const m of matches) {
    const numStr = m.replace(/R\$\s?/, "").replace(/\./g, "").replace(",", ".");
    const n = Number(numStr);
    if (!Number.isNaN(n)) total += n;
  }
  return total;
}

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
  const fieldMap = new Map<string, string>(card.fields.map((f: any) => [f.field.id, f.value]));
  const oportunidadesTexto = fieldMap.get(F_OPORTUNIDADES) ?? null;
  const contingenciasTexto = fieldMap.get(F_CONTINGENCIAS) ?? null;
  return {
    pipefy_card_id: String(card.id),
    empresa_auditada: (fieldMap.get(F_EMPRESA) ?? "").trim() || null,
    unidade: (fieldMap.get(F_UNIDADE) ?? "").trim() || null,
    fase_atual: card.current_phase?.name ?? null,
    tipo_projeto: parseJsonArrayField(fieldMap.get(F_TIPO_PROJETO)),
    status_solicitacao: fieldMap.get(F_STATUS_SOLICITACAO) ?? null,
    complexidade_fiscal: fieldMap.get(F_COMPLEXIDADE) ?? null,
    tipo_empresa: fieldMap.get(F_TIPO_EMPRESA) ?? null,
    setor_atuacao: fieldMap.get(F_SETOR) ?? null,
    equipe_designada: parseJsonArrayField(fieldMap.get(F_EQUIPE)),
    data_inicio_contrato: parseBrDate(fieldMap.get(F_DATA_INICIO_CONTRATO)),
    prazo_atual: card.due_date ?? null,
    data_conclusao: parseBrDate(fieldMap.get(F_DATA_CONCLUSAO)),
    auditoria_finalizada: (fieldMap.get(F_AUDITORIA_FINALIZADA) ?? "").toLowerCase() === "sim",
    classificacao_apontamentos: parseJsonArrayField(fieldMap.get(F_CLASSIFICACAO)),
    avaliacao_sucesso: fieldMap.get(F_AVALIACAO_SUCESSO) ?? null,
    oportunidades_texto: oportunidadesTexto,
    contingencias_texto: contingenciasTexto,
    oportunidades_valor: sumReais(oportunidadesTexto),
    contingencias_valor: sumReais(contingenciasTexto),
    faturamento_periodo: parseValorBr(fieldMap.get(F_FATURAMENTO)),
    update_time: card.updated_at ?? null,
  };
}

export const syncAuditoriaInterna = createServerFn({ method: "POST" })
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
      .from("auditorias_internas")
      .upsert(rows, { onConflict: "pipefy_card_id" });
    if (upsertErr) throw new Error(upsertErr.message);

    const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
    const { data: existing, error: exErr } = await supabase
      .from("auditorias_internas")
      .select("pipefy_card_id");
    if (exErr) throw new Error(exErr.message);
    const staleIds = (existing ?? [])
      .map((e: { pipefy_card_id: string }) => String(e.pipefy_card_id))
      .filter((id: string) => !currentIds.has(id));

    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from("auditorias_internas")
        .delete()
        .in("pipefy_card_id", staleIds);
      if (delErr) throw new Error(delErr.message);
    }

    const duracao = Math.round((Date.now() - start) / 1000);
    await supabase.from("sync_log").insert({
      fonte: "pipefy_auditoria_interna",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: { pipe_id: PIPE_ID, cards: rows.length, removidos: staleIds.length, trigger: "manual" },
      status: "sucesso",
    });

    return { total: rows.length, removidos: staleIds.length };
  });
