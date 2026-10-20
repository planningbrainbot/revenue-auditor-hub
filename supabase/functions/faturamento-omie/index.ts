/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do PostgREST chega sem tipo. */
// faturamento-omie: o conector do Omie do Portal de Faturamento (T2 da E1, 20/10/2026). Processa a fila
// integracoes.omie_envios: garantir cliente, incluir/alterar OS, faturar, ler status e sincronizar o catálogo.
// A lógica (montagem do Omie, simulação, erros, idempotência, fila) está em logica.ts, testada no Node em
// tests/faturamento-omie.test.mjs. Aqui só se liga a lógica ao banco e ao fetch.
//
// Banco: as RPCs do conector (API.md §2) vivem em `integracoes`, que não é exposto no PostgREST. A edge chama as
// funções de passagem em `ops` (ops.fat_conector_*, mesmas assinaturas, executáveis só pelo service_role), com
// Content-Profile/Accept-Profile: ops, como as outras edges.
//
// Travas: toda emissora nasce em modo_omie = 'simular' e o envio carrega o modo do momento em que entrou na fila.
// Em simulação o conector só lê o Omie e grava `simulado` com o param que iria. Gravar depende do "pode ativar" do
// Pedro (ops.fat_emissora_config, só o admin).
//
// Quem chama:
// - pg_cron a cada 2 minutos: {"acao":"processar"} (migration 20261020160000_portal_faturamento_conector_cron.sql);
// - pg_cron de 4 em 4 horas em dia útil: {"acao":"enfileirar_status"} (integracoes.fat_status_enfileirar, depois
//   processa a fila);
// - alguém com a chave de serviço, para rodar na hora. {"limite": n} reduz o máximo da rodada.
// Autenticação: Authorization: Bearer <service_role> ou x-faturamento-cron: <segredo faturamento_cron_secret do Vault,
// o mesmo valor do segredo FATURAMENTO_CRON_SECRET da edge>. Publicar com --no-verify-jwt.
//
// A chave do Omie é lida por ops.fat_conector_credencial → integracoes.omie_credencial (só service_role) e fica só em memória: nunca vai para
// resposta, log, ops.sync_log ou erro.
import { autorizado, cortar, MAX_POR_RODADA, rodarFila, VERSAO } from "./logica.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("FATURAMENTO_CRON_SECRET") ?? null;
const FONTE_LOG = "omie-faturamento";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

class ErroBanco extends Error {
  code: string | null;
  http: number;
  constructor(http: number, code: string | null, mensagem: string) {
    super(mensagem);
    this.name = "ErroBanco";
    this.http = http;
    this.code = code;
  }
}

/** Função de passagem do conector em `ops` (ops.fat_conector_<nome>), pelo PostgREST com a chave de serviço. */
async function rpc(nome: string, args: Record<string, unknown>) {
  const fn = `fat_conector_${nome}`;
  const schema = "ops";
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
      "Accept-Profile": schema,
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(30000),
  });
  const texto = await r.text();
  let corpo: any = null;
  try {
    corpo = texto ? JSON.parse(texto) : null;
  } catch {
    corpo = texto;
  }
  if (!r.ok) {
    // PGRST202: a função de passagem ainda não existe (ou mudou de assinatura) em ops.
    const msg =
      typeof corpo === "object" && corpo
        ? `${corpo.code ?? r.status}: ${corpo.message ?? ""}`
        : String(texto);
    throw new ErroBanco(
      r.status,
      typeof corpo === "object" && corpo ? (corpo.code ?? null) : null,
      `${schema}.${fn}: ${cortar(msg, 300)}`,
    );
  }
  return corpo;
}

async function registrar(
  inicio: number,
  status: "sucesso" | "erro",
  total: number,
  detalhes: Record<string, unknown>,
) {
  await fetch(`${URL_BASE}/rest/v1/sync_log`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      "Content-Profile": "ops",
      Prefer: "return=minimal",
    },
    body: JSON.stringify([
      {
        fonte: FONTE_LOG,
        executado_em: new Date(inicio).toISOString(),
        duracao_segundos: Math.round((Date.now() - inicio) / 1000),
        total_registros: total,
        detalhes,
        status,
      },
    ]),
    signal: AbortSignal.timeout(15000),
  }).catch(() => {});
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const transporte = async (url: string, corpo: string) => {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "planning-brain-faturamento-omie/1.0",
    },
    body: corpo,
    signal: AbortSignal.timeout(60000),
  });
  return { status: r.status, texto: await r.text() };
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);
  if (!autorizado(req.headers, SERVICE, CRON)) return json({ error: "Não autorizado" }, 401);

  let corpo: Record<string, any> = {};
  try {
    corpo = await req.json();
  } catch {
    /* corpo vazio = processar */
  }
  const acao = String(corpo?.acao ?? "processar");
  if (acao !== "processar" && acao !== "enfileirar_status")
    return json({ error: `Ação inválida: ${acao}` }, 400);
  const limite =
    Number.isInteger(corpo?.limite) && corpo.limite > 0
      ? Math.min(corpo.limite, MAX_POR_RODADA)
      : MAX_POR_RODADA;
  const inicio = Date.now();

  try {
    let enfileirados: unknown = null;
    if (acao === "enfileirar_status") enfileirados = await rpc("status_enfileirar", {});

    const resumo = await rodarFila({
      reservar: async (n) => (await rpc("envio_proximos", { p_limite: n })) ?? [],
      responder: (envio, r) =>
        rpc("envio_resultado", {
          p_envio: envio,
          p_status: r.status,
          p_resposta: r.resposta,
          p_erro_legivel: r.erro_legivel,
          p_codigos: r.codigos ?? {},
        }),
      credencial: (emissora) => rpc("credencial", { p_emissora: emissora }),
      statusAplicar: (pedido, status) =>
        rpc("status_aplicar", { p_pedido: pedido, p_status: status }),
      servicosAplicar: (emissora, catalogo) =>
        rpc("servicos_aplicar", { p_emissora: emissora, p_catalogo: catalogo }),
      transporte,
      dormir,
      maxEnvios: limite,
    });

    // Rodada vazia não vai para o log (o cron roda 720 vezes por dia).
    if (resumo.reservados > 0 || enfileirados != null || resumo.erros_banco.length) {
      await registrar(inicio, resumo.erros_banco.length ? "erro" : "sucesso", resumo.reservados, {
        versao: VERSAO,
        acao,
        origem: corpo?.origem ?? null,
        enfileirados,
        por_status: resumo.por_status,
        envios: resumo.envios,
        emissoras_paradas: resumo.emissoras_paradas,
        erros_banco: resumo.erros_banco,
      });
    }
    // Só o resumo: nenhuma resposta de envio (payload) sai daqui.
    console.log(
      JSON.stringify({
        fonte: FONTE_LOG,
        acao,
        reservados: resumo.reservados,
        por_status: resumo.por_status,
      }),
    );
    return json({ ok: true, versao: VERSAO, acao, enfileirados, resumo });
  } catch (e) {
    const erro = cortar((e as Error)?.message ?? e, 400);
    await registrar(inicio, "erro", 0, { versao: VERSAO, acao, erro });
    console.error(JSON.stringify({ fonte: FONTE_LOG, acao, erro }));
    return json({ ok: false, versao: VERSAO, erro }, 500);
  }
});
