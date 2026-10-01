// "Perguntar ao Brain" do Cockpit do COO no servidor.
//
// Modelo pelo OpenRouter (OPENROUTER_API_KEY; no local, COCKPIT_IA_KEYCHAIN=1), escolhido por
// COCKPIT_COO_MODELO dentro de uma lista fechada; padrão openai/gpt-6-luna desde 01/10/2026 (o
// mesmo do CEO; antes era o openai/gpt-5.5 da avaliação de 25/09). Teto de gasto próprio do COO (ops.cockpit_ia_orcamento('coo')),
// conferido antes da chamada; consumo gravado com cockpit = 'coo'. Sem histórico gravado nesta
// versão: cada pergunta é uma rodada.
import { createServerFn } from "@tanstack/react-start";
import { generateText, isStepCount, tool } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { obterChaveOpenRouter } from "../cockpit-ceo/conversa/servidor.server";
import { avaliarOrcamento, limitesDoAmbiente } from "../cockpit-ceo/conversa/orcamento";
import type { Orcamento } from "../cockpit-ceo/conversa/orcamento";
import { abrirContextoCoo } from "./contexto.server.ts";
import { lerBaseCoo } from "./base.functions.ts";
import { lerTarefas } from "./compromissos.ts";
import { ORDEM_TEMAS, ehTema } from "./contrato.ts";
import type { LeituraTema, Tema } from "./contrato.ts";
import { montarOkrsTema } from "./okrs.ts";
import { filtroValido } from "./unidades.ts";
import { lerGrowth } from "./temas/growth.server.ts";
import { montarGrowth } from "./temas/growth.ts";
import { lerFinanceiroOperacoes } from "./temas/financeiro-operacoes.server.ts";
import { montarFinanceiroOperacoes } from "./temas/financeiro-operacoes.ts";
import { lerCsRh } from "./temas/cs-rh.server.ts";
import { montarCsRh } from "./temas/cs-rh.ts";
import { lerEstrategico } from "./temas/estrategico.server.ts";
import { montarEstrategico } from "./temas/estrategico.ts";
import { lerMonetizacaoNoServidor } from "./temas/monetizacao.server.ts";
import { montarMonetizacao } from "./temas/monetizacao.ts";
import {
  INSTRUCOES_COO,
  conferirResposta,
  resumoDaLeitura,
  resumoDosCompromissos,
  resumoDosOkrs,
} from "./perguntar.ts";

export const MODELOS_COO = [
  "openai/gpt-6-luna",
  "openai/gpt-5.5",
  "anthropic/claude-sonnet-5",
  "openai/gpt-5.4-mini",
] as const;
const MAX_PASSOS = 6;

export interface RespostaCoo {
  estado: "ok" | "erro" | "sem_orcamento" | "sem_chave";
  texto: string;
  descartadas: string[];
  consultas: { ferramenta: string; args: Record<string, string | boolean> }[];
  modelo: string | null;
  custoUsd: number | null;
}

export const perguntarCoo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pergunta: string; tema?: string; unidade?: string }) => {
    const pergunta = String(input?.pergunta ?? "").trim();
    if (!pergunta) throw new Error("Escreva a pergunta.");
    if (pergunta.length > 1000) throw new Error("A pergunta passou de 1.000 caracteres.");
    return { pergunta, tema: ehTema(input.tema) ? input.tema : undefined, unidade: String(input.unidade ?? "") };
  })
  .handler(async ({ data, context }): Promise<RespostaCoo> => {
    const ctx = await abrirContextoCoo(context);
    const vazio = { descartadas: [], consultas: [], modelo: null, custoUsd: null };
    const chave = await obterChaveOpenRouter();
    if (!chave) return { estado: "sem_chave", texto: "A IA do cockpit não está configurada neste ambiente (chave do OpenRouter).", ...vazio };
    const { data: orc, error } = await ctx.db.schema("ops").rpc("cockpit_ia_orcamento", { _cockpit: "coo" });
    if (error) return { estado: "erro", texto: "O controle de consumo de IA não respondeu. Tente de novo.", ...vazio };
    const aval = avaliarOrcamento(orc as Orcamento, limitesDoAmbiente(process.env));
    if (!aval.ok) return { estado: "sem_orcamento", texto: `Sem orçamento de IA agora: ${aval.motivo}.`, ...vazio };

    const env = process.env.COCKPIT_COO_MODELO;
    const nomeModelo = env && (MODELOS_COO as readonly string[]).includes(env) ? env : MODELOS_COO[0];
    const modelo = createOpenRouter({ apiKey: chave })(nomeModelo, { usage: { include: true } });

    const resultados: unknown[] = [];
    const consultas: RespostaCoo["consultas"] = [];
    let base: Awaited<ReturnType<typeof lerBaseCoo>> | null = null;
    const obterBase = async () => (base ??= await lerBaseCoo(ctx));
    const filtroDe = (u: string | undefined) => (u && filtroValido(ctx.unidades, u) ? u : "");

    const lerTema = async (tema: Tema, unidade: string): Promise<LeituraTema | { estado: string; motivo: string }> => {
      switch (tema) {
        case "growth":
          return montarGrowth(await lerGrowth(ctx), ctx.unidades, unidade, ctx.hoje);
        case "financeiro-operacoes":
          return montarFinanceiroOperacoes(await lerFinanceiroOperacoes(ctx), ctx.unidades, unidade, ctx.hoje);
        case "cs-rh":
          return montarCsRh(await lerCsRh(ctx), ctx.unidades, unidade, ctx.hoje);
        case "estrategico": {
          const b = await obterBase();
          const agora = new Date().toISOString();
          const cs = b.compromissos.ok ? lerTarefas(b.compromissos.dado, agora, ctx.unidades) : [];
          return montarEstrategico(await lerEstrategico(ctx), { okrs: b.okrs.ok ? b.okrs.dado : [], compromissos: cs, clickupConectado: b.clickup.conectado, okrsMotivo: b.okrs.ok ? undefined : b.okrs.motivo, compromissosMotivo: b.compromissos.ok ? undefined : b.compromissos.motivo }, ctx.unidades, unidade, ctx.hoje);
        }
        case "monetizacao":
          // No servidor, só o projetado × realizado; a régua das unidades volta "não apurado" com o motivo.
          return montarMonetizacao(await lerMonetizacaoNoServidor(ctx), ctx.unidades, unidade, ctx.hoje);
      }
    };

    // Consulta repetida não lê de novo. Na prova real do GPT-6 Luna (01/10/2026) ele pediu a mesma
    // leitura de Financeiro e Operações 16 vezes, em paralelo, até estourar o tempo, e a pessoa ficou
    // sem resposta. A primeira chamada lê; as iguais (mesmo na mesma rodada) recebem só o aviso.
    const vistas = new Set<string>();
    const repetida = (nome: string, args: Record<string, unknown>) => {
      const usados = Object.entries(args).filter(([, v]) => v !== undefined && v !== "" && v !== false);
      const chave = nome + JSON.stringify(usados.sort());
      if (vistas.has(chave))
        return {
          repetida: true,
          aviso: "Esta consulta já foi feita nesta pergunta. Use o resultado anterior e responda.",
        };
      vistas.add(chave);
      return null;
    };

    const temaSchema = z.enum(ORDEM_TEMAS as [Tema, ...Tema[]]);
    const unidadeSchema = z
      .string()
      .max(10)
      .optional()
      .describe('Vazio = todas as unidades; "rede"; "propria"; ou o id da unidade. Ids: ' + ctx.unidades.map((u) => `${u.id}=${u.nome}`).join(", "));
    const ferramentas = {
      ler_tema: tool({
        description: "Números, alertas e gráfico de um tema da semana, no recorte de unidade pedido. É o mesmo dado da tela.",
        inputSchema: z.object({ tema: temaSchema, unidade: unidadeSchema }).strict(),
        execute: async ({ tema, unidade }: { tema: Tema; unidade?: string }) => {
          const rep = repetida("ler_tema", { tema, unidade: filtroDe(unidade) });
          if (rep) return rep;
          consultas.push({ ferramenta: "ler_tema", args: { tema, unidade: unidade ?? "" } });
          const l = await lerTema(tema, filtroDe(unidade));
          const r = "numeros" in l ? resumoDaLeitura(l) : l;
          resultados.push(r);
          return r;
        },
      }),
      ler_okrs: tool({
        description: "Evolução dos OKRs dos departamentos de um tema (progresso contra o esperado do ciclo).",
        inputSchema: z.object({ tema: temaSchema }).strict(),
        execute: async ({ tema }: { tema: Tema }) => {
          const rep = repetida("ler_okrs", { tema });
          if (rep) return rep;
          consultas.push({ ferramenta: "ler_okrs", args: { tema } });
          const b = await obterBase();
          const r = b.okrs.ok ? resumoDosOkrs(montarOkrsTema(tema, b.okrs.dado, ctx.hoje)) : { estado: b.okrs.estado, motivo: b.okrs.motivo };
          resultados.push(r);
          return r;
        },
      }),
      ler_compromissos: tool({
        description:
          "Execução no ClickUp da Expansão Nacional: tarefas das áreas (KRs, entregas, direcionamentos; o tema vem da pasta do departamento) e compromissos da rotina do COO, com dono, prazo, tema, unidade e situação. Filtros opcionais: tema, só abertas, só vencidas, departamento (ex.: \"Operações\"). Devolve até 40, vencidas primeiro, e o total.",
        inputSchema: z
          .object({
            tema: temaSchema.optional(),
            soVencidos: z.boolean().optional(),
            soAbertas: z.boolean().optional(),
            departamento: z.string().max(60).optional(),
          })
          .strict(),
        execute: async ({ tema, soVencidos, soAbertas, departamento }: { tema?: Tema; soVencidos?: boolean; soAbertas?: boolean; departamento?: string }) => {
          const rep = repetida("ler_compromissos", { tema, soVencidos, soAbertas, departamento });
          if (rep) return rep;
          consultas.push({ ferramenta: "ler_compromissos", args: { tema: tema ?? "", soVencidos: !!soVencidos, soAbertas: !!soAbertas, departamento: departamento ?? "" } });
          const b = await obterBase();
          if (!b.clickup.conectado) {
            const r = { estado: "nao_apurado", motivo: "o ClickUp ainda não está conectado (token em Administração › Chaves de Integração)" };
            resultados.push(r);
            return r;
          }
          const agora = new Date().toISOString();
          let cs = b.compromissos.ok ? lerTarefas(b.compromissos.dado, agora, ctx.unidades) : [];
          if (tema) cs = cs.filter((c) => c.tema === tema);
          if (soVencidos) cs = cs.filter((c) => c.vencido);
          if (soAbertas) cs = cs.filter((c) => !c.concluida);
          if (departamento) {
            const d = departamento.toLocaleLowerCase("pt-BR");
            cs = cs.filter((c) => (c.departamento ?? "").toLocaleLowerCase("pt-BR").includes(d));
          }
          const r = { total: cs.length, compromissos: resumoDosCompromissos(cs) };
          resultados.push(r);
          return r;
        },
      }),
    };

    const contexto = data.tema ? `\nA pessoa está na tela do tema "${data.tema}"${data.unidade ? `, unidade ${data.unidade}` : ""}.` : "";
    const reservaId = crypto.randomUUID();
    await ctx.db.from("cockpit_ia_consumo").insert({ id: reservaId, tipo: "modelo", modelo: nomeModelo, estado: "reservada", cockpit: "coo" });
    const t0 = Date.now();
    try {
      const r = await generateText({
        model: modelo,
        instructions: INSTRUCOES_COO(ctx.hoje) + contexto,
        messages: [{ role: "user", content: data.pergunta }],
        tools: ferramentas,
        stopWhen: [isStepCount(MAX_PASSOS)],
        // O último passo é sem ferramenta: o modelo tem de escrever a resposta com o que já leu.
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_PASSOS - 1 ? { toolChoice: "none" as const } : {},
        maxRetries: 0,
        // Sem teto explícito o provedor reserva 65 mil tokens de saída (medido em 24/09).
        maxOutputTokens: 2000,
        timeout: { totalMs: 90_000, stepMs: 45_000 },
      });
      let custo = 0;
      let conhecido = true;
      for (const s of r.steps) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const c = (s.providerMetadata as any)?.openrouter?.usage?.cost;
        if (typeof c === "number") custo += c;
        else conhecido = false;
      }
      await ctx.db.from("cockpit_ia_consumo").insert({
        tipo: "modelo",
        modelo: nomeModelo,
        estado: "ok",
        reserva_id: reservaId,
        custo_usd: conhecido ? custo : null,
        custo_desconhecido: !conhecido,
        tokens_entrada: r.totalUsage.inputTokens ?? null,
        tokens_saida: r.totalUsage.outputTokens ?? null,
        latencia_ms: Date.now() - t0,
        cockpit: "coo",
      });
      const conferido = conferirResposta(r.text, resultados, data.pergunta);
      return {
        estado: "ok",
        texto: conferido.texto || "Não consegui responder com números que tenham origem nos dados do cockpit.",
        descartadas: conferido.descartadas,
        consultas,
        modelo: nomeModelo,
        custoUsd: conhecido ? custo : null,
      };
    } catch (e) {
      await ctx.db.from("cockpit_ia_consumo").insert({
        tipo: "modelo",
        modelo: nomeModelo,
        estado: "falha",
        reserva_id: reservaId,
        custo_desconhecido: true,
        latencia_ms: Date.now() - t0,
        codigo: (e as Error).name,
        cockpit: "coo",
      });
      return { estado: "erro", texto: "O modelo não respondeu agora. Nenhum número foi mostrado.", ...vazio, consultas, modelo: nomeModelo };
    }
  });
