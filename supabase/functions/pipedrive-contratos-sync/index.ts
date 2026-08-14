// pipedrive-contratos-sync
//
// Port de ~/sync_pipedrive_contratos.py (LaunchAgent local, agendado 07:00).
// Migrado pra Edge Function + pg_cron em 31/07/2026 porque o LaunchAgent
// falhou 2 dias seguidos (29-30/07) com ConnectionResetError na chamada à
// API do Pipedrive — instabilidade de rede do laptop no horário agendado
// (Mac acordando do sleep). 5 contratos de clientes reais (Camianski, Mh
// Construções, Embutidos 2 Irmãos, I B M Mangueiras, Baluarte Engenharia)
// ficaram fora do CAC por causa disso. Rodando na nuvem elimina essa classe
// de falha (não depende do laptop estar ligado/acordado/na rede certa).
//
// Fonte: Pipedrive pipeline 2 (Inside Sales), deals com status=won.
// Para cada deal: upsert em 'empresas' (casando por CNPJ antes de criar
// linha nova) e upsert em 'contratos' (preserva CNPJ já gravado
// manualmente). Remove contratos recentes (<=90 dias) que saíram do
// pipeline 2 ou foram marcados 'lost'. Mescla duplicatas em 'empresas'.
//
// NÃO inclui o backfill de entrada_contrato_assinado_em do script original
// (run_backfill_contrato_assinado) — esse campo não é usado por CAC nem
// royalties (que dependem de ganho_em, mrr_mensal, status_contrato), custa
// uma chamada /flow por deal do stage 170 (~170+ chamadas) e não é crítico
// pro caminho principal. Se precisar dessa data, portar como função
// separada com cadência menor.

const PD_TOKEN = Deno.env.get("PIPEDRIVE_TOKEN")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PIPELINE_VENDAS = 2;

// Campos customizados Pipedrive
const CNPJ_FIELD = "f37f5a5c865fe4f49f16233ed97a989cab34dc7d";
const TIPO_FIELD = "f7c06d8b25c27822d1cbd4955c9fd8f46e93e973";
const RS_FIELD = "eee126ecb81fb8931a81179eb1994e25e2c9acd4"; // Razão Social 1
const UNIDADE_FIELD = "5684f15458abf85ed384837a8eb515294350f5cc";
const CLOSER_FIELD = "82f35432010d0c95fceeaa0b5bce5f8e7542a795";
const SDR_FIELD = "216740813ecdc3d64c03e5e1d5685050048a01d1";
const REGIME_FIELD = "093e25bbb3aff5d379b996da8fcec39667c6ae4e";

const TIPO_LABELS: Record<string, string> = {
  "919": "Churn",
  "920": "Aditivo",
  "921": "Novo Contrato",
};

const UNIDADE_LABELS: Record<string, string> = {
  "694": "Matriz",
  "695": "Rio de Janeiro",
  "696": "Patos de Minas",
  "697": "Belém",
  "698": "Curitiba",
  "699": "Consultoria",
  "700": "Construção Civil",
  "701": "Agronegócio",
  "719": "São Paulo",
  "720": "ROIT",
  "857": "Itaúna",
  "929": "Fortaleza",
  "930": "Campo Novo",
  "931": "São Luis",
  "984": "Maceió",
};

const MATRIZ_IDS = new Set(["694", "699", "700", "701", "719", "720"]);

const CLOSER_LABELS: Record<string, string> = {
  "922": "Mateus Nunes",
  "923": "Isabella Mehedin",
  "924": "Thalissa Carvalho",
  "925": "Maria Silva",
  "926": "William Linhares",
  "928": "Rogério Carvalho",
  "934": "Jordana",
  "935": "Daniel Jr.",
  "994": "Amanda Gusmão",
  "995": "Brenda Patury",
  "996": "Mario Costa",
};

const REGIME_LABELS: Record<string, string> = {
  "350": "Simples Nacional",
  "351": "Lucro Presumido",
  "352": "Lucro Real",
  "681": "MEI",
  "682": "Não tem CNPJ",
};

const SDR_LABELS: Record<string, string> = {
  "29": "Yasmim Ferreira",
  "30": "Sem SDR",
  "28": "Mateus Nunes",
  "286": "Isabella Mehedin",
  "862": "Jessica Rabelo",
  "863": "Willian Linhares",
  "864": "Thais Gerlach",
  "865": "Thalissa Carvalho",
  "866": "Amanda Gusmão",
  "867": "Thulio Ribeiro",
  "868": "Gabriella Oliveira",
  "869": "Daniele Andrade",
  "985": "Júlia Santos",
  "992": "Edilson Prates",
  "993": "Jacquelyne Almeida",
};

function extractEnumLabel(
  d: Record<string, unknown>,
  fieldKey: string,
  labels: Record<string, string>,
): string | null {
  const raw = d[fieldKey];
  if (!raw || raw === 0) return null;
  return labels[String(raw)] ?? null;
}

// ── Pipedrive HTTP helper (3 tentativas, 3s entre elas) ──────────────────
async function pdGet(path: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `https://api.pipedrive.com/v1${path}${sep}api_token=${PD_TOKEN}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}: ${await res.text()}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw lastErr;
}

// ── Supabase REST helpers ─────────────────────────────────────────────────
async function supaPost(
  path: string,
  rows: Record<string, unknown>[],
  prefer = "resolution=merge-duplicates,return=representation",
): Promise<any[]> {
  if (rows.length === 0) return [];
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    console.error(`Supabase error ${res.status} em ${path}: ${(await res.text()).slice(0, 400)}`);
    return [];
  }
  const body = await res.text();
  return body.trim() ? JSON.parse(body) : [];
}

// PostgREST rejeita o array inteiro (PGRST102) se os objetos tiverem chaves
// diferentes — acontece sempre que um campo é omitido condicionalmente (ex:
// cnpj só entra quando tem valor, pra não sobrescrever com null um dado já
// preenchido em banco). Agrupa por conjunto de chaves antes de enviar.
async function supaPostGrouped(
  path: string,
  rows: Record<string, unknown>[],
  prefer?: string,
): Promise<any[]> {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = Object.keys(r).sort().join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  const result: any[] = [];
  for (const group of groups.values()) {
    result.push(...(await supaPost(path, group, prefer)));
  }
  return result;
}

async function supaGet(path: string): Promise<any[]> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function supaPatch(
  table: string,
  id: number | string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${table} -> HTTP ${res.status}: ${await res.text()}`);
}

async function supaPatchFilter(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function supaDelete(path: string): Promise<void> {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: "return=minimal" },
  });
  if (!res.ok) throw new Error(`Supabase DELETE ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

// ── Mapeamento Pipedrive → linhas do banco ────────────────────────────────
function cleanTitle(raw: string | undefined | null): string {
  return (raw ?? "").replace(/\s*\(cópia\)\s*$/i, "").trim();
}

function extractCnpj(d: Record<string, unknown>): string {
  const raw = d[CNPJ_FIELD];
  if (!raw || raw === 0) return "";
  const cleaned = String(raw).replace(/[^0-9]/g, "");
  return cleaned.length === 14 ? cleaned : "";
}

function extractUnidade(d: Record<string, unknown>): [string | null, string | null] {
  const raw = d[UNIDADE_FIELD];
  if (!raw || raw === 0) return [null, null];
  const uid = String(raw);
  const label = UNIDADE_LABELS[uid];
  if (label === undefined) return [uid, null];
  const tipo = MATRIZ_IDS.has(uid) ? "matriz" : "franquia";
  return [label, tipo];
}

function isCopy(d: Record<string, unknown>): boolean {
  const raw = (d.title as string) ?? "";
  return /\(c[oó]pia\)/i.test(raw);
}

function mapEmpresa(d: Record<string, unknown>, includeCnpj: boolean): Record<string, unknown> {
  const title = cleanTitle(d.title as string);
  const razaoSocial = (d[RS_FIELD] as string) || title;
  const [unidade, tipoUnidade] = extractUnidade(d);
  const row: Record<string, unknown> = {
    pipedrive_id: String(d.id),
    titulo: title,
    razao_social: razaoSocial,
    unidade,
    tipo_unidade: tipoUnidade,
    fonte_cadastro: "pipedrive_sync",
  };
  if (includeCnpj) {
    const cnpj = extractCnpj(d);
    if (cnpj) row.cnpj = cnpj;
  }
  return row;
}

function mapContrato(
  d: Record<string, unknown>,
  empresaId: number | string | null,
): Record<string, unknown> {
  const title = cleanTitle(d.title as string);
  const cnpj = extractCnpj(d);
  const tipoRaw = d[TIPO_FIELD];
  const tipo = tipoRaw && tipoRaw !== 0 ? (TIPO_LABELS[String(tipoRaw)] ?? "Recorrente") : "Recorrente";
  const wonTime = (d.won_time as string) ?? "";
  const addTime = (d.add_time as string) ?? "";
  const ganhoEm = wonTime ? wonTime.slice(0, 10) : addTime ? addTime.slice(0, 10) : null;
  const valorTotal = Number(d.value ?? 0);
  const mrr = Number(d.weighted_value ?? valorTotal);
  const [unidade, tipoUnidade] = extractUnidade(d);
  const closer = extractEnumLabel(d, CLOSER_FIELD, CLOSER_LABELS);
  const sdr = extractEnumLabel(d, SDR_FIELD, SDR_LABELS);
  const regimeTributario = extractEnumLabel(d, REGIME_FIELD, REGIME_LABELS);

  const row: Record<string, unknown> = {
    pipedrive_deal_id: String(d.id),
    titulo: title,
    produto: "",
    tipo,
    ganho_em: ganhoEm,
    valor_total: valorTotal,
    mrr,
    preco_unitario: null,
    quantidade: null,
    subtotal_produto: null,
    cnpj,
    segmento: "",
    status_contrato: "Ativo",
    unidade,
    tipo_unidade: tipoUnidade,
    closer,
    sdr,
    regime_tributario: regimeTributario,
  };
  if (empresaId != null) row.empresa_id = empresaId;
  return row;
}

async function fetchPipelineWonDeals(pipelineId: number): Promise<Record<string, unknown>[]> {
  const deals: Record<string, unknown>[] = [];
  let start = 0;
  while (true) {
    const data = await pdGet(`/deals?pipeline_id=${pipelineId}&status=won&limit=100&start=${start}`);
    const batch = (data.data ?? []) as Record<string, unknown>[];
    deals.push(...batch);
    const more = data.additional_data?.pagination?.more_items_in_collection ?? false;
    if (!more) break;
    start += 100;
    await new Promise((r) => setTimeout(r, 200));
  }
  return deals;
}

async function fetchEmpresasCnpjIndex(): Promise<Map<string, { id: number; pipedrive_id: string | null }>> {
  const rows = await supaGet("empresas?select=id,cnpj,pipedrive_id&cnpj=not.is.null&limit=5000");
  const idx = new Map<string, { id: number; pipedrive_id: string | null }>();
  for (const r of rows) {
    const c = String(r.cnpj ?? "").replace(/[^0-9]/g, "");
    if (c.length === 14 && !idx.has(c)) idx.set(c, { id: r.id, pipedrive_id: r.pipedrive_id });
  }
  return idx;
}

async function fetchContratosCnpjIndex(): Promise<Set<string>> {
  const rows = await supaGet(
    "contratos?select=pipedrive_deal_id,cnpj&cnpj=not.is.null&pipedrive_deal_id=not.is.null&limit=5000",
  );
  return new Set(rows.filter((r) => r.cnpj).map((r) => r.pipedrive_deal_id as string));
}

// Faz o papel do upsert em 'empresas', mas casa por CNPJ primeiro: se já
// existe uma empresa (de qualquer fonte) com o mesmo CNPJ do deal, funde o
// pipedrive_id nela via PATCH em vez de inserir uma linha nova.
async function upsertEmpresasSemDuplicarCnpj(
  deals: Record<string, unknown>[],
): Promise<Map<string, number>> {
  const cnpjIdx = await fetchEmpresasCnpjIndex();
  const pidToEid = new Map<string, number>();
  const dealsNormais: Record<string, unknown>[] = [];

  for (const d of deals) {
    const cnpj = extractCnpj(d);
    const match = cnpj ? cnpjIdx.get(cnpj) : undefined;
    if (match && String(match.pipedrive_id ?? "") !== String(d.id)) {
      const row = mapEmpresa(d, false);
      delete row.pipedrive_id;
      await supaPatch("empresas", match.id, row);
      pidToEid.set(String(d.id), match.id);
    } else {
      dealsNormais.push(d);
    }
  }

  if (dealsNormais.length > 0) {
    const empRows = dealsNormais.map((d) => mapEmpresa(d, true));
    const empResult = await supaPostGrouped("empresas?on_conflict=pipedrive_id", empRows);
    for (const e of empResult) {
      if (e.pipedrive_id) pidToEid.set(String(e.pipedrive_id), e.id);
    }
  }

  return pidToEid;
}

async function insertSyncLog(
  executadoEm: Date,
  duracao: number,
  total: number,
  detalhes: Record<string, unknown>,
  status = "sucesso",
) {
  await supaPost(
    "sync_log",
    [
      {
        fonte: "pipedrive_contratos",
        executado_em: executadoEm.toISOString(),
        duracao_segundos: duracao,
        total_registros: total,
        detalhes,
        status,
      },
    ],
    "return=minimal",
  );
}

// 'empresas' com mesma unidade+título mas pipedrive_id diferente (2 deals
// pro mesmo cliente). Mantém a linha vinculada a um contrato ativo (a
// "real"); remove as demais.
async function runMergeDuplicates(): Promise<number> {
  const empresas = await supaGet(
    "empresas?select=id,pipedrive_id,titulo,unidade,cnpj&tipo_unidade=eq.franquia&limit=10000",
  );
  const groups = new Map<string, any[]>();
  for (const e of empresas) {
    const titulo = (e.titulo ?? "").trim().toLowerCase();
    if (!titulo) continue;
    const key = `${e.unidade}||${titulo}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }
  const dupGroups = [...groups.entries()].filter(([, v]) => v.length > 1);
  if (dupGroups.length === 0) return 0;

  const contratosAtivos = await supaGet(
    "contratos?select=pipedrive_deal_id&status_contrato=eq.Ativo&pipedrive_deal_id=not.is.null&limit=20000",
  );
  const ativos = new Set(contratosAtivos.map((c) => c.pipedrive_deal_id));

  let removidos = 0;
  for (const [, rows] of dupGroups) {
    const keeper = rows.find((r) => ativos.has(r.pipedrive_id)) ?? rows[0];
    const others = rows.filter((r) => r.id !== keeper.id);
    const cnpjToApply = keeper.cnpj || others.find((r) => r.cnpj)?.cnpj || null;
    const idsToDelete = others.map((r) => r.id);

    if (idsToDelete.length > 0) {
      await supaDelete(`empresas?id=in.(${idsToDelete.join(",")})`);
    }
    if (cnpjToApply && !keeper.cnpj) {
      await supaPatch("empresas", keeper.id, { cnpj: cnpjToApply });
    }
    removidos += idsToDelete.length;
  }
  return removidos;
}

async function runSync() {
  const startTime = new Date();
  console.log(`Sync Pipedrive → Supabase | ${startTime.toISOString()}`);

  const allDeals = await fetchPipelineWonDeals(PIPELINE_VENDAS);
  const deals = allDeals.filter((d) => d.pipeline_id === PIPELINE_VENDAS && !isCopy(d));
  console.log(`${allDeals.length} deals encontrados → ${deals.length} a importar`);

  console.log("Upserting empresas...");
  const pidToEid = await upsertEmpresasSemDuplicarCnpj(deals);
  console.log(`${pidToEid.size} empresas upserted`);

  console.log("Upserting contratos...");
  const contratosComCnpj = await fetchContratosCnpjIndex();
  const contRowsNovoCnpj: Record<string, unknown>[] = [];
  const contRowsPreservaCnpj: Record<string, unknown>[] = [];
  for (const d of deals) {
    const empId = pidToEid.get(String(d.id)) ?? null;
    const row = mapContrato(d, empId);
    if (contratosComCnpj.has(String(d.id))) {
      delete row.cnpj;
      contRowsPreservaCnpj.push(row);
    } else {
      contRowsNovoCnpj.push(row);
    }
  }
  await supaPostGrouped(
    "contratos?on_conflict=pipedrive_deal_id",
    contRowsNovoCnpj,
    "resolution=merge-duplicates,return=minimal",
  );
  await supaPostGrouped(
    "contratos?on_conflict=pipedrive_deal_id",
    contRowsPreservaCnpj,
    "resolution=merge-duplicates,return=minimal",
  );
  const contRows = [...contRowsNovoCnpj, ...contRowsPreservaCnpj];
  console.log(`${contRows.length} contratos upserted (${contRowsPreservaCnpj.length} com CNPJ preservado)`);

  console.log("Verificando deals órfãos / lost (últimos 90 dias)...");
  const cutoff = new Date(startTime.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
  const wonIds = new Set(deals.map((d) => String(d.id)));
  const dbContratos = await supaGet(
    `contratos?select=id,pipedrive_deal_id&pipedrive_deal_id=not.is.null&ganho_em=gte.${cutoff}&limit=2000`,
  );
  const toCheck = dbContratos.filter((c) => !wonIds.has(c.pipedrive_deal_id));
  let lostCount = 0;
  if (toCheck.length > 0) {
    const lostIds: number[] = [];
    for (const c of toCheck) {
      try {
        const d = await pdGet(`/deals/${c.pipedrive_deal_id}`);
        const deal = d.data ?? {};
        if (deal.pipeline_id !== PIPELINE_VENDAS || deal.status === "lost") {
          lostIds.push(c.id);
        }
      } catch {
        // deal individual falhou ao buscar — não bloqueia o resto do sync
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    if (lostIds.length > 0) {
      const dbIdStr = lostIds.join(",");
      await supaPatchFilter(`royalties_itens?contrato_id=in.(${dbIdStr})`, { contrato_id: null });
      await supaPatchFilter(`contrato_omie_grupos?contrato_id=in.(${dbIdStr})`, { contrato_id: null });
      // cac_apuracao_itens.contrato_id também é FK pra contratos.id (achado 10/08/2026 no
      // script local ~/sync_pipedrive_contratos.py — faltava aqui, o DELETE abaixo dava
      // 409/23503 sempre que um contrato lost/wrong_pipeline tinha parcela de CAC vinculada.
      // Sync diário em produção ficou quebrado 11–14/08 por causa disso.
      await supaPatchFilter(`cac_apuracao_itens?contrato_id=in.(${dbIdStr})`, { contrato_id: null });
      await supaDelete(`contratos?id=in.(${dbIdStr})`);
      lostCount = lostIds.length;
    }
  }
  console.log(`${lostCount} deals removidos (wrong_pipeline/lost)`);

  const merged = await runMergeDuplicates();
  console.log(`${merged} duplicata(s) removida(s) em 'empresas'`);

  const elapsed = Math.round((Date.now() - startTime.getTime()) / 1000);
  const result = {
    deals: deals.length,
    empresas: pidToEid.size,
    contratos: contRows.length,
    lost_removidos: lostCount,
    duplicatas_removidas: merged,
    elapsed,
  };
  await insertSyncLog(startTime, elapsed, contRows.length, result);
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
