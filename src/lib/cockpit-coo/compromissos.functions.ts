// Escritas do Cockpit do COO no ClickUp (lote 3 da spec): criar compromisso a partir de um alerta,
// concluir, mudar prazo, trocar dono e comentar.
//
// Quem pode: quem tem a área cockpit_coo (admin e o COO). O token do ClickUp mora em
// ops.integracoes_segredos (CLICKUP_API_KEY); sem ele, as ações respondem "ClickUp desconectado".
// Toda escrita fica em ops.cockpit_coo_escritas (o autor real: no ClickUp a tarefa aparece em nome
// do dono do token) e atualiza o espelho na hora, sem esperar a rodada de 10 minutos.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  clienteClickUp,
  lerCamposDaLista,
  lerEstruturaDoSpace,
  lerMembrosDaLista,
  SPACE_EXPANSAO,
  ErroClickUp,
} from "../../../supabase/functions/_shared/clickup/api.ts";
import type { ClienteClickUp, MembroLista } from "../../../supabase/functions/_shared/clickup/api.ts";
import { linhaDoEspelho } from "../../../supabase/functions/_shared/clickup/compromissos.ts";
import type { TarefaBruta } from "../../../supabase/functions/_shared/clickup/normalizar.ts";
import { abrirContextoCoo } from "./contexto.server.ts";
import type { ContextoCoo, Db } from "./contexto.server.ts";
import { PASTA_ROTINA } from "./compromissos.ts";
import { TEMAS, ehTema } from "./contrato.ts";
import type { Tema } from "./contrato.ts";
import {
  corpoComentario,
  corpoTarefaNova,
  corpoTrocaDono,
  prazoEmMs,
  statusConcluido,
  validarNovo,
} from "./escrita.ts";
import type { Autor, NovoCompromisso, StatusLista } from "./escrita.ts";

async function admin(): Promise<Db> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as Db;
}

async function tokenClickUp(): Promise<string> {
  const db = await admin();
  const { data } = await db.from("integracoes_segredos").select("valor").eq("chave", "CLICKUP_API_KEY").maybeSingle();
  return String(data?.valor ?? process.env.CLICKUP_API_KEY ?? "").trim();
}

export interface ListaRotina {
  id: string;
  nome: string;
  pastaId: string;
  statuses: StatusLista[];
}

// A lista dos compromissos muda pouco: guarda 10 minutos por processo, para não gastar a cota.
let listaEmCache: { lista: ListaRotina | null; em: number } | null = null;

/** A lista de compromissos dentro da pasta Rotina Semanal (a que tem "compromisso" no nome, senão a primeira). */
async function listaDaRotina(c: ClienteClickUp): Promise<ListaRotina | null> {
  if (listaEmCache && Date.now() - listaEmCache.em < 10 * 60_000) return listaEmCache.lista;
  const { pastas } = await lerEstruturaDoSpace(c, SPACE_EXPANSAO);
  const pasta = pastas.find((p) => p.name.toLowerCase().startsWith(PASTA_ROTINA.toLowerCase()));
  const l = pasta ? pasta.lists.find((x) => /compromisso/i.test(x.name)) ?? pasta.lists[0] : undefined;
  const lista = pasta && l
    ? {
        id: l.id,
        nome: l.name,
        pastaId: pasta.id,
        statuses: (l.statuses ?? []).map((s) => ({ status: s.status, type: (s as { type?: string }).type ?? "", orderindex: s.orderindex })),
      }
    : null;
  listaEmCache = { lista, em: Date.now() };
  return lista;
}

async function autorDe(ctx: ContextoCoo): Promise<Autor> {
  const db = await admin();
  const { data } = await db.schema("public").from("profiles").select("email, nome").eq("user_id", ctx.userId).maybeSingle();
  return { nome: (data?.nome || data?.email || "alguém da matriz") as string, email: (data?.email ?? null) as string | null };
}

async function registrar(
  ctx: ContextoCoo,
  acao: string,
  tarefaId: string | null,
  payload: unknown,
  resultado: { status?: number; erro?: string | null; chave?: string | null },
) {
  const db = await admin();
  await db.from("cockpit_coo_escritas").insert({
    user_id: ctx.userId,
    acao,
    tarefa_id: tarefaId,
    chave_alerta: resultado.chave ?? null,
    payload,
    resposta_status: resultado.status ?? null,
    erro: resultado.erro ?? null,
  });
}

/** Relê a tarefa no ClickUp e grava no espelho, com o evento da escrita. */
async function espelhar(c: ClienteClickUp, lista: ListaRotina | null, tarefaId: string, evento: { tipo: string; de?: unknown; para?: unknown } | null) {
  const t = await c.ler<TarefaBruta>(`/task/${tarefaId}?include_subtasks=false`);
  const pastas = lista ? { [lista.id]: { id: lista.pastaId, nome: PASTA_ROTINA } } : {};
  const linha = linhaDoEspelho(t, pastas);
  const db = await admin();
  await db.from("clickup_tarefas").upsert({ ...linha, sincronizado_em: new Date().toISOString(), ausente_desde: null }, { onConflict: "id" });
  if (evento) await db.from("clickup_eventos").insert({ tarefa_id: tarefaId, tipo: evento.tipo, de: evento.de ?? null, para: evento.para ?? null, fonte: "cockpit" });
  return linha;
}

function mensagemDoErro(e: unknown): string {
  if (e instanceof ErroClickUp) {
    if (e.status === 401) return "O ClickUp recusou o token. Troque-o em Administração › Chaves de Integração.";
    if (e.status === 429) return "A cota do ClickUp está cheia agora. Tente de novo em um minuto.";
    return `O ClickUp respondeu ${e.status}. Nada foi gravado.`;
  }
  return (e as Error)?.message ?? "Falha ao falar com o ClickUp.";
}

// ---------------------------------------------------------------------------------------------

export interface OpcoesCompromisso {
  conectado: boolean;
  motivo: string | null;
  lista: { id: string; nome: string } | null;
  membros: MembroLista[];
  unidades: string[];
}

export const carregarOpcoesCompromisso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpcoesCompromisso> => {
    const ctx = await abrirContextoCoo(context);
    const unidades = [...ctx.unidades.map((u) => u.nome), "Rede"];
    const token = await tokenClickUp();
    if (!token)
      return {
        conectado: false,
        motivo: "O ClickUp ainda não está conectado: falta o token em Administração › Chaves de Integração.",
        lista: null,
        membros: [],
        unidades,
      };
    try {
      const c = clienteClickUp(token);
      const lista = await listaDaRotina(c);
      if (!lista)
        return {
          conectado: false,
          motivo: `Não achei a pasta "${PASTA_ROTINA}" com uma lista no space da Expansão Nacional.`,
          lista: null,
          membros: [],
          unidades,
        };
      const membros = await lerMembrosDaLista(c, lista.id);
      return { conectado: true, motivo: null, lista: { id: lista.id, nome: lista.nome }, membros, unidades };
    } catch (e) {
      return { conectado: false, motivo: mensagemDoErro(e), lista: null, membros: [], unidades };
    }
  });

export interface ResultadoEscrita {
  ok: boolean;
  mensagem: string;
  tarefa?: { id: string; url: string } | null;
  /** Campos do compromisso que não existem na lista do ClickUp (a tarefa foi criada mesmo assim). */
  faltando?: string[];
}

export const criarCompromisso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: NovoCompromisso) => {
    if (!ehTema(input?.tema)) throw new Error("Tema inválido.");
    return {
      titulo: String(input.titulo ?? ""),
      contexto: input.contexto ? String(input.contexto).slice(0, 600) : undefined,
      donoId: Number(input.donoId),
      prazo: String(input.prazo ?? ""),
      tema: input.tema as Tema,
      unidade: String(input.unidade ?? ""),
      chaveAlerta: input.chaveAlerta ? String(input.chaveAlerta).slice(0, 200) : null,
      linkBrain: input.linkBrain ? String(input.linkBrain).slice(0, 400) : null,
    } satisfies NovoCompromisso;
  })
  .handler(async ({ data, context }): Promise<ResultadoEscrita> => {
    const ctx = await abrirContextoCoo(context);
    const invalido = validarNovo(data, ctx.hoje);
    if (invalido) return { ok: false, mensagem: invalido };
    const db = await admin();

    // Idempotência: o mesmo alerta não vira duas tarefas (clique duplo, duas abas, duas pessoas).
    if (data.chaveAlerta) {
      const { data: ja } = await db
        .from("clickup_tarefas")
        .select("id, url")
        .eq("origem", data.chaveAlerta)
        .is("ausente_desde", null)
        .limit(1)
        .maybeSingle();
      if (ja) return { ok: true, mensagem: "Este alerta já tem compromisso aberto.", tarefa: { id: ja.id, url: ja.url } };
    }

    const token = await tokenClickUp();
    if (!token) return { ok: false, mensagem: "O ClickUp ainda não está conectado (token em Administração › Chaves de Integração)." };
    const c = clienteClickUp(token);
    try {
      const lista = await listaDaRotina(c);
      if (!lista) return { ok: false, mensagem: `Não achei a lista de compromissos na pasta "${PASTA_ROTINA}".` };
      const campos = await lerCamposDaLista(c, lista.id);
      const autor = await autorDe(ctx);
      const { corpo, faltando } = corpoTarefaNova(data, campos, autor, new Date().toISOString());
      const criada = await c.enviar<TarefaBruta>(`/list/${lista.id}/task`, "POST", corpo);
      await registrar(ctx, "criar", criada.id, { tema: data.tema, unidade: data.unidade, prazo: data.prazo, donoId: data.donoId }, { status: 200, chave: data.chaveAlerta });
      await espelhar(c, lista, criada.id, { tipo: "criada", para: { prazo: data.prazo, dono: data.donoId } });
      return {
        ok: true,
        mensagem: faltando.length
          ? `Compromisso criado. Faltam campos na lista do ClickUp: ${faltando.join(", ")}.`
          : "Compromisso criado no ClickUp.",
        tarefa: { id: criada.id, url: criada.url },
        faltando,
      };
    } catch (e) {
      const mensagem = mensagemDoErro(e);
      await registrar(ctx, "criar", null, { tema: data.tema, unidade: data.unidade }, { status: e instanceof ErroClickUp ? e.status : 0, erro: mensagem, chave: data.chaveAlerta });
      return { ok: false, mensagem };
    }
  });

export type AcaoCompromisso =
  | { tarefaId: string; acao: "concluir" }
  | { tarefaId: string; acao: "prazo"; prazo: string }
  | { tarefaId: string; acao: "dono"; donoId: number }
  | { tarefaId: string; acao: "comentar"; texto: string };

export const atualizarCompromisso = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: AcaoCompromisso) => {
    const tarefaId = String(input?.tarefaId ?? "");
    if (!/^[A-Za-z0-9_-]{3,40}$/.test(tarefaId)) throw new Error("Tarefa inválida.");
    if (!["concluir", "prazo", "dono", "comentar"].includes(input?.acao)) throw new Error("Ação inválida.");
    return input;
  })
  .handler(async ({ data, context }): Promise<ResultadoEscrita> => {
    const ctx = await abrirContextoCoo(context);
    const db = await admin();
    // Só tarefa que o espelho conhece como compromisso da Rotina Semanal: o cockpit não edita o
    // resto do ClickUp.
    const { data: linha } = await db
      .from("clickup_tarefas")
      .select("id, lista_id, pasta_nome, donos, prazo, status")
      .eq("id", data.tarefaId)
      .maybeSingle();
    if (!linha || !String(linha.pasta_nome ?? "").toLowerCase().startsWith(PASTA_ROTINA.toLowerCase()))
      return { ok: false, mensagem: "Esta tarefa não é um compromisso da Rotina Semanal." };
    const token = await tokenClickUp();
    if (!token) return { ok: false, mensagem: "O ClickUp ainda não está conectado (token em Administração › Chaves de Integração)." };
    const c = clienteClickUp(token);
    const autor = await autorDe(ctx);
    try {
      const lista = await listaDaRotina(c);
      let evento: { tipo: string; de?: unknown; para?: unknown } | null = null;
      if (data.acao === "concluir") {
        const status = statusConcluido(lista?.statuses ?? []);
        if (!status) return { ok: false, mensagem: "A lista não tem status de concluído." };
        await c.enviar(`/task/${data.tarefaId}`, "PUT", { status });
        evento = { tipo: "concluida", de: linha.status, para: status };
      } else if (data.acao === "prazo") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.prazo) || data.prazo < ctx.hoje)
          return { ok: false, mensagem: "Escolha um prazo de hoje em diante." };
        await c.enviar(`/task/${data.tarefaId}`, "PUT", { due_date: prazoEmMs(data.prazo), due_date_time: false });
        evento = { tipo: "prazo", de: linha.prazo, para: new Date(prazoEmMs(data.prazo)).toISOString() };
      } else if (data.acao === "dono") {
        const atuais = ((linha.donos ?? []) as { id: string }[]).map((d) => d.id);
        await c.enviar(`/task/${data.tarefaId}`, "PUT", corpoTrocaDono(atuais, Number(data.donoId)));
        evento = { tipo: "dono", de: atuais, para: [String(data.donoId)] };
      } else {
        await c.enviar(`/task/${data.tarefaId}/comment`, "POST", corpoComentario(data.texto, autor));
      }
      await registrar(ctx, data.acao === "concluir" ? "status" : data.acao, data.tarefaId, data, { status: 200 });
      await espelhar(c, lista, data.tarefaId, evento);
      const ok: Record<AcaoCompromisso["acao"], string> = {
        concluir: "Compromisso concluído.",
        prazo: "Prazo alterado.",
        dono: "Dono trocado.",
        comentar: "Comentário enviado.",
      };
      return { ok: true, mensagem: ok[data.acao] };
    } catch (e) {
      const mensagem = mensagemDoErro(e);
      await registrar(ctx, data.acao === "concluir" ? "status" : data.acao, data.tarefaId, data, { status: e instanceof ErroClickUp ? e.status : 0, erro: mensagem });
      return { ok: false, mensagem };
    }
  });

/** Rótulo do tema para mensagens. */
export const rotuloTema = (t: Tema) => TEMAS[t].menu;
