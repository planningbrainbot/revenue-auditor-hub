// Sincroniza o pipe Pipefy "Auditoria Interna" (id 307181077) para a tabela
// public.auditorias_internas — alimenta a tela executiva /auditoria-interna.
// Mesmo padrão da pipefy-tratativas-sync: full-refresh periódico (pg_cron),
// não webhook — o valor aqui é reconciliação completa (detectar cards que
// saíram do pipe), não reagir rápido a um evento pontual.
// Espelhado em src/lib/auditoria-interna.functions.ts (botão "forçar
// atualização" da tela) — manter os dois em sincronia se os field_id mudarem.

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

// deno-lint-ignore no-explicit-any
async function fetchAllCards(token: string): Promise<any[]> {
  // deno-lint-ignore no-explicit-any
  const cards: any[] = [];
  let after: string | null = null;
  while (true) {
    const data = await pipefyGraphql(token, CARDS_QUERY, { pipeId: PIPE_ID, after });
    const conn = data.allCards;
    // deno-lint-ignore no-explicit-any
    cards.push(...conn.edges.map((e: any) => e.node));
    if (!conn.pageInfo.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  return cards;
}

// deno-lint-ignore no-explicit-any
function mapCard(card: any) {
  // deno-lint-ignore no-explicit-any
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
    update_time: card.updated_at ?? null,
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const pipefyToken = Deno.env.get("PIPEFY_TOKEN")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const start = Date.now();
  let rows: ReturnType<typeof mapCard>[] = [];
  let staleCount = 0;
  let status = "sucesso";
  let errorMsg: string | null = null;

  try {
    const cards = await fetchAllCards(pipefyToken);
    rows = cards.map(mapCard);

    const upsertResp = await fetch(`${supabaseUrl}/rest/v1/auditorias_internas`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (!upsertResp.ok) {
      throw new Error(`Upsert falhou: ${upsertResp.status} ${await upsertResp.text()}`);
    }

    const existingResp = await fetch(
      `${supabaseUrl}/rest/v1/auditorias_internas?select=pipefy_card_id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const existing: { pipefy_card_id: string }[] = await existingResp.json();
    const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
    const staleIds = existing.map((e) => e.pipefy_card_id).filter((id) => !currentIds.has(id));
    staleCount = staleIds.length;

    if (staleIds.length > 0) {
      const inList = staleIds.map((id) => `"${id}"`).join(",");
      await fetch(
        `${supabaseUrl}/rest/v1/auditorias_internas?pipefy_card_id=in.(${inList})`,
        { method: "DELETE", headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
    }
  } catch (e) {
    status = "erro";
    errorMsg = e instanceof Error ? e.message : String(e);
  }

  const duracao = Math.round((Date.now() - start) / 1000);
  await fetch(`${supabaseUrl}/rest/v1/sync_log`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      fonte: "pipefy_auditoria_interna",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: { pipe_id: PIPE_ID, cards: rows.length, removidos: staleCount, trigger: "cron", erro: errorMsg },
      status,
    }),
  });

  if (status === "erro") {
    return new Response(JSON.stringify({ error: errorMsg }), { status: 500 });
  }
  return new Response(JSON.stringify({ total: rows.length, removidos: staleCount }), { status: 200 });
});
