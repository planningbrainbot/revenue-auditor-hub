// Carimba o schema do produto em toda chamada ao PostgREST.
//
// No banco único as tabelas do Ops vivem no schema `ops`, mas o schema padrão do
// PostgREST continua sendo `public`. Sem este carimbo toda leitura volta VAZIA,
// sem erro — que é indistinguível de "não há dado" e é como um sync silenciosamente
// para de sincronizar.
//
// Por que embrulhar o `fetch` em vez de editar as 69 chamadas: elas montam os
// cabeçalhos inline, uma a uma. Esquecer uma não quebra nada visivelmente — só
// devolve vazio. Aqui não há ponto de chamada a esquecer.
//
// `Accept-Profile` vale para leitura; `Content-Profile` para escrita. O PostgREST
// exige os dois, cada um no seu verbo.

const SCHEMA = "ops";
const original = globalThis.fetch;

globalThis.fetch = ((entrada: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof entrada === "string" ? entrada : entrada instanceof URL
    ? entrada.href
    : (entrada as Request).url;

  // `/rest/v1/` cobre também as chamadas de RPC, que vivem em /rest/v1/rpc/.
  if (!url.includes("/rest/v1/")) return original(entrada, init);

  const metodo = (init?.method ?? "GET").toUpperCase();
  const cabecalhos = new Headers(init?.headers ?? (entrada as Request)?.headers);
  // Não sobrescreve um perfil já declarado à mão — se alguém precisou apontar
  // para outro schema de propósito, essa intenção vence.
  if (!cabecalhos.has("Accept-Profile")) cabecalhos.set("Accept-Profile", SCHEMA);
  if (metodo !== "GET" && metodo !== "HEAD" && !cabecalhos.has("Content-Profile")) {
    cabecalhos.set("Content-Profile", SCHEMA);
  }
  return original(entrada, { ...init, headers: cabecalhos });
}) as typeof fetch;
