/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Envio dos negócios da Cella para o Pipedrive da Diehl & Cella. Lógica em logica.ts (testada no Node:
// tests/monetizacao-cella-envio.test.mjs); estado em ops.monetizacao_cella_envios e o registro de cada envio em
// ops.monetizacao_cella_envios_log (migration 20261022170000_monetizacao_cella_envio.sql).
//
// Lê o espelho dos pipes 39 e 40 que a carga do Brain já mantém (ops.monetizacao_deals e
// ops.monetizacao_diagnostico_deals). O Pipedrive da Planning só é chamado para o "Caixa · Produtos contratados" de card
// ganho e para empresa e contato quando o negócio vai ser criado do lado deles.
//
// Roda pelo cron a cada 5 minutos (cabeçalho x-monetizacao-sync), com {"action":"rodar"}; {"dry": true} força a prévia.
//
// Como ligar (só com o "pode ativar" do Pedro):
// 1. supabase functions deploy monetizacao-cella-envio --no-verify-jwt   (antes da migration, que liga o cron)
// 2. CELLA_PIPEDRIVE_TOKEN: token da API do usuário da Maiara no Pipedrive da Diehl & Cella (admin; o envio só toca o
//    funil 9). Fica no Keychain do Mac do Pedro (serviço cella-pipedrive-api-token) e nos secrets do projeto.
// 3. MONET_CELLA_ENVIO_ATIVO=sim: grava no Pipedrive deles. Qualquer outro valor: só prévia, registrada no log.
// Usa PIPEDRIVE_TOKEN e MONETIZACAO_SYNC_SECRET, os mesmos das outras funções da Monetização.
import { pipedriveApi } from "../monetizacao-crm/pipedrive.mjs";
import {
  detalheDe,
  fonte39,
  fonte40,
  rodarCella,
  type Cella,
  type Estado,
  type Planning,
  type Store,
} from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const CELLA_TOKEN = Deno.env.get("CELLA_PIPEDRIVE_TOKEN") || "";
const SEGREDO = Deno.env.get("MONETIZACAO_SYNC_SECRET");
const ATIVO = Deno.env.get("MONET_CELLA_ENVIO_ATIVO") === "sim";

const { pd } = pipedriveApi(PD);

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

// ---------------------------------------------------------------------------- Pipedrive da Planning (leitura)

let rotulosFaixa: Map<number, string> | null = null;
async function rotuloFaixa(): Promise<(id: number) => string | null> {
  if (!rotulosFaixa) {
    const campos = (await pd("dealFields", { limit: "500" })).data || [];
    const faixa = campos.find((c: any) => c.key === "b92a608454a6648327f24c5cc3bf87a95bb7fbcd");
    rotulosFaixa = new Map((faixa?.options || []).map((o: any) => [Number(o.id), String(o.label)]));
  }
  return (id) => rotulosFaixa!.get(id) ?? null;
}

const planning: Planning = {
  contratados: async (dealId) => {
    const d = (await pd(`deals/${dealId}`)).data;
    const v = String(d?.["35e4390b926cf597266c53e0a7cc55b0ddc9091d"] ?? "").trim();
    return v ? v.split(",").map(Number).filter(Boolean) : null;
  },
  detalhe: async (dealId) => {
    const d = (await pd(`deals/${dealId}`)).data;
    const orgId = Number(d?.org_id?.value ?? d?.org_id) || null;
    const pessoaId = Number(d?.person_id?.value ?? d?.person_id) || null;
    const [org, pessoa, rotulo] = await Promise.all([
      orgId ? pd(`organizations/${orgId}`).then((b: any) => b.data) : null,
      pessoaId ? pd(`persons/${pessoaId}`).then((b: any) => b.data) : null,
      rotuloFaixa(),
    ]);
    return detalheDe(d, org, pessoa, rotulo);
  },
};

// ---------------------------------------------------------------------------- Pipedrive da Diehl & Cella

async function cellaApi(
  metodo: string,
  path: string,
  corpo?: unknown,
  params: Record<string, string> = {},
): Promise<any> {
  if (!CELLA_TOKEN) throw new Error("CELLA_PIPEDRIVE_TOKEN não configurado");
  const q = new URLSearchParams(params);
  const res = await fetch(`https://api.pipedrive.com/v1/${path}${q.size ? `?${q}` : ""}`, {
    method: metodo,
    headers: { "Content-Type": "application/json", "x-api-token": CELLA_TOKEN },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(25000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Pipedrive da Cella HTTP ${res.status}`);
  const body = await res.json().catch(() => null);
  if (body && body.success === false)
    throw new Error("Pipedrive da Cella não confirmou a operação");
  return body;
}

const primeiroItem = (b: any): number | null => Number(b?.data?.items?.[0]?.item?.id) || null;

const cella: Cella = {
  negocio: async (id) => {
    const b = await cellaApi("GET", `deals/${id}`);
    return b?.data ? { status: String(b.data.status), stage_id: Number(b.data.stage_id) } : null;
  },
  atualizarNegocio: async (id, patch) => void (await cellaApi("PUT", `deals/${id}`, patch)),
  acharOrganizacao: async (cnpj, nome) => {
    if (cnpj) {
      const porCnpj = primeiroItem(
        await cellaApi("GET", "organizations/search", undefined, {
          term: cnpj,
          fields: "custom_fields",
          exact_match: "true",
        }),
      );
      if (porCnpj) return porCnpj;
    }
    if (!nome || nome.length < 3) return null;
    return primeiroItem(
      await cellaApi("GET", "organizations/search", undefined, {
        term: nome,
        fields: "name",
        exact_match: "true",
      }),
    );
  },
  criarOrganizacao: async (corpo) =>
    Number((await cellaApi("POST", "organizations", corpo)).data.id),
  acharPessoa: async (email) =>
    email
      ? primeiroItem(
          await cellaApi("GET", "persons/search", undefined, {
            term: email,
            fields: "email",
            exact_match: "true",
          }),
        )
      : null,
  criarPessoa: async (corpo) => Number((await cellaApi("POST", "persons", corpo)).data.id),
  criarNegocio: async (corpo) => Number((await cellaApi("POST", "deals", corpo)).data.id),
  criarAtividade: async (corpo) => Number((await cellaApi("POST", "activities", corpo)).data.id),
};

// ---------------------------------------------------------------------------- estado

const COLUNAS = [
  "deal_id",
  "pipe",
  "vinculo",
  "estado",
  "cella_deal_id",
  "cella_org_id",
  "cella_person_id",
  "cella_activity_id",
  "status_deles",
  "hash",
  "ultimo_evento",
  "simulado_hash",
  "simulado",
  "enviado_em",
  "erro",
  "atualizado_em",
];

const store: Store = {
  salvar: async (e) => {
    const linha = Object.fromEntries(COLUNAS.filter((c) => c in e).map((c) => [c, (e as any)[c]]));
    await rest("monetizacao_cella_envios?on_conflict=deal_id", {
      body: linha,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  },
  log: async (l) => {
    await rest("monetizacao_cella_envios_log", { body: l, prefer: "return=minimal" });
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
    const ativo = ATIVO && body.dry !== true;
    const [p39, p40, estados] = await Promise.all([
      rest("monetizacao_deals?select=payload&limit=10000"),
      rest("monetizacao_diagnostico_deals?select=payload&limit=10000"),
      rest("monetizacao_cella_envios?select=*&limit=10000"),
    ]);
    const fontes = [
      ...(p39 || []).map((r: any) => fonte39(r.payload)),
      ...(p40 || []).map((r: any) => fonte40(r.payload)),
    ].filter(
      (f) => f.deal_id && (f.cella || estados?.some((e: any) => Number(e.deal_id) === f.deal_id)),
    );
    const resumo = await rodarCella({
      fontes,
      estados: new Map((estados || []).map((e: any) => [Number(e.deal_id), e as Estado])),
      planning,
      cella,
      store,
      ativo,
      agora: new Date(),
    });
    await rest("monetizacao_cella_sync?on_conflict=id", {
      body: {
        id: true,
        status: resumo.erros.length ? "parcial" : "ok",
        resumo,
        rodado_em: new Date().toISOString(),
        erro: null,
      },
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return json(resumo);
  } catch (e) {
    const mensagem = (e as Error).message;
    await rest("monetizacao_cella_sync?on_conflict=id", {
      body: {
        id: true,
        status: "erro",
        erro: mensagem.slice(0, 500),
        rodado_em: new Date().toISOString(),
      },
      prefer: "resolution=merge-duplicates,return=minimal",
    }).catch(() => {});
    return json({ status: "erro", error: mensagem }, 500);
  }
});
