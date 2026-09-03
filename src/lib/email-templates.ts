// Templates dos e-mails transacionais de acesso ao Planning Ops.
// HTML em tabela e estilo inline de propósito: é o que sobrevive ao Gmail,
// Outlook e ao webmail das unidades.

const LOGO_URL = "https://ops.planningbrain.com.br/brand/planning-logo-dark.png";
const VERDE = "#00C38B";

function layout(opts: {
  titulo: string;
  corpo: string;
  botao: { texto: string; url: string };
  rodape: string;
}) {
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f4f5f7;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden;">
        <tr><td style="padding:28px 32px 8px 32px;">
          <img src="${LOGO_URL}" alt="Planning" width="132" style="display:block;height:auto;border:0;" />
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;">
          <h1 style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:20px;line-height:28px;color:#111827;font-weight:700;">${opts.titulo}</h1>
        </td></tr>
        <tr><td style="padding:12px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:23px;color:#374151;">
          ${opts.corpo}
        </td></tr>
        <tr><td style="padding:24px 32px 4px 32px;">
          <a href="${opts.botao.url}" style="display:inline-block;background:${VERDE};color:#0b1f18;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;padding:13px 26px;border-radius:999px;">${opts.botao.texto}</a>
        </td></tr>
        <tr><td style="padding:18px 32px 0 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#6b7280;">
          Se o botão não funcionar, copie e cole este endereço no navegador:<br />
          <span style="word-break:break-all;color:#374151;">${opts.botao.url}</span>
        </td></tr>
        <tr><td style="padding:22px 32px 30px 32px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:19px;color:#6b7280;border-top:1px solid #f0f1f3;margin-top:8px;">
          ${opts.rodape}
        </td></tr>
      </table>
      <p style="margin:16px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;">Planning Brain · ops.planningbrain.com.br</p>
    </td></tr>
  </table>
</body>
</html>`;
}

const VALIDADE = "O link vale por 24 horas e só pode ser usado uma vez.";

export function emailBoasVindas(params: {
  nome: string;
  email: string;
  link: string;
  papel: string;
}) {
  const primeiroNome = params.nome.trim().split(/\s+/)[0] || params.nome;
  return {
    subject: "Seu acesso ao Planning Ops",
    html: layout({
      titulo: `Olá, ${primeiroNome}`,
      corpo: `
        <p style="margin:0 0 12px 0;">Sua conta no <strong>Planning Ops</strong> foi criada com o perfil <strong>${params.papel}</strong>.</p>
        <p style="margin:0;">Seu usuário é <strong>${params.email}</strong>. Defina sua senha no botão abaixo para entrar pela primeira vez.</p>`,
      botao: { texto: "Definir minha senha", url: params.link },
      rodape: `${VALIDADE} Se ele expirar, use "Esqueci minha senha" na tela de login que um novo chega no mesmo e-mail.`,
    }),
    text: [
      `Olá, ${primeiroNome}`,
      ``,
      `Sua conta no Planning Ops foi criada com o perfil ${params.papel}.`,
      `Usuário: ${params.email}`,
      ``,
      `Defina sua senha neste link (vale por 24 horas, uso único):`,
      params.link,
      ``,
      `Se o link expirar, use "Esqueci minha senha" na tela de login.`,
      `Planning Brain — ops.planningbrain.com.br`,
    ].join("\n"),
  };
}

export function emailRedefinicaoSenha(params: { nome: string; email: string; link: string }) {
  const primeiroNome = (params.nome || "").trim().split(/\s+/)[0];
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}` : "Redefinição de senha";
  return {
    subject: "Redefinição de senha — Planning Ops",
    html: layout({
      titulo: saudacao,
      corpo: `
        <p style="margin:0 0 12px 0;">Um administrador solicitou a redefinição da senha da sua conta no <strong>Planning Ops</strong> (${params.email}).</p>
        <p style="margin:0;">Sua senha atual continua valendo até você cadastrar uma nova pelo botão abaixo.</p>`,
      botao: { texto: "Cadastrar nova senha", url: params.link },
      rodape: `${VALIDADE} Se você não esperava este e-mail, avise a equipe de Operações — nenhuma alteração acontece enquanto o link não for usado.`,
    }),
    text: [
      saudacao,
      ``,
      `Um administrador solicitou a redefinição da senha da sua conta no Planning Ops (${params.email}).`,
      `Sua senha atual continua valendo até você cadastrar uma nova neste link (vale por 24 horas, uso único):`,
      params.link,
      ``,
      `Se você não esperava este e-mail, avise a equipe de Operações.`,
      `Planning Brain — ops.planningbrain.com.br`,
    ].join("\n"),
  };
}
