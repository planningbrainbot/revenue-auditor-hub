// Emails de acesso do login unificado. Chave restrita ao servidor.
import type { EnviarEmailInput } from "./email.server";

const FROM = "Planning Brain <noreply@planningbrain.com.br>";

export function accessEmailStatus() {
  return { configured: Boolean(process.env.RESEND_API_KEY), provider: "Resend", from: FROM };
}

export async function enviarEmailAcesso(
  input: EnviarEmailInput,
): Promise<{ enviado: boolean; erro?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key)
    return { enviado: false, erro: "O envio de acessos pelo Resend ainda não está configurado." };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM,
        to: [input.to],
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error("[email-acesso] Resend HTTP", response.status);
      return {
        enviado: false,
        erro: `Resend respondeu HTTP ${response.status}. Use o link de acesso exibido abaixo.`,
      };
    }
    return { enviado: true };
  } catch {
    // Erros de rede podem carregar corpo e token na mensagem. Não registrar o conteúdo.
    return {
      enviado: false,
      erro: "Não foi possível confirmar o envio. Use o link de acesso exibido abaixo.",
    };
  }
}
