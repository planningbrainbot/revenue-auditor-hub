// Abrir a página não verifica nem consome o token. Somente Salvar nova senha.
export const PASSWORD_RECOVERY_URL = "https://planningbrain.com.br/redefinir-senha";

export type RecoveryLink =
  | { kind: "token"; tokenHash: string }
  | { kind: "legacy"; accessToken: string; refreshToken: string }
  | { kind: "invalid" }
  | { kind: "missing" };

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;

export function readRecoveryLink(href: string): RecoveryLink {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { kind: "invalid" };
  }
  let fragment = url.hash.slice(1);
  // Alguns aplicativos encaminham o fragmento inteiro codificado ou preservam
  // entidades HTML no separador. Decodificar uma vez, sem aceitar outro tipo de OTP.
  if (!fragment.includes("=") && /%3d/i.test(fragment)) {
    try {
      fragment = decodeURIComponent(fragment);
    } catch {
      return { kind: "invalid" };
    }
  }
  const hash = new URLSearchParams(fragment.replace(/&amp;/g, "&"));
  const params = ["token_hash", "access_token", "error", "error_code"].some((key) => hash.has(key))
    ? hash
    : new URLSearchParams(url.search.slice(1).replace(/&amp;/g, "&"));
  if (params.has("error") || params.has("error_code")) return { kind: "invalid" };
  if (params.has("token_hash")) {
    const tokenHash = params.get("token_hash") ?? "";
    return params.get("type") === "recovery" && TOKEN.test(tokenHash)
      ? { kind: "token", tokenHash }
      : { kind: "invalid" };
  }
  if (params.get("type") === "recovery" && params.get("access_token")) {
    const refreshToken = params.get("refresh_token");
    return refreshToken
      ? { kind: "legacy", accessToken: params.get("access_token")!, refreshToken }
      : { kind: "invalid" };
  }
  return { kind: "missing" };
}

export function passwordRecoveryLink(tokenHash: string): string {
  if (!TOKEN.test(tokenHash)) throw new Error("Token de recuperação inválido.");
  // Fragmento não vai ao servidor nem ao Referer. Sem redirecionamento para /verify.
  return `${PASSWORD_RECOVERY_URL}#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
}

export function recoveryRequestError(status?: number): string {
  return status === 429
    ? "Aguarde um minuto antes de solicitar outro e-mail. Use o mais recente que recebeu."
    : "Não foi possível enviar agora. Tente novamente em instantes.";
}
