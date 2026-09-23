// Leitura paginada pelo PostgREST: o projeto corta cada resposta em 1.000 linhas (max_rows), então
// um `.range(0, 4999)` devolve 1.000 sem erro nenhum. Quem chama precisa ordenar por uma chave ÚNICA,
// senão empate na borda da página pula ou repete linha.
export const PAGINA = 1000;

export type Consulta = (
  de: number,
  ate: number,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
) => PromiseLike<{ data: any[] | null; error: any }>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function todasAsPaginas(consulta: Consulta, limite = 100_000): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return linhas;
    if (linhas.length >= limite) throw new Error(`a leitura passou de ${limite} linhas`);
  }
}
