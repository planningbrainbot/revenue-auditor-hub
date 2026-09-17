export interface CatalogPage {
  after: string | null;
  through: string;
  count: number;
}
interface CatalogVersion {
  catalog_at: string | null;
  scope_signature?: string;
}

// Bound concurrency so a large portfolio does not fan out into hundreds of requests.
// Never publish partial or mixed-revision totals to the rest of the application.
export async function loadCatalogPages<T extends { key: string }>(
  pages: CatalogPage[],
  fetchPage: (page: CatalogPage) => Promise<CatalogVersion & { accounts: T[] }>,
  expected: CatalogVersion & { base_count: number; signal?: AbortSignal },
): Promise<T[]> {
  if (pages.length > 100 || pages.reduce((n, p) => n + p.count, 0) !== expected.base_count)
    throw new Error("Não foi possível conferir os lotes da carteira.");
  const results: T[][] = new Array(pages.length);
  let cursor = 0;
  let failed = false;
  const worker = async () => {
    while (!failed) {
      expected.signal?.throwIfAborted();
      const index = cursor++;
      if (index >= pages.length) return;
      try {
        const page = pages[index];
        const batch = await fetchPage(page);
        expected.signal?.throwIfAborted();
        if (
          batch.catalog_at !== expected.catalog_at ||
          batch.scope_signature !== expected.scope_signature ||
          batch.accounts.length !== page.count ||
          batch.accounts.at(-1)?.key !== page.through
        )
          throw new Error("A base ou seu acesso mudou durante a consulta. Atualize novamente.");
        results[index] = batch.accounts;
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pages.length) }, worker));
  const accounts = results.flat();
  if (
    accounts.length !== expected.base_count ||
    new Set(accounts.map((a) => a.key)).size !== accounts.length
  )
    throw new Error("A base mudou durante a consulta. Nenhum total parcial foi exibido.");
  return accounts;
}
