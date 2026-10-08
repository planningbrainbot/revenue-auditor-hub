/**
 * Visão "Hoje" da Operação da Monetização (spec `docs/superpowers/specs/2026-10-01-monetizacao-acompanhamento-diario.md`).
 * Pergunta: o mês vai chegar a 50% de marcação? Tudo aqui é leitura da carga do CRM; nada é gravado.
 *
 * Os números do mês saem da mesma régua cumulativa do funil (`funil-cumulativo.ts`). Os do dia são eventos do dia,
 * de qualquer mês de abordagem.
 */
import { ehDiaUtil } from "./feriados.ts";
import {
  ficou,
  funilCumulativo,
  instante,
  linhaDa,
  trajeto,
  type Etapa,
  type FunilCumulativo,
  type Regua,
} from "./funil-cumulativo.ts";
import { uteis, type Filtro } from "./model.ts";
import { doResponsavel, pessoasNoRecorte } from "./responsavel.ts";
import type { Negocio, Plano, Produto } from "./types";

// ----------------------------------------------------------------------------------------------- parâmetros
// DEFINIDO pelo Pedro em 01/10/2026: alvos da marcação, meta de abordagens sem plano e prazo da lista de atenção.
export const ALVOS = {
  /** Conexão ÷ abordados. Conexão = qualquer resposta do cliente. */
  conexao: 0.7,
  /** Levantamentos agendados ÷ Conexão. */
  levantamento: 0.72,
  /** Levantamentos agendados ÷ abordados: a meta do mês. */
  marcacao: 0.5,
} as const;
/** Meta de abordagens do mês por closer, quando o mês não tem plano em `monetizacao_planos`. */
export const ABORDAGENS_POR_CLOSER = 120;
/** Abordado há este tanto de dias úteis, sem Conexão, entra na lista de atenção. */
export const DIAS_UTEIS_SEM_CONEXAO = 3;
/** Na lista de atenção, a faixa mais antiga. */
export const DIAS_UTEIS_ALERTA_ALTO = 10;
/** Usuário de integração "Ops Planning" no Pipedrive: movimento dele não é abordagem. */
export const USUARIO_OPS_PLANNING = 23984402;

export const SEM_UNIDADE = "Sem unidade";

// ----------------------------------------------------------------------------------------------- dias
const somaDias = (dia: string, n: number) =>
  new Date(Date.parse(dia + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);

/** O dia útil antes de `dia`. Na segunda, a sexta; depois de feriado, o último dia útil. */
export function diaUtilAnterior(dia: string): string {
  let d = somaDias(dia, -1);
  while (!ehDiaUtil(d)) d = somaDias(d, -1);
  return d;
}

/** Dias úteis depois de `dia` até `hoje`, inclusive: abordado ontem (dia útil) = 1. */
export function uteisDesde(dia: string, hoje: string): number {
  let n = 0;
  for (let d = somaDias(dia, 1); d <= hoje; d = somaDias(d, 1)) if (ehDiaUtil(d)) n++;
  return n;
}

export const fimDoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

const doProduto = (cards: Negocio[], f: Pick<Filtro, "product">) =>
  cards.filter((c) => !f.product || c.route === f.product);

export function contarPorProduto(cards: Negocio[]): Record<Produto | "sem_produto", number> {
  const out = { cella: 0, finance: 0, consultoria: 0, sem_produto: 0 };
  for (const c of cards) out[c.route]++;
  return out;
}

// ----------------------------------------------------------------------------------------------- 1. o dia
export type IndicadorDia = "abordagens" | "conexoes" | "agendados" | "realizados" | "propostas";
export const INDICADORES_DIA: { chave: IndicadorDia; rotulo: string }[] = [
  { chave: "abordagens", rotulo: "Abordagens" },
  { chave: "conexoes", rotulo: "Conexões" },
  { chave: "agendados", rotulo: "Levantamentos agendados" },
  { chave: "realizados", rotulo: "Levantamentos realizados" },
  { chave: "propostas", rotulo: "Reuniões de proposta" },
];

/**
 * Cards com o evento no `dia` (São Paulo), pelo filtro de quem moveu e de produto. `null` = o pipe não tem a etapa.
 * - Abordagem: `started` do dia (saída da Base), a mesma da coorte. O usuário "Ops Planning" não aborda.
 * - Conexão, levantamento agendado e reunião de proposta: entrada na etapa no dia. Toque desfeito em menos de
 *   30 minutos (voltou ou foi para trás) não conta.
 * - Levantamento realizado: evento `meeting` do dia (Reunião realizada, ou o primeiro Stand by sem reunião antes),
 *   sem toque.
 */
export function eventosDoDia(
  cards: Negocio[],
  regua: Regua,
  dia: string,
  f: Pick<Filtro, "owner" | "owners" | "product">,
): Record<IndicadorDia, Negocio[] | null> {
  const pool = doProduto(cards, f);
  const doAtor = (actor: number | null) => doResponsavel(f, actor);
  const etapa = (chave: "conexao" | "agendada" | "reuniaoProposta") => {
    const n = regua.nivelDe[chave];
    // A etapa principal do nível: "entradas na etapa Conexão" não somam o Gatilho encerrado.
    return n === undefined ? undefined : (regua.niveis[n].stage_id ?? undefined);
  };
  const entradas = (id: number | undefined) =>
    id === undefined
      ? null
      : pool.filter((c) => {
          const mv = trajeto(c, regua);
          return mv.some(
            (m, i) => m.stage_id === id && m.date === dia && doAtor(m.actor_id) && ficou(mv, i),
          );
        });
  const realizada = regua.nivelDe.realizada;
  const daRealizada = new Set(realizada === undefined ? [] : regua.niveis[realizada].stage_ids);
  return {
    abordagens: pool.filter((c) =>
      c.events.started.some(
        (e) => e.date === dia && e.actor_id !== USUARIO_OPS_PLANNING && doAtor(e.actor_id),
      ),
    ),
    conexoes: entradas(etapa("conexao")),
    agendados: entradas(etapa("agendada")),
    realizados:
      realizada === undefined
        ? null
        : pool.filter((c) => {
            const mv = trajeto(c, regua);
            return c.events.meeting.some((e) => {
              if (e.date !== dia || !doAtor(e.actor_id)) return false;
              const i = mv.findIndex((m) => m.at === e.at && daRealizada.has(m.stage_id));
              return i < 0 || ficou(mv, i);
            });
          }),
    propostas: entradas(etapa("reuniaoProposta")),
  };
}

// ----------------------------------------------------------------------------------------------- 2. o mês
export interface MarcacaoDoMes {
  funil: FunilCumulativo;
  abordados: number;
  /** `null` quando o pipe não tem a etapa. */
  conexao: number | null;
  agendados: number | null;
  taxaConexao: number | null;
  taxaLevantamento: number | null;
  marcacao: number | null;
  /** Levantamentos que faltam para 50% dos abordados: `max(0, ⌈0,5 × abordados⌉ − agendados)`. */
  faltam: number | null;
}

const razao = (a: number | null, b: number | null) => (a === null || !b ? null : a / b);

/** Coorte do mês corrente, de 1º até hoje, pelo filtro de quem moveu e de produto. */
export function marcacaoDoMes(
  cards: Negocio[],
  stages: Etapa[],
  f: Pick<Filtro, "owner" | "owners" | "product">,
  hoje: string,
): MarcacaoDoMes {
  const funil = funilCumulativo(cards, stages, { ...f, from: hoje.slice(0, 7) + "-01", to: hoje });
  const abordados = linhaDa(funil, "abordagem")?.contagem ?? funil.coorte.length;
  const conexao = linhaDa(funil, "conexao")?.contagem ?? null;
  const agendados = linhaDa(funil, "agendada")?.contagem ?? null;
  return {
    funil,
    abordados,
    conexao,
    agendados,
    taxaConexao: razao(conexao, abordados),
    taxaLevantamento: razao(agendados, conexao),
    marcacao: razao(agendados, abordados),
    faltam:
      agendados === null ? null : Math.max(0, Math.ceil(ALVOS.marcacao * abordados) - agendados),
  };
}

// ----------------------------------------------------------------------------------------------- 3. unidade
/**
 * Unidade do card pela carga (`monetizacao_deals.unidade_ids`, preenchida a partir da conta da Base). Mais de uma
 * unidade vira um rótulo só ("Curitiba / Goiânia"), para cada card contar uma vez. Não se infere pelo dono do card.
 */
export function rotuloDaUnidade(
  ids: number[] | undefined,
  nomeDa: ReadonlyMap<number, string>,
): string {
  const unicos = [...new Set(ids ?? [])].sort((a, b) => a - b);
  return unicos.length
    ? unicos.map((id) => nomeDa.get(id) ?? `Unidade ${id}`).join(" / ")
    : SEM_UNIDADE;
}

export const nomesDasUnidades = (units: { id: number | null; name: string }[]) =>
  new Map(units.filter((u) => u.id !== null).map((u) => [u.id!, u.name]));

export interface ConexaoDaUnidade {
  unidade: string;
  abordados: Negocio[];
  conexao: Negocio[];
}

/** Conexão de N abordados no mês, por unidade. `null` quando a carga não traz a unidade dos cards. */
export function conexaoPorUnidade(
  mes: MarcacaoDoMes,
  units: { id: number | null; name: string }[],
): ConexaoDaUnidade[] | null {
  const coorte = mes.funil.coorte;
  if (coorte.length && coorte.every((c) => c.unidade_ids === undefined)) return null;
  const nomeDa = nomesDasUnidades(units);
  const comConexao = new Set((linhaDa(mes.funil, "conexao")?.cards ?? []).map((c) => c.id));
  const grupos = new Map<string, ConexaoDaUnidade>();
  for (const c of coorte) {
    const unidade = rotuloDaUnidade(c.unidade_ids, nomeDa);
    const g = grupos.get(unidade) ?? { unidade, abordados: [], conexao: [] };
    g.abordados.push(c);
    if (comConexao.has(c.id)) g.conexao.push(c);
    grupos.set(unidade, g);
  }
  return [...grupos.values()].sort(
    (a, b) =>
      Number(a.unidade === SEM_UNIDADE) - Number(b.unidade === SEM_UNIDADE) ||
      b.abordados.length - a.abordados.length ||
      b.conexao.length - a.conexao.length ||
      a.unidade.localeCompare(b.unidade, "pt-BR"),
  );
}

// ----------------------------------------------------------------------------------------------- 4. estoque
export interface EstoqueERitmo {
  /** Abertos na Base elegível agora, pipe inteiro, no produto do filtro. */
  base: Negocio[];
  /** Dias úteis de hoje ao fim do mês, contando hoje. */
  uteisRestantes: number;
  /** Meta de abordagens do mês; `null` com filtro de produto (a meta é da frente inteira). */
  meta: number | null;
  metaDoPlano: boolean;
  /** Abordagens por dia útil para chegar à meta, arredondadas para cima. */
  porDiaUtil: number | null;
  /** Contas que faltam mesmo esgotando a Base: meta − abordados − Base, quando positivo. */
  faltamContas: number;
}

export function estoqueERitmo(
  cards: Negocio[],
  regua: Regua,
  f: Pick<Filtro, "owner" | "owners" | "product">,
  plano: Plano | undefined,
  abordados: number,
  hoje: string,
): EstoqueERitmo {
  const base = doProduto(cards, f).filter(
    (c) => c.status === "open" && regua.niveis[0].stage_ids.includes(c.stage_id),
  );
  const uteisRestantes = uteis(hoje, fimDoMes(hoje.slice(0, 7)));
  const metaDoPlano = !!plano?.capacity;
  const meta = f.product
    ? null
    : metaDoPlano
      ? plano!.capacity
      : ABORDAGENS_POR_CLOSER * pessoasNoRecorte(f);
  const faltam = meta === null ? null : Math.max(0, meta - abordados);
  return {
    base,
    uteisRestantes,
    meta,
    metaDoPlano,
    porDiaUtil: faltam === null || !uteisRestantes ? null : Math.ceil(faltam / uteisRestantes),
    faltamContas: meta === null ? 0 : Math.max(0, meta - abordados - base.length),
  };
}

// ----------------------------------------------------------------------------------------------- 6. atenção
export interface ItemAtencao {
  card: Negocio;
  /** Data do primeiro `started` (saída da Base). */
  abordadoEm: string;
  diasUteis: number;
  unidade: string;
  unidade_ids: number[];
}

/**
 * Abertos em Abordagem iniciada, do dono atual e do produto do filtro, que nunca chegaram ao nível da Conexão e
 * foram abordados há `DIAS_UTEIS_SEM_CONEXAO` dias úteis ou mais. Ordem: dias úteis, do maior para o menor.
 *
 * "Chegar à Conexão" usa as etapas do pipe novo (Conexão e as seguintes), com a regra dos 30 minutos. O Gatilho
 * encerrado não conta aqui: a edição do pipe de 01/10 devolveu esses cards para Abordagem iniciada, sem resposta.
 * `null` quando o pipe não tem Abordagem ou Conexão.
 */
export function listaDeAtencao(
  cards: Negocio[],
  regua: Regua,
  f: Pick<Filtro, "owner" | "owners" | "product">,
  units: { id: number | null; name: string }[],
  hoje: string,
): ItemAtencao[] | null {
  const nAbordagem = regua.nivelDe.abordagem;
  const nConexao = regua.nivelDe.conexao;
  if (nAbordagem === undefined || nConexao === undefined) return null;
  const naAbordagem = new Set(regua.niveis[nAbordagem].stage_ids);
  const encerradas = new Set(regua.niveis[nConexao].somadas.map((s) => s.id));
  const nomeDa = nomesDasUnidades(units);
  const itens: ItemAtencao[] = [];
  for (const c of doProduto(cards, f)) {
    if (c.status !== "open" || !naAbordagem.has(c.stage_id)) continue;
    if (!doResponsavel(f, c.owner_id)) continue;
    const mv = trajeto(c, regua, encerradas);
    if (mv.some((m, i) => m.nivel >= nConexao && ficou(mv, i))) continue;
    const inicio = [...c.events.started].sort((a, b) => instante(a.at) - instante(b.at))[0];
    if (!inicio) continue;
    const diasUteis = uteisDesde(inicio.date, hoje);
    if (diasUteis < DIAS_UTEIS_SEM_CONEXAO) continue;
    itens.push({
      card: c,
      abordadoEm: inicio.date,
      diasUteis,
      unidade: rotuloDaUnidade(c.unidade_ids, nomeDa),
      unidade_ids: [...new Set(c.unidade_ids ?? [])],
    });
  }
  return itens.sort((a, b) => b.diasUteis - a.diasUteis || a.card.id - b.card.id);
}
