import type { SupabaseClient } from "@supabase/supabase-js";
import type { RecoveryLink } from "./password-recovery";

type RecoveryAuth = Pick<
  SupabaseClient["auth"],
  "verifyOtp" | "setSession" | "getUser" | "updateUser"
>;
export type RecoveryResult = { ok: true } | { ok: false; expired?: boolean; message: string };

/**
 * De onde vem a prova de identidade: o link (ou o código) do e-mail, ou a
 * sessão já aberta de quem entrou com uma senha provisória e é obrigado a
 * trocá-la antes de usar o Ops.
 */
export type PasswordFlowSource = RecoveryLink | { kind: "sessao" };

/** Mantém a identidade confirmada para poder corrigir a senha sem reutilizar o OTP. */
export function createPasswordRecoveryFlow(auth: RecoveryAuth, link: PasswordFlowSource) {
  let verifiedUser: string | null = null;
  let pending = false;
  return {
    isVerified: () => Boolean(verifiedUser),
    async save(password: string, code?: { email: string; token: string }): Promise<RecoveryResult> {
      if (pending) return { ok: false, message: "Aguarde a confirmação da senha." };
      if (password.length < 6) return { ok: false, message: "Use pelo menos 6 caracteres." };
      pending = true;
      try {
        if (!verifiedUser && link.kind === "sessao") {
          // Senha provisória: a identidade já está provada pela sessão que a
          // pessoa abriu com a senha que o admin passou na mão. Não há OTP para
          // verificar, e pedir um e-mail aqui seria voltar ao problema que a
          // senha em tela resolve (a pessoa não acessa o e-mail).
          const { data, error } = await auth.getUser();
          if (error || !data.user) {
            return {
              ok: false,
              expired: true,
              message: "Sua sessão expirou. Entre de novo com a senha provisória para continuar.",
            };
          }
          verifiedUser = data.user.id;
        }
        if (!verifiedUser) {
          const result = code
            ? await auth.verifyOtp({
                email: code.email.trim(),
                token: code.token.trim(),
                type: "recovery",
              })
            : link.kind === "token"
              ? await auth.verifyOtp({ token_hash: link.tokenHash, type: "recovery" })
              : link.kind === "legacy"
                ? await auth.setSession({
                    access_token: link.accessToken,
                    refresh_token: link.refreshToken,
                  })
                : null;
          if (!result)
            return { ok: false, message: "Use o código do e-mail ou solicite um novo link." };
          if (result.error || !result.data.session || !result.data.user) {
            const expired =
              result.error?.code === "otp_expired" ||
              result.error?.code === "refresh_token_not_found";
            return {
              ok: false,
              expired,
              message: expired
                ? "Link ou código expirado ou já utilizado. Solicite um novo e-mail e use o mais recente."
                : "Não foi possível validar. Confira o código ou tente novamente em instantes.",
            };
          }
          verifiedUser = result.data.user.id;
        }
        const { data, error } = await auth.getUser();
        if (error || !verifiedUser || data.user?.id !== verifiedUser) {
          return {
            ok: false,
            message: "Sua sessão mudou. Reabra o e-mail de recuperação para continuar.",
          };
        }
        const { error: updateError } = await auth.updateUser({ password });
        if (updateError)
          return {
            ok: false,
            message:
              updateError.code === "same_password"
                ? "Escolha uma senha diferente da anterior."
                : "Não foi possível salvar a senha. Confira os requisitos e tente novamente.",
          };
        return { ok: true };
      } catch {
        return { ok: false, message: "Falha de conexão. Tente novamente." };
      } finally {
        pending = false;
      }
    },
  };
}
