// Envio de e-mail transacional pela API HTTPS do SendGrid.
// Só pode ser importado de server functions — a API key nunca vai pro browser.
// O domínio planningbrain.com.br está autenticado no SendGrid, então qualquer
// endereço @planningbrain.com.br passa como remetente.

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

const DEFAULT_FROM_EMAIL = "noreply@planningbrain.com.br";
const DEFAULT_FROM_NAME = "Planning Brain";

export type EnviarEmailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/**
 * Envia um e-mail e devolve se saiu ou não. Nunca lança: um e-mail que não sai
 * não pode derrubar a criação do usuário — o admin ainda tem o link em tela.
 */
export async function enviarEmail(
  input: EnviarEmailInput,
): Promise<{ enviado: boolean; erro?: string }> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error("[enviarEmail] SENDGRID_API_KEY ausente — e-mail não enviado:", input.subject);
    return { enviado: false, erro: "SENDGRID_API_KEY não configurada no ambiente." };
  }

  const from = {
    email: process.env.EMAIL_FROM || DEFAULT_FROM_EMAIL,
    name: process.env.EMAIL_FROM_NAME || DEFAULT_FROM_NAME,
  };

  try {
    const res = await fetch(SENDGRID_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: input.to }] }],
        from,
        subject: input.subject,
        content: [
          { type: "text/plain", value: input.text },
          { type: "text/html", value: input.html },
        ],
      }),
    });
    if (!res.ok) {
      const corpo = await res.text();
      console.error(`[enviarEmail] SendGrid HTTP ${res.status}: ${corpo}`);
      return { enviado: false, erro: `SendGrid respondeu HTTP ${res.status}.` };
    }
    return { enviado: true };
  } catch (err) {
    console.error("[enviarEmail] falha na chamada ao SendGrid:", err);
    return { enviado: false, erro: err instanceof Error ? err.message : "Erro desconhecido." };
  }
}
