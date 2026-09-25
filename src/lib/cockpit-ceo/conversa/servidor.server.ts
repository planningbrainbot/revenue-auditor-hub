// Liga a rodada da conversa (responder.ts) ao mundo real: sessão da pessoa, carga do cockpit, Jev,
// modelo no OpenRouter, histórico e visões no banco (RLS "só o dono") e consumo de IA.
//
// Chave do provedor: OPENROUTER_API_KEY no ambiente do servidor. Fora de produção, e só com
// COCKPIT_IA_KEYCHAIN=1, ela pode vir do Keychain do macOS (a mesma do piloto). A chave nunca vai
// para o navegador, log ou banco.
import { execFile } from "node:child_process";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { decidirJev, obterChaveKeychain } from "../jev/adaptador.server";
import type { LedgerJev } from "../jev/adaptador.server";
import { JEV_MODELO } from "../jev/contrato";
import type { RegistroChamada } from "../jev/contrato";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import type { ContextoCockpit } from "../contexto";
import { conferirAcesso, fonteDaPessoa } from "./carga.server";
import type { AcessoConversa } from "./carga.server";
import { pedidoConversa } from "./jev";
import { avaliarOrcamento, limitesDoAmbiente } from "./orcamento";
import type { Orcamento } from "./orcamento";
import { responder } from "./responder";
import type { ParteConversa, RespostaFinal, TurnoAnterior } from "./responder";
import { VisaoDefinicaoSchema } from "./spec";
import type { VisaoDefinicao } from "./spec";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export const MODELO_PADRAO = "anthropic/claude-sonnet-5";
/** Modelos que o servidor aceita; a escolha vem da avaliação (relatório), não do nome. */
export const MODELOS_PERMITIDOS = [
  "anthropic/claude-sonnet-5",
  "anthropic/claude-opus-5.5",
] as const;

export function modeloDoAmbiente(env = process.env): string {
  const m = env.COCKPIT_CONVERSA_MODELO;
  return m && (MODELOS_PERMITIDOS as readonly string[]).includes(m) ? m : MODELO_PADRAO;
}

export async function obterChaveOpenRouter(env = process.env): Promise<string | null> {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY;
  if (env.NODE_ENV !== "production" && env.COCKPIT_IA_KEYCHAIN === "1")
    return env.COCKPIT_IA_KEYCHAIN_SERVICO
      ? lerKeychain(env.COCKPIT_IA_KEYCHAIN_SERVICO)
      : obterChaveKeychain();
  return null;
}

/** Chave de outro serviço do Keychain (só local). Nome fixo por variável; valor nunca sai daqui. */
function lerKeychain(servico: string): Promise<string | null> {
  if (!/^[a-z0-9-]{3,80}$/.test(servico)) return Promise.resolve(null);
  return new Promise((ok) =>
    execFile("security", ["find-generic-password", "-s", servico, "-w"], (e, out) =>
      ok(e ? null : out.trim() || null),
    ),
  );
}

// ── Ledger do Jev no banco (as linhas da própria pessoa, no mês) ──────────────
const travas = new Map<string, Promise<unknown>>();
function ledgerJevNoBanco(db: Db, userId: string): LedgerJev {
  return {
    async ler() {
      const inicioMes = `${hojeSaoPaulo().slice(0, 7)}-01T03:00:00Z`;
      const { data, error } = await db
        .from("cockpit_ia_consumo")
        .select(
          "id, em, estado, reserva_id, modelo, custo_usd, custo_desconhecido, latencia_ms, codigo",
        )
        .eq("tipo", "jev")
        .gte("em", inicioMes);
      if (error) throw new Error("ledger do Jev indisponível");
      return (data ?? []).map((r: Record<string, unknown>): RegistroChamada => ({
        id: String(r.estado === "reservada" ? r.id : r.reserva_id),
        em: String(r.em),
        exemplo: "conversa",
        taxonomia: "cockpit-ceo-conversa-v1",
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
          ? { id: r.id, tipo: "jev", modelo: JEV_MODELO, estado: "reservada" }
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
            };
      const { error } = await db.from("cockpit_ia_consumo").insert(linha);
      if (error) throw new Error("não foi possível registrar o consumo do Jev");
    },
    comTrava(fn) {
      const antes = travas.get(userId) ?? Promise.resolve();
      const agora = antes.then(fn, fn);
      travas.set(
        userId,
        agora.catch(() => undefined),
      );
      return agora;
    },
  };
}

// ── Histórico ─────────────────────────────────────────────────────────────────
export async function historicoDaConversa(db: Db, conversaId: string): Promise<TurnoAnterior[]> {
  const { data, error } = await db
    .from("cockpit_mensagens")
    .select("papel, texto, visao, criada_em")
    .eq("conversa_id", conversaId)
    .order("criada_em", { ascending: true })
    .limit(40);
  if (error) throw new Error("Não foi possível ler o histórico da conversa.");
  const turnos: TurnoAnterior[] = [];
  let pergunta: string | null = null;
  for (const m of data ?? []) {
    if (m.papel === "usuario") pergunta = m.texto;
    else if (pergunta !== null) {
      const d = VisaoDefinicaoSchema.safeParse(m.visao);
      turnos.push({ pergunta, conclusao: m.texto, definicao: d.success ? d.data : null });
      pergunta = null;
    }
  }
  return turnos;
}

const tituloDaPergunta = (p: string) => (p.length > 80 ? p.slice(0, 77).trimEnd() + "…" : p);

export interface PedidoConversa {
  conversaId?: string | null;
  pergunta: string;
}

/**
 * Roda uma rodada e persiste pergunta e resposta. Devolve o id da conversa (nova ou existente).
 * O acesso à área é conferido antes de qualquer coisa; sem ele, nada é lido nem gravado.
 */
export async function rodadaNoServidor(
  ctx: ContextoCockpit,
  pedido: PedidoConversa,
  emitir: (p: ParteConversa) => void,
  abortSignal?: AbortSignal,
): Promise<{ conversaId: string; resposta: RespostaFinal }> {
  const db = ctx.supabase as Db;
  const acesso: AcessoConversa = await conferirAcesso(ctx);

  let conversaId = pedido.conversaId ?? null;
  if (conversaId) {
    const { data } = await db
      .from("cockpit_conversas")
      .select("id")
      .eq("id", conversaId)
      .maybeSingle();
    // Conversa de outra pessoa não aparece pela RLS: vira "não encontrada", nunca leitura.
    if (!data) throw new Error("Conversa não encontrada.");
  } else {
    const { data, error } = await db
      .from("cockpit_conversas")
      .insert({ titulo: tituloDaPergunta(pedido.pergunta) })
      .select("id")
      .single();
    if (error) throw new Error("Não foi possível abrir a conversa.");
    conversaId = data.id as string;
  }
  emitir({
    type: "data-estado",
    data: { etapa: "conversa", detalhe: conversaId! },
    transient: true,
  });

  const historico = pedido.conversaId ? await historicoDaConversa(db, conversaId!) : [];
  await db
    .from("cockpit_mensagens")
    .insert({ conversa_id: conversaId, papel: "usuario", texto: pedido.pergunta });

  const chave = await obterChaveOpenRouter();
  const nomeModelo = modeloDoAmbiente();
  const limites = limitesDoAmbiente(process.env);
  let resposta: RespostaFinal;
  if (!chave) {
    resposta = {
      estado: "erro",
      conclusao:
        "A conversa por IA não está configurada neste ambiente (falta a chave do provedor no servidor). Os painéis do cockpit funcionam normalmente.",
      definicao: null,
      blocos: [],
      filtros: {},
      proximas: [],
      opcoes: [],
      descartadas: [],
      consultas: [],
      jev: { classe: null, confianca: null, motivo: "jev_indisponivel" },
      modelo: null,
      latenciaMs: 0,
      custoUsd: null,
      tentativas: 0,
    };
    emitir({ type: "data-resposta", data: resposta });
  } else {
    const provedor = createOpenRouter({ apiKey: chave });
    resposta = await responder(pedido.pergunta, {
      modelo: provedor(nomeModelo, { usage: { include: true } }),
      nomeModelo,
      hoje: hojeSaoPaulo(),
      historico,
      abortSignal,
      emitir,
      classificar: (pergunta, contexto) =>
        decidirJev(pedidoConversa(pergunta, contexto), {
          obterChave: async () => chave,
          ledger: ledgerJevNoBanco(db, ctx.userId),
          exemplo: "conversa",
          timeoutMs: 6_000,
          limites: { tentativas: 3_000, custoUsd: 1 },
        }),
      carregarFonte: () => fonteDaPessoa(ctx, acesso),
      salvarVisao: async (nome: string, definicao: VisaoDefinicao) => {
        const { data, error } = await db
          .from("cockpit_visoes")
          .insert({ nome, definicao, conversa_id: conversaId })
          .select("id")
          .single();
        if (error) throw new Error("falha ao salvar");
        return { id: data.id as string };
      },
      orcamento: async () => {
        const { data, error } = await db.schema("ops").rpc("cockpit_ia_orcamento");
        if (error) return { ok: false, motivo: "o controle de consumo não respondeu" };
        return avaliarOrcamento(data as Orcamento, limites);
      },
      registrarConsumo: async (e) => {
        const linha =
          e.fase === "reserva"
            ? { id: e.reservaId, tipo: "modelo", modelo: nomeModelo, estado: "reservada" }
            : {
                tipo: "modelo",
                modelo: nomeModelo,
                estado: e.estado,
                reserva_id: e.reservaId,
                custo_usd: e.custoUsd ?? null,
                custo_desconhecido: e.custoUsd === null || e.custoUsd === undefined,
                tokens_entrada: e.tokensEntrada ?? null,
                tokens_saida: e.tokensSaida ?? null,
                latencia_ms: e.latenciaMs ?? null,
                codigo: e.codigo ?? null,
              };
        const { error } = await db.from("cockpit_ia_consumo").insert(linha);
        if (error) console.error("[cockpit-ceo conversa] consumo não registrado:", error.code);
      },
    });
  }

  // A mensagem do assistente guarda o texto conferido e a DEFINIÇÃO da visão, sem números.
  await db.from("cockpit_mensagens").insert({
    conversa_id: conversaId,
    papel: "assistente",
    texto: resposta.conclusao.slice(0, 4000),
    visao: resposta.definicao,
    metadados: {
      estado: resposta.estado,
      proximas: resposta.proximas,
      opcoes: resposta.opcoes,
      descartadas: resposta.descartadas,
      consultas: resposta.consultas,
      jev: resposta.jev,
      modelo: resposta.modelo,
      latenciaMs: resposta.latenciaMs,
      custoUsd: resposta.custoUsd,
      tentativas: resposta.tentativas,
      filtros: resposta.filtros,
      ...(resposta.visaoSalva ? { visaoSalva: resposta.visaoSalva } : {}),
    },
  });
  await db
    .from("cockpit_conversas")
    .update({ atualizada_em: new Date().toISOString() })
    .eq("id", conversaId);
  return { conversaId: conversaId!, resposta };
}
