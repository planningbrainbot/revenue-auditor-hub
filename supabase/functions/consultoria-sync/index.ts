// consultoria-sync
//
// Traz a operação da Consultoria (plataforma do Pedro Siqueira, API `api-comercial`) para o banco
// único: /clientes → ops.consultoria_clientes, /propostas → ops.consultoria_propostas. A Base de
// clientes cruza essas tabelas com a conta por CNPJ completo e por raiz (ops.base_conta_sinais).
//
// Agendada por pg_cron de hora em hora (job consultoria-sync-hora, migration 20260928200000).
// Leitura completa a cada rodada: quem some da API fica com ausente_desde preenchido (não é
// apagado) e sai do casamento. Leitura vazia ou que perde mais da metade não marca ninguém.
//
// A API de 28/09 não traz cliente inativo (`?ativo=false` é ignorado; os 679 vêm ativo=true) nem
// valor a recuperar. A sync já pede os inativos e já lê os campos pedidos ao Pedro Siqueira
// (`inativo_desde`, `valor_a_recuperar`, `valor_a_recuperar_em`): quando a API trouxer, entram sem
// mudança de código.
//
// Segredos (supabase secrets set): CONSULTORIA_API_URL, CONSULTORIA_API_KEY, SINAIS_CRON_SECRET.
// A chave nunca vai para código, log ou sync_log. Publicar com --no-verify-jwt.
import "../_shared/perfil.ts";
import {
  LIMITE_PAGINAS,
  linhaCliente,
  linhaProposta,
  POR_PAGINA,
  podeMarcarAusentes,
  unicosPorId,
} from "./domain.mjs";

const API = (Deno.env.get("CONSULTORIA_API_URL") ?? "").replace(/\/+$/, "");
const API_KEY = Deno.env.get("CONSULTORIA_API_KEY") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");

async function rest(path: string, init: RequestInit = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${init.method ?? "GET"} ${path.split("?")[0]} → ${res.status}: ${body.slice(0, 300)}`);
  return body.trim() ? JSON.parse(body) : null;
}

/** Todas as páginas de um recurso da API. Erro HTTP interrompe a rodada inteira, sem gravar nada. */
async function ler(recurso: string, extra: Record<string, string> = {}) {
  const itens: Record<string, unknown>[] = [];
  for (let pagina = 1; pagina <= LIMITE_PAGINAS; pagina++) {
    const qs = new URLSearchParams({ ...extra, pagina: String(pagina), por_pagina: String(POR_PAGINA) });
    const res = await fetch(`${API}${recurso}?${qs}`, { headers: { "x-api-key": API_KEY } });
    if (!res.ok) throw new Error(`API da Consultoria ${recurso}: HTTP ${res.status}`);
    const corpo = await res.json();
    const dados = Array.isArray(corpo?.dados) ? corpo.dados : [];
    itens.push(...dados);
    if (!corpo?.tem_mais || !dados.length) return itens;
  }
  throw new Error(`API da Consultoria ${recurso}: mais de ${LIMITE_PAGINAS} páginas; leitura interrompida.`);
}

async function upsert(tabela: string, linhas: unknown[]) {
  for (let i = 0; i < linhas.length; i += 500)
    await rest(`${tabela}?on_conflict=id`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(linhas.slice(i, i + 500)),
    });
}

/** Marca ausente quem estava presente e não foi relido nesta rodada (sincronizado_em anterior). */
async function marcarAusentes(tabela: string, lidos: number, agora: string) {
  const presentes = await rest(`${tabela}?select=id&ausente_desde=is.null`);
  const decisao = podeMarcarAusentes(lidos, presentes?.length ?? 0);
  if (!decisao.pode) return { marcados: 0, recusado: decisao.motivo };
  const marcados = await rest(
    `${tabela}?ausente_desde=is.null&sincronizado_em=lt.${encodeURIComponent(agora)}&select=id`,
    { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ ausente_desde: agora }) },
  );
  return { marcados: marcados?.length ?? 0, recusado: null };
}

async function registrar(inicio: number, status: "sucesso" | "erro", total: number, detalhes: Record<string, unknown>) {
  await rest("sync_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      fonte: "consultoria",
      executado_em: new Date(inicio).toISOString(),
      duracao_segundos: Math.round((Date.now() - inicio) / 1000),
      total_registros: total,
      detalhes,
      status,
    }]),
  });
}

async function sincronizar(trigger: string) {
  if (!API || !API_KEY) throw new Error("CONSULTORIA_API_URL ou CONSULTORIA_API_KEY ausente nos segredos da função.");
  const inicio = Date.now();
  const agora = new Date(inicio).toISOString();
  // Ativos e inativos: hoje a API ignora o filtro e devolve os mesmos 679; quando passar a
  // respeitá-lo, os inativos chegam por aqui.
  const [ativos, inativos, propostasApi] = await Promise.all([
    ler("/clientes"),
    ler("/clientes", { ativo: "false" }),
    ler("/propostas"),
  ]);
  const clientesApi = unicosPorId([ativos, inativos]);
  const clientes = clientesApi.map((x) => linhaCliente(x, agora)).filter((x) => x !== null);
  const propostas = propostasApi.map((x) => linhaProposta(x, agora)).filter((x) => x !== null);
  await upsert("consultoria_clientes", clientes);
  await upsert("consultoria_propostas", propostas);
  const ausCli = await marcarAusentes("consultoria_clientes", clientes.length, agora);
  const ausProp = await marcarAusentes("consultoria_propostas", propostas.length, agora);
  const resumo = {
    trigger,
    clientes: clientes.length,
    clientes_descartados: clientesApi.length - clientes.length,
    clientes_inativos: clientes.filter((c) => !c.ativo).length,
    clientes_com_valor_a_recuperar: clientes.filter((c) => c.valor_a_recuperar !== null).length,
    propostas: propostas.length,
    propostas_descartadas: propostasApi.length - propostas.length,
    propostas_com_cnpj: propostas.filter((p) => p.cnpj !== null).length,
    ausentes_marcados: { clientes: ausCli.marcados, propostas: ausProp.marcados },
    ausencia_recusada: { clientes: ausCli.recusado, propostas: ausProp.recusado },
  };
  await registrar(inicio, "sucesso", clientes.length, resumo);
  return { ok: true, ...resumo, duracao_segundos: Math.round((Date.now() - inicio) / 1000) };
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
    return Response.json(await sincronizar(trigger));
  } catch (err) {
    console.error(err);
    await registrar(inicio, "erro", 0, { trigger, erro: String(err).slice(0, 500) }).catch(() => {});
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
});
