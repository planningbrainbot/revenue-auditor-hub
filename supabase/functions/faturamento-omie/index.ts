/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do PostgREST chega sem tipo. */
// faturamento-omie: o conector do Omie e do Pipefy do Portal de Faturamento (T2 e T3 da E1, 20/10/2026).
// 1. Fila integracoes.omie_envios: garantir cliente, incluir/alterar OS, faturar, ler status e sincronizar o catálogo,
//    os contratos e as notas de contrato do recorrente (lógica em logica.ts, testes em tests/faturamento-omie.test.mjs).
// 2. Depois, na mesma rodada, a fila integracoes.pipefy_envios: criar o card no pipe 307098392 e movê-lo a cada
//    situação (lógica em pipefy.ts, testes em tests/faturamento-pipefy.test.mjs). Com pipefy_sync = false (todas hoje),
//    as mutations ficam montadas e validadas, e nenhuma sai.
// 3. Por fim, a fila integracoes.notificacoes (e-mails do RF-P12, lógica em notificacoes.ts). Sem FATURAMENTO_EMAIL=sim
//    na env da edge, nada sai: a notificação fica `simulado` com o e-mail pronto. Envio pelo SendGrid
//    (SENDGRID_API_KEY), remetente noreply@planningbrain.com.br.
// Aqui só se liga a lógica ao banco e ao fetch.
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
import {
  autorizado,
  criarOmie,
  cortar,
  MAX_POR_RODADA,
  rodarFila,
  type Ritmo,
  VERSAO,
} from "./logica.ts";
import { PIPEFY_URL, rodarFilaPipefy } from "./pipefy.ts";
import { corpoSendgrid, type Email, rodarFilaNotificacoes } from "./notificacoes.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("FATURAMENTO_CRON_SECRET") ?? null;
const PIPEFY_TOKEN = Deno.env.get("PIPEFY_TOKEN") ?? null;
/** Tempo de cada fila na rodada: as duas cabem antes do próximo cron (2 min) e do limite da edge (150 s). */
const ORCAMENTO_OMIE_MS = 55_000;
const ORCAMENTO_PIPEFY_MS = 20_000;
const ORCAMENTO_NOTIFICACOES_MS = 10_000;
/**
 * Prazo duro da execução: nenhuma chamada (Omie, Pipefy, SendGrid) passa de 110 s depois do início, bem antes dos
 * 150 s da edge e dos 120 s do cron. Cada fila para de reservar antes disso.
 */
const PRAZO_EXECUCAO_MS = 110_000;
const PARA_DE_RESERVAR_PIPEFY_MS = 90_000;
const PARA_DE_RESERVAR_NOTIFICACOES_MS = 100_000;
const SENDGRID = Deno.env.get("SENDGRID_API_KEY") ?? null;
/** Trava do e-mail: só "sim" literal liga o envio. */
const EMAIL_LIGADO = Deno.env.get("FATURAMENTO_EMAIL") === "sim";
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

const transporte = async (url: string, corpo: string, limiteMs?: number) => {
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "planning-brain-faturamento-omie/1.0",
    },
    body: corpo,
    signal: AbortSignal.timeout(Math.max(1_000, limiteMs ?? 60_000)),
  });
  return { status: r.status, texto: await r.text() };
};

/** O token do Pipefy fica aqui; a lógica só recebe o transporte. */
const transportePipefy = PIPEFY_TOKEN
  ? async (corpo: string, limiteMs?: number) => {
      const r = await fetch(PIPEFY_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${PIPEFY_TOKEN}`, "Content-Type": "application/json" },
        body: corpo,
        signal: AbortSignal.timeout(Math.max(1_000, limiteMs ?? 30_000)),
      });
      return { status: r.status, texto: await r.text() };
    }
  : null;

/**
 * PDF da NFS-e (ou do recibo) para anexar no card em FATURAMENTO REALIZADO. Só em gravação do Pipefy: lê o StatusOS no
 * Omie da emissora (leitura) e baixa o PDF do destinatário. Nulo se ainda não houver. Usa o ritmo da emissora da mesma
 * execução (a pausa entre chamadas vale também aqui) e o prazo dela.
 */
const pdfDaNota =
  (ritmos: Map<string, Ritmo>, prazo: number) => async (envio: any, contexto: any) => {
    const nCodOS = Number(
      contexto?.pedido?.omie_os_codigo ?? envio?.payload?.pedido?.omie_os_codigo,
    );
    const emissora = String(envio?.emissora?.id ?? "");
    if (!nCodOS || !emissora) return null;
    const credencial = await rpc("credencial", { p_emissora: emissora });
    let ritmo = ritmos.get(emissora);
    if (!ritmo) {
      ritmo = { ultima: 0 };
      ritmos.set(emissora, ritmo);
    }
    const omie = criarOmie({ transporte, credencial, modo: "simular", dormir, ritmo, prazo });
    const st = await omie.consultar("servicos/os", "StatusOS", {
      nCodOS,
      lPdfDest: true,
      lPdfRecibo: true,
    });
    const rps = (st?.ListaRpsNfse ?? []).find((r: any) => r?.cUrlPdfDest);
    const url = rps?.cUrlPdfDest || st?.cUrlPdfRecibo;
    if (!url) return null;
    const r = await fetch(url, {
      signal: AbortSignal.timeout(Math.max(1_000, Math.min(30_000, prazo - Date.now()))),
    });
    const bytes = new Uint8Array(await r.arrayBuffer());
    // Só anexa se for PDF de verdade (%PDF).
    if (!r.ok || bytes.length < 5 || String.fromCharCode(...bytes.slice(0, 4)) !== "%PDF")
      return null;
    const numero = rps?.nNfse || st?.cNumRecibo || contexto?.pedido?.numero || "pedido";
    return { nome: `NFSe-${numero}.pdf`, bytes };
  };

/** SendGrid v3, como a gente-vigencia-alertas. A chave fica aqui; a lógica só recebe a função. */
const enviarEmail = SENDGRID
  ? async (e: Email, limiteMs?: number) => {
      const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${SENDGRID}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpoSendgrid(e)),
        signal: AbortSignal.timeout(Math.max(1_000, limiteMs ?? 20_000)),
      });
      return { status: r.status, texto: await r.text() };
    }
  : null;

async function subir(url: string, bytes: Uint8Array) {
  const r = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/pdf" },
    body: bytes.slice().buffer,
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`Upload do PDF recusado (${r.status})`);
}

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

  let enfileirados: unknown = null;
  let omie: Awaited<ReturnType<typeof rodarFila>> | null = null;
  let pipefy: Awaited<ReturnType<typeof rodarFilaPipefy>> | null = null;
  let notificacoes: Awaited<ReturnType<typeof rodarFilaNotificacoes>> | null = null;
  const falhas: string[] = [];

  const prazo = inicio + PRAZO_EXECUCAO_MS;
  const ritmos = new Map<string, Ritmo>();
  const sobra = (ate: number, teto: number) =>
    Math.max(0, Math.min(teto, inicio + ate - Date.now()));

  // 1. Omie.
  try {
    if (acao === "enfileirar_status") enfileirados = await rpc("status_enfileirar", {});
    omie = await rodarFila({
      reservar: async (n) => (await rpc("envio_proximos", { p_limite: n })) ?? [],
      responder: (envio, r) =>
        rpc("envio_resultado", {
          p_envio: envio?.id,
          p_status: r.status,
          p_resposta: r.resposta,
          p_erro_legivel: r.erro_legivel,
          p_codigos: r.codigos ?? {},
          p_reserva: envio?.reserva ?? null,
        }),
      bloquear: (emissora, ate, motivo) =>
        rpc("emissora_bloquear", { p_emissora: emissora, p_ate: ate, p_motivo: motivo }),
      ritmos,
      prazo,
      credencial: (emissora) => rpc("credencial", { p_emissora: emissora }),
      statusAplicar: (pedido, status) =>
        rpc("status_aplicar", { p_pedido: pedido, p_status: status }),
      receitaCnpj: (cnpj) => rpc("receita_cnpj", { p_cnpj: cnpj }),
      contratosAplicar: (emissora, contratos) =>
        rpc("contratos_aplicar", { p_emissora: emissora, p_contratos: contratos }),
      notasAplicar: (emissora, de, ate, notas) =>
        rpc("notas_aplicar", { p_emissora: emissora, p_de: de, p_ate: ate, p_notas: notas }),
      servicosAplicar: (emissora, catalogo) =>
        rpc("servicos_aplicar", { p_emissora: emissora, p_catalogo: catalogo }),
      transporte,
      dormir,
      maxEnvios: limite,
      orcamentoMs: ORCAMENTO_OMIE_MS,
    });
  } catch (e) {
    falhas.push(`omie: ${cortar((e as Error)?.message ?? e, 300)}`);
  }

  // 2. Pipefy (o card anda depois do Omie, na mesma rodada).
  try {
    pipefy = await rodarFilaPipefy({
      reservar: async (n) => (await rpc("pipefy_proximos", { p_limite: n })) ?? [],
      responder: (envio, r) =>
        rpc("pipefy_resultado", {
          p_envio: envio?.id,
          p_status: r.status,
          p_resposta: r.resposta,
          p_erro_legivel: r.erro_legivel,
          p_card_id: r.card_id,
          p_reserva: envio?.reserva ?? null,
        }),
      contexto: (pedido) => rpc("pipefy_contexto", { p_pedido: pedido }),
      transporte: transportePipefy,
      pdfDaNota: pdfDaNota(ritmos, prazo),
      subir,
      prazo,
      orcamentoMs: sobra(PARA_DE_RESERVAR_PIPEFY_MS, ORCAMENTO_PIPEFY_MS),
    });
  } catch (e) {
    falhas.push(`pipefy: ${cortar((e as Error)?.message ?? e, 300)}`);
  }

  // 3. Notificações (e-mail). Desligado, tudo fica simulado.
  try {
    notificacoes = await rodarFilaNotificacoes({
      reservar: async (n) => (await rpc("notificacoes_proximos", { p_limite: n })) ?? [],
      responder: (id, r) =>
        rpc("notificacoes_resultado", {
          p_id: id,
          p_status: r.status,
          p_email: r.email,
          p_assunto: r.assunto,
          p_corpo: r.corpo,
          p_erro_legivel: r.erro_legivel,
          p_resposta: r.resposta,
        }),
      ligado: EMAIL_LIGADO,
      enviar: enviarEmail,
      prazo,
      orcamentoMs: sobra(PARA_DE_RESERVAR_NOTIFICACOES_MS, ORCAMENTO_NOTIFICACOES_MS),
    });
  } catch (e) {
    falhas.push(`notificacoes: ${cortar((e as Error)?.message ?? e, 300)}`);
  }

  const errosBanco = [
    ...(omie?.erros_banco ?? []),
    ...(pipefy?.erros_banco ?? []),
    ...(notificacoes?.erros_banco ?? []),
  ];
  const trabalho =
    (omie?.reservados ?? 0) + (pipefy?.reservados ?? 0) + (notificacoes?.reservados ?? 0);
  // Rodada vazia não vai para o log (o cron roda 720 vezes por dia).
  if (trabalho > 0 || enfileirados != null || errosBanco.length || falhas.length) {
    await registrar(inicio, errosBanco.length || falhas.length ? "erro" : "sucesso", trabalho, {
      versao: VERSAO,
      acao,
      origem: corpo?.origem ?? null,
      enfileirados,
      omie: omie && {
        por_status: omie.por_status,
        envios: omie.envios,
        emissoras_paradas: omie.emissoras_paradas,
      },
      pipefy: pipefy && {
        por_status: pipefy.por_status,
        envios: pipefy.envios,
        token: !!PIPEFY_TOKEN,
      },
      notificacoes: notificacoes && { por_status: notificacoes.por_status, ligado: EMAIL_LIGADO },
      erros_banco: errosBanco,
      falhas,
    });
  }
  // Só o resumo: nenhuma resposta de envio (payload, mutation) sai daqui.
  console.log(
    JSON.stringify({
      fonte: FONTE_LOG,
      acao,
      omie: omie?.por_status ?? null,
      pipefy: pipefy?.por_status ?? null,
      notificacoes: notificacoes?.por_status ?? null,
      falhas,
    }),
  );
  return json(
    {
      ok: !falhas.length,
      versao: VERSAO,
      acao,
      enfileirados,
      resumo: omie,
      pipefy,
      notificacoes,
      falhas,
    },
    falhas.length ? 500 : 200,
  );
});
