/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Base nova da Monetização: pipe 40 (Onboarding | Diagnóstico de Oportunidades). Pedido do Pedro em 16/10/2026;
// PRD https://claude.ai/artifact/9SapRMdQ3ydy8srToQ7NSn. Lógica em logica.ts (testada no Node:
// tests/monetizacao-diagnostico.test.mjs), régua de tarefas em regua.ts, estado nas tabelas
// ops.monetizacao_diagnostico_* (migration 20261016180000_monetizacao_diagnostico.sql).
//
// Roda pelo cron a cada 5 minutos (cabeçalho x-monetizacao-sync), com {"action":"rodar"}; {"dry": true} força as
// duas chaves desligadas.
//
// Como ligar (só com o "pode ativar" do Pedro, depois de Matheus e Jordana lerem o Guia do Diagnóstico):
// 1. supabase functions deploy monetizacao-diagnostico --no-verify-jwt   (antes da migration, que liga o cron)
// 2. A carga do pipe 40 roda sempre: só lê o Pipedrive.
// 3. MONET_DIAG_INICIO=<instante ISO>: só entrada em etapa depois dele recebe tarefa. Sem ele, nenhuma nasce.
// 4. MONET_DIAG_ENTRADA_ATIVA=sim: cliente do onboarding do CS que passou do kickoff, com fit pela venda, vira card
//    no pipe 40 (21/10/2026; antes era a venda ganha no Inside Sales). Qualquer outro valor: só prévia.
// 5. MONET_DIAG_TAREFAS_ATIVA=sim: as etapas criam e apagam tarefas e a etapa 04 grava D0 e prazo. Senão, só prévia.
// 7. MONET_DIAG_CADASTRO_CONSULTORIA=sim (22/10/2026): no dia em que o cliente entra no pipe 40, quem tem perfil de
//    Consultoria e ainda não tem projeto com o CNPJ é cadastrado na plataforma da Consultoria, pela mesma função do
//    formulário do parceiro (fn_projeto_registrar_parceiro), como Carteira BPO, canal Máquina de Vendas Comercial BPO,
//    Diagnóstico Curva B e C. Entra com o usuário do Pedro (CONSULTORIA_CADASTRO_EMAIL e _SENHA, decisão dele em
//    22/10/2026; a senha ele grava no Supabase); sem o par, usa o login técnico (CONSULTORIA_PLAT_*), que é só de leitura
//    e alimenta o espelho da plataforma. Desligada: confere se já há projeto e deixa o cadastro "pendente".
// 6. MONET_DIAG_UNIDADES_PAUSADAS (lista separada por vírgula, ex.: "Belém"): o card dessas unidades nasce com a nota
//    fixada "Pausado em", sem tarefa, até o sócio liberar a lista.
// Usa PIPEDRIVE_TOKEN e MONETIZACAO_SYNC_SECRET, os mesmos das outras funções da Monetização.
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import {
  rodarDiagnostico,
  type ConsultoriaDiagnostico,
  type LinhaTarefa,
  type PipedriveDiagnostico,
  type StoreDiagnostico,
} from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ENTRADA_ATIVA = Deno.env.get("MONET_DIAG_ENTRADA_ATIVA") === "sim";
const TAREFAS_ATIVA = Deno.env.get("MONET_DIAG_TAREFAS_ATIVA") === "sim";
const INICIO = Deno.env.get("MONET_DIAG_INICIO") || null;
const UNIDADES_PAUSADAS = (Deno.env.get("MONET_DIAG_UNIDADES_PAUSADAS") || "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean);
const CADASTRO_CONSULTORIA = Deno.env.get("MONET_DIAG_CADASTRO_CONSULTORIA") === "sim";
const PLAT_URL = Deno.env.get("CONSULTORIA_PLAT_URL");
const PLAT_ANON = Deno.env.get("CONSULTORIA_PLAT_ANON");
// O cadastro entra com o usuário do Pedro quando o par está completo; senão, com o login técnico de leitura.
const CADASTRO_EMAIL = Deno.env.get("CONSULTORIA_CADASTRO_EMAIL");
const CADASTRO_SENHA = Deno.env.get("CONSULTORIA_CADASTRO_SENHA");
const PLAT_EMAIL =
  CADASTRO_EMAIL && CADASTRO_SENHA ? CADASTRO_EMAIL : Deno.env.get("CONSULTORIA_PLAT_EMAIL");
const PLAT_SENHA =
  CADASTRO_EMAIL && CADASTRO_SENHA ? CADASTRO_SENHA : Deno.env.get("CONSULTORIA_PLAT_SENHA");
/** Parceiro "Carteira BPO" e canal "Máquina de Vendas Comercial BPO" do catálogo da plataforma (22/10/2026). */
const PLAT_PARCEIRO =
  Deno.env.get("MONET_DIAG_CONSULTORIA_PARCEIRO_ID") || "39bc9f08-9a9d-4ecd-b574-c552824af930";
const PLAT_CANAL =
  Deno.env.get("MONET_DIAG_CONSULTORIA_CANAL_ID") || "77443e0b-98a0-4150-8059-ea2aee120684";

const { pd, pages } = pipedriveApi(PD);

/** Pipedrive sem o token na mensagem de erro; DELETE e PUT sem corpo de retorno obrigatório. */
async function bruto(metodo: string, url: string, corpo?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: metodo,
    headers: { "Content-Type": "application/json" },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (body && body.success === false) throw new Error("Pipedrive não confirmou a operação");
  return body;
}
const v1 = (path: string) =>
  `https://api.pipedrive.com/v1/${path}?${new URLSearchParams({ api_token: PD })}`;

const pipedrive: PipedriveDiagnostico = {
  get: (path, params = {}) => pd(path, params as Record<string, string>),
  pages: (path, params = {}) => pages(path, params as Record<string, string>),
  v2: (path, params = {}) => {
    const q = new URLSearchParams({ api_token: PD });
    for (const [k, v] of Object.entries(params)) if (v != null) q.set(k, String(v));
    return bruto("GET", `https://api.pipedrive.com/api/v2/${path}?${q}`);
  },
  post: (path, payload) => pd(path, {}, payload),
  put: (path, payload) => bruto("PUT", v1(path), payload),
  del: async (path) => void (await bruto("DELETE", v1(path))),
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

const chaveDa = (l: Pick<LinhaTarefa, "deal_id" | "entrou_em" | "chave">) =>
  `deal_id=eq.${Number(l.deal_id)}&entrou_em=eq.${encodeURIComponent(l.entrou_em)}&chave=eq.${encodeURIComponent(l.chave)}`;

const store: StoreDiagnostico = {
  cardsAtuais: async () =>
    ((await rest("monetizacao_diagnostico_deals?select=payload&limit=5000")) || []).map(
      (r: any) => r.payload,
    ),
  gravarRetrato: async (retrato) => {
    await rest("rpc/monetizacao_diagnostico_gravar", {
      body: { _retrato: retrato },
      prefer: "return=minimal",
    });
  },
  entradas: () =>
    rest(
      "monetizacao_diagnostico_entradas?select=venda_id,org_id,deal_id,status,consultoria,consultoria_cnpj,consultoria_em&limit=10000",
    ),
  atualizarEntrada: async (vendaId, patch) => {
    await rest(`monetizacao_diagnostico_entradas?venda_id=eq.${Number(vendaId)}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=minimal",
    });
  },
  inserirEntrada: async (linha) => {
    await rest("monetizacao_diagnostico_entradas?on_conflict=venda_id", {
      body: linha,
      prefer: "resolution=ignore-duplicates,return=minimal",
    });
  },
  // Venda achada pelo CNPJ ou pelo nome quando o Handoff não liga o card do onboarding a uma venda (23/10/2026).
  vinculos: () => rest("monetizacao_diagnostico_vinculos?select=*&limit=10000"),
  gravarVinculo: async (v) => {
    await rest("monetizacao_diagnostico_vinculos?on_conflict=pipefy_card_id", {
      body: v,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  },
  // O espelho do Handoff da Consultoria liga o card do onboarding à venda; as fases vêm do espelho do onboarding do CS.
  onboarding: async () => {
    const [handoff, cs] = await Promise.all([
      rest(
        "handoff_consultoria_onboarding?select=pipefy_card_id,titulo,unidade,fase_atual,pipedrive_deal_id,cnpj&ausente_desde=is.null&limit=10000",
      ),
      rest("cs_onboarding_cards?select=pipefy_card_id,fase_atual,fases_history&limit=10000"),
    ]);
    const fases = new Map((cs || []).map((r: any) => [String(r.pipefy_card_id), r]));
    return (handoff || []).map((h: any) => {
      const o: any = fases.get(String(h.pipefy_card_id));
      return {
        pipefy_card_id: String(h.pipefy_card_id),
        titulo: String(h.titulo ?? "").trim(),
        unidade: h.unidade ?? null,
        fase_atual: o?.fase_atual ?? h.fase_atual ?? null,
        fases: (Array.isArray(o?.fases_history) ? o.fases_history : []).map((x: any) => ({
          fase: String(x.fase),
          entrou_em: x.entrou_em ?? null,
        })),
        pipedrive_deal_id: Number(h.pipedrive_deal_id) || null,
        cnpj: h.cnpj ?? null,
      };
    });
  },
  liberarEtapa: async (dealId, etapa) => {
    await rest(
      `monetizacao_diagnostico_tarefas?deal_id=eq.${Number(dealId)}&etapa=eq.${Number(etapa)}&status=in.(feita,apagada)`,
      { method: "DELETE", prefer: "return=minimal" },
    );
  },
  tarefas: () =>
    rest(
      `monetizacao_diagnostico_tarefas?or=${encodeURIComponent('(status.in.(aberta,pausada),criado_em.gte."' + new Date(Date.now() - 90 * 86400000).toISOString() + '")')}&select=*&limit=20000`,
    ),
  inserirTarefa: async (linha) => {
    const r = await rest("monetizacao_diagnostico_tarefas?on_conflict=deal_id,entrou_em,chave", {
      body: linha,
      prefer: "resolution=ignore-duplicates,return=representation",
    });
    return Array.isArray(r) && r.length > 0;
  },
  atualizarTarefa: async (l, patch) => {
    await rest(`monetizacao_diagnostico_tarefas?${chaveDa(l)}`, {
      method: "PATCH",
      body: patch,
      prefer: "return=minimal",
    });
  },
};

// ---------------------------------------------------------------------------- plataforma da Consultoria

let sessaoPlataforma: { token: string; expira: number } | null = null;
async function plataforma(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<any> {
  if (!PLAT_URL || !PLAT_ANON || !PLAT_EMAIL || !PLAT_SENHA)
    throw new Error("login técnico da plataforma não configurado");
  if (!sessaoPlataforma || sessaoPlataforma.expira < Date.now() + 60_000) {
    const res = await fetch(`${PLAT_URL}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: PLAT_ANON, "Content-Type": "application/json" },
      body: JSON.stringify({ email: PLAT_EMAIL, password: PLAT_SENHA }),
      signal: AbortSignal.timeout(20000),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.access_token) throw new Error(`login na plataforma: HTTP ${res.status}`);
    sessaoPlataforma = {
      token: body.access_token,
      expira: Date.now() + Number(body.expires_in ?? 3600) * 1000,
    };
  }
  const res = await fetch(`${PLAT_URL}/rest/v1/${path}`, {
    method: init.method || (init.body === undefined ? "GET" : "POST"),
    headers: {
      apikey: PLAT_ANON,
      Authorization: `Bearer ${sessaoPlataforma!.token}`,
      "Content-Type": "application/json",
      "Accept-Profile": "public",
      "Content-Profile": "public",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`plataforma ${path.split("?")[0]}: ${body?.message || res.status}`);
  return body;
}

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

const consultoria: ConsultoriaDiagnostico = {
  temProjeto: async (cnpj) => {
    const linhas = await plataforma(
      `projetos_gestao?select=cnpj,departamento&cnpj_raiz=eq.${cnpj.slice(0, 8)}&limit=200`,
    );
    return (linhas || []).some(
      (l: any) => soDigitos(l.cnpj) === cnpj && l.departamento === "diagnostico_tributario",
    );
  },
  // O mesmo caminho do formulário "Cadastrar novo projeto" (planningtax-system.com.br/parceiro/novo): código do projeto
  // pela raiz do CNPJ e a função fn_projeto_registrar_parceiro.
  registrar: async ({ cnpj, razao_social, observacoes }) => {
    const raiz = cnpj.slice(0, 8);
    const jaTem = await plataforma(`projetos_gestao?select=codserv&cnpj_raiz=eq.${raiz}&limit=500`);
    const usados = new Set((jaTem || []).map((l: any) => String(l.codserv)));
    let n = (jaTem?.length ?? 0) + 1;
    while (usados.has(`${raiz}-${String(n).padStart(2, "0")}`)) n++;
    const linhas = await plataforma("rpc/fn_projeto_registrar_parceiro", {
      body: {
        p_razao_social: razao_social,
        p_codserv: `${raiz}-${String(n).padStart(2, "0")}`,
        p_departamento: "diagnostico_tributario",
        p_produto: "Diagnóstico de oportunidades - Curva B e C",
        p_categoria: "curva_b_c",
        p_cnpj: cnpj,
        p_observacoes: observacoes,
        p_canal_venda_id: PLAT_CANAL,
        p_parceiro_id: PLAT_PARCEIRO,
        p_confirmado: true,
        p_documentos_liberados: false,
      },
    });
    const r = Array.isArray(linhas) ? linhas[0] : linhas;
    if (!r?.projeto_id) throw new Error(`a plataforma respondeu ${r?.resultado ?? "sem projeto"}`);
    return { projeto_id: String(r.projeto_id) };
  },
};

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
    const dry = body.dry === true;
    const resumo = await rodarDiagnostico({
      pd: pipedrive,
      store,
      agora: new Date(),
      entradaAtiva: ENTRADA_ATIVA && !dry,
      tarefasAtiva: TAREFAS_ATIVA && !dry,
      inicio: INICIO,
      unidadesPausadas: UNIDADES_PAUSADAS,
      consultoria: PLAT_URL ? consultoria : undefined,
      cadastroConsultoria: CADASTRO_CONSULTORIA && !dry,
    });
    return json(resumo);
  } catch (e) {
    const mensagem = (e as Error).message;
    await rest("monetizacao_diagnostico_sync?id=eq.true", {
      method: "PATCH",
      body: {
        status: "error",
        error: mensagem.slice(0, 500),
        tentado_em: new Date().toISOString(),
      },
      prefer: "return=minimal",
    }).catch(() => {});
    return json({ status: "erro", error: mensagem }, 500);
  }
});
