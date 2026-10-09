/**
 * Régua cumulativa da Operação da Monetização: a única régua do funil, de "Qual produto avança", do lado a lado e
 * dos quadros de meta desde 01/10/2026 (spec `docs/superpowers/specs/2026-10-01-monetizacao-acompanhamento-diario.md`).
 *
 * Porta para TypeScript a régua de `monetizacao/base/medir_funil_cumulativo.mjs`, já generalizada para ler as etapas
 * do pipe por nome e pela ordem em tempo de execução (`f03_medir.mjs`, 01/10). Nenhum id nem ordem fica fixo aqui: a
 * frente 01 reordena o pipe, e a régua acompanha.
 *
 * - Coorte do período: cards com `started` (saída da Base) no período, feito por quem o filtro mede, no produto do
 *   filtro.
 * - Nível do card: a etapa mais adiantada alcançada no período, depois do primeiro `started` do período. Conta a etapa
 *   em que o card ficou 30 minutos ou mais, de onde avançou ou em que terminou; um toque desfeito em minutos não
 *   conta. Ganho no período é o nível acima de todos.
 * - Contagem da etapa: cards da coorte com nível maior ou igual ao dela. Só desce, e é sempre inteira.
 * - Fila: cards que estiveram na Base elegível em algum momento do período (já estavam lá no início ou entraram).
 * - Taxa: contagem da etapa ÷ contagem da etapa de cima.
 *
 * Datas de evento (`date`) já vêm no fuso de São Paulo; instantes (`at`) são comparados como instante, nunca como
 * texto ("2026-09-01 10:00:00" < "2026-09-01T03:00:00Z" dava verdadeiro no script de referência).
 */
import type { Filtro } from "./model";
import type { Movimento, Negocio } from "./types";
import { doResponsavel } from "./responsavel.ts";
import {
  chaveDaEtapa,
  type ChaveEtapa,
} from "../../../supabase/functions/_shared/etapas-pipe39.ts";

export { chaveDaEtapa };
export type { ChaveEtapa };

export type Etapa = { id: number; name: string; order: number };

/** Um toque desfeito antes disto não conta como etapa alcançada. */
export const PERMANENCIA_MINIMA_MS = 30 * 60_000;

/** Etapas com papel na régua, lidas pelo nome. */
export type ChaveNivel =
  | "abordagem"
  | "conexao"
  | "agendada"
  | "realizada"
  | "negociacao"
  | "reuniaoProposta"
  | "propostaEnviada";

// O papel de cada etapa vem do nome, antigo ou novo (`_shared/etapas-pipe39.ts`; renomeação de 09/10/2026:
// Conexão → Qualificação, "Reunião de levantamento agendada/realizada" → "Agendado/Realizado - Levantamento com sócio").
const papelDe = (s: Etapa) => chaveDaEtapa(s.name);
// Cada chave fica com o primeiro passo que tem esse papel. Sem a etapa Conexão (pipe anterior a 01/10), o Gatilho é
// uma etapa da sequência e faz o papel dela.
const CHAVES: ChaveNivel[] = [
  "abordagem",
  "conexao",
  "agendada",
  "realizada",
  "negociacao",
  "reuniaoProposta",
  "propostaEnviada",
];
const temPapel = (s: Etapa, papel: ChaveNivel) =>
  papelDe(s) === papel || (papel === "conexao" && papelDe(s) === "gatilho");

export interface NivelRegua {
  nivel: number;
  /** "fila", o id da etapa principal, ou "ganho". */
  key: string;
  /** Nome da etapa sem o número e sem o parêntese ("Gatilho (encerrada …)" → "Gatilho"). */
  nome: string;
  chave: ChaveNivel | "fila" | "ganho" | null;
  /** Etapa principal do nível; `null` em Ganho. */
  stage_id: number | null;
  /** Todas as etapas que valem este nível: a principal e as somadas a ela. */
  stage_ids: number[];
  /** Etapas somadas: Gatilho (encerrada) na Conexão, Stand by no Levantamento realizado. */
  somadas: { id: number; nome: string }[];
}

export interface Regua {
  /** Do nível 0 (fila) ao Ganho, em ordem. */
  niveis: NivelRegua[];
  /** Nível do Ganho, acima de todos. */
  ganho: number;
  nivelDaEtapa: ReadonlyMap<number, number>;
  nivelDe: Partial<Record<ChaveNivel, number>>;
  /** Etapas que a régua não soube pôr num nível (ficam fora da conta). */
  semNivel: string[];
}

export const nomeDaEtapa = (nome: string) =>
  nome
    .replace(/^\d+\s*·\s*/, "")
    .replace(/\s*\(.*\)\s*$/, "")
    .trim();

/** Níveis lidos do pipe, por nome e pela ordem de `stages` (campo `order`). */
export function reguaDoPipe(stages: Etapa[]): Regua {
  const ord = [...stages].sort((a, b) => a.order - b.order);
  const base = ord.filter((s) => papelDe(s) === "base");
  const temConexao = ord.some((s) => papelDe(s) === "conexao");
  const somada = (s: Etapa) => papelDe(s) === "standby" || (temConexao && papelDe(s) === "gatilho");
  const passos = ord.filter((s) => papelDe(s) !== "base" && !somada(s));
  const nivelDaEtapa = new Map<number, number>();
  for (const s of base) nivelDaEtapa.set(s.id, 0);
  passos.forEach((s, i) => nivelDaEtapa.set(s.id, i + 1));
  const chaveDe = new Map<number, ChaveNivel>();
  const nivelDe: Partial<Record<ChaveNivel, number>> = {};
  for (const papel of CHAVES) {
    const s = passos.find((p) => temPapel(p, papel) && !chaveDe.has(p.id));
    if (!s) continue;
    chaveDe.set(s.id, papel);
    nivelDe[papel] = nivelDaEtapa.get(s.id);
  }
  const somadasDo = new Map<number, { id: number; nome: string }[]>();
  const semNivel: string[] = [];
  for (const s of ord.filter(somada)) {
    const v = papelDe(s) === "standby" ? nivelDe.realizada : nivelDe.conexao;
    if (v === undefined) {
      semNivel.push(s.name);
      continue;
    }
    nivelDaEtapa.set(s.id, v);
    somadasDo.set(v, [...(somadasDo.get(v) ?? []), { id: s.id, nome: nomeDaEtapa(s.name) }]);
  }
  const niveis: NivelRegua[] = [
    {
      nivel: 0,
      key: "fila",
      nome: base[0] ? nomeDaEtapa(base[0].name) : "Base elegível",
      chave: "fila",
      stage_id: base[0]?.id ?? null,
      stage_ids: base.map((s) => s.id),
      somadas: base.slice(1).map((s) => ({ id: s.id, nome: nomeDaEtapa(s.name) })),
    },
    ...passos.map((s, i) => {
      const somadas = somadasDo.get(i + 1) ?? [];
      return {
        nivel: i + 1,
        key: String(s.id),
        nome: nomeDaEtapa(s.name),
        chave: chaveDe.get(s.id) ?? null,
        stage_id: s.id,
        stage_ids: [s.id, ...somadas.map((x) => x.id)],
        somadas,
      };
    }),
    {
      nivel: passos.length + 1,
      key: "ganho",
      nome: "Ganho",
      chave: "ganho",
      stage_id: null,
      stage_ids: [],
      somadas: [],
    },
  ];
  return { niveis, ganho: passos.length + 1, nivelDaEtapa, nivelDe, semNivel };
}

/** Instante de um `at` da carga: "aaaa-mm-dd hh:mm:ss" é UTC (Pipedrive); ISO com fuso vale como está. */
export function instante(at: string): number {
  const s = at.trim().replace(" ", "T");
  return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : s + "Z");
}

/** 00:00 do dia em São Paulo (UTC−3 o ano todo desde 2019). */
const inicioDoDia = (dia: string) => Date.parse(dia + "T00:00:00-03:00");

type Passo = Movimento & { stage_id: number; t: number; nivel: number };

/** Movimentos do card para etapas com nível, em ordem de tempo (empate mantém a ordem da carga). */
export function trajeto(c: Negocio, regua: Regua, ignorar?: ReadonlySet<number>): Passo[] {
  return (c.moves ?? [])
    .filter((m) => regua.nivelDaEtapa.has(m.stage_id) && !ignorar?.has(m.stage_id))
    .map((m) => ({ ...m, t: instante(m.at), nivel: regua.nivelDaEtapa.get(m.stage_id)! }))
    .sort((a, b) => a.t - b.t);
}

/** A etapa conta como alcançada: o card ficou 30 minutos ou mais, avançou a partir dela ou terminou nela. */
export function ficou(mv: Passo[], i: number): boolean {
  const prox = mv[i + 1];
  return !prox || prox.t - mv[i].t >= PERMANENCIA_MINIMA_MS || prox.nivel > mv[i].nivel;
}

const noPeriodo = (date: string, f: Pick<Filtro, "from" | "to">) => date >= f.from && date <= f.to;

/** Nível do card no período, a partir do `inicio` (o primeiro `started` do período). Abordado = 1. */
export function nivelNoPeriodo(
  c: Negocio,
  inicio: string,
  f: Pick<Filtro, "from" | "to">,
  regua: Regua,
): number {
  const t0 = instante(inicio);
  const mv = trajeto(c, regua);
  let max = 1;
  mv.forEach((m, i) => {
    if (!noPeriodo(m.date, f) || m.t < t0) return;
    if (ficou(mv, i) && m.nivel > max) max = m.nivel;
  });
  if (c.events.signed.some((e) => noPeriodo(e.date, f))) max = regua.ganho;
  return max;
}

/** O card esteve na Base elegível em algum momento do período (já estava lá no início ou entrou). */
export function naFila(c: Negocio, f: Pick<Filtro, "from" | "to">, regua: Regua): boolean {
  const moves = c.moves ?? [];
  if (moves.some((m) => noPeriodo(m.date, f) && regua.nivelDaEtapa.get(m.stage_id) === 0))
    return true;
  const t0 = inicioDoDia(f.from);
  const antes = moves
    .map((m) => ({ m, t: instante(m.at) }))
    .filter((x) => x.t < t0)
    .sort((a, b) => a.t - b.t);
  const ultimo = antes.at(-1)?.m;
  return (
    !!ultimo &&
    regua.nivelDaEtapa.get(ultimo.stage_id) === 0 &&
    !(c.lost_on && c.lost_on < f.from) &&
    !c.events.signed.some((e) => e.date < f.from)
  );
}

/**
 * Primeiro `started` do período feito por quem o filtro mede. `null` = o card não é da coorte. Saída da Base pelo
 * usuário de integração não é abordagem da pré-venda: com o filtro numa pessoa ou nos dois, ela fica fora.
 */
export function inicioDaAbordagem(c: Negocio, f: Filtro): string | null {
  const e = c.events.started.filter((x) => noPeriodo(x.date, f) && doResponsavel(f, x.actor_id));
  if (!e.length) return null;
  return e.reduce((a, x) => (instante(x.at) < instante(a) ? x.at : a), e[0].at);
}

/** Card abordado antes do período que avançou nele: do nível em que estava no início (`de`) ao alcançado (`ate`). */
export interface AvancoAnterior {
  card: Negocio;
  de: number;
  ate: number;
}

/**
 * Avanços de cards abordados antes do período (06/10/2026). A coorte só conta quem saiu da Base no período, então a
 * reunião, a validação e o ganho de outubro de um card abordado em setembro não apareciam em lugar nenhum de outubro
 * (Tag e Alves e Freitas, relato do Matheus). Ficam fora da coorte, que segue cumulativa, e vão para as notas dos
 * quadros. `de` é o nível do último movimento antes do período; `ate`, o mais adiantado alcançado no período, pela
 * mesma regra de etapa alcançada e só por movimento de quem o filtro mede. Card perdido ou ganho antes do período,
 * ou sem abordagem anterior, fica de fora; só entra quem passou do nível em que estava.
 */
export function avancosDeAbordagemAnterior(
  cards: Negocio[],
  regua: Regua,
  f: Filtro,
  naCoorte: ReadonlySet<number>,
): AvancoAnterior[] {
  const t0 = inicioDoDia(f.from);
  const out: AvancoAnterior[] = [];
  for (const c of cards) {
    if (naCoorte.has(c.id) || !c.events.started.some((e) => e.date < f.from)) continue;
    if ((c.lost_on && c.lost_on < f.from) || c.events.signed.some((e) => e.date < f.from)) continue;
    const mv = trajeto(c, regua);
    const de = mv.filter((m) => m.t < t0).at(-1)?.nivel ?? 1;
    let ate = de;
    mv.forEach((m, i) => {
      if (!noPeriodo(m.date, f) || m.t < t0 || !doResponsavel(f, m.actor_id)) return;
      if (ficou(mv, i) && m.nivel > ate) ate = m.nivel;
    });
    if (c.events.signed.some((e) => noPeriodo(e.date, f) && doResponsavel(f, e.actor_id)))
      ate = regua.ganho;
    if (ate > de) out.push({ card: c, de, ate });
  }
  return out;
}

/** Cards de abordagem anterior que chegaram no período a um nível que não tinham: `de < nivel ≤ ate`. */
export const chegaramAoNivel = (avancos: AvancoAnterior[], nivel: number | undefined) =>
  nivel === undefined
    ? []
    : avancos.filter((a) => a.de < nivel && nivel <= a.ate).map((a) => a.card);

export interface LinhaCumulativa extends NivelRegua {
  /** Nível 0: os cards da fila. Demais: cards da coorte com nível ≥ este. */
  cards: Negocio[];
  contagem: number;
  /** Contagem ÷ a da linha de cima. `undefined` na primeira linha; `null` quando a de cima é zero. */
  taxa?: number | null;
  /** Abertos agora nas etapas do nível, pipe inteiro (só o filtro de produto). `null` em Ganho. */
  hoje: Negocio[] | null;
  /** Etapas somadas, com quantos estão nelas agora. */
  somadasHoje: { nome: string; hoje: number }[];
}

export interface FunilCumulativo {
  regua: Regua;
  linhas: LinhaCumulativa[];
  fila: Negocio[];
  coorte: Negocio[];
  nivelDoCard: ReadonlyMap<number, number>;
  /** Ganhos no período, pelo filtro, de cards abordados em outro período (fora da coorte). */
  ganhosForaDaCoorte: Negocio[];
  /** Cards abordados antes do período que avançaram nele (fora da coorte e da taxa). */
  avancosAnteriores: AvancoAnterior[];
  /** Perdidos no período por quem marcou a perda (`lost_by`, carga v6). `null` antes da carga v4. */
  perdidos: Negocio[] | null;
  /** Abertos agora no pipe (filtro de produto). */
  abertos: number;
}

const doProduto = (cards: Negocio[], f: Pick<Filtro, "product">) =>
  cards.filter((c) => !f.product || c.route === f.product);

export function funilCumulativo(cards: Negocio[], stages: Etapa[], f: Filtro): FunilCumulativo {
  const regua = reguaDoPipe(stages);
  const pool = doProduto(cards, f);
  const fila = pool.filter((c) => naFila(c, f, regua));
  const nivelDoCard = new Map<number, number>();
  const coorte: Negocio[] = [];
  for (const c of pool) {
    const inicio = inicioDaAbordagem(c, f);
    if (inicio === null) continue;
    coorte.push(c);
    nivelDoCard.set(c.id, nivelNoPeriodo(c, inicio, f, regua));
  }
  const abertos = pool.filter((c) => c.status === "open");
  const linhas: LinhaCumulativa[] = regua.niveis.map((n) => {
    const doNivel = n.nivel === 0 ? fila : coorte.filter((c) => nivelDoCard.get(c.id)! >= n.nivel);
    return {
      ...n,
      cards: doNivel,
      contagem: doNivel.length,
      hoje: n.chave === "ganho" ? null : abertos.filter((c) => n.stage_ids.includes(c.stage_id)),
      somadasHoje: n.somadas.map((s) => ({
        nome: s.nome,
        hoje: abertos.filter((c) => c.stage_id === s.id).length,
      })),
    };
  });
  linhas.forEach((l, i) => {
    if (i > 0) l.taxa = linhas[i - 1].contagem ? l.contagem / linhas[i - 1].contagem : null;
  });
  const naCoorte = new Set(coorte.map((c) => c.id));
  const ganhosForaDaCoorte = pool.filter(
    (c) =>
      !naCoorte.has(c.id) &&
      c.events.signed.some((e) => noPeriodo(e.date, f) && doResponsavel(f, e.actor_id)),
  );
  const medePerda = pool.some((c) => c.lost_on !== undefined);
  const perdidos = medePerda
    ? pool.filter(
        (c) =>
          c.status === "lost" &&
          !!c.lost_on &&
          noPeriodo(c.lost_on, f) &&
          // quem perdeu, como todo movimento; carga anterior à v6 só tem o dono atual
          doResponsavel(f, c.lost_by !== undefined ? c.lost_by : c.owner_id),
      )
    : null;
  return {
    regua,
    linhas,
    fila,
    coorte,
    nivelDoCard,
    ganhosForaDaCoorte,
    avancosAnteriores: avancosDeAbordagemAnterior(pool, regua, f, naCoorte),
    perdidos,
    abertos: abertos.length,
  };
}

/** A linha de uma etapa com papel na régua; `undefined` quando o pipe não tem a etapa. */
export function linhaDa(
  fc: FunilCumulativo,
  chave: ChaveNivel | "fila" | "ganho",
): LinhaCumulativa | undefined {
  return fc.linhas.find((l) => l.chave === chave);
}
