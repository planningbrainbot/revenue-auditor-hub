// Controle de vazão para a API do ClickUp. Portado do Growth (`brain-web/src/lib/okrs/vazao.ts`).
//
// O plano dá 100 requisições por minuto POR TOKEN, e o token é um só para o app inteiro (e hoje é
// o mesmo do Growth). Um 429 é a cota compartilhada batendo, não erro de programação.

export async function comLimite<T, R>(
  itens: T[],
  limite: number,
  trabalho: (item: T, indice: number) => Promise<R>,
): Promise<R[]> {
  if (limite < 1) throw new Error("limite tem que ser >= 1");
  const resultados = new Array<R>(itens.length);
  let proximo = 0;
  const operario = async () => {
    for (;;) {
      const i = proximo++;
      if (i >= itens.length) return;
      resultados[i] = await trabalho(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, operario));
  return resultados;
}

/** Espera indicada por um 429: `X-RateLimit-Reset` (unix em segundos) ou backoff exponencial. */
export function esperaApos429(
  cabecalhos: { get: (n: string) => string | null },
  tentativa: number,
  agoraMs: number,
  tetoMs = 15_000,
): number {
  const reset = Number(cabecalhos.get("X-RateLimit-Reset"));
  if (Number.isFinite(reset) && reset > 0) {
    const faltaMs = reset * 1000 - agoraMs;
    if (faltaMs > 0) return Math.min(faltaMs, tetoMs);
  }
  return Math.min(2 ** tentativa * 500, tetoMs);
}
