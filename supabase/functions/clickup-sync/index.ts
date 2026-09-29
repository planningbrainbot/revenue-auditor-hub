// clickup-sync
//
// Espelha o space "Operação | Expansão Nacional" do ClickUp (90176460033) no banco único e grava a
// foto diária de OKR. Serve o Cockpit do COO (compromissos da Rotina Semanal e OKRs por tema).
//
// A cada rodada (pg_cron, 10 min, job clickup-sync-10min):
// 1. lê TODAS as tarefas do space, página a página (o leitor do Growth não paginava);
// 2. compara com o espelho e registra o que mudou em ops.clickup_eventos (status, prazo, dono);
// 3. grava ops.clickup_tarefas; tarefa que some é marcada, não apagada (trava: leitura que perde
//    mais da metade não marca ninguém);
// 4. grava a foto do dia em growth.okr_snapshot, na régua da tela de OKRs (upsert por dia e KR).
//    Retoma a série que parou em 02/09/2026 (o cron do Growth tomava um redirect e contava como
//    sucesso).
//
// O token do ClickUp mora em ops.integracoes_segredos (CLICKUP_API_KEY), editável em
// Administração › Chaves de Integração: trocar o token não exige deploy. Sem token a função
// responde "sem token" e não grava nada. A primeira rodada com token liga o monitor.
//
// Segredos da função: SINAIS_CRON_SECRET (o mesmo das outras sincronizações). Publicar com
// --no-verify-jwt.
import "../_shared/perfil.ts";
import { clienteClickUp, lerEstruturaDoSpace, lerTarefasDoSpace, SPACE_EXPANSAO, TEAM_EXPANSAO } from "../_shared/clickup/api.ts";
import type { LinhaEspelho } from "../_shared/clickup/compromissos.ts";
import type { DadosBrain } from "../_shared/clickup/medicoes-brain.ts";
import { diaSaoPaulo, planejarRodada } from "./dominio.ts";

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");

async function rest(path: string, init: RequestInit & { schema?: string } = {}) {
  const { schema, ...resto } = init;
  const headers: Record<string, string> = {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
    "Content-Type": "application/json",
    ...((resto.headers as Record<string, string>) ?? {}),
  };
  if (schema) {
    headers["Accept-Profile"] = schema;
    headers["Content-Profile"] = schema;
  }
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, { ...resto, headers });
  const body = await res.text();
  if (!res.ok) throw new Error(`PostgREST ${resto.method ?? "GET"} ${path.split("?")[0]} → ${res.status}: ${body.slice(0, 300)}`);
  return body.trim() ? JSON.parse(body) : null;
}

async function tokenClickUp(): Promise<string> {
  const linhas = await rest("integracoes_segredos?select=valor&chave=eq.CLICKUP_API_KEY");
  const v = (linhas?.[0]?.valor ?? "").trim();
  return v || (Deno.env.get("CLICKUP_API_KEY") ?? "").trim();
}

async function lerEspelho(): Promise<LinhaEspelho[]> {
  const todas: LinhaEspelho[] = [];
  for (let de = 0; ; de += 1000) {
    const parte = await rest(`clickup_tarefas?select=*&ausente_desde=is.null&order=id`, {
      headers: { Range: `${de}-${de + 999}` },
    });
    todas.push(...(parte ?? []));
    if (!parte || parte.length < 1000) return todas;
  }
}

/** Dados do Growth do mês corrente para as seis KRs medidas pelo Brain. Falha = foto sem Brain. */
async function dadosBrain(dia: string): Promise<DadosBrain | null> {
  const mes = dia.slice(0, 7);
  try {
    const [campanhas, trafegoDia, metricasPessoa, corrente] = await Promise.all([
      rest(`campanhas_mes?select=investimento,mql&mes=eq.${mes}`, { schema: "growth" }),
      rest("rpc/trafego_dia", { method: "POST", schema: "growth", body: JSON.stringify({ p_inicio: `${mes}-01`, p_fim: dia }) }),
      rest(`metricas_pessoa?select=papel,mql,rm,rr,vendas&mes=eq.${mes}`, { schema: "growth" }),
      rest("mes_corrente?select=ticket_real&porte=eq.consolidado", { schema: "growth" }),
    ]);
    return {
      campanhas: campanhas ?? [],
      trafegoDia: trafegoDia ?? [],
      metricasPessoa: metricasPessoa ?? [],
      ticketReal: corrente?.[0]?.ticket_real ?? null,
    };
  } catch (e) {
    console.error("[clickup-sync] medições do Brain:", (e as Error).message);
    return null;
  }
}

async function registrar(inicio: number, status: "sucesso" | "erro", total: number, detalhes: Record<string, unknown>) {
  await rest("sync_log", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify([{
      fonte: "clickup",
      executado_em: new Date(inicio).toISOString(),
      duracao_segundos: Math.round((Date.now() - inicio) / 1000),
      total_registros: total,
      detalhes,
      status,
    }]),
  });
}

async function sincronizar(trigger: string) {
  const token = await tokenClickUp();
  if (!token) return { ok: false, motivo: "sem_token", trigger };
  const inicio = Date.now();
  const agora = new Date(inicio).toISOString();
  const dia = diaSaoPaulo(new Date(inicio));
  const c = clienteClickUp(token);
  try {
    const [{ pastas }, tarefas, anteriores, brain] = await Promise.all([
      lerEstruturaDoSpace(c, SPACE_EXPANSAO),
      lerTarefasDoSpace(c, { teamId: TEAM_EXPANSAO, spaceId: SPACE_EXPANSAO }),
      lerEspelho(),
      dadosBrain(dia),
    ]);
    const plano = planejarRodada(anteriores, tarefas, pastas, brain, dia);
    if (plano.linhas.length === 0) throw new Error("o ClickUp devolveu zero tarefas no space; nada foi gravado");

    const linhas = plano.linhas.map((l) => ({ ...l, sincronizado_em: agora, ausente_desde: null }));
    for (let i = 0; i < linhas.length; i += 500)
      await rest("clickup_tarefas?on_conflict=id", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(linhas.slice(i, i + 500)),
      });
    for (let i = 0; i < plano.eventos.length; i += 500)
      await rest("clickup_eventos", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(plano.eventos.slice(i, i + 500).map((e) => ({ ...e, em: agora, fonte: "sync" }))),
      });
    if (plano.sumidas.length)
      for (let i = 0; i < plano.sumidas.length; i += 200)
        await rest(`clickup_tarefas?id=in.(${plano.sumidas.slice(i, i + 200).map(encodeURIComponent).join(",")})`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ ausente_desde: agora }),
        });
    // Foto de OKR: zero KR é coleta quebrada, não dia sem KR.
    let fotos = 0;
    if (plano.snapshot.length)
      for (let i = 0; i < plano.snapshot.length; i += 500) {
        await rest("okr_snapshot?on_conflict=dia,kr_id", {
          method: "POST",
          schema: "growth",
          headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(plano.snapshot.slice(i, i + 500)),
        });
        fotos += Math.min(500, plano.snapshot.length - i);
      }
    await rest("integracoes_config?fonte=eq.clickup&ativo=eq.false", {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ ativo: true }),
    });
    const resumo = {
      trigger,
      tarefas: plano.linhas.length,
      eventos: plano.eventos.length,
      sumidas: plano.sumidas.length,
      sumidas_recusadas: plano.sumidasRecusadas,
      krs_na_foto: fotos,
      krs_medidas: plano.snapshot.filter((s) => s.progresso != null).length,
      medicoes_brain: brain ? "ok" : "indisponível",
      dia,
    };
    await registrar(inicio, "sucesso", plano.linhas.length, resumo);
    return { ok: true, ...resumo, duracao_segundos: Math.round((Date.now() - inicio) / 1000) };
  } catch (e) {
    const erro = (e as Error).message;
    await registrar(inicio, "erro", 0, { trigger, erro }).catch(() => {});
    throw e;
  }
}

Deno.serve(async (req) => {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const porCron = !!CRON && req.headers.get("x-planning-sinais-cron") === CRON;
  if (!porCron && bearer !== SUPA_KEY)
    return new Response(JSON.stringify({ ok: false, error: "não autorizado" }), { status: 401 });
  const body = await req.json().catch(() => ({}));
  const trigger = porCron ? "cron" : String(body?.trigger ?? "manual");
  try {
    const r = await sincronizar(trigger);
    return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
