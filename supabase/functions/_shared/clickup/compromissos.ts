// Tarefa do ClickUp → linha do espelho (`ops.clickup_tarefas`) e diferença entre duas leituras →
// eventos (`ops.clickup_eventos`). Puro.
//
// O ClickUp não entrega pela API o histórico de prazo e de dono. O espelho guarda a última leitura
// de cada tarefa e registra o que mudou a cada rodada: é daí que saem "cumprido no prazo" e "prazo
// empurrado N vezes" na revisão de sexta.
import { concluidaStatus, opcaoDoCampo } from "./normalizar.ts";
import type { TarefaBruta } from "./normalizar.ts";

/** Nomes dos campos que o cockpit lê (criados à mão no ClickUp; a API não cria campo). */
export const CAMPO_TEMA = "Tema";
export const CAMPO_UNIDADE = "Unidade";
export const CAMPO_ORIGEM = "Origem no Brain";

/**
 * Enquanto os campos não existem na lista, o cockpit escreve tema, unidade e alerta de origem no
 * texto da tarefa ("Tema: … · Unidade: …" e "Alerta de origem: …"), e é dali que o espelho lê. O
 * ClickUp devolve o texto sem a marcação (sem ** e sem crase); as duas formas são aceitas.
 */
export function marcasDoTexto(texto: string | null | undefined): { tema: string | null; unidade: string | null; origem: string | null } {
  const t = (texto ?? "").replace(/\*\*|`/g, "");
  const pega = (re: RegExp) => t.match(re)?.[1]?.trim() || null;
  return {
    // O tema vem como "Ter · Financeiro e Operações": vai até o "· Unidade:", não até o primeiro "·".
    tema: pega(/^\s*Tema:\s*(.+?)\s*(?:·\s*Unidade:|$)/m),
    unidade: pega(/Unidade:\s*(.+?)\s*$/m),
    origem: pega(/^\s*Alerta de origem:\s*(\S+)\s*$/m),
  };
}

export interface Dono {
  id: string;
  nome: string | null;
  email: string | null;
}

export interface LinhaEspelho {
  id: string;
  parent_id: string | null;
  lista_id: string | null;
  lista_nome: string | null;
  pasta_id: string | null;
  pasta_nome: string | null;
  nome: string;
  url: string;
  status: string;
  status_tipo: string;
  concluida: boolean;
  donos: Dono[];
  prazo: string | null;
  criada_em: string | null;
  atualizada_em: string | null;
  concluida_em: string | null;
  tags: string[];
  tema: string | null;
  unidade: string | null;
  origem: string | null;
  prioridade: string | null;
}

/** ClickUp manda datas como milissegundos em texto. */
export function dataDoClickUp(ms: string | number | null | undefined): string | null {
  if (ms == null || ms === "") return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n).toISOString();
}

export function linhaDoEspelho(t: TarefaBruta, pastasPorLista: Record<string, { id: string; nome: string }> = {}): LinhaEspelho {
  const listaId = t.list?.id ?? null;
  const pasta = t.folder && !t.folder.hidden
    ? { id: t.folder.id, nome: t.folder.name ?? null }
    : listaId && pastasPorLista[listaId]
      ? { id: pastasPorLista[listaId].id, nome: pastasPorLista[listaId].nome }
      : null;
  const concluida = concluidaStatus(t.status?.type);
  const marcas = marcasDoTexto(t.text_content ?? t.description);
  return {
    id: t.id,
    parent_id: t.parent ?? null,
    lista_id: listaId,
    lista_nome: t.list?.name ?? null,
    pasta_id: pasta?.id ?? null,
    pasta_nome: pasta?.nome ?? null,
    nome: t.name,
    url: t.url,
    status: t.status?.status ?? "",
    status_tipo: t.status?.type ?? "",
    concluida,
    donos: (t.assignees ?? []).map((a) => ({
      id: String(a.id),
      nome: a.username ?? null,
      email: a.email ?? null,
    })),
    prazo: dataDoClickUp(t.due_date),
    criada_em: dataDoClickUp(t.date_created),
    atualizada_em: dataDoClickUp(t.date_updated),
    concluida_em: concluida ? dataDoClickUp(t.date_done ?? t.date_closed) : null,
    tags: (t.tags ?? []).map((x) => x.name),
    tema: opcaoDoCampo(t.custom_fields, CAMPO_TEMA) ?? marcas.tema,
    unidade: opcaoDoCampo(t.custom_fields, CAMPO_UNIDADE) ?? marcas.unidade,
    origem: opcaoDoCampo(t.custom_fields, CAMPO_ORIGEM) ?? marcas.origem,
    prioridade: t.priority?.priority ?? null,
  };
}

export type TipoEvento = "criada" | "status" | "prazo" | "dono" | "concluida" | "reaberta" | "sumiu";

export interface Evento {
  tarefa_id: string;
  tipo: TipoEvento;
  de: unknown;
  para: unknown;
}

const idsDonos = (l: Pick<LinhaEspelho, "donos">) =>
  l.donos
    .map((d) => d.id)
    .sort()
    .join(",");

/**
 * Mesmo instante? O banco devolve "2026-07-30T07:00:00+00:00" e a leitura nova vem como
 * "2026-07-30T07:00:00.000Z": comparar o texto gravava um "prazo mudou" a cada rodada para toda
 * tarefa com prazo (5.100 eventos falsos em 12 horas, 30/09/2026).
 */
export function mesmoInstante(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/**
 * O que mudou entre a leitura anterior e a atual. Tarefa nova vira "criada" (sem registrar os
 * campos iniciais como mudança); tarefa que sumiu da leitura vira "sumiu" (arquivada ou apagada).
 */
export function diferencas(anteriores: LinhaEspelho[], atuais: LinhaEspelho[]): Evento[] {
  const antes = new Map(anteriores.map((l) => [l.id, l]));
  const agora = new Map(atuais.map((l) => [l.id, l]));
  const eventos: Evento[] = [];
  for (const [id, n] of agora) {
    const a = antes.get(id);
    if (!a) {
      eventos.push({ tarefa_id: id, tipo: "criada", de: null, para: { prazo: n.prazo, donos: n.donos.map((d) => d.id) } });
      continue;
    }
    if (a.concluida !== n.concluida)
      eventos.push({ tarefa_id: id, tipo: n.concluida ? "concluida" : "reaberta", de: a.status, para: n.status });
    else if (a.status !== n.status) eventos.push({ tarefa_id: id, tipo: "status", de: a.status, para: n.status });
    if (!mesmoInstante(a.prazo, n.prazo)) eventos.push({ tarefa_id: id, tipo: "prazo", de: a.prazo, para: n.prazo });
    if (idsDonos(a) !== idsDonos(n))
      eventos.push({ tarefa_id: id, tipo: "dono", de: a.donos.map((d) => d.id), para: n.donos.map((d) => d.id) });
  }
  for (const [id, a] of antes)
    if (!agora.has(id)) eventos.push({ tarefa_id: id, tipo: "sumiu", de: a.status, para: null });
  return eventos;
}

/**
 * Trava de universo: uma leitura que perde mais da metade das tarefas não é "metade foi apagada",
 * é leitura quebrada. Nesse caso a rodada não marca ninguém como sumido.
 */
export function podeMarcarSumidas(anteriores: number, atuais: number): boolean {
  if (anteriores === 0) return true;
  return atuais >= anteriores * 0.5;
}
