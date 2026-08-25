/**
 * Storage de sessão do Supabase em cookie no domínio raiz.
 *
 * Motivo: `localStorage` é isolado por origem, então a sessão criada em
 * ops.planningbrain.com.br nunca é visível em growth.planningbrain.com.br —
 * é o que obriga a logar duas vezes hoje. Cookie com Domain=.planningbrain.com.br
 * é legível pelos dois subdomínios. As chaves do Supabase já incluem o ref do
 * projeto (`sb-<ref>-auth-token`), então as sessões dos dois projetos convivem
 * sem colidir.
 *
 * Ver PLANO-SSO-OPS-GROWTH.md. Exige a mesma mudança no lado do Growth para o
 * login integrado funcionar de fato.
 */

const COOKIE_DOMAIN = ".planningbrain.com.br";

// Cookie individual tem limite de ~4KB. O payload da sessão (access + refresh
// token) passa disso, então fatiamos — mesma estratégia do @supabase/ssr.
const CHUNK_SIZE = 3200;
const MAX_CHUNKS = 10;

/** Em localhost não dá pra setar Domain do domínio de produção. */
function dominioAplicavel(): string {
  if (typeof window === "undefined") return "";
  const h = window.location.hostname;
  if (h === "localhost" || h === "127.0.0.1" || h.endsWith(".local")) return "";
  return h.endsWith("planningbrain.com.br") ? `; domain=${COOKIE_DOMAIN}` : "";
}

function lerCookie(nome: string): string | null {
  if (typeof document === "undefined") return null;
  const alvo = `${encodeURIComponent(nome)}=`;
  for (const parte of document.cookie.split("; ")) {
    if (parte.startsWith(alvo)) return decodeURIComponent(parte.slice(alvo.length));
  }
  return null;
}

function escreverCookie(nome: string, valor: string) {
  if (typeof document === "undefined") return;
  const seguro = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${encodeURIComponent(nome)}=${encodeURIComponent(valor)}` +
    `; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax${seguro}${dominioAplicavel()}`;
}

function apagarCookie(nome: string) {
  if (typeof document === "undefined") return;
  document.cookie =
    `${encodeURIComponent(nome)}=; path=/; max-age=0${dominioAplicavel()}`;
}

export const cookieStorage = {
  getItem(key: string): string | null {
    // Valor inteiro num cookie só
    const direto = lerCookie(key);
    if (direto !== null) return direto;

    // Ou fatiado em key.0, key.1, ...
    const partes: string[] = [];
    for (let i = 0; i < MAX_CHUNKS; i++) {
      const p = lerCookie(`${key}.${i}`);
      if (p === null) break;
      partes.push(p);
    }
    if (partes.length > 0) return partes.join("");

    // Migração: sessão antiga ainda no localStorage. Lê, promove pra cookie e
    // devolve — assim ninguém é deslogado quando esta mudança sobe.
    try {
      const antigo = window.localStorage.getItem(key);
      if (antigo) {
        cookieStorage.setItem(key, antigo);
        window.localStorage.removeItem(key);
        return antigo;
      }
    } catch {
      // localStorage pode estar bloqueado — não é motivo pra quebrar o login.
    }
    return null;
  },

  setItem(key: string, value: string): void {
    // Limpa o formato anterior antes de gravar o novo, senão sobram fatias
    // órfãs de uma sessão maior.
    apagarCookie(key);
    for (let i = 0; i < MAX_CHUNKS; i++) apagarCookie(`${key}.${i}`);

    if (value.length <= CHUNK_SIZE) {
      escreverCookie(key, value);
      return;
    }
    for (let i = 0; i * CHUNK_SIZE < value.length && i < MAX_CHUNKS; i++) {
      escreverCookie(`${key}.${i}`, value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
  },

  removeItem(key: string): void {
    apagarCookie(key);
    for (let i = 0; i < MAX_CHUNKS; i++) apagarCookie(`${key}.${i}`);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // idem
    }
  },
};
