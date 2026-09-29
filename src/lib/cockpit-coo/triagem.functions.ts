// Assistente de triagem do Cockpit do COO no servidor (Jev via OpenRouter).
//
// Liga só com COCKPIT_COO_JEV=1 e a chave OPENROUTER_API_KEY no ambiente (no local, também
// COCKPIT_IA_KEYCHAIN=1 lê a chave do Keychain). Sem isso, as funções respondem "desligado" e a
// tela segue sem sugestão. O consumo vai para ops.cockpit_ia_consumo com cockpit = 'coo' (teto
// separado do CEO). O texto enviado ao Jev é só nome, lista e status da tarefa.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { decidirJev } from "../cockpit-ceo/jev/adaptador.server";
import type { LedgerJev } from "../cockpit-ceo/jev/adaptador.server";
import { JEV_MODELO } from "../cockpit-ceo/jev/contrato";
import type { RegistroChamada } from "../cockpit-ceo/jev/contrato";
import { obterChaveOpenRouter } from "../cockpit-ceo/conversa/servidor.server";
import {
  clienteClickUp,
  lerCamposDaLista,
} from "../../../supabase/functions/_shared/clickup/api.ts";
import { opcaoPorNome } from "../../../supabase/functions/_shared/clickup/campos.ts";
import { CAMPO_UNIDADE } from "../../../supabase/functions/_shared/clickup/compromissos.ts";
import { abrirContextoCoo } from "./contexto.server.ts";
import type { ContextoCoo, Db } from "./contexto.server.ts";
import { PASTA_ROTINA } from "./compromissos.ts";
import { ehTema } from "./contrato.ts";
import {
  LIMIARES_TRIAGEM,
  TAXONOMIA_TRIAGEM,
  assinatura,
  lerDuplicidade,
  lerTriagem,
  pedidoDuplicidade,
  pedidoTriagem,
  textoDaTarefa,
} from "./triagem.ts";
import type { SugestaoCoo } from "./triagem.ts";

export const jevCooLigado = (env = process.env) => env.COCKPIT_COO_JEV === "1";
const VERSAO = `${TAXONOMIA_TRIAGEM}@${LIMIARES_TRIAGEM.unidade}`;
const POR_RODADA = 15;

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

/** Ledger do Jev no banco, só com as linhas do COO (o teto do CEO não é tocado). */
function ledgerCoo(db: Db, userId: string): LedgerJev {
  let fila: Promise<unknown> = Promise.resolve();
  return {
    async ler() {
      const inicioMes = `${hojeSaoPaulo().slice(0, 7)}-01T03:00:00Z`;
      const { data, error } = await db
        .from("cockpit_ia_consumo")
        .select("id, em, estado, reserva_id, custo_usd, custo_desconhecido, latencia_ms, codigo")
        .eq("tipo", "jev")
        .eq("cockpit", "coo")
        .gte("em", inicioMes);
      if (error) throw new Error("ledger do Jev indisponível");
      return (data ?? []).map((r: Record<string, unknown>): RegistroChamada => ({
        id: String(r.estado === "reservada" ? r.id : r.reserva_id),
        em: String(r.em),
        exemplo: "triagem",
        taxonomia: TAXONOMIA_TRIAGEM,
        estado: r.estado === "reservada" ? "reservada" : r.estado === "ok" ? "ok" : "falha",
        custoUsd: r.custo_usd === null ? null : Number(r.custo_usd),
        custoDesconhecido: Boolean(r.custo_desconhecido),
        latenciaMs: (r.latencia_ms as number | null) ?? null,
        codigo: (r.codigo as string | null) ?? null,
      }));
    },
    async anexar(r) {
      const linha =
        r.estado === "reservada"
          ? { id: r.id, tipo: "jev", modelo: JEV_MODELO, estado: "reservada", cockpit: "coo", user_id: userId }
          : {
              tipo: "jev",
              modelo: r.modelo ?? JEV_MODELO,
              estado: r.estado,
              reserva_id: r.id,
              custo_usd: r.custoUsd ?? null,
              custo_desconhecido: !!r.custoDesconhecido,
              tokens_entrada: r.tokens?.entrada ?? null,
              tokens_saida: r.tokens?.saida ?? null,
              latencia_ms: r.latenciaMs ?? null,
              codigo: r.codigo ?? null,
              cockpit: "coo",
              user_id: userId,
            };
      const { error } = await db.from("cockpit_ia_consumo").insert(linha);
      if (error) throw new Error("não foi possível registrar o consumo do Jev");
    },
    comTrava(fn) {
      const agora = fila.then(fn, fn);
      fila = agora.catch(() => undefined);
      return agora;
    },
  };
}

async function chamarJev(ctx: ContextoCoo, pedido: Parameters<typeof decidirJev>[0]) {
  if (!jevCooLigado()) return { estado: "desativado" as const };
  const chave = await obterChaveOpenRouter();
  if (!chave) return { estado: "sem_chave" as const };
  return decidirJev(pedido, {
    obterChave: async () => chave,
    // Consumo com a sessão da pessoa: a policy exige a área do COO para gravar linha 'coo'.
    ledger: ledgerCoo(ctx.db, ctx.userId),
    exemplo: "triagem",
    timeoutMs: 8_000,
    limites: { tentativas: 3_000, custoUsd: 2 },
  });
}

export const carregarSugestoesCoo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ligado: boolean; sugestoes: SugestaoCoo[] }> => {
    const ctx = await abrirContextoCoo(context);
    const { data } = await ctx.db
      .from("cockpit_coo_sugestoes")
      .select("id, tarefa_id, pergunta, resposta, confianca, estado")
      .eq("versao", VERSAO)
      .in("estado", ["pendente"]);
    const porId = new Map(ctx.unidades.map((u) => [`u${u.id}`, u.nome]));
    return {
      ligado: jevCooLigado(),
      sugestoes: ((data ?? []) as Omit<SugestaoCoo, "rotulo">[]).map((s) => ({
        ...s,
        confianca: s.confianca == null ? null : Number(s.confianca),
        rotulo: s.pergunta === "unidade" ? (s.resposta === "rede" ? "Rede" : (porId.get(s.resposta ?? "") ?? s.resposta ?? "")) : (s.resposta ?? ""),
      })),
    };
  });

/**
 * Pede ao Jev a unidade dos compromissos abertos sem o campo Unidade (até 15 por rodada, os que
 * ainda não têm sugestão para o texto atual). O tema está desligado pela calibração de 29/09.
 */
export const triarCompromissos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ estado: string; triadas: number }> => {
    const ctx = await abrirContextoCoo(context);
    if (!jevCooLigado()) return { estado: "desativado", triadas: 0 };
    const db = await admin();
    const { data: abertas } = await ctx.db
      .from("clickup_tarefas")
      .select("id, nome, lista_nome, status, unidade")
      .is("ausente_desde", null)
      .eq("concluida", false)
      .is("unidade", null)
      .ilike("pasta_nome", `${PASTA_ROTINA}%`)
      .limit(200);
    const { data: ja } = await db.from("cockpit_coo_sugestoes").select("tarefa_id, assinatura").eq("versao", VERSAO).eq("pergunta", "unidade");
    const feitas = new Set(((ja ?? []) as { tarefa_id: string; assinatura: string }[]).map((x) => `${x.tarefa_id}|${x.assinatura}`));
    const fila = ((abertas ?? []) as { id: string; nome: string; lista_nome: string | null; status: string }[])
      .map((t) => ({ t, texto: textoDaTarefa({ nome: t.nome, lista: t.lista_nome, status: t.status }) }))
      .filter(({ t, texto }) => !feitas.has(`${t.id}|${assinatura(texto)}`))
      .slice(0, POR_RODADA);
    let triadas = 0;
    for (const { t, texto } of fila) {
      const r = await chamarJev(ctx, pedidoTriagem(texto, ctx.unidades, { tema: false, unidade: true }));
      if (r.estado !== "ok" || !("respostas" in r)) return { estado: r.estado, triadas };
      const l = lerTriagem(r.respostas);
      const u = l.unidade;
      if (!u) continue;
      await db.from("cockpit_coo_sugestoes").upsert(
        {
          tarefa_id: t.id,
          pergunta: "unidade",
          resposta: u.rede ? "rede" : u.unidadeId != null ? `u${u.unidadeId}` : "nenhuma",
          confianca: u.confianca,
          versao: VERSAO,
          assinatura: assinatura(texto),
          estado: u.aceita ? "pendente" : "abaixo_do_limiar",
        },
        { onConflict: "tarefa_id,pergunta,versao,assinatura" },
      );
      triadas++;
    }
    return { estado: "ok", triadas };
  });

/** Confirmar grava a unidade no ClickUp; descartar só registra a decisão. */
export const decidirSugestaoCoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number; aceitar: boolean }) => ({ id: Number(input.id), aceitar: Boolean(input.aceitar) }))
  .handler(async ({ data, context }): Promise<{ ok: boolean; mensagem: string }> => {
    const ctx = await abrirContextoCoo(context);
    const db = await admin();
    const { data: s } = await db.from("cockpit_coo_sugestoes").select("*").eq("id", data.id).maybeSingle();
    if (!s || s.estado !== "pendente") return { ok: false, mensagem: "Esta sugestão já foi decidida." };
    if (data.aceitar && s.pergunta === "unidade") {
      const { data: t } = await db.from("clickup_tarefas").select("id, lista_id").eq("id", s.tarefa_id).maybeSingle();
      const { data: seg } = await db.from("integracoes_segredos").select("valor").eq("chave", "CLICKUP_API_KEY").maybeSingle();
      const token = String(seg?.valor ?? process.env.CLICKUP_API_KEY ?? "").trim();
      if (!t?.lista_id || !token) return { ok: false, mensagem: "O ClickUp não está conectado." };
      const nome = s.resposta === "rede" ? "Rede" : (ctx.unidades.find((u) => `u${u.id}` === s.resposta)?.nome ?? null);
      if (!nome) return { ok: false, mensagem: "A unidade sugerida não existe mais no cadastro." };
      const c = clienteClickUp(token);
      const campos = await lerCamposDaLista(c, t.lista_id);
      const campo = campos.find((f) => f.name.includes(CAMPO_UNIDADE));
      if (!campo) return { ok: false, mensagem: `A lista não tem o campo "${CAMPO_UNIDADE}".` };
      const valor = campo.type === "drop_down" ? opcaoPorNome(campo.type_config?.options ?? [], nome) : nome;
      if (!valor) return { ok: false, mensagem: `O campo "${CAMPO_UNIDADE}" não tem a opção "${nome}".` };
      await c.enviar(`/task/${t.id}/field/${campo.id}`, "POST", { value: valor });
      await db.from("clickup_tarefas").update({ unidade: nome }).eq("id", t.id);
      await db.from("cockpit_coo_escritas").insert({ user_id: ctx.userId, acao: "campo", tarefa_id: t.id, payload: { campo: CAMPO_UNIDADE, valor: nome, origem: "sugestao_jev" }, resposta_status: 200 });
    }
    await db
      .from("cockpit_coo_sugestoes")
      .update({ estado: data.aceitar ? "confirmada" : "descartada", decidida_em: new Date().toISOString(), decidida_por: ctx.userId })
      .eq("id", data.id);
    return { ok: true, mensagem: data.aceitar ? "Unidade gravada no ClickUp." : "Sugestão descartada." };
  });

/** Antes de criar: alguma tarefa aberta do mesmo tema já trata disso? Só aviso. */
export const verificarDuplicidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { titulo: string; tema: string }) => {
    if (!ehTema(input?.tema)) throw new Error("Tema inválido.");
    return { titulo: String(input.titulo ?? "").slice(0, 400), tema: input.tema };
  })
  .handler(async ({ data, context }): Promise<{ parecida: { id: string; nome: string; url?: string; confianca: number } | null }> => {
    const ctx = await abrirContextoCoo(context);
    if (!jevCooLigado() || !data.titulo.trim()) return { parecida: null };
    const { data: abertas } = await ctx.db
      .from("clickup_tarefas")
      .select("id, nome, url, tema")
      .is("ausente_desde", null)
      .eq("concluida", false)
      .ilike("pasta_nome", `${PASTA_ROTINA}%`)
      .limit(200);
    const candidatas = ((abertas ?? []) as { id: string; nome: string; url: string }[]).slice(0, 20);
    if (!candidatas.length) return { parecida: null };
    const r = await chamarJev(ctx, pedidoDuplicidade(data.titulo, candidatas));
    if (r.estado !== "ok" || !("respostas" in r)) return { parecida: null };
    return { parecida: lerDuplicidade(r.respostas.duplicada, candidatas) };
  });
