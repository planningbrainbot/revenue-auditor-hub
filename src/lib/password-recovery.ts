// Abrir o link não verifica o token. A troca acontece somente ao salvar a senha.
export type RecoveryLink =
  | { kind: "token"; tokenHash: string }
  | { kind: "legacy"; accessToken: string }
  | { kind: "invalid" }
  | { kind: "missing" };

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

export function readRecoveryLink(href: string): RecoveryLink {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const params =
    hash.has("token_hash") || hash.has("access_token") || hash.has("error")
      ? hash
      : url.searchParams;
  if (params.has("error") || params.has("error_code")) return { kind: "invalid" };
  if (params.has("token_hash")) {
    const tokenHash = params.get("token_hash") ?? "";
    return params.get("type") === "recovery" && TOKEN.test(tokenHash)
      ? { kind: "token", tokenHash }
      : { kind: "invalid" };
  }
  if (params.get("type") === "recovery" && params.get("access_token")) {
    return { kind: "legacy", accessToken: params.get("access_token")! };
  }
  return { kind: "missing" };
}

export function passwordRecoveryLink(tokenHash: string): string {
  if (!TOKEN.test(tokenHash)) throw new Error("Token de recuperação inválido.");
  // Fragmento não vai ao servidor nem ao Referer. Sem redirecionamento para /verify.
  return `https://planningbrain.com.br/redefinir-senha#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}
