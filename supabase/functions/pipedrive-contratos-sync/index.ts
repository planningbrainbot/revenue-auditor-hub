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
// Fonte: Pipedrive pipelines 2 (Inside Sales) e 4 (Negociação - Sócios),
// deals com status=won.
// Para cada deal: upsert em 'empresas' (casando por CNPJ antes de criar
// linha nova) e upsert em 'contratos' (preserva CNPJ já gravado
// manualmente). Remove contratos recentes (<=90 dias) que saíram
// dos dois pipelines ou foram marcados 'lost'. Mescla duplicatas em 'empresas'.
//
// NÃO inclui o backfill de entrada_contrato_assinado_em do script original
// (run_backfill_contrato_assinado) — esse campo não é usado por CAC nem
// royalties (que dependem de ganho_em, mrr_mensal, status_contrato), custa
// uma chamada /flow por deal do stage 170 (~170+ chamadas) e não é crítico
// pro caminho principal. Se precisar dessa data, portar como função
// separada com cadência menor.

import "../_shared/perfil.ts";
const PD_TOKEN = Deno.env.get("PIPEDRIVE_TOKEN")!;
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const PIPELINE_VENDAS = 2;
// Pipeline 4 ("Negociação - Sócios") é a segunda fonte de contratos desde a
// integração do pipe de Sócios — mesmo campo Unidade de Negócio, mesmo
// significado de won. O port original desta função (31/07/2026) trouxe só o
// pipeline 2 e ainda tratava "não é pipeline 2" como motivo de remoção, o que
// deixou 117 deals ganhos de 2026 invisíveis no Ops (28 só em Belém, achado
// em 10/09/2026 na validação por unidade do Placar da Base).
const PIPELINE_SOCIOS = 4;
const VALID_PIPELINES = new Set([PIPELINE_VENDAS, PIPELINE_SOCIOS]);
const ORIGEM_LABELS: Record<number, string> = {
  [PIPELINE_VENDAS]: "inside_sales",
  [PIPELINE_SOCIOS]: "socios",
};

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
  // Unidades novas da Expansao, cadastradas em `unidades` em 16/09/2026.
  // Sem elas o extractUnidade devolvia o id cru e 13 contratos de Sao Bernardo
  // ficaram gravados com unidade = "1055", invisiveis em qualquer leitura por
  // unidade. Corrigidos no mesmo dia.
  "1054": "Recife",
  "1055": "São Bernardo",
  "1056": "Sorocaba",
  // 1124 (BPO Financeiro GYN) fica de fora de proposito: e produto atendido
  // por uma empresa so, nao unidade, e ainda precisa de decisao de modelo.
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

// Os mapas acima são cópias congeladas das opções dos campos de seleção do
// Pipedrive. Quando alguém entra no time e ganha uma opção nova, o id novo não
// está aqui e `extractEnumLabel` devolvia null: o deal sincroniza inteiro, sem
// erro, só com a coluna vazia. Foi o que aconteceu com "Closer Responsável" —
// Anna Carolina (1046), Gabryelly Morais (1058) e Gabriella Oliveira (1126)
// venderam, e o Ops mostrou "—" em 22/09/2026.
//
// Agora as opções são lidas do próprio Pipedrive a cada rodada (uma chamada a
// `/dealFields`) e os mapas ficam só como rede: se a chamada falhar, o sync
// continua com o que sabia antes em vez de zerar as três colunas.
const OPCOES_AO_VIVO: Record<string, Record<string, string>> = {};

async function carregarOpcoesDeSelecao(): Promise<void> {
  const alvos = new Set([CLOSER_FIELD, SDR_FIELD, REGIME_FIELD]);
  try {
    const data = await pdGet(`/dealFields?limit=500`);
    for (const f of (data?.data ?? []) as Record<string, any>[]) {
      if (!alvos.has(f.key)) continue;
      const mapa: Record<string, string> = {};
      for (const o of (f.options ?? []) as Record<string, any>[]) {
        mapa[String(o.id)] = String(o.label);
      }
      if (Object.keys(mapa).length > 0) OPCOES_AO_VIVO[f.key] = mapa;
    }
    console.log(`dealFields: opções carregadas para ${Object.keys(OPCOES_AO_VIVO).length} campos`);
  } catch (e) {
    console.error(`dealFields falhou, seguindo com os rótulos fixos: ${e}`);
  }
}

function extractEnumLabel(
  d: Record<string, unknown>,
  fieldKey: string,
  labels: Record<string, string>,
): string | null {
  const raw = d[fieldKey];
  if (!raw || raw === 0) return null;
  const id = String(raw);
  return OPCOES_AO_VIVO[fieldKey]?.[id] ?? labels[id] ?? null;
}

// ── Dono do deal ─────────────────────────────────────────────────────────
// contratos.pipedrive_owner_email, desde 02/10/2026, para o Hunter Sócio: venda
// do pipe Sócios sem "Unidade de Negócio" cai na unidade do sócio dono do deal
// (só na view v_hunter_socio; contratos.unidade continua o que o Pipedrive diz).
// A lista de deals da v1 às vezes devolve user_id como número, então o e-mail
// sai do cadastro de usuários quando não vem no próprio deal.
let EMAIL_DO_USUARIO = new Map<number, string>();

async function carregarUsuariosDoPipedrive(): Promise<void> {
  const data = await pdGet("/users");
  EMAIL_DO_USUARIO = new Map(
    ((data.data ?? []) as { id: number; email?: string }[])
      .filter((u) => u.email)
      .map((u) => [u.id, String(u.email).toLowerCase()]),
  );
}

function emailDoDono(d: Record<string, unknown>): string | null {
  const dono = d.user_id as { id?: number; email?: string } | number | null | undefined;
  if (dono && typeof dono === "object") {
    if (dono.email) return String(dono.email).toLowerCase();
    return dono.id != null ? (EMAIL_DO_USUARIO.get(Number(dono.id)) ?? null) : null;
  }
  return dono != null ? (EMAIL_DO_USUARIO.get(Number(dono)) ?? null) : null;
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

// Unidade cadastrada pela tela Regras da Rede (/unidades) com a opção do
// Pipedrive preenchida. Lida a cada rodada, então unidade nova deixa de pedir
// mudança neste arquivo: até 01/10/2026 cada uma exigia uma linha em
// UNIDADE_LABELS, e esquecer gravava o id cru (os 13 contratos "1055").
// O mapa fixo continua vencendo nos ids que já conhece: 694 grava "Matriz",
// que é o apelido que a normalização traduz para Goiânia (DECISIONS 18/09).
const UNIDADES_DO_OPS: Record<string, [string, string]> = {};

async function carregarUnidadesDoOps(): Promise<void> {
  try {
    const rows = await supaGet(
      "unidades?select=pipedrive_opcao_id,nome_da_praca,tipo&pipedrive_opcao_id=not.is.null",
    );
    for (const r of rows) {
      if (!r.nome_da_praca) continue;
      UNIDADES_DO_OPS[String(r.pipedrive_opcao_id)] = [
        r.nome_da_praca,
        r.tipo === "interna" ? "matriz" : "franquia",
      ];
    }
    console.log(`unidades: ${Object.keys(UNIDADES_DO_OPS).length} com opção do Pipedrive no cadastro`);
  } catch (e) {
    console.error(`unidades do cadastro falharam, seguindo com o mapa fixo: ${e}`);
  }
}

function extractUnidade(d: Record<string, unknown>): [string | null, string | null] {
  const raw = d[UNIDADE_FIELD];
  if (!raw || raw === 0) return [null, null];
  const uid = String(raw);
  const label = UNIDADE_LABELS[uid];
  if (label === undefined) return UNIDADES_DO_OPS[uid] ?? [uid, null];
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
    origem_pipeline: ORIGEM_LABELS[d.pipeline_id as number] ?? "inside_sales",
    pipedrive_owner_email: emailDoDono(d),
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

// Contratos com MRR fixado à mão (migration 46). O valor do deal no Pipedrive
// nem sempre é o MRR real — o caso que originou isso foi o deal 93810 (Genial
// Energia), cujo valor comercial dava 9,5x o que a apuração de royalties do RJ
// confirma. Quando há override, ele vence o valor do deal.
async function fetchContratosMrrOverride(): Promise<Map<string, number>> {
  const rows = await supaGet(
    "contratos?select=pipedrive_deal_id,mrr_override&mrr_override=not.is.null&pipedrive_deal_id=not.is.null&limit=5000",
  );
  return new Map(
    rows.map((r) => [r.pipedrive_deal_id as string, Number(r.mrr_override)]),
  );
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
      // Campos que pertencem ao Pipefy nao vao no PATCH. O trigger
      // ops.sync_empresa_to_pipefy recusa a escrita com HTTP 400, e como o
      // PATCH acontece ANTES do upsert de contratos, o run inteiro morria: de
      // 17/09/2026 a 18/09/2026 nenhum contrato foi atualizado, e foi assim que
      // a unidade do Grupo Andrade Bezerra ficou divergente do Pipedrive.
      // Quem manda nesses campos e o Pipefy; aqui so seguimos.
      for (const campo of ["titulo", "razao_social", "unidade", "tipo_unidade"]) {
        delete row[campo];
      }
      if (Object.keys(row).length > 0) {
        try {
          await supaPatch("empresas", match.id, row);
        } catch (e) {
          // Uma empresa recusada nao pode derrubar o sync de 600 contratos.
          console.error(`PATCH empresa ${match.id} recusado: ${String(e)}`);
        }
      }
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

// Tabelas com FK empresa_id -> empresas.id. As de delete_rule NO ACTION
// (central_tratativas, contatos, contratos, contratos_documentos,
// cs_onboarding_cards) barravam o DELETE; as de SET NULL se resolveriam
// sozinhas, mas perderiam o vínculo — repontar é mais fiel à ideia de merge.
const EMPRESA_FK_TABELAS = [
  // Tabelas novas do banco unico. Sem elas o DELETE da duplicata dava 409
  // (23503) e derrubava o sync inteiro: base_sync_registros segurou o run de
  // 18/09/2026 na empresa 35995.
  "base_alteracoes",
  "base_sync_registros",
  "monetizacao_ingest_pendencias",
  "central_tratativas",
  "contatos",
  "contratos",
  "contratos_documentos",
  "cs_onboarding_cards",
  "ecd_empresa",
  "empresa_cnpj_de_para",
  "nps_pesquisas",
];

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
      // Mesclar é repontar, não só apagar: o DELETE dava 409/23503 sempre que
      // a duplicata já tinha contrato/card/tratativa pendurado (achado em
      // 10/09/2026, quando o pipeline 4 trouxe dois deals da mesma Rocha
      // Distribuidora). As linhas pertencem à empresa que fica.
      const idStr = idsToDelete.join(",");
      for (const tabela of EMPRESA_FK_TABELAS) {
        await supaPatchFilter(`${tabela}?empresa_id=in.(${idStr})`, { empresa_id: keeper.id });
      }
      await supaDelete(`empresas?id=in.(${idStr})`);
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

  await carregarOpcoesDeSelecao();
  await carregarUnidadesDoOps();
  await carregarUsuariosDoPipedrive();

  // A API do Pipedrive devolve deals de outros pipelines ao filtrar por
  // pipeline_id, então o pipeline_id do response é revalidado nos dois casos.
  const allVendas = await fetchPipelineWonDeals(PIPELINE_VENDAS);
  const dealsVendas = allVendas.filter((d) => d.pipeline_id === PIPELINE_VENDAS && !isCopy(d));
  const allSocios = await fetchPipelineWonDeals(PIPELINE_SOCIOS);
  const dealsSocios = allSocios.filter((d) => d.pipeline_id === PIPELINE_SOCIOS);
  const deals = [...dealsVendas, ...dealsSocios];
  console.log(
    `pipeline ${PIPELINE_VENDAS}: ${allVendas.length} encontrados → ${dealsVendas.length} | ` +
      `pipeline ${PIPELINE_SOCIOS}: ${allSocios.length} → ${dealsSocios.length} | ` +
      `${deals.length} a importar`,
  );

  console.log("Upserting empresas...");
  const pidToEid = await upsertEmpresasSemDuplicarCnpj(deals);
  console.log(`${pidToEid.size} empresas upserted`);

  console.log("Upserting contratos...");
  const contratosComCnpj = await fetchContratosCnpjIndex();
  const mrrOverrides = await fetchContratosMrrOverride();
  const contRowsNovoCnpj: Record<string, unknown>[] = [];
  const contRowsPreservaCnpj: Record<string, unknown>[] = [];
  for (const d of deals) {
    const empId = pidToEid.get(String(d.id)) ?? null;
    const row = mapContrato(d, empId);
    const override = mrrOverrides.get(String(d.id));
    if (override != null && Number.isFinite(override)) row.mrr = override;
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
  console.log(
    `${contRows.length} contratos upserted ` +
      `(${contRowsPreservaCnpj.length} com CNPJ preservado, ${mrrOverrides.size} com MRR override)`,
  );

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
        if (!VALID_PIPELINES.has(deal.pipeline_id as number) || deal.status === "lost") {
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
