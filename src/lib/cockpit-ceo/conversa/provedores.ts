// Provedor e custo de cada modelo da conversa.
//
// OpenRouter informa o custo de cada chamada (`usage.cost`). A OpenAI não: o custo é estimado pelos
// tokens do passo com a tabela abaixo (preço padrão, US$ por milhão de tokens, conferido na página
// oficial developers.openai.com/api/docs/pricing em 25/09/2026). Preço mudou, muda aqui.
export type Provedor = "openai" | "openrouter";

export const PRECOS_OPENAI: Record<string, { entrada: number; cache: number; saida: number }> = {
  "gpt-5.5": { entrada: 5, cache: 0.5, saida: 30 },
  "gpt-5.4-mini": { entrada: 0.75, cache: 0.075, saida: 4.5 },
};

export const provedorDo = (modelo: string): Provedor =>
  modelo.startsWith("openai/") ? "openai" : "openrouter";

export const idNoProvedor = (modelo: string) => modelo.replace(/^openai\//, "");

export interface UsoDoPasso {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { cacheReadTokens?: number };
}

/**
 * Custo estimado de um passo na OpenAI. `null` quando falta token ou preço: o teto trata como
 * custo desconhecido, nunca como zero.
 */
export function custoEstimadoOpenAI(modelo: string, uso: UsoDoPasso | undefined): number | null {
  const p = PRECOS_OPENAI[idNoProvedor(modelo)];
  if (!p || !uso || typeof uso.inputTokens !== "number" || typeof uso.outputTokens !== "number")
    return null;
  const cache = uso.inputTokenDetails?.cacheReadTokens ?? 0;
  const semCache = Math.max(0, uso.inputTokens - cache);
  return (semCache * p.entrada + cache * p.cache + uso.outputTokens * p.saida) / 1_000_000;
}
