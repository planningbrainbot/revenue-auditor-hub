// Domínio normalizado do ClickUp da Expansão Nacional (puro, sem I/O).
//
// Portado do Growth (`brain-web/src/lib/okrs/tipos.ts`, b0c1400, 14/09/2026) sem mudança de
// régua: medição da KR = Brain > ponteiro do ClickUp (Atual/Alvo com Sentido) > % de ações
// concluídas. Mora em `supabase/functions/_shared/` porque a sincronização (Deno) e as telas do Ops
// (Vite) importam o mesmo arquivo: a régua da foto diária nunca diverge da tela.
//
// Só sintaxe apagável de TypeScript (sem enum, sem parameter property): o Node roda os testes
// removendo os tipos, e o Deno roda a função de borda.

export type Sentido = "maior" | "menor";

export interface Acao {
  id: string;
  nome: string;
  status: string;
  concluida: boolean;
  url: string;
}

/** Medição automática vinda do Brain: quando presente, vence os campos do ClickUp. */
export interface MedicaoBrain {
  /** 0..1, já na régua da KR. */
  progresso: number;
  resumo: string;
  detalhe?: string;
}

export interface Kr {
  id: string;
  nome: string;
  url: string;
  alvo: number | null;
  atual: number | null;
  sentido: Sentido;
  acoes: Acao[];
  brain?: MedicaoBrain;
}

export interface Objetivo {
  listaId: string;
  nome: string;
  krs: Kr[];
  statusDisponiveis: string[];
}

export interface DepartamentoOkr {
  pastaId: string;
  nome: string;
  objetivos: Objetivo[];
}

export type OrigemMedicao = "brain" | "clickup" | "acoes";

/**
 * Progresso 0..1 com a origem da medição, na ordem de confiança: Brain > campos do ClickUp >
 * % de ações concluídas. O fallback por ações mede execução, não o ponteiro.
 */
export function medicaoKr(kr: Kr): { progresso: number; origem: OrigemMedicao } | null {
  if (kr.brain) return { progresso: kr.brain.progresso, origem: "brain" };
  if (kr.alvo != null && kr.alvo > 0 && kr.atual != null) {
    const razao =
      kr.sentido === "menor" ? (kr.atual <= kr.alvo ? 1 : kr.alvo / kr.atual) : kr.atual / kr.alvo;
    return { progresso: Math.min(Math.max(razao, 0), 1), origem: "clickup" };
  }
  if (kr.acoes.length > 0) {
    const feitas = kr.acoes.filter((a) => a.concluida).length;
    return { progresso: feitas / kr.acoes.length, origem: "acoes" };
  }
  return null;
}

export function progressoKr(kr: Kr): number | null {
  return medicaoKr(kr)?.progresso ?? null;
}
