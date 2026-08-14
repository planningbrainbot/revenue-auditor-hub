// pipefy-vendas-servicos-sync
//
// Sincroniza o pipe Pipefy "[PTRS-UNI-06] Vendas de Serviços para Unidades"
// (id 307297295) na tabela vendas_servicos_unidades — usada na página
// /ebit-operacional pra acompanhar a meta de zerar o custo operacional do
// time via venda de serviços internos (RH, CS, Compliance) pras unidades.
//
// Campos "Valor no teto da rampa" e "Gatilho do reajuste" foram criados no
// pipe em 14/08/2026 pra capturar de forma estruturada as rampas de valor
// que antes só existiam como texto livre no campo "Negociação".
//
// Mesma lógica que a versão server-side (src/lib/ebit-operacional.functions.ts,
// syncVendasServicos) usada pelo botão "Forçar atualização" — manter as duas
// em sincronia se as fases/campos do pipe mudarem.

const PIPEFY_TOKEN = Deno.env.get("PIPEFY_TOKEN")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PIPE_ID = "307297295";

// Fases em que "Venda feita = Sim" já conta como MRR vendido — decisão do
// usuário 14/08/2026 (DATA-RULES.md): "Aditivo Contratual" é a etapa de
// formalização pós-venda, não pipeline aberto. Mantido aqui só como
// documentação; o cálculo de "vendido" acontece no frontend, não no sync.

const QUERY = `
  query($pipeId: ID!) {
    pipe(id: $pipeId) {
      phases {
        name
        cards(first: 50) {
          edges {
            node {
              id
              title
              createdAt
              fields { field { id } value }
            }
          }
        }
      }
    }
  }
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pipefyGraphql(query: string, variables: Record<string, unknown>): Promise<any> {
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${PIPEFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json();
  if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

function parseCurrency(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function parseUnidade(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : null;
  } catch {
    return v;
  }
}

function parseData(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(faseNome: string, card: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldMap = new Map<string, string>((card.fields ?? []).map((f: any) => [f.field.id, f.value]));
  const vendaFeitaRaw = fieldMap.get("venda_feita");
  const reuniaoRaw = fieldMap.get("reuni_o_aconteceu");
  return {
    pipefy_card_id: String(card.id),
    titulo: card.title ?? null,
    solucao: fieldMap.get("solu_o") ?? card.title ?? null,
    unidade: parseUnidade(fieldMap.get("unidade")),
    fase_atual: faseNome,
    venda_feita: vendaFeitaRaw ? vendaFeitaRaw === "Sim" : null,
    reuniao_aconteceu: reuniaoRaw ? reuniaoRaw === "Sim" : null,
    valor_mensal_1_mes: parseCurrency(fieldMap.get("valor_mensal_1_m_s")),
    valor_teto_rampa: parseCurrency(fieldMap.get("valor_no_teto_da_rampa")),
    gatilho_reajuste: fieldMap.get("gatilho_do_reajuste") ?? null,
    negociacao: fieldMap.get("negocia_o") ?? null,
    data_reuniao: parseData(fieldMap.get("data_da_reuni_o")),
    criado_em: card.createdAt ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Supabase REST helpers ─────────────────────────────────────────────────
async function supaUpsert(path: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function supaInsert(path: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function supaGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supaDelete(path: string): Promise<void> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function insertSyncLog(
  executadoEm: Date,
  duracao: number,
  total: number,
  detalhes: Record<string, unknown>,
  status = "sucesso",
) {
  await supaInsert("sync_log", [
    {
      fonte: "pipefy_vendas_servicos",
      executado_em: executadoEm.toISOString(),
      duracao_segundos: duracao,
      total_registros: total,
      detalhes,
      status,
    },
  ]);
}

async function runSync() {
  const startTime = new Date();
  console.log(`Sync Pipefy Vendas de Serviços → Supabase | ${startTime.toISOString()}`);

  const data = await pipefyGraphql(QUERY, { pipeId: PIPE_ID });
  const rows: ReturnType<typeof mapCard>[] = [];
  for (const phase of data.pipe.phases) {
    for (const edge of phase.cards.edges) {
      rows.push(mapCard(phase.name, edge.node));
    }
  }

  await supaUpsert("vendas_servicos_unidades", rows, "pipefy_card_id");

  const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
  const existing = await supaGet("vendas_servicos_unidades?select=pipefy_card_id");
  const staleIds = existing
    .map((e: { pipefy_card_id: string }) => String(e.pipefy_card_id))
    .filter((id: string) => !currentIds.has(id));
  if (staleIds.length > 0) {
    await supaDelete(`vendas_servicos_unidades?pipefy_card_id=in.(${staleIds.join(",")})`);
  }

  const elapsed = Math.round((Date.now() - startTime.getTime()) / 1000);
  const result = { cards: rows.length, removidos: staleIds.length, elapsed };
  await insertSyncLog(startTime, elapsed, rows.length, { pipe_id: PIPE_ID, ...result, trigger: "cron" });
  return result;
}

Deno.serve(async (_req) => {
  const startTime = new Date();
  try {
    const result = await runSync();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error("Sync falhou:", err);
    try {
      await insertSyncLog(
        startTime,
        Math.round((Date.now() - startTime.getTime()) / 1000),
        0,
        { error: err },
        "erro",
      );
    } catch {
      // se nem o log der certo, não bloqueia a resposta de erro
    }
    return new Response(JSON.stringify({ ok: false, error: err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
