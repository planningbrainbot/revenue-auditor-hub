// Templates dos e-mails transacionais de acesso ao Planning Brain.
// HTML em tabela e estilo inline de propósito: é o que sobrevive ao Gmail,
// Outlook e ao webmail das unidades.

const LOGO_URL = "https://planningbrain.com.br/brand/planning-logo-dark.png";
const VERDE = "#0ae18c";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function layout(opts: {
  titulo: string;
  corpo: string;
  botao: { texto: string; url: string };
  rodape: string;
  preheader?: string;
  complemento?: string;
}) {
  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(opts.titulo)} · Planning Brain</title>
  <style>@media only screen and (max-width:600px){.outer{padding:20px 12px!important}.content{padding-left:24px!important;padding-right:24px!important}.title{font-size:28px!important;line-height:36px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f7f9;color:#10171c;font-family:Poppins,'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f4f7f9;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader ?? opts.titulo)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7f9;">
    <tr><td class="outer" align="center" style="padding:40px 16px;">
      <!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dde4e9;border-radius:20px;">
        <tr><td class="content" style="padding:32px 40px 28px;border-bottom:1px solid #dde4e9;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="${LOGO_URL}" alt="Planning" width="156" style="display:block;width:156px;max-width:100%;height:auto;border:0;" /></td>
            <td align="right" style="color:#4a5b66;font-size:12px;font-weight:600;letter-spacing:2px;">BRAIN</td>
          </tr></table>
        </td></tr>
        <tr><td class="content" style="padding:32px 40px 0;">
          <p style="margin:0 0 16px;color:#00875a;font-size:11px;line-height:16px;letter-spacing:1.5px;font-weight:700;">SEU ACESSO AO PLANNING</p>
          <h1 class="title" style="margin:0;font-size:32px;line-height:40px;letter-spacing:-1px;color:#10171c;font-weight:700;">${escapeHtml(opts.titulo)}</h1>
        </td></tr>
        <tr><td class="content" style="padding:20px 40px 0;font-size:15px;line-height:25px;color:#4a5b66;">${opts.corpo}</td></tr>
        <tr><td class="content" style="padding:28px 40px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${VERDE}" style="border-radius:12px;background:${VERDE};mso-padding-alt:16px 28px;">
            <a href="${escapeHtml(opts.botao.url)}" style="display:inline-block;padding:16px 28px;border:1px solid ${VERDE};border-radius:12px;color:#06090b;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;mso-padding-alt:0;">${escapeHtml(opts.botao.texto)}</a>
          </td></tr></table>
        </td></tr>
        ${opts.complemento ? `<tr><td class="content" style="padding:24px 40px 0;">${opts.complemento}</td></tr>` : ""}
        <tr><td class="content" style="padding:24px 40px 32px;font-size:12px;line-height:20px;color:#4a5b66;">
          ${escapeHtml(opts.rodape)}
        </td></tr>
        <tr><td class="content" style="padding:24px 40px;border-top:1px solid #dde4e9;font-size:11px;line-height:18px;color:#4a5b66;">
          Se o botão não abrir, copie o endereço completo para o navegador:<br />
          <span style="word-break:break-all;overflow-wrap:anywhere;">${escapeHtml(opts.botao.url)}</span>
        </td></tr>
      </table>
      <!--[if mso]></td></tr></table><![endif]-->
      <p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#4a5b66;">Planning Brain<br />planningbrain.com.br</p>
    </td></tr>
  </table>
</body>
</html>`;
}

/** Mesmo layout dos envios administrativos, usado pelo Auth em Esqueceu a senha. */
export function emailRecuperacaoSenha(params: { link: string; codigo: string }) {
  return {
    subject: "Redefina sua senha · Planning Brain",
    html: layout({
      titulo: "Vamos recuperar seu acesso.",
      preheader: "Defina uma nova senha. Link e código válidos por 1 hora.",
      corpo: `<p style="margin:0;">Recebemos seu pedido para redefinir a senha do <strong style="color:#10171c;">Planning Brain</strong>. Clique abaixo e escolha uma nova senha.</p>`,
      botao: { texto: "Redefinir minha senha", url: params.link },
      complemento: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f9;border:1px solid #dde4e9;border-radius:12px;">
        <tr><td style="padding:20px 24px;font-size:13px;line-height:21px;color:#4a5b66;">
          <strong style="color:#10171c;">Prefere usar um código?</strong><br />Na tela de recuperação, escolha “Usar código do e-mail” e informe seu e-mail e este código:
          <p style="margin:14px 0 0;font-family:Consolas,monospace;font-size:28px;line-height:36px;font-weight:700;letter-spacing:5px;color:#10171c;">${escapeHtml(params.codigo)}</p>
        </td></tr></table>`,
      rodape:
        "Link e código valem por 1 hora e só podem ser usados uma vez. Use sempre o e-mail mais recente. Se você não pediu esta alteração, ignore a mensagem: sua senha continua a mesma.",
    }),
  };
}

const VALIDADE = "O link vale por 1 hora. A confirmação acontece ao salvar sua nova senha.";

export function emailBoasVindas(params: {
  nome: string;
  email: string;
  link: string;
  papel: string;
}) {
  const primeiroNome = params.nome.trim().split(/\s+/)[0] || params.nome;
  return {
    subject: "Seu acesso ao Planning Brain",
    html: layout({
      titulo: `Olá, ${primeiroNome}`,
      corpo: `
        <p style="margin:0 0 12px 0;">Sua conta no <strong>Planning Brain</strong> foi criada com o perfil <strong>${escapeHtml(params.papel)}</strong>.</p>
        <p style="margin:0;">Seu usuário é <strong>${escapeHtml(params.email)}</strong>. Defina sua senha no botão abaixo para entrar pela primeira vez.</p>`,
      botao: { texto: "Definir minha senha", url: params.link },
      rodape: `${VALIDADE} Se ele expirar, use "Esqueci minha senha" na tela de login que um novo chega no mesmo e-mail.`,
    }),
    text: [
      `Olá, ${primeiroNome}`,
      ``,
      `Sua conta no Planning Brain foi criada com o perfil ${params.papel}.`,
      `Usuário: ${params.email}`,
      ``,
      `Defina sua senha neste link (vale por 1 hora, uso único):`,
      params.link,
      ``,
      `Se o link expirar, use "Esqueci minha senha" na tela de login.`,
      `Planning Brain — planningbrain.com.br`,
    ].join("\n"),
  };
}

export function emailRedefinicaoSenha(params: { nome: string; email: string; link: string }) {
  const primeiroNome = (params.nome || "").trim().split(/\s+/)[0];
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}` : "Redefinição de senha";
  return {
    subject: "Redefinição de senha — Planning Brain",
    html: layout({
      titulo: saudacao,
      corpo: `
        <p style="margin:0 0 12px 0;">Um administrador solicitou a redefinição da senha da sua conta no <strong>Planning Brain</strong> (${escapeHtml(params.email)}).</p>
        <p style="margin:0;">Sua senha atual continua valendo até você cadastrar uma nova pelo botão abaixo.</p>`,
      botao: { texto: "Cadastrar nova senha", url: params.link },
      rodape: `${VALIDADE} Se você não esperava este e-mail, avise a equipe de Operações — nenhuma alteração acontece antes de salvar a nova senha.`,
    }),
    text: [
      saudacao,
      ``,
      `Um administrador solicitou a redefinição da senha da sua conta no Planning Brain (${params.email}).`,
      `Sua senha atual continua valendo até você cadastrar uma nova neste link (vale por 1 hora, uso único):`,
      params.link,
      ``,
      `Se você não esperava este e-mail, avise a equipe de Operações.`,
      `Planning Brain — planningbrain.com.br`,
    ].join("\n"),
  };
}

/**
 * Avisa que a pessoa recebeu acesso ao Brain Financeiro.
 *
 * PEDIDO DO DONO, verbatim (15/09/2026): "Quero enviar o acesso via email.
 * Igual acontece no sistema geral hoje. Só que dentro do financeiro
 * especificamente."
 *
 * DIFERENÇA DELIBERADA EM RELAÇÃO AO `emailBoasVindas`: aqui NÃO vai link de
 * definir senha. O cockpit financeiro não tem login próprio — a sessão nasce
 * da sessão do Ops. Mandar "defina sua senha" apontaria para uma senha que não
 * existe e não serve para nada. O botão leva ao cockpit; quem ainda não tem
 * senha do Ops recebe o `emailBoasVindas` na mesma leva, por outro caminho.
 *
 * As unidades vão escritas no corpo de propósito. Quem concede erra, e a
 * pessoa que recebe é a única em posição de dizer "eu não deveria ver MAROX".
 */
export function emailAcessoFinanceiro(params: {
  nome: string;
  email: string;
  link: string;
  unidades: string[];
  concedidoPor: string;
}) {
  const primeiroNome = (params.nome || "").trim().split(/\s+/)[0] || params.email;
  const lista = params.unidades.length
    ? params.unidades.join(", ")
    : "nenhuma unidade ainda — peça a quem te liberou";
  return {
    subject: "Seu acesso ao Brain Financeiro",
    html: layout({
      titulo: `Olá, ${primeiroNome}`,
      corpo: `
        <p style="margin:0 0 12px 0;">Você recebeu acesso ao <strong>Brain Financeiro</strong>, o cockpit de DRE, fluxo de caixa, inadimplência e aprovações do Grupo Planning.</p>
        <p style="margin:0 0 12px 0;">As unidades que você abre: <strong>${escapeHtml(lista)}</strong>.</p>
        <p style="margin:0;">Você entra com o mesmo e-mail e a mesma senha do Planning Brain (<strong>${escapeHtml(params.email)}</strong>) — não há senha separada.</p>`,
      botao: { texto: "Abrir o Brain Financeiro", url: params.link },
      rodape: `Acesso concedido por ${params.concedidoPor}. Se alguma unidade dessa lista não deveria estar aí, responda este e-mail antes de abrir.`,
    }),
    text: [
      `Olá, ${primeiroNome}`,
      ``,
      `Você recebeu acesso ao Brain Financeiro, o cockpit de DRE, fluxo de caixa,`,
      `inadimplência e aprovações do Grupo Planning.`,
      ``,
      `Unidades que você abre: ${lista}`,
      ``,
      `Você entra com o mesmo e-mail e senha do Planning Brain (${params.email}).`,
      `Não há senha separada.`,
      ``,
      params.link,
      ``,
      `Acesso concedido por ${params.concedidoPor}.`,
      `Planning Brain — planningbrain.com.br`,
    ].join("\n"),
  };
}

/**
 * Para quem pediu cadastro em /cadastro. O link de definir senha é também a
 * prova de que a pessoa é dona do e-mail: ninguém entra sem abrir esta caixa.
 */
export function emailPedidoRecebido(params: {
  nome: string;
  email: string;
  unidade: string;
  link: string | null;
}) {
  const primeiroNome = params.nome.trim().split(/\s+/)[0] || params.nome;
  const passoSenha = params.link
    ? `<p style="margin:0 0 12px 0;">Enquanto isso, defina sua senha no botão abaixo.</p>`
    : `<p style="margin:0 0 12px 0;">Você já tem senha: use a mesma de sempre.</p>`;
  return {
    subject: "Recebemos seu pedido de acesso · Planning Brain",
    html: layout({
      titulo: `Olá, ${primeiroNome}`,
      corpo: `
        <p style="margin:0 0 12px 0;">Seu pedido de acesso ao <strong>Planning Brain</strong> foi para o sócio da unidade <strong>${escapeHtml(params.unidade)}</strong>. Você recebe outro e-mail quando ele liberar.</p>
        ${passoSenha}
        <p style="margin:0;">Seu usuário é <strong>${escapeHtml(params.email)}</strong>.</p>`,
      botao: params.link
        ? { texto: "Definir minha senha", url: params.link }
        : { texto: "Abrir o Planning Brain", url: "https://planningbrain.com.br/auth" },
      rodape: params.link
        ? `${VALIDADE} Se ele expirar, use "Esqueci minha senha" na tela de login. Se você não pediu acesso, ignore este e-mail.`
        : "Se você não pediu acesso, ignore este e-mail.",
    }),
    text: [
      `Olá, ${primeiroNome}`,
      ``,
      `Seu pedido de acesso ao Planning Brain foi para o sócio da unidade ${params.unidade}.`,
      `Você recebe outro e-mail quando ele liberar.`,
      `Usuário: ${params.email}`,
      ...(params.link ? [``, `Defina sua senha neste link (vale por 1 hora, uso único):`, params.link] : []),
      ``,
      `Se você não pediu acesso, ignore este e-mail.`,
      `Planning Brain · planningbrain.com.br`,
    ].join("\n"),
  };
}

/** Para o sócio ou admin que decide: tem gente esperando em /equipe. */
export function emailNovoPedidoParaLider(params: {
  nomeLider: string;
  nome: string;
  cargo: string;
  email: string;
  unidade: string;
  observacao: string | null;
  link: string;
}) {
  const primeiroNome = (params.nomeLider || "").trim().split(/\s+/)[0];
  const obs = params.observacao
    ? `<p style="margin:12px 0 0 0;">Mensagem: <em>${escapeHtml(params.observacao)}</em></p>`
    : "";
  return {
    subject: `Pedido de acesso: ${params.nome} (${params.unidade})`,
    html: layout({
      titulo: primeiroNome ? `Olá, ${primeiroNome}` : "Novo pedido de acesso",
      corpo: `
        <p style="margin:0;"><strong>${escapeHtml(params.nome)}</strong>, ${escapeHtml(params.cargo)} (${escapeHtml(params.email)}), pediu acesso ao Planning Brain na unidade <strong>${escapeHtml(params.unidade)}</strong>. Escolha o que a pessoa vê e aprove em Minha equipe.</p>
        ${obs}`,
      botao: { texto: "Ver o pedido", url: params.link },
      rodape: "Ninguém entra antes de você aprovar. Se não conhece a pessoa, recuse o pedido.",
    }),
    text: [
      `${params.nome}, ${params.cargo} (${params.email}), pediu acesso ao Planning Brain na unidade ${params.unidade}.`,
      ...(params.observacao ? [`Mensagem: ${params.observacao}`] : []),
      ``,
      `Aprove ou recuse em: ${params.link}`,
      `Planning Brain · planningbrain.com.br`,
    ].join("\n"),
  };
}

/** Para quem pediu: a decisão saiu. */
export function emailPedidoDecidido(params: {
  nome: string;
  aprovado: boolean;
  area: string | null;
  motivo: string | null;
  link: string;
}) {
  const primeiroNome = params.nome.trim().split(/\s+/)[0] || params.nome;
  const corpo = params.aprovado
    ? `<p style="margin:0;">Seu acesso ao <strong>Planning Brain</strong>${params.area ? ` em <strong>${escapeHtml(params.area)}</strong>` : ""} foi liberado. Entre com seu e-mail e a senha que você definiu.</p>`
    : `<p style="margin:0;">Seu pedido de acesso ao <strong>Planning Brain</strong> não foi aprovado.</p>${
        params.motivo ? `<p style="margin:12px 0 0 0;">Motivo: <em>${escapeHtml(params.motivo)}</em></p>` : ""
      }`;
  return {
    subject: params.aprovado ? "Seu acesso foi liberado · Planning Brain" : "Seu pedido de acesso · Planning Brain",
    html: layout({
      titulo: `Olá, ${primeiroNome}`,
      corpo,
      botao: { texto: params.aprovado ? "Entrar no Planning Brain" : "Abrir o Planning Brain", url: params.link },
      rodape: params.aprovado
        ? 'Se ainda não definiu a senha, use "Esqueci minha senha" na tela de login.'
        : "Dúvidas, fale com o sócio da sua unidade.",
    }),
    text: [
      `Olá, ${primeiroNome}`,
      ``,
      params.aprovado
        ? `Seu acesso ao Planning Brain${params.area ? ` em ${params.area}` : ""} foi liberado.`
        : `Seu pedido de acesso ao Planning Brain não foi aprovado.${params.motivo ? ` Motivo: ${params.motivo}` : ""}`,
      params.link,
      `Planning Brain · planningbrain.com.br`,
    ].join("\n"),
  };
}
