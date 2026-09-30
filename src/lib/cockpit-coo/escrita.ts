// Escritas do Cockpit do COO no ClickUp: a parte pura (monta o corpo de cada requisição).
// O servidor (compromissos.functions.ts) confere área, token e idempotência e só então chama a API.
//
// Regras do compromisso (spec §6.1, aprovada pelo COO): dono único, prazo, tema da rotina, unidade
// (ou "Rede") e, quando nasce de um alerta, a chave dele no campo "Origem no Brain".
import { opcaoPorNome } from "../../../supabase/functions/_shared/clickup/campos.ts";
import type { CampoBruto } from "../../../supabase/functions/_shared/clickup/normalizar.ts";
import {
  CAMPO_ORIGEM,
  CAMPO_TEMA,
  CAMPO_UNIDADE,
} from "../../../supabase/functions/_shared/clickup/compromissos.ts";
import { TEMAS } from "./contrato.ts";
import type { Tema } from "./contrato.ts";

export interface NovoCompromisso {
  titulo: string;
  /** Contexto do alerta (uma ou duas linhas). */
  contexto?: string;
  donoId: number;
  /** YYYY-MM-DD */
  prazo: string;
  tema: Tema;
  /** Nome da unidade como no cadastro, ou "Rede". */
  unidade: string;
  chaveAlerta?: string | null;
  linkBrain?: string | null;
}

export interface Autor {
  nome: string;
  email: string | null;
}

/**
 * Prazo do ClickUp em milissegundos: fim do expediente (18h) em São Paulo no dia escolhido.
 * São Paulo não tem horário de verão desde 2019: 18h em SP = 21h UTC.
 */
export function prazoEmMs(dia: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error("Prazo inválido: use AAAA-MM-DD.");
  return Date.parse(`${dia}T21:00:00.000Z`);
}

/** Próxima reunião do tema (mesmo dia da semana), estritamente depois de hoje: o prazo padrão. */
export function proximaReuniao(tema: Tema, hojeIso: string): string {
  const d = new Date(`${hojeIso}T12:00:00Z`);
  for (let i = 1; i <= 7; i++) {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    if (x.getUTCDay() === TEMAS[tema].dia) return x.toISOString().slice(0, 10);
  }
  return hojeIso;
}

export function validarNovo(n: NovoCompromisso, hojeIso: string): string | null {
  if (!n.titulo.trim()) return "Escreva o que precisa ser feito.";
  if (n.titulo.trim().length > 200) return "O título passou de 200 caracteres.";
  if (!Number.isInteger(n.donoId) || n.donoId <= 0) return "Escolha um dono: compromisso tem um dono só.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(n.prazo)) return "Escolha o prazo.";
  if (n.prazo < hojeIso) return "O prazo não pode ficar no passado.";
  if (!(n.tema in TEMAS)) return "Escolha o tema da rotina.";
  if (!n.unidade.trim()) return "Escolha a unidade (ou Rede).";
  return null;
}

export interface CamposResolvidos {
  faltando: string[];
  custom_fields: { id: string; value: unknown }[];
}

/** Valores dos três campos do compromisso, na forma da API; o que não existir na lista é listado. */
export function camposDoCompromisso(campos: CampoBruto[], n: NovoCompromisso): CamposResolvidos {
  const faltando: string[] = [];
  const custom_fields: { id: string; value: unknown }[] = [];
  const achar = (nome: string) => campos.find((c) => c.name.includes(nome));

  const tema = achar(CAMPO_TEMA);
  if (!tema) faltando.push(CAMPO_TEMA);
  else {
    const opcoes = tema.type_config?.options ?? [];
    const id =
      opcaoPorNome(opcoes, TEMAS[n.tema].titulo) ??
      opcaoPorNome(opcoes, TEMAS[n.tema].menu) ??
      opcaoPorNome(opcoes, TEMAS[n.tema].diaRotulo);
    if (id) custom_fields.push({ id: tema.id, value: id });
    else faltando.push(`${CAMPO_TEMA} (opção "${TEMAS[n.tema].titulo}")`);
  }

  const unidade = achar(CAMPO_UNIDADE);
  if (!unidade) faltando.push(CAMPO_UNIDADE);
  else if (unidade.type === "drop_down") {
    const id = opcaoPorNome(unidade.type_config?.options ?? [], n.unidade);
    if (id) custom_fields.push({ id: unidade.id, value: id });
    else faltando.push(`${CAMPO_UNIDADE} (opção "${n.unidade}")`);
  } else custom_fields.push({ id: unidade.id, value: n.unidade });

  if (n.chaveAlerta) {
    const origem = achar(CAMPO_ORIGEM);
    if (!origem) faltando.push(CAMPO_ORIGEM);
    else custom_fields.push({ id: origem.id, value: n.chaveAlerta });
  }
  return { faltando, custom_fields };
}

/** Corpo do POST /list/{id}/task. O autor real vai na descrição: o token é de uma conta só. */
export function corpoTarefaNova(n: NovoCompromisso, campos: CampoBruto[], autor: Autor, agoraIso: string) {
  const r = camposDoCompromisso(campos, n);
  const linhas = [
    n.contexto?.trim() ? n.contexto.trim() : null,
    "",
    `**Tema:** ${TEMAS[n.tema].menu} · **Unidade:** ${n.unidade}`,
    n.chaveAlerta ? `**Alerta de origem:** \`${n.chaveAlerta}\`` : null,
    n.linkBrain ? `**No Brain:** ${n.linkBrain}` : null,
    "",
    `Criado pelo Cockpit do COO por ${autor.nome}${autor.email ? ` (${autor.email})` : ""} em ${agoraIso.slice(0, 16).replace("T", " ")} UTC.`,
  ].filter((l): l is string => l !== null);
  // Campo que falta não trava a criação: o texto também leva tema e unidade, e a tela avisa.
  if (r.faltando.length)
    linhas.push("", `_Campos que faltam na lista do ClickUp: ${r.faltando.join(", ")}._`);
  return {
    corpo: {
      name: n.titulo.trim(),
      markdown_description: linhas.join("\n"),
      assignees: [n.donoId],
      due_date: prazoEmMs(n.prazo),
      due_date_time: false,
      custom_fields: r.custom_fields,
    },
    faltando: r.faltando,
  };
}

export interface StatusLista {
  status: string;
  type: string;
  orderindex?: number;
}

/** O status "fechado" da lista: o de tipo closed, senão o último de tipo done. */
export function statusConcluido(statuses: StatusLista[]): string | null {
  const fechado = statuses.find((s) => s.type === "closed");
  if (fechado) return fechado.status;
  const feitos = statuses.filter((s) => s.type === "done");
  return feitos.length ? feitos[feitos.length - 1].status : null;
}

/** Troca de dono: entra o novo, saem todos os outros (compromisso tem um dono só). */
export function corpoTrocaDono(atuais: (string | number)[], novo: number) {
  return {
    assignees: {
      add: [novo],
      rem: atuais.map(Number).filter((id) => Number.isFinite(id) && id !== novo),
    },
  };
}

export function corpoComentario(texto: string, autor: Autor) {
  const t = texto.trim();
  if (!t) throw new Error("Escreva o comentário.");
  if (t.length > 2000) throw new Error("O comentário passou de 2.000 caracteres.");
  return { comment_text: `${t}\n\n— ${autor.nome}, pelo Cockpit do COO`, notify_all: false };
}
