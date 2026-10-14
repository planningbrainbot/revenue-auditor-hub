/**
 * Régua da visão Hoje da Pré-venda (`/monetizacao?aba=pre-venda`, padrão desde 14/10/2026). PRD da call com o Paulo de
 * 14/10 (https://claude.ai/artifact/PdTV7euynpQEU3C63tt3h4, slide 3): o que cada pré-vendedor faz hoje, para a daily.
 *
 * Duas fontes, nenhuma conta nova no banco:
 * - as atividades das cadências ativas (`ops.monetizacao_pre_venda_cadencias()`), uma linha por atividade;
 * - os cards da carga do pipe 39 (`ops.monetizacao_deals`), pela régua do funil (`funil-cumulativo.ts`).
 *
 * Cada bloco é de uma pessoa e devolve os cards que o compõem, para a lista abrir com o link do Pipedrive.
 */
import { listaDeAtencao } from "./acompanhamento.ts";
import { ehDiaUtil } from "./feriados.ts";
import { reguaDoPipe, type Etapa } from "./funil-cumulativo.ts";
import { PRE_VENDEDORES, type Negocio } from "./types.ts";

/** `ops.monetizacao_pre_venda_cadencias()`: uma atividade de cadência ativa. */
export interface AtividadeCadencia {
  deal_id: number;
  empresa: string;
  user_id: number | null;
  dia_cadencia: number | null;
  canal: string | null;
  turno: string | null;
  /** Instante do vencimento (ISO). */
  vence: string | null;
  feita: boolean;
}

type Bruto = Record<string, unknown>;
const obj = (v: unknown): Bruto =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Bruto) : {};
const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const numOuNulo = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export const normalizarCadencias = (linhas: unknown): AtividadeCadencia[] =>
  (Array.isArray(linhas) ? linhas : [])
    .map(obj)
    .map((l) => ({
      deal_id: numOuNulo(l.deal_id) ?? 0,
      empresa: texto(l.empresa) ?? `Card ${numOuNulo(l.deal_id) ?? ""}`,
      user_id: numOuNulo(l.user_id),
      dia_cadencia: numOuNulo(l.dia_cadencia),
      canal: texto(l.canal),
      turno: texto(l.turno),
      vence: texto(l.vence),
      feita: l.feita === true,
    }))
    .filter((a) => a.deal_id > 0);

const DIA_SP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Dia (aaaa-mm-dd) do vencimento, no fuso de São Paulo. */
export const diaDoVencimento = (iso: string | null) =>
  iso && Number.isFinite(Date.parse(iso)) ? DIA_SP.format(new Date(iso)) : null;

/** Próximo dia útil depois de `dia` (sem fim de semana e feriado nacional). */
export function proximoDiaUtil(dia: string): string {
  let t = Date.parse(dia + "T12:00:00Z");
  for (let i = 0; i < 15; i++) {
    t += 86400000;
    const d = new Date(t).toISOString().slice(0, 10);
    if (ehDiaUtil(d)) return d;
  }
  return new Date(t).toISOString().slice(0, 10);
}

/** Ritmo da régua de 08/10/2026: 8 abordagens por pessoa por dia útil. */
export const ABORDAGENS_POR_DIA = 8;

export type ChaveBlocoHoje =
  | "cadencia"
  | "vencidas"
  | "reta"
  | "semData"
  | "semCadencia"
  | "parados"
  | "fila"
  | "amanha";

export interface BlocoHoje {
  chave: ChaveBlocoHoje;
  rotulo: string;
  valor: number;
  nota: string;
  /** "perigo": tem o que fazer e está atrasado; "atencao": tem o que fazer hoje; sem tom: informação. */
  tom?: "perigo" | "atencao" | "sucesso";
  cards: Negocio[];
}

export interface HojeDaPessoa {
  id: number;
  nome: string;
  blocos: BlocoHoje[];
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/**
 * Os blocos de cada pré-vendedor (Matheus e Heloá; com `pessoa`, só ela). Card é da pessoa pelo dono atual; atividade,
 * pelo dono da cadência.
 */
export function hojeDaPreVenda({
  cards,
  stages,
  units,
  atividades,
  hoje,
  pessoa,
}: {
  cards: Negocio[];
  stages: Etapa[];
  units: { id: number | null; name: string }[];
  atividades: AtividadeCadencia[];
  hoje: string;
  pessoa?: number;
}): HojeDaPessoa[] {
  const regua = reguaDoPipe(stages);
  const nivelDe = (c: Negocio) => regua.nivelDaEtapa.get(c.stage_id);
  const nAgendada = regua.nivelDe.agendada;
  const nNegociacao = regua.nivelDe.negociacao;
  const nProposta = regua.nivelDe.reuniaoProposta;
  const nAbordagem = regua.nivelDe.abordagem;
  // Da Reunião de proposta em diante: Reunião de proposta, Em negociação e o que vem depois, sem o Stand by.
  const desdeProposta = Math.min(nProposta ?? Infinity, nNegociacao ?? Infinity);
  const porId = new Map(cards.map((c) => [c.id, c]));
  const amanha = proximoDiaUtil(hoje);
  const abertos = cards.filter((c) => c.status === "open");
  const comCadencia = new Set(atividades.map((a) => a.deal_id));
  const cardsDe = (ids: Iterable<number>) =>
    [...new Set(ids)].map((id) => porId.get(id)).filter((c): c is Negocio => !!c);

  const pessoas = PRE_VENDEDORES.filter(([id]) => !pessoa || id === pessoa);
  return pessoas.map(([id, nome]) => {
    const minhas = atividades.filter((a) => a.user_id === id);
    const doDia = (d: string) => minhas.filter((a) => diaDoVencimento(a.vence) === d);
    const hojeAbertas = doDia(hoje).filter((a) => !a.feita);
    const hojeFeitas = doDia(hoje).filter((a) => a.feita);
    const vencidas = minhas.filter((a) => {
      const d = diaDoVencimento(a.vence);
      return !a.feita && !!d && d < hoje;
    });
    const deAmanha = doDia(amanha);
    const meus = abertos.filter((c) => c.owner_id === id);
    const naReta =
      nAgendada === undefined
        ? []
        : meus.filter((c) => (nivelDe(c) ?? -1) >= nAgendada || regua.standby.has(c.stage_id));
    const semProximo = naReta.filter((c) => !c.next_activity || c.next_activity < hoje);
    const daProposta = meus.filter(
      (c) => !regua.standby.has(c.stage_id) && (nivelDe(c) ?? -1) >= desdeProposta,
    );
    const semData = daProposta.filter((c) => !c.expected_close);
    const naAbordagem =
      nAbordagem === undefined
        ? []
        : meus.filter((c) => regua.niveis[nAbordagem].stage_ids.includes(c.stage_id));
    const semCadencia = naAbordagem.filter((c) => !comCadencia.has(c.id));
    const parados =
      listaDeAtencao(cards, regua, { owner: id, product: "" }, units, hoje)?.map((i) => i.card) ??
      [];
    const fila = meus.filter((c) => nivelDe(c) === 0);
    const diasDeFila = Math.ceil(fila.length / ABORDAGENS_POR_DIA);

    const blocos: BlocoHoje[] = [
      {
        chave: "cadencia",
        rotulo: "Cadência de hoje",
        valor: hojeAbertas.length,
        nota: `${plural(hojeAbertas.length, "atividade aberta", "atividades abertas")} · ${hojeFeitas.length} ${hojeFeitas.length === 1 ? "feita" : "feitas"}`,
        tom: hojeAbertas.length ? "atencao" : hojeFeitas.length ? "sucesso" : undefined,
        cards: cardsDe(hojeAbertas.map((a) => a.deal_id)),
      },
      {
        chave: "vencidas",
        rotulo: "Atividades vencidas",
        valor: vencidas.length,
        nota: vencidas.length
          ? `em ${plural(new Set(vencidas.map((a) => a.deal_id)).size, "card", "cards")}, de dias anteriores`
          : "nada atrasado na cadência",
        tom: vencidas.length ? "perigo" : "sucesso",
        cards: cardsDe(vencidas.map((a) => a.deal_id)),
      },
      {
        chave: "reta",
        rotulo: "Reta final sem próximo passo",
        valor: semProximo.length,
        nota: `de ${plural(naReta.length, "card", "cards")} do Agendado em diante, sem atividade futura`,
        tom: semProximo.length ? "perigo" : naReta.length ? "sucesso" : undefined,
        cards: semProximo,
      },
      {
        chave: "semData",
        rotulo: "Sem data esperada de fechamento",
        valor: semData.length,
        nota: `de ${plural(daProposta.length, "card", "cards")} da Reunião de proposta em diante`,
        tom: semData.length ? "atencao" : daProposta.length ? "sucesso" : undefined,
        cards: semData,
      },
      {
        chave: "semCadencia",
        rotulo: "Abordagem sem cadência",
        valor: semCadencia.length,
        nota: `de ${plural(naAbordagem.length, "card", "cards")} em Abordagem iniciada; passe pela Base e volte`,
        tom: semCadencia.length ? "atencao" : naAbordagem.length ? "sucesso" : undefined,
        cards: semCadencia,
      },
      {
        chave: "parados",
        rotulo: "Abordados sem resposta",
        valor: parados.length,
        nota: "em Abordagem há 3 dias úteis ou mais, sem chegar à Qualificação",
        tom: parados.length ? "atencao" : undefined,
        cards: parados,
      },
      {
        chave: "fila",
        rotulo: "Fila",
        valor: fila.length,
        nota: fila.length
          ? `na Base elegível; dá para ${plural(diasDeFila, "dia útil", "dias úteis")} a ${ABORDAGENS_POR_DIA} por dia`
          : "Base elegível vazia",
        tom: fila.length ? undefined : "perigo",
        cards: fila,
      },
      {
        chave: "amanha",
        rotulo: `Cadência de ${ddmm(amanha)}`,
        valor: deAmanha.length,
        nota: `${plural(deAmanha.length, "atividade prevista", "atividades previstas")} no próximo dia útil`,
        cards: cardsDe(deAmanha.map((a) => a.deal_id)),
      },
    ];
    return { id, nome, blocos };
  });
}
