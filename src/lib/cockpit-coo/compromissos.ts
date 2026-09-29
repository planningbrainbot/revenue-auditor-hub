// Compromissos do COO: a leitura do espelho do ClickUp (`ops.clickup_tarefas` + `ops.clickup_eventos`)
// na forma que a tela pede. Puro.
//
// Um compromisso é uma tarefa do ClickUp com dono único, prazo, tema da rotina, unidade (ou "Rede")
// e, quando nasceu no cockpit, a chave do alerta de origem. Moram na pasta "Rotina Semanal" do
// space da Expansão Nacional, que é do COO (confirmado em 29/09/2026).
import type { LinhaEspelho } from "../../../supabase/functions/_shared/clickup/compromissos.ts";
import { ORDEM_TEMAS, TEMAS } from "./contrato.ts";
import type { Tema } from "./contrato.ts";

export type { LinhaEspelho };

export interface LinhaEvento {
  tarefa_id: string;
  tipo: string;
  de: unknown;
  para: unknown;
  em: string;
}

export interface Compromisso {
  id: string;
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
export const DIAS_PARADO = 7;

const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

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

function diaDe(iso: string): string {
  return iso.slice(0, 10);
}

function diasEntre(deIso: string, ateIso: string): number {
  return Math.floor((Date.parse(ateIso) - Date.parse(deIso)) / 86_400_000);
}

export function lerCompromisso(l: LinhaEspelho, eventos: LinhaEvento[], agoraIso: string): Compromisso {
  const doTarefa = eventos.filter((e) => e.tarefa_id === l.id);
  const adiamentos = doTarefa.filter(
    (e) => e.tipo === "prazo" && typeof e.de === "string" && typeof e.para === "string" && e.para > e.de,
  ).length;
  const vencido = !l.concluida && l.prazo != null && l.prazo < agoraIso;
  const [primeiro, ...resto] = l.donos ?? [];
  return {
    id: l.id,
    nome: l.nome,
    url: l.url,
    status: l.status,
    concluida: l.concluida,
    dono: primeiro ? { id: primeiro.id, nome: primeiro.nome } : null,
    outrosDonos: resto.length,
    prazo: l.prazo,
    tema: temaDoTexto(l.tema),
    temaTexto: l.tema,
    unidade: l.unidade,
    origem: l.origem,
    criadaEm: l.criada_em,
    atualizadaEm: l.atualizada_em,
    concluidaEm: l.concluida_em,
    lista: l.lista_nome,
    pasta: l.pasta_nome,
    vencido,
    diasVencido: vencido && l.prazo ? diasEntre(l.prazo, agoraIso) : null,
    parado:
      !l.concluida && l.atualizada_em != null && diasEntre(l.atualizada_em, agoraIso) >= DIAS_PARADO,
    adiamentos,
    cumpridoNoPrazo:
      l.concluida && l.prazo && l.concluida_em ? diaDe(l.concluida_em) <= diaDe(l.prazo) : null,
  };
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
  feitosDesdeUltima: number;
  desde: string;
  /** Até 3, vencidos primeiro. */
  destaques: Compromisso[];
}

export function execucaoDoTema(tema: Tema, cs: Compromisso[], hojeIso: string): ExecucaoTema {
  const doTema = cs.filter((c) => c.tema === tema);
  const desde = reuniaoAnterior(tema, hojeIso);
  return {
    tema,
    abertos: doTema.filter((c) => !c.concluida).length,
    vencidos: doTema.filter((c) => c.vencido).length,
    feitosDesdeUltima: doTema.filter((c) => c.concluida && c.concluidaEm && diaDe(c.concluidaEm) >= desde).length,
    desde,
    destaques: ordenarFila(doTema.filter((c) => !c.concluida)).slice(0, 3),
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
