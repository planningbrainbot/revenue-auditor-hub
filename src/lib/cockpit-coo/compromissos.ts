// Execução do COO: a leitura do espelho do ClickUp (`ops.clickup_tarefas` + `ops.clickup_eventos`)
// na forma que a tela pede. Puro.
//
// Duas origens, a mesma forma (`Compromisso`):
// - compromisso da rotina: tarefa da lista "✅ Compromissos da rotina" (pasta Rotina Semanal do
//   COO), com dono único, prazo, tema, unidade (ou "Rede") e, quando nasceu no cockpit, a chave do
//   alerta de origem. O cockpit lê e escreve;
// - tarefa de área (pedido do Pedro em 30/09: "a parte de operação tá sem nenhuma task; tem que ter
//   um reflexo do ClickUp"): tudo o que os departamentos mantêm no space da Expansão Nacional (KRs,
//   entregas das KRs, direcionamentos de 1:1). O tema vem da pasta do departamento. O cockpit só lê.
import type { LinhaEspelho } from "../../../supabase/functions/_shared/clickup/compromissos.ts";
import { ORDEM_TEMAS, TEMAS, departamentoBase, temasDoDepartamento } from "./contrato.ts";
import type { Tema } from "./contrato.ts";
import { acharUnidade } from "./unidades.ts";
import type { UnidadeCoo } from "./unidades.ts";

export type { LinhaEspelho };

/** Valor JSON (o que o banco guarda em jsonb): serializável de ponta a ponta. */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export interface LinhaEvento {
  tarefa_id: string;
  tipo: string;
  de: Json;
  para: Json;
  em: string;
}

/** De onde a tarefa vem: a lista de compromissos da rotina ou a pasta de um departamento. */
export type OrigemTarefa = "rotina" | "area";
/** O papel da tarefa no quadro (a mesma régua de `normalizarOkrs`: raiz fora de 🗣️/📖 é KR). */
export type TipoTarefa = "compromisso" | "kr" | "entrega" | "direcionamento";

export const ROTULO_TIPO: Record<TipoTarefa, string> = {
  compromisso: "Compromisso",
  kr: "KR",
  entrega: "Entrega",
  direcionamento: "Direcionamento",
};

export interface Compromisso {
  id: string;
  origemTarefa: OrigemTarefa;
  tipo: TipoTarefa;
  /** Departamento da pasta ("Operações"); null nos compromissos da rotina. */
  departamento: string | null;
  /** A KR mãe de uma entrega. */
  pai: string | null;
  nome: string;
  url: string;
  status: string;
  concluida: boolean;
  dono: { id: string; nome: string | null } | null;
  /** Donos além do primeiro: compromisso deveria ter um só. */
  outrosDonos: number;
  prazo: string | null;
  tema: Tema | null;
  temaTexto: string | null;
  unidade: string | null;
  origem: string | null;
  criadaEm: string | null;
  atualizadaEm: string | null;
  concluidaEm: string | null;
  lista: string | null;
  pasta: string | null;
  vencido: boolean;
  diasVencido: number | null;
  parado: boolean;
  /** Quantas vezes o prazo foi para frente (desde que o espelho acompanha a tarefa). */
  adiamentos: number;
  cumpridoNoPrazo: boolean | null;
}

export const PASTA_ROTINA = "Rotina Semanal";
/** A lista dos compromissos dentro da pasta (no ClickUp: "✅ Compromissos da rotina"). */
export const LISTA_COMPROMISSOS = "Compromissos";
export const DIAS_PARADO = 7;

const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Compromisso é tarefa da lista de compromissos na pasta da Rotina Semanal. No ClickUp a pasta tem
 * enfeite ("🗓️ Rotina Semanal · Paulo"), então casa por conteúdo, não pelo começo do nome. A
 * "Minha Semana" da mesma pasta (os blocos D1–D5 e a caixa de entrada) não é compromisso.
 */
export function ehCompromissoDaRotina(pasta: string | null | undefined, lista: string | null | undefined): boolean {
  return chave(pasta ?? "").includes(chave(PASTA_ROTINA)) && chave(lista ?? "").includes(chave(LISTA_COMPROMISSOS));
}

export const ehPastaDaRotina = (nome: string | null | undefined) => chave(nome ?? "").includes(chave(PASTA_ROTINA));
export const ehListaDeCompromissos = (nome: string | null | undefined) =>
  chave(nome ?? "").includes(chave(LISTA_COMPROMISSOS));

/** O valor do campo Tema do ClickUp → tema do cockpit. Aceita título, rótulo do menu ou dia. */
export function temaDoTexto(texto: string | null | undefined): Tema | null {
  if (!texto) return null;
  const c = chave(texto);
  for (const t of ORDEM_TEMAS) {
    const d = TEMAS[t];
    if ([d.titulo, d.menu, d.diaRotulo, t].some((x) => chave(x) === c)) return t;
    if (c.includes(chave(d.titulo))) return t;
  }
  return null;
}

const DIA_SAO_PAULO = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * O dia (AAAA-MM-DD) em São Paulo. O ClickUp grava prazo sem hora às 04h locais (07h UTC): a
 * tarefa que vence hoje só está vencida amanhã, e o dia do prazo é o de São Paulo, não o do UTC.
 */
export function diaDe(iso: string): string {
  return iso.length === 10 ? iso : DIA_SAO_PAULO.format(new Date(iso));
}

function diasEntre(deIso: string, ateIso: string): number {
  return Math.floor((Date.parse(ateIso) - Date.parse(deIso)) / 86_400_000);
}

/** Lista de guia ("📖 COMECE AQUI"): não é trabalho. */
const LISTA_GUIA = /^📖/u;
const LISTA_DIRECIONAMENTO = /^🗣️|direcionamento/iu;

/**
 * Entra na execução: compromisso da rotina ou tarefa de área. Fica de fora o resto da pasta da
 * rotina (a "📅 Minha Semana" é do COO) e as listas de guia.
 */
export function entraNaExecucao(l: Pick<LinhaEspelho, "pasta_nome" | "lista_nome">): boolean {
  if (ehCompromissoDaRotina(l.pasta_nome, l.lista_nome)) return true;
  if (ehPastaDaRotina(l.pasta_nome)) return false;
  return !!l.pasta_nome && !LISTA_GUIA.test(l.lista_nome ?? "");
}

export interface ExtrasLeitura {
  /** Nome da KR mãe, para a entrega. */
  pai?: string | null;
  /** Cadastro de unidades: acha a unidade no nome da tarefa de área ("Maceió"). */
  unidades?: UnidadeCoo[];
}

export function lerCompromisso(
  l: LinhaEspelho,
  eventos: LinhaEvento[],
  agoraIso: string,
  extras: ExtrasLeitura = {},
): Compromisso {
  const doTarefa = eventos.filter((e) => e.tarefa_id === l.id);
  const rotina = ehCompromissoDaRotina(l.pasta_nome, l.lista_nome);
  const tipo: TipoTarefa = rotina
    ? "compromisso"
    : l.parent_id
      ? "entrega"
      : LISTA_DIRECIONAMENTO.test(l.lista_nome ?? "")
        ? "direcionamento"
        : "kr";
  // Tarefa de área: o tema é o da pasta do departamento (mapa aprovado pelo COO em 29/09).
  const tema = temaDoTexto(l.tema) ?? (rotina ? null : (temasDoDepartamento(l.pasta_nome ?? "")[0] ?? null));
  const unidade =
    l.unidade ?? (!rotina && extras.unidades ? (acharUnidade(extras.unidades, l.nome)?.nome ?? null) : null);
  // Adiamento é o prazo indo para um DIA depois; o mesmo instante escrito de outro jeito não conta.
  const adiamentos = doTarefa.filter(
    (e) => e.tipo === "prazo" && typeof e.de === "string" && typeof e.para === "string" && diaDe(e.para) > diaDe(e.de),
  ).length;
  const hoje = diaDe(agoraIso);
  const vencido = !l.concluida && l.prazo != null && diaDe(l.prazo) < hoje;
  const [primeiro, ...resto] = l.donos ?? [];
  return {
    id: l.id,
    origemTarefa: rotina ? "rotina" : "area",
    tipo,
    departamento: rotina || !l.pasta_nome ? null : departamentoBase(l.pasta_nome),
    pai: extras.pai ?? null,
    nome: l.nome,
    url: l.url,
    status: l.status,
    concluida: l.concluida,
    dono: primeiro ? { id: primeiro.id, nome: primeiro.nome } : null,
    outrosDonos: resto.length,
    prazo: l.prazo,
    tema,
    temaTexto: l.tema,
    unidade,
    origem: l.origem,
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
    concluidaEm: l.concluida_em,
    lista: l.lista_nome,
    pasta: l.pasta_nome,
    vencido,
    diasVencido: vencido && l.prazo ? diasEntre(`${diaDe(l.prazo)}T12:00:00Z`, `${hoje}T12:00:00Z`) : null,
    parado:
      !l.concluida && l.atualizada_em != null && diasEntre(l.atualizada_em, agoraIso) >= DIAS_PARADO,
    adiamentos,
    cumpridoNoPrazo:
      l.concluida && l.prazo && l.concluida_em ? diaDe(l.concluida_em) <= diaDe(l.prazo) : null,
  };
}

/**
 * O espelho inteiro → a execução: filtra o que entra, dá à entrega o nome da KR mãe e agrupa os
 * eventos por tarefa uma vez (o espelho tem o space todo).
 */
export function lerTarefas(
  dado: { linhas: LinhaEspelho[]; eventos: LinhaEvento[] },
  agoraIso: string,
  unidades?: UnidadeCoo[],
): Compromisso[] {
  const nomes = new Map(dado.linhas.map((l) => [l.id, l.nome]));
  const porTarefa = new Map<string, LinhaEvento[]>();
  for (const e of dado.eventos) {
    const lista = porTarefa.get(e.tarefa_id);
    if (lista) lista.push(e);
    else porTarefa.set(e.tarefa_id, [e]);
  }
  return dado.linhas
    .filter(entraNaExecucao)
    .map((l) =>
      lerCompromisso(l, porTarefa.get(l.id) ?? [], agoraIso, {
        pai: l.parent_id ? (nomes.get(l.parent_id) ?? null) : null,
        unidades,
      }),
    );
}

/**
 * Ordem de trabalho (N5): vencidos primeiro (o mais atrasado no topo), depois pelo prazo, e sem
 * prazo por último (a criação mais antiga primeiro). Concluídos vão para o fim.
 */
export function ordenarFila(cs: Compromisso[]): Compromisso[] {
  const grupo = (c: Compromisso) => (c.concluida ? 3 : c.vencido ? 0 : c.prazo ? 1 : 2);
  return [...cs].sort((a, b) => {
    const g = grupo(a) - grupo(b);
    if (g) return g;
    if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
    return (a.criadaEm ?? "").localeCompare(b.criadaEm ?? "");
  });
}

export interface Higiene {
  semDono: number;
  semPrazo: number;
  vencidos: number;
  parados: number;
  semTema: number;
}

export function higiene(cs: Compromisso[]): Higiene {
  const abertos = cs.filter((c) => !c.concluida);
  return {
    semDono: abertos.filter((c) => !c.dono).length,
    semPrazo: abertos.filter((c) => !c.prazo).length,
    vencidos: abertos.filter((c) => c.vencido).length,
    parados: abertos.filter((c) => c.parado).length,
    semTema: abertos.filter((c) => !c.tema).length,
  };
}

/** Segunda-feira da semana de uma data (YYYY-MM-DD). */
export function segundaDaSemana(hojeIso: string): string {
  const d = new Date(`${hojeIso}T12:00:00Z`);
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (dia - 1));
  return d.toISOString().slice(0, 10);
}

/** A reunião anterior do mesmo tema: o mesmo dia da semana, sete dias antes da desta semana. */
export function reuniaoAnterior(tema: Tema, hojeIso: string): string {
  const seg = new Date(`${segundaDaSemana(hojeIso)}T12:00:00Z`);
  seg.setUTCDate(seg.getUTCDate() + (TEMAS[tema].dia - 1));
  const desta = seg.toISOString().slice(0, 10);
  const alvo = new Date(`${desta}T12:00:00Z`);
  // Se a reunião desta semana é hoje ou ainda vem, a anterior é a da semana passada.
  if (desta >= hojeIso) alvo.setUTCDate(alvo.getUTCDate() - 7);
  return alvo.toISOString().slice(0, 10);
}

export interface ExecucaoTema {
  tema: Tema;
  abertos: number;
  vencidos: number;
  /** Abertos com prazo de hoje até 7 dias à frente (não vencidos). */
  vencemEm7: number;
  semDono: number;
  feitosDesdeUltima: number;
  desde: string;
  /** Até 5, vencidos primeiro. */
  destaques: Compromisso[];
}

export const DESTAQUES_EXECUCAO = 5;

/** Tarefas de área e compromissos da rotina do tema: o que o dia cobra. */
export function execucaoDoTema(tema: Tema, cs: Compromisso[], hojeIso: string): ExecucaoTema {
  const doTema = cs.filter((c) => c.tema === tema);
  const abertos = doTema.filter((c) => !c.concluida);
  const desde = reuniaoAnterior(tema, hojeIso);
  const limite = new Date(`${hojeIso}T12:00:00Z`);
  limite.setUTCDate(limite.getUTCDate() + 7);
  const ate = limite.toISOString().slice(0, 10);
  return {
    tema,
    abertos: abertos.length,
    vencidos: abertos.filter((c) => c.vencido).length,
    vencemEm7: abertos.filter((c) => !c.vencido && c.prazo && diaDe(c.prazo) <= ate).length,
    semDono: abertos.filter((c) => !c.dono).length,
    feitosDesdeUltima: doTema.filter((c) => c.concluida && c.concluidaEm && diaDe(c.concluidaEm) >= desde).length,
    desde,
    destaques: ordenarFila(abertos).slice(0, DESTAQUES_EXECUCAO),
  };
}

export interface RevisaoTema {
  tema: Tema;
  noPrazo: number;
  comAtraso: number;
  vencidos: number;
  abertos: number;
}

/**
 * Revisão da semana (sexta): os compromissos com prazo nesta semana (seg a dom), por tema.
 * No prazo = concluído até o dia do prazo; com atraso = concluído depois; vencido = aberto e
 * com o prazo já passado; aberto = prazo ainda por vir.
 */
export function revisaoDaSemana(cs: Compromisso[], hojeIso: string): RevisaoTema[] {
  const seg = segundaDaSemana(hojeIso);
  const dom = new Date(`${seg}T12:00:00Z`);
  dom.setUTCDate(dom.getUTCDate() + 6);
  const fim = dom.toISOString().slice(0, 10);
  const daSemana = cs.filter((c) => c.prazo && diaDe(c.prazo) >= seg && diaDe(c.prazo) <= fim);
  return ORDEM_TEMAS.map((tema) => {
    const t = daSemana.filter((c) => c.tema === tema);
    return {
      tema,
      noPrazo: t.filter((c) => c.cumpridoNoPrazo === true).length,
      comAtraso: t.filter((c) => c.cumpridoNoPrazo === false).length,
      vencidos: t.filter((c) => c.vencido).length,
      abertos: t.filter((c) => !c.concluida && !c.vencido).length,
    };
  });
}

/** % de compromissos com prazo na semana que foram cumpridos no prazo; null sem nenhum. */
export function taxaNoPrazo(revisao: RevisaoTema[]): number | null {
  const noPrazo = revisao.reduce((s, r) => s + r.noPrazo, 0);
  const total = revisao.reduce((s, r) => s + r.noPrazo + r.comAtraso + r.vencidos, 0);
  return total ? (noPrazo / total) * 100 : null;
}
