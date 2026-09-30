// Assistente de triagem do Cockpit do COO (Jev). Parte pura: perguntas, limiares e leitura.
//
// Papel aprovado pelo COO em 29/09/2026 ("Assistente de triagem: Aprovo"): SUGERIR, sempre com
// confirmação de uma pessoa.
// - tema: qual reunião da rotina acompanha a tarefa (compromisso sem o campo Tema);
// - unidade: de qual unidade a tarefa trata (sem o campo Unidade);
// - bloqueio: pelos últimos comentários, a tarefa espera outra pessoa ou área?;
// - duplicidade: antes de criar, alguma tarefa aberta do tema já trata disso?
// O Jev não calcula número, não escolhe alerta, não muda status e nunca grava sozinho.
import { JEV_MODELO } from "../cockpit-ceo/jev/contrato.ts";
import type { PedidoJev, RespostaJev } from "../cockpit-ceo/jev/contrato.ts";
import { ORDEM_TEMAS, TEMAS } from "./contrato.ts";
import type { Tema } from "./contrato.ts";
import type { UnidadeCoo } from "./unidades.ts";

export const TAXONOMIA_TRIAGEM = "cockpit-coo-triagem-v1";

export type PerguntaTriagem = "tema" | "unidade" | "bloqueio" | "duplicidade";

export interface SugestaoCoo {
  id: number;
  tarefa_id: string;
  pergunta: PerguntaTriagem;
  resposta: string | null;
  /** O que a tela mostra: nome do tema, da unidade ou da tarefa duplicada. */
  rotulo: string;
  confianca: number | null;
  estado: "pendente" | "confirmada" | "descartada" | "abaixo_do_limiar";
}

/**
 * Limiares: a sugestão só aparece com confiança igual ou acima. Calibração de 29/09/2026
 * (docs/dev_notes/cockpit-coo/jev-calibracao.md), regra da spec: só liga a pergunta que chega a
 * 90% de acerto na faixa aceita.
 * - tema: DESLIGADO (acima de 1). Com 108 KRs reais, o Jev acertou 51% no total e 81% nos 31 casos
 *   acima de 0,9: os temas se sobrepõem (KR de Receitas fala de venda e cai em Growth). O tema de
 *   uma tarefa sai da pasta do ClickUp (mapa aprovado pelo COO), sem IA.
 * - unidade: 0,8 → 22 de 24 frases acima do limiar, 100% certas. Conjunto SINTÉTICO: rever com
 *   tarefas reais quando o ClickUp estiver conectado.
 * - bloqueio: DESLIGADO até existir amostra rotulada de comentários reais.
 * - duplicidade: 0,85, só como aviso antes de criar (a pessoa pode criar mesmo assim). Não calibrado.
 */
export const LIMIARES_TRIAGEM = { tema: 1.01, unidade: 0.8, bloqueio: 1.01, duplicidade: 0.85 };

export const FORA_DA_ROTINA = "fora_da_rotina";
export const REDE = "rede";
export const NENHUMA = "nenhuma";

export function opcoesTema(): Record<string, string> {
  return {
    ...Object.fromEntries(
      ORDEM_TEMAS.map((t) => [
        t,
        `${TEMAS[t].titulo} (${TEMAS[t].diaRotulo}): ${TEMAS[t].pergunta} Departamentos: ${TEMAS[t].departamentos.join(", ")}.`,
      ]),
    ),
    [FORA_DA_ROTINA]: "Não é assunto de nenhuma das cinco reuniões da semana da Expansão.",
  };
}

export function opcoesUnidade(unidades: UnidadeCoo[]): Record<string, string> {
  const apelidos: Record<string, string> = {
    goiania: " (também chamada de Matriz ou Partners)",
    "rio de janeiro": " (também RJ ou Sudeste)",
  };
  return {
    ...Object.fromEntries(
      unidades.map((u) => [`u${u.id}`, `A unidade ${u.nome}${apelidos[u.chave] ?? ""}.`]),
    ),
    [REDE]: "Trata da rede inteira ou de várias unidades ao mesmo tempo.",
    [NENHUMA]: "Não trata de unidade nenhuma (assunto interno da matriz).",
  };
}

/** Texto que o Jev lê de uma tarefa: nome, lista e status. Nunca descrição longa nem cliente. */
export function textoDaTarefa(t: { nome: string; lista?: string | null; status?: string | null }): string {
  return [t.nome, t.lista ? `Lista: ${t.lista}` : null, t.status ? `Status: ${t.status}` : null]
    .filter(Boolean)
    .join("\n")
    .slice(0, 800);
}

/** Assinatura curta do texto: se a tarefa mudar de nome, a sugestão antiga não vale mais. */
export function assinatura(texto: string): string {
  let h = 0;
  for (let i = 0; i < texto.length; i++) h = (h * 31 + texto.charCodeAt(i)) | 0;
  return `${texto.length}:${(h >>> 0).toString(36)}`;
}

export function pedidoTriagem(
  texto: string,
  unidades: UnidadeCoo[],
  perguntas: { tema: boolean; unidade: boolean },
): PedidoJev {
  const questions: PedidoJev["questions"] = {};
  if (perguntas.tema)
    questions.tema = {
      type: "choice",
      instructions:
        "`tarefa` é um compromisso anotado numa reunião semanal da Expansão Nacional da Planning (rede de unidades de contabilidade). Em qual das reuniões da semana esse assunto é acompanhado?",
      criteria: opcoesTema(),
    };
  if (perguntas.unidade)
    questions.unidade = {
      type: "choice",
      instructions:
        "De qual unidade da Planning a tarefa em `tarefa` trata? Escolha a rede quando citar várias unidades, e nenhuma quando não citar unidade.",
      criteria: opcoesUnidade(unidades),
    };
  return { model: JEV_MODELO, state: { tarefa: texto }, questions };
}

export function pedidoBloqueio(texto: string, comentarios: string[]): PedidoJev {
  return {
    model: JEV_MODELO,
    state: {
      tarefa: texto,
      comentarios: comentarios.length ? comentarios.join("\n---\n").slice(0, 3000) : "Sem comentários.",
    },
    questions: {
      bloqueio: {
        type: "noul",
        instructions:
          "Pelos `comentarios` mais recentes da `tarefa`, ela está parada esperando outra pessoa, outra área ou um terceiro fazer algo antes de andar?",
        criteria: {
          true: "Os comentários dizem que a tarefa aguarda alguém ou alguma coisa de fora para seguir.",
          false: "Não há espera por terceiros nos comentários, ou não há comentário.",
        },
      },
    },
  };
}

export function pedidoDuplicidade(novo: string, abertas: { id: string; nome: string }[]): PedidoJev {
  const criteria: Record<string, string> = Object.fromEntries(abertas.slice(0, 20).map((a, i) => [`t${i}`, a.nome.slice(0, 200)]));
  criteria.nenhuma = "Nenhuma das tarefas abertas trata do mesmo assunto.";
  return {
    model: JEV_MODELO,
    state: { nova: novo.slice(0, 400) },
    questions: {
      duplicada: {
        type: "choice",
        instructions:
          "A tarefa em `nova` vai ser criada. Alguma das tarefas abertas listadas nas opções já trata do MESMO assunto (mesma ação sobre a mesma unidade ou o mesmo problema)?",
        criteria,
      },
    },
  };
}

/** Probabilidade da escolha (ou a confiança resumida, quando o provedor não manda a distribuição). */
export function confiancaDa(r: RespostaJev | undefined): number | null {
  if (!r) return null;
  if (r.type === "noul") return r.noul;
  if (r.type === "choice") return r.probabilities?.[r.choice] ?? r.confidence ?? null;
  return r.confidence ?? null;
}

export interface LeituraTriagem {
  tema: { tema: Tema | null; fora: boolean; confianca: number | null; aceita: boolean } | null;
  unidade: { unidadeId: number | null; rede: boolean; nenhuma: boolean; confianca: number | null; aceita: boolean } | null;
}

export function lerTriagem(respostas: Record<string, RespostaJev>, limiares = LIMIARES_TRIAGEM): LeituraTriagem {
  const t = respostas.tema;
  const u = respostas.unidade;
  const tema =
    t && t.type === "choice"
      ? (() => {
          const conf = confiancaDa(t);
          const valida = t.choice === FORA_DA_ROTINA || (ORDEM_TEMAS as string[]).includes(t.choice);
          return {
            tema: valida && t.choice !== FORA_DA_ROTINA ? (t.choice as Tema) : null,
            fora: t.choice === FORA_DA_ROTINA,
            confianca: conf,
            aceita: valida && conf != null && conf >= limiares.tema,
          };
        })()
      : null;
  const unidade =
    u && u.type === "choice"
      ? (() => {
          const conf = confiancaDa(u);
          const m = /^u(\d+)$/.exec(u.choice);
          return {
            unidadeId: m ? Number(m[1]) : null,
            rede: u.choice === REDE,
            nenhuma: u.choice === NENHUMA,
            confianca: conf,
            aceita: (Boolean(m) || u.choice === REDE) && conf != null && conf >= limiares.unidade,
          };
        })()
      : null;
  return { tema, unidade };
}

/** Duplicidade: a tarefa aberta que o Jev apontou, se passou do limiar. */
export function lerDuplicidade(
  resposta: RespostaJev | undefined,
  abertas: { id: string; nome: string; url?: string }[],
  limiar = LIMIARES_TRIAGEM.duplicidade,
): { id: string; nome: string; url?: string; confianca: number } | null {
  if (!resposta || resposta.type !== "choice") return null;
  const m = /^t(\d+)$/.exec(resposta.choice);
  const conf = confiancaDa(resposta);
  if (!m || conf == null || conf < limiar) return null;
  const a = abertas[Number(m[1])];
  return a ? { ...a, confianca: conf } : null;
}
