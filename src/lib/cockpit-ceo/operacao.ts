// Operação e capacidade no Cockpit do CEO: a fila de onboarding como sinal de ativação.
//
// Fonte: `ops.cs_onboarding_cards` (pipe de Onboarding do Pipefy, sincronizado pelo Ops desde
// 16/07/2026), com o histórico de fases de cada card. Vínculo com a venda: `empresa_id` do card ×
// `ops.contratos.empresa_id` (ganho no CRM). Card sem empresa não é ligado por nome.
//
// Não existe SLA de onboarding decidido. As faixas de idade (mais de 30 e de 60 dias na mesma fase)
// são faixas de leitura, não meta: a tela diz isso. Horas, retrabalho, custo por cliente e
// capacidade da equipe não têm fonte — aparecem como lacuna, não como zero.

import type { Cadeia } from "./cadeia.ts";

const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const dias = (de: string, ate: string) => (Date.parse(ate) - Date.parse(de)) / 86_400_000;
const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const FASE_CONCLUIDO = "Concluído";
export const FASE_CHURN = "Churn no Onboarding";
export const FAIXAS_IDADE = [30, 60] as const;

export interface CardOnboarding {
  fase: string;
  ordem: number | null;
  entrouNaFase: string | null;
  criadoEm: string | null;
  concluido: boolean;
  empresaId: number | null;
  /** Quando entrou em "Concluído", pelo histórico de fases. */
  concluidoEm: string | null;
}

export interface FaseOnboarding {
  fase: string;
  ordem: number | null;
  cards: number;
  idadeMediana: number | null;
  acima30: number;
  acima60: number;
}

export interface Onboarding {
  desde: string | null;
  total: number;
  emCurso: number;
  concluidos: number;
  churnNoOnboarding: number;
  /** Em curso há mais de 30 / 60 dias na mesma fase. */
  parados30: number;
  parados60: number;
  fases: FaseOnboarding[];
  concluidosNoPeriodo: number;
  /**
   * Do ganho no CRM à entrada em "Concluído", em dias, só onde o card liga a um contrato ganho até a
   * criação do card (a venda que o originou).
   */
  ganhoAteConclusao: { mediana: number | null; casos: number; semVinculo: number };
  /**
   * Da criação do card à entrada em "Concluído", em dias. O pipe começou em 16/07/2026 com clientes
   * vendidos antes, e o tempo desde o ganho inclui essa espera; este mede só o onboarding.
   */
  criacaoAteConclusao: { mediana: number | null; casos: number };
  semEmpresa: number;
}

/** Linha crua de `ops.cs_onboarding_cards` → card. `fases_history` é lista {fase, entrou_em, saiu_em}. */
export function lerCard(r: Record<string, unknown>): CardOnboarding {
  const hist = Array.isArray(r.fases_history) ? (r.fases_history as Record<string, unknown>[]) : [];
  const conc = hist
    .filter((h) => h.fase === FASE_CONCLUIDO && typeof h.entrou_em === "string")
    .map((h) => h.entrou_em as string)
    .sort()[0];
  const fase = String(r.fase_atual ?? "");
  return {
    fase,
    ordem: numero(r.fase_atual_ordem),
    entrouNaFase: typeof r.entrou_fase_atual_em === "string" ? r.entrou_fase_atual_em : null,
    criadoEm: typeof r.criado_em === "string" ? r.criado_em : null,
    concluido: r.concluido === true,
    empresaId: numero(r.empresa_id),
    concluidoEm:
      conc ??
      (fase === FASE_CONCLUIDO && typeof r.entrou_fase_atual_em === "string"
        ? r.entrou_fase_atual_em
        : null),
  };
}

/**
 * A venda que originou o card: o último ganho da empresa até a criação do card. Cliente antigo que
 * comprou de novo tem vários ganhos; o primeiro deles mediria outra coisa (medido em 23/09: com o
 * primeiro ganho a mediana dava 202 dias).
 */
export function ganhoDoCard(c: CardOnboarding, ganhosPorEmpresa: Map<number, string[]>) {
  if (c.empresaId === null || !c.criadoEm) return null;
  const limite = c.criadoEm.slice(0, 10);
  const antes = (ganhosPorEmpresa.get(c.empresaId) ?? []).filter((g) => g <= limite).sort();
  return antes.at(-1) ?? null;
}

export function montarOnboarding(
  cards: CardOnboarding[],
  ganhosPorEmpresa: Map<number, string[]>,
  agora: string,
  periodo: { de: string; ate: string },
): Onboarding {
  const terminal = (c: CardOnboarding) => c.fase === FASE_CONCLUIDO || c.fase === FASE_CHURN;
  const porFase = new Map<string, { ordem: number | null; idades: number[] }>();
  let parados30 = 0;
  let parados60 = 0;
  for (const c of cards) {
    const f = porFase.get(c.fase) ?? { ordem: c.ordem, idades: [] };
    const idade = c.entrouNaFase ? Math.floor(dias(c.entrouNaFase, agora)) : null;
    if (idade !== null) f.idades.push(idade);
    porFase.set(c.fase, f);
    if (!terminal(c) && idade !== null) {
      if (idade > FAIXAS_IDADE[0]) parados30 += 1;
      if (idade > FAIXAS_IDADE[1]) parados60 += 1;
    }
  }
  const fases = [...porFase.entries()]
    .map(([fase, f]) => ({
      fase,
      ordem: f.ordem,
      cards: cards.filter((c) => c.fase === fase).length,
      idadeMediana: mediana(f.idades),
      acima30: f.idades.filter((i) => i > FAIXAS_IDADE[0]).length,
      acima60: f.idades.filter((i) => i > FAIXAS_IDADE[1]).length,
    }))
    .sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999) || b.cards - a.cards);

  const tempos: number[] = [];
  const temposCard: number[] = [];
  let semVinculo = 0;
  for (const c of cards) {
    if (c.fase !== FASE_CONCLUIDO || !c.concluidoEm) continue;
    if (c.criadoEm) {
      const dc = dias(c.criadoEm, c.concluidoEm);
      if (Number.isFinite(dc) && dc >= 0) temposCard.push(Math.round(dc));
    }
    const ganho = ganhoDoCard(c, ganhosPorEmpresa);
    if (!ganho) {
      semVinculo += 1;
      continue;
    }
    const d = dias(ganho, c.concluidoEm);
    if (Number.isFinite(d) && d >= 0) tempos.push(Math.round(d));
    else semVinculo += 1;
  }
  const noPeriodo = (iso: string | null) =>
    !!iso && iso.slice(0, 10) >= periodo.de && iso.slice(0, 10) <= periodo.ate;
  const criados = cards
    .map((c) => c.criadoEm)
    .filter((x): x is string => !!x)
    .sort();
  return {
    desde: criados[0]?.slice(0, 10) ?? null,
    total: cards.length,
    emCurso: cards.filter((c) => !terminal(c)).length,
    concluidos: cards.filter((c) => c.fase === FASE_CONCLUIDO).length,
    churnNoOnboarding: cards.filter((c) => c.fase === FASE_CHURN).length,
    parados30,
    parados60,
    fases,
    concluidosNoPeriodo: cards.filter((c) => c.fase === FASE_CONCLUIDO && noPeriodo(c.concluidoEm))
      .length,
    ganhoAteConclusao: { mediana: mediana(tempos), casos: tempos.length, semVinculo },
    criacaoAteConclusao: { mediana: mediana(temposCard), casos: temposCard.length },
    semEmpresa: cards.filter((c) => c.empresaId === null).length,
  };
}

// ── Resposta da leitura de operação (operacao.functions.ts) ─────────────────

export type Falha = { estado: "acesso_insuficiente" | "fonte_indisponivel"; motivo: string };
export type Parte<T> = ({ estado: "ok" } & T) | Falha;

export interface RespostaOperacao {
  lidoEm: string;
  onboarding: Parte<{ dado: Onboarding; atualizadoEm: string | null }>;
  cadeia: Parte<{ dado: Cadeia; faturamento: Falha | null }>;
}
