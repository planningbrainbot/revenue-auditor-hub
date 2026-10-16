// consultoria-plataforma-sync
//
// Espelha no banco único tudo o que a plataforma da Consultoria (Pedro Siqueira) tem sobre as empresas, para a ficha
// de Monetização › Consultoria › Buscar empresa mostrar sem ninguém abrir a plataforma. A API `api-comercial`
// (consultoria-sync) continua sendo a fonte da busca e dos números; esta sync traz o resto: teses uma a uma,
// gestores, canal, prazos, follow-ups, histórico, propostas de todos os status, estoque de crédito mês a mês e as
// faturas e os recebimentos da Consultoria.
//
// Lê o PostgREST da plataforma (Supabase dkgfajxmuyrejxbyqgxn) com o login técnico planning.brain.bot@gmail.com,
// papel Comercial: decisão do Pedro em 16/10/2026. Só leitura do lado de lá. Cada tabela vai inteira para
// ops.consultoria_plataforma_gravar, que grava só o que mudou e marca ausente quem sumiu.
//
// Agendada por pg_cron a cada 15 min (job consultoria-plataforma-sync-15min, migration 20261016120000).
// Segredos: CONSULTORIA_PLAT_URL, CONSULTORIA_PLAT_ANON, CONSULTORIA_PLAT_EMAIL, CONSULTORIA_PLAT_SENHA,
// SINAIS_CRON_SECRET. A senha e o token nunca vão para log nem para o sync_log. Publicar com --no-verify-jwt.
import "../_shared/perfil.ts";
import { caminhoPagina, LIMITE_PAGINAS, linhaEspelho, POR_PAGINA, statusRodada, TABELAS } from "./domain.mjs";

const PLAT = (Deno.env.get("CONSULTORIA_PLAT_URL") ?? "").replace(/\/+$/, "");
const PLAT_ANON = Deno.env.get("CONSULTORIA_PLAT_ANON") ?? "";
const PLAT_EMAIL = Deno.env.get("CONSULTORIA_PLAT_EMAIL") ?? "";
const PLAT_SENHA = Deno.env.get("CONSULTORIA_PLAT_SENHA") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");
const UA = "planning-brain-consultoria-plataforma-sync/1.0";

async function entrar(): Promise<string> {
  const res = await fetch(`${PLAT}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: PLAT_ANON, "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ email: PLAT_EMAIL, password: PLAT_SENHA }),
  });
  if (!res.ok) throw new Error(`login na plataforma da Consultoria: HTTP ${res.status}`);
  const corpo = await res.json();
  if (!corpo?.access_token) throw new Error("login na plataforma da Consultoria: resposta sem token");
  return corpo.access_token;
}

/** Uma tabela inteira da plataforma. O perfil `public` vai explícito: o perfil.ts carimbaria `ops`. */
async function lerTabela(spec: (typeof TABELAS)[number], token: string) {
  const itens: Record<string, unknown>[] = [];
  for (let pagina = 0; pagina < LIMITE_PAGINAS; pagina++) {
    const res = await fetch(`${PLAT}/rest/v1/${caminhoPagina(spec, pagina)}`, {
      headers: {
        apikey: PLAT_ANON,
        Authorization: `Bearer ${token}`,
        "Accept-Profile": "public",
        "User-Agent": UA,
      },
    });
    if (!res.ok) throw new Error(`plataforma ${spec.tabela}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const dados = await res.json();
    if (!Array.isArray(dados)) throw new Error(`plataforma ${spec.tabela}: resposta não é lista`);
    itens.push(...dados);
    if (dados.length < POR_PAGINA) return itens;
  }
  throw new Error(`plataforma ${spec.tabela}: mais de ${LIMITE_PAGINAS} páginas; leitura interrompida.`);
}

async function gravar(tabela: string, linhas: unknown[]) {
  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/consultoria_plataforma_gravar`, {
    method: "POST",
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_tabela: tabela, p_linhas: linhas }),
  });
  const corpo = await res.text();
  if (!res.ok) throw new Error(`gravar ${tabela} → ${res.status}: ${corpo.slice(0, 300)}`);
  return JSON.parse(corpo);
}

async function registrar(inicio: number, status: string, total: number, detalhes: Record<string, unknown>) {
  await fetch(`${SUPA_URL}/rest/v1/sync_log`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{
      fonte: "consultoria_plataforma",
      executado_em: new Date(inicio).toISOString(),
      duracao_segundos: Math.round((Date.now() - inicio) / 1000),
      total_registros: total,
      detalhes,
      status,
    }]),
  });
}

async function sincronizar(trigger: string) {
  if (!PLAT || !PLAT_ANON || !PLAT_EMAIL || !PLAT_SENHA)
    throw new Error("CONSULTORIA_PLAT_URL, _ANON, _EMAIL ou _SENHA ausente nos segredos da função.");
  const inicio = Date.now();
  const token = await entrar();
  const resultados: Record<string, unknown>[] = [];
  // Uma tabela por vez: a leitura inteira leva segundos e não pesa no banco da plataforma.
  for (const spec of TABELAS) {
    try {
      const brutos = await lerTabela(spec, token);
      const linhas = brutos.map((x) => linhaEspelho(spec, x)).filter((x) => x !== null);
      const r = await gravar(spec.tabela, linhas);
      resultados.push({ ...r, descartados: brutos.length - linhas.length });
    } catch (err) {
      console.error(err);
      resultados.push({ tabela: spec.tabela, erro: String(err).slice(0, 300) });
    }
  }
  const status = statusRodada(resultados);
  const total = resultados.reduce((s, r) => s + (Number(r.lidos) || 0), 0);
  const detalhes = { trigger, tabelas: resultados };
  await registrar(inicio, status, total, detalhes);
  return { ok: status !== "erro", status, total, ...detalhes, duracao_segundos: Math.round((Date.now() - inicio) / 1000) };
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const porCron = !!CRON && req.headers.get("x-planning-sinais-cron") === CRON;
  if (!porCron && bearer !== SUPA_KEY)
    return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401 });
  let trigger = porCron ? "cron" : "manual";
  const body = await req.json().catch(() => ({}));
  if (typeof body?.trigger === "string") trigger = body.trigger.slice(0, 20);
  const inicio = Date.now();
  try {
    const r = await sincronizar(trigger);
    return Response.json(r, { status: r.ok ? 200 : 500 });
  } catch (err) {
    console.error(err);
    await registrar(inicio, "erro", 0, { trigger, erro: String(err).slice(0, 500) }).catch(() => {});
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
