// pipefy-contratos-sync
//
// Sincroniza o pipe Pipefy "[PTRS-CLI-03] Central de Contratos" (id
// 307285170, criado em 03/08/2026) para public.contratos_documentos.
// Um card = um documento contratual (Contrato Novo / Aditivo / Distrato) por
// cliente, criado automaticamente pela pipedrive-onboarding-webhook a cada
// deal que chega em "Contrato Assinado" (pipeline 28, stage 170).
//
// Full-refresh periódico via pg_cron, mesmo padrão de pipefy-cs-onboarding-
// sync / pipefy-tratativas-sync — reconciliação completa, não webhook.
//
// Resolve, pra cada card:
//   - empresa_id: via id_organiza_o_pipedrive (org) -> deals da org no
//     Pipedrive -> empresas.pipedrive_id (que guarda deal_id). Só chama a
//     API do Pipedrive pra cards ainda sem empresa_id salvo.
//   - contrato_pai_id: via connector "Contrato Vinculado (aditivo de)"
//     (connectedRepoItems) -> casa o card_id conectado contra
//     contratos_documentos.pipefy_card_id já sincronizado.
//   - cs_onboarding_card_id: via connector "Card de Onboarding" -> id do card
//     no pipe 307173656 (FK cs_onboarding_cards.pipefy_card_id).

const PIPE_ID = "307285170";

const F_CLIENTE = "cliente";
const F_CNPJ = "cnpj";
const F_ORG_ID = "id_organiza_o_pipedrive";
const F_UNIDADE = "unidade";
const F_TIPO = "tipo_de_documento";
const F_VALOR = "valor";
const F_DATA_ASSINATURA = "data_de_assinatura";
const F_FERRAMENTA = "ferramenta_de_assinatura";
const F_LINK_DOC = "link_do_documento_assinado";
const F_STATUS = "status";
// "Deal ID" do Start Form — preenchido em 100% dos cards, ao contrário dos
// campos da fase "Vigente" (que quase nenhum card alcança). É a chave de
// junção com contratos.pipedrive_deal_id. `id_neg_cio_pipedrive` é o mesmo
// dado, mas só existe na fase "Vigente" — fica como fallback.
const F_DEAL_ID = "deal_id_1";
const F_DEAL_ID_VIGENTE = "id_neg_cio_pipedrive";
// Data de assinatura preenchida na própria fase "Contrato Assinado"; a da
// fase "Vigente" (F_DATA_ASSINATURA) só aparece bem depois no fluxo.
const F_DATA_ASSINATURA_FASE = "data_de_assinatura_do_contrato";
const F_CARD_ONBOARDING = "card_de_onboarding";
const F_CONTRATO_VINCULADO = "contrato_vinculado_aditivo_de";

const TIPOS_VALIDOS = new Set(["Contrato Novo", "Aditivo", "Distrato"]);

const UPSERT_COLUMNS = [
  "pipefy_card_id",
  "pipedrive_deal_id",
  "empresa_id",
  "org_id_pipedrive",
  "cnpj",
  "cliente",
  "unidade",
  "tipo",
  "contrato_pai_id",
  "cs_onboarding_card_id",
  "valor",
  "data_assinatura",
  "ferramenta_assinatura",
  "link_documento",
  "status",
  "fase_atual",
  "created_at",
  "update_time",
  "synced_at",
] as const;

type UpsertRow = Record<(typeof UPSERT_COLUMNS)[number], string | number | null>;

const CARDS_QUERY = `
query($pipeId: ID!, $after: String) {
  allCards(pipeId: $pipeId, first: 30, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        title
        created_at
        updated_at
        current_phase { name }
        fields {
          field { id }
          value
          connectedRepoItems { ... on PublicCard { id } }
        }
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

async function dealsDaOrg(pipedriveToken: string, orgId: string): Promise<string[]> {
  const resp = await fetch(
    `https://api.pipedrive.com/v1/organizations/${orgId}/deals?api_token=${pipedriveToken}&status=all_not_deleted`,
  );
  if (!resp.ok) return [];
  const body = await resp.json();
  // deno-lint-ignore no-explicit-any
  return ((body.data ?? []) as any[]).map((d) => String(d.id));
}

function parseValor(raw: unknown): number | null {
  if (!raw) return null;
  const n = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

// Os campos de data deste pipe voltam em MM/DD/YYYY, não em dd/mm/yyyy:
// entre os 95 valores preenchidos de `data_de_assinatura_do_contrato` em
// 24/08/2026, nenhum tem o primeiro componente > 12 e 54 têm o segundo > 12
// (ex.: "01/29/2026" = 29/01/2026). Ler como dd/mm gerava "2026-29-01" e
// derrubava o upsert inteiro com 22008 (date/time field value out of range).
// A ordem invertida (primeiro > 12) continua aceita como dd/mm por segurança,
// para o caso de alguém digitar a data no formato brasileiro num campo de
// texto. Data inválida vira null em vez de quebrar o lote.
function parsePipefyDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const [mes, dia] = a > 12 ? [b, a] : [a, b];
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function normalizeTipo(raw: unknown): string {
  const t = String(raw ?? "").trim();
  return TIPOS_VALIDOS.has(t) ? t : "Contrato Novo";
}

function normalizeUpsertRow(partial: Partial<UpsertRow>): UpsertRow {
  const row = {} as UpsertRow;
  for (const col of UPSERT_COLUMNS) {
    row[col] = partial[col] ?? null;
  }
  return row;
}

// deno-lint-ignore no-explicit-any
function mapCard(card: any) {
  const fieldMap: Record<string, string> = {};
  const connectedMap: Record<string, string | null> = {};
  // deno-lint-ignore no-explicit-any
  for (const f of card.fields ?? []) {
    fieldMap[f.field.id] = f.value;
    connectedMap[f.field.id] = f.connectedRepoItems?.[0]?.id ?? null;
  }
  return {
    pipefy_card_id: String(card.id),
    pipedrive_deal_id:
      (fieldMap[F_DEAL_ID] || fieldMap[F_DEAL_ID_VIGENTE] || "").trim() || null,
    cliente: fieldMap[F_CLIENTE] || null,
    cnpj: fieldMap[F_CNPJ] || null,
    org_id_pipedrive: fieldMap[F_ORG_ID] || null,
    unidade: fieldMap[F_UNIDADE] || null,
    tipo: normalizeTipo(fieldMap[F_TIPO]),
    valor: parseValor(fieldMap[F_VALOR]),
    data_assinatura: parsePipefyDate(fieldMap[F_DATA_ASSINATURA] || fieldMap[F_DATA_ASSINATURA_FASE]),
    ferramenta_assinatura: fieldMap[F_FERRAMENTA] || null,
    link_documento: fieldMap[F_LINK_DOC] || null,
    status: fieldMap[F_STATUS] || null,
    fase_atual: card.current_phase?.name ?? null,
    created_at: card.created_at ?? null,
    update_time: card.updated_at ?? null,
    synced_at: new Date().toISOString(),
    empresa_id: null as number | null,
    contrato_pai_id: null as number | null,
    cs_onboarding_card_id: connectedMap[F_CARD_ONBOARDING] ?? null,
    _contrato_vinculado_pipefy_id: connectedMap[F_CONTRATO_VINCULADO] ?? null,
  };
}

Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (authHeader !== `Bearer ${serviceKey}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const pipefyToken = Deno.env.get("PIPEFY_TOKEN")!;
  const pipedriveToken = Deno.env.get("PIPEDRIVE_TOKEN")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

  const start = Date.now();
  let rows: UpsertRow[] = [];
  let staleCount = 0;
  let empresaIdResolvidos = 0;
  let status = "sucesso";
  let errorMsg: string | null = null;

  try {
    const cards = await fetchAllCards(pipefyToken);
    const mapped = cards.map(mapCard);

    const idPorPipefyCard = new Map(mapped.map((r) => [r.pipefy_card_id, r]));
    const paiPorPipefyCard = new Map<string, string>();
    for (const row of mapped) {
      const vinculadoPipefyId = row._contrato_vinculado_pipefy_id;
      if (vinculadoPipefyId && idPorPipefyCard.has(vinculadoPipefyId)) {
        paiPorPipefyCard.set(row.pipefy_card_id, vinculadoPipefyId);
      }
    }

    const existingResp = await fetch(
      `${supabaseUrl}/rest/v1/contratos_documentos?select=pipefy_card_id,empresa_id,id`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const existing: { pipefy_card_id: string; empresa_id: number | null; id: number }[] = await existingResp.json();
    const empresaIdAtual = new Map(existing.map((e) => [e.pipefy_card_id, e.empresa_id]));
    const idBancoPorPipefyCard = new Map(existing.map((e) => [e.pipefy_card_id, e.id]));

    const empresasResp = await fetch(
      `${supabaseUrl}/rest/v1/empresas?select=id,pipedrive_id,created_at&pipedrive_id=not.is.null`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const empresas: { id: number; pipedrive_id: string; created_at: string }[] = await empresasResp.json();
    const empresaPorDeal = new Map<string, typeof empresas>();
    for (const e of empresas) {
      const list = empresaPorDeal.get(e.pipedrive_id) ?? [];
      list.push(e);
      empresaPorDeal.set(e.pipedrive_id, list);
    }

    const dealsCache = new Map<string, string[]>();
    for (const row of mapped) {
      const jaResolvido = empresaIdAtual.get(row.pipefy_card_id);
      if (jaResolvido) {
        row.empresa_id = jaResolvido;
        continue;
      }
      if (!row.org_id_pipedrive) continue;
      let deals = dealsCache.get(row.org_id_pipedrive);
      if (!deals) {
        deals = await dealsDaOrg(pipedriveToken, row.org_id_pipedrive);
        dealsCache.set(row.org_id_pipedrive, deals);
      }
      const candidatos = deals.flatMap((d) => empresaPorDeal.get(d) ?? []);
      if (!candidatos.length) continue;
      const escolhida = [...candidatos].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      row.empresa_id = escolhida.id;
      empresaIdResolvidos++;
    }

    rows = mapped.map((row) =>
      normalizeUpsertRow({
        pipefy_card_id: row.pipefy_card_id,
        pipedrive_deal_id: row.pipedrive_deal_id,
        empresa_id: row.empresa_id,
        org_id_pipedrive: row.org_id_pipedrive,
        cnpj: row.cnpj,
        cliente: row.cliente,
        unidade: row.unidade,
        tipo: row.tipo,
        contrato_pai_id: row.contrato_pai_id,
        cs_onboarding_card_id: row.cs_onboarding_card_id,
        valor: row.valor,
        data_assinatura: row.data_assinatura,
        ferramenta_assinatura: row.ferramenta_assinatura,
        link_documento: row.link_documento,
        status: row.status,
        fase_atual: row.fase_atual,
        created_at: row.created_at,
        update_time: row.update_time,
        synced_at: row.synced_at,
      })
    );

    // `on_conflict` é obrigatório: sem ele o PostgREST resolve o conflito pela
    // primary key (`id`), que as linhas novas não trazem — o merge-duplicates
    // vira INSERT puro e bate na constraint UNIQUE (pipefy_card_id). Foi o que
    // deixou este sync quebrado de 11/08 a 24/08/2026.
    const upsertResp = await fetch(
      `${supabaseUrl}/rest/v1/contratos_documentos?on_conflict=pipefy_card_id`,
      {
        method: "POST",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation",
        },
        body: JSON.stringify(rows),
      },
    );
    if (!upsertResp.ok) {
      throw new Error(`Upsert falhou: ${upsertResp.status} ${await upsertResp.text()}`);
    }
    const upserted: { id: number; pipefy_card_id: string }[] = await upsertResp.json();
    for (const u of upserted) idBancoPorPipefyCard.set(u.pipefy_card_id, u.id);

    for (const [pipefyCardId, paiPipefyCardId] of paiPorPipefyCard.entries()) {
      const meuId = idBancoPorPipefyCard.get(pipefyCardId);
      const paiId = idBancoPorPipefyCard.get(paiPipefyCardId);
      if (!meuId || !paiId) continue;
      await fetch(`${supabaseUrl}/rest/v1/contratos_documentos?id=eq.${meuId}`, {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ contrato_pai_id: paiId }),
      });
    }

    const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
    const staleIds = existing.map((e) => e.pipefy_card_id).filter((id) => !currentIds.has(id));
    staleCount = staleIds.length;
    if (staleIds.length > 0) {
      const inList = staleIds.map((id) => `"${id}"`).join(",");
      await fetch(
        `${supabaseUrl}/rest/v1/contratos_documentos?pipefy_card_id=in.(${inList})`,
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
      fonte: "pipefy_contratos",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: {
        pipe_id: PIPE_ID,
        cards: rows.length,
        removidos: staleCount,
        empresa_id_resolvidos: empresaIdResolvidos,
        trigger: "cron",
        erro: errorMsg,
      },
      status,
    }),
  });

  if (status === "erro") {
    return new Response(JSON.stringify({ error: errorMsg }), { status: 500 });
  }
  return new Response(
    JSON.stringify({ total: rows.length, removidos: staleCount, empresa_id_resolvidos: empresaIdResolvidos }),
    { status: 200 },
  );
});
