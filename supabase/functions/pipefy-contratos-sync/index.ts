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

// Carimba `Accept-Profile: ops` em toda chamada ao PostgREST. Sem ele o
// PostgREST resolve as tabelas em `public`, onde nenhuma delas existe. Esta
// linha estava na versão em produção mas não no repositório, e publicar a
// cópia do repositório por cima derrubou a execução das 22:37 de 21/09/2026
// com "existing.map is not a function" — a leitura voltou objeto de erro em
// vez de lista. Não apagar.
import "../_shared/perfil.ts";

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

// Campos da fase "Nova Solicitação", que é por onde todo card entra hoje. O
// pipe foi reestruturado depois que este sync foi escrito: a fase "Vigente"
// virou "Enviar para Onboarding" e os dados que a operação preenche de fato
// passaram para cá. Medição de 21/09/2026 sobre os 460 cards:
//   honor_rio_mensal        358 preenchidos   ← MRR do contrato
//   valor_total_do_contrato 261
//   data_da_venda           261
//   valor (fase antiga)     234
//   data_de_assinatura      1    ← era a fonte primária de data deste sync
// Ou seja: o sync rodava verde lendo o campo mais vazio do pipe.
const F_HONORARIO_MENSAL = "honor_rio_mensal";
const F_VALOR_TOTAL_CONTRATO = "valor_total_do_contrato";
const F_DATA_VENDA = "data_da_venda";
// Connector "Selecione ou cadastre a Empresa" → [PTRS-DB-01] Empresas, a
// database canônica. Preenchido em 325 dos 460 cards e é o vínculo com
// `empresas.pipefy_record_id`.
const F_EMPRESA = "empresa";
// "Unidade de Negócio Planning" do Start Form: 454 dos 460 cards, contra 119
// do campo `unidade` da fase antiga.
const F_UNIDADE_START = "unidade_2";

// Connector para uma database do Pipefy devolve os ids no próprio `value`,
// como JSON (["1371986369"]), e não em `connectedRepoItems` — aquele campo só
// materializa card de pipe, que é o que a query pede no fragmento PublicCard.
function primeiroConectado(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === "[]") return null;
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v)) return v.length ? String(v[0]) : null;
    return String(v) || null;
  } catch {
    return s;
  }
}

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
  "mrr_mensal",
  "valor_total_contrato",
  "data_venda",
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

// Campo `currency` do Pipefy volta em pt-BR: "17.526,00". A versão anterior
// apagava tudo que não fosse dígito, ponto ou hífen, o que transformava
// "17.526,00" em "17.52600" — um número mil vezes menor, que o Postgres aceita
// sem reclamar. Em 21/09/2026, 199 dos 234 valores gravados estavam abaixo de
// R$ 100 por causa disso.
//
// A vírgula é o separador decimal em 358 de 358 valores medidos no pipe, então
// ela manda: quando existe, o ponto é milhar. Sem vírgula, só um formato de
// número simples ("2800" ou "2800.00") é aceito como decimal; qualquer outra
// pontuação é tratada como milhar.
function parseValor(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const limpo = s.replace(/[^\d.,-]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null;
  let normalizado: string;
  if (limpo.includes(",")) {
    normalizado = limpo.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+(\.\d{1,2})?$/.test(limpo)) {
    normalizado = limpo;
  } else {
    normalizado = limpo.replace(/\./g, "");
  }
  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}

// O pipe manda dd/mm/yyyy. Medição de 21/09/2026 sobre os 460 cards: dos 157
// valores de `data_de_assinatura_do_contrato`, 92 têm o primeiro componente
// maior que 12 e **nenhum** tem o segundo — o mesmo vale para `data_da_venda`
// (168 de 261). O formato é inequivocamente dd/mm.
//
// A versão anterior assumia MM/DD/YYYY, com base numa medição de 24/08/2026
// que dava o contrário. Seja qual for a razão da virada (o Pipefy renderiza
// data conforme a localidade de quem gerou o token), o efeito era este: card
// com dia menor ou igual a 12 gravava dia e mês trocados, em silêncio, porque
// a data continua sendo válida. Eram 65 dos 157.
//
// Por isso a regra agora decide pelo que o valor prova, e só cai em dd/mm
// quando os dois componentes são ambíguos:
//   primeiro > 12  → dd/mm (só pode ser dia)
//   segundo  > 12  → mm/dd (só pode ser dia)
//   ambíguo        → dd/mm, que é o formato medido no pipe
// Data impossível vira null em vez de derrubar o lote com 22008.
function parsePipefyDate(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  let dia: number, mes: number;
  if (a > 12 && b <= 12) [dia, mes] = [a, b];
  else if (b > 12 && a <= 12) [dia, mes] = [b, a];
  else [dia, mes] = [a, b];
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
    unidade: fieldMap[F_UNIDADE] || fieldMap[F_UNIDADE_START] || null,
    tipo: normalizeTipo(fieldMap[F_TIPO]),
    valor: parseValor(fieldMap[F_VALOR]),
    mrr_mensal: parseValor(fieldMap[F_HONORARIO_MENSAL]),
    valor_total_contrato: parseValor(fieldMap[F_VALOR_TOTAL_CONTRATO]),
    data_venda: parsePipefyDate(fieldMap[F_DATA_VENDA]),
    // Só data de assinatura de verdade entra aqui. "Data da Venda" fica na
    // coluna própria: decisão do usuário em 21/09/2026 de não usá-la como
    // aproximação da assinatura.
    data_assinatura: parsePipefyDate(fieldMap[F_DATA_ASSINATURA] || fieldMap[F_DATA_ASSINATURA_FASE]),
    _empresa_pipefy_record_id: primeiroConectado(fieldMap[F_EMPRESA]),
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

    // `empresas` passa de 4 mil linhas, acima do teto de 1000 do PostgREST.
    // Sem paginar, o mapa nasce com um quarto da base e o vínculo falha em
    // silêncio para o resto — que é indistinguível de "card sem empresa".
    const empresas: { id: number; pipedrive_id: string | null; pipefy_record_id: string | null; created_at: string }[] = [];
    for (let offset = 0; ; offset += 1000) {
      const resp = await fetch(
        `${supabaseUrl}/rest/v1/empresas?select=id,pipedrive_id,pipefy_record_id,created_at&offset=${offset}&limit=1000`,
        { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
      );
      const lote = await resp.json();
      if (!Array.isArray(lote) || !lote.length) break;
      empresas.push(...lote);
      if (lote.length < 1000) break;
    }
    const empresaPorDeal = new Map<string, typeof empresas>();
    const empresaPorRecord = new Map<string, number>();
    for (const e of empresas) {
      if (e.pipedrive_id) {
        const list = empresaPorDeal.get(e.pipedrive_id) ?? [];
        list.push(e);
        empresaPorDeal.set(e.pipedrive_id, list);
      }
      if (e.pipefy_record_id) empresaPorRecord.set(String(e.pipefy_record_id), e.id);
    }

    const dealsCache = new Map<string, string[]>();
    for (const row of mapped) {
      const jaResolvido = empresaIdAtual.get(row.pipefy_card_id);
      if (jaResolvido) {
        row.empresa_id = jaResolvido;
        continue;
      }
      // Ordem de tentativa, da mais barata e mais forte para a mais cara.
      // 1) Connector "Empresa": o vínculo explícito com a database canônica,
      //    sem chamada externa nenhuma.
      const porRecord = row._empresa_pipefy_record_id
        ? empresaPorRecord.get(row._empresa_pipefy_record_id)
        : undefined;
      if (porRecord) {
        row.empresa_id = porRecord;
        empresaIdResolvidos++;
        continue;
      }
      // 2) Deal ID do Start Form, preenchido em 100% dos cards, casado direto
      //    com `empresas.pipedrive_id`. Também não custa chamada.
      if (row.pipedrive_deal_id) {
        const diretos = empresaPorDeal.get(row.pipedrive_deal_id) ?? [];
        if (diretos.length) {
          row.empresa_id = [...diretos].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0].id;
          empresaIdResolvidos++;
          continue;
        }
      }
      // 3) Só então o caminho antigo, que gasta uma consulta ao Pipedrive por
      //    organização. `id_organiza_o_pipedrive` mora na fase antiga e hoje
      //    está quase sempre vazio, então quase nunca chega aqui.
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
        mrr_mensal: row.mrr_mensal,
        valor_total_contrato: row.valor_total_contrato,
        data_venda: row.data_venda,
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
