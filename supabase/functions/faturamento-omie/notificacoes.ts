/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do banco chega sem tipo. */
// Notificações por e-mail do Portal de Faturamento (T6 da E1, RF-P12, 20/10/2026). Lógica pura, sem API do Deno:
// testada no Node em tests/faturamento-notificacoes.test.mjs.
//
// A fila é integracoes.notificacoes (migration 20261020200000), alimentada pelo gatilho de receita.fat_eventos: uma
// linha por destinatário de cada transição (OK pendente, devolvido, faturado, em atraso, erro no Omie). Aqui se monta o
// e-mail (texto curto, em português de quem usa, com o link para a página do pedido) e se decide o destino:
// - sem FATURAMENTO_EMAIL=sim na env da edge, nada sai: a linha vira `simulado` com o e-mail pronto (assunto e corpo);
// - pedido simulado no Omie (simulacao = true) nunca gera e-mail de verdade;
// - com a variável ligada, SendGrid, remetente noreply@planningbrain.com.br (o mesmo da gente-vigencia-alertas).
// O layout é o dos e-mails do Brain (src/lib/email-templates.ts): tabela, estilo inline, botão verde. Nenhum CPF ou
// CNPJ completo vai no texto (o que vier no motivo é mascarado).

export const VERSAO_NOTIFICACOES = "faturamento-notificacoes-v1-2026-10-20";
export const APP_URL = "https://planningbrain.com.br";
export const REMETENTE = { email: "noreply@planningbrain.com.br", name: "Planning Brain" };
export const MAX_TENTATIVAS_EMAIL = 6;

export type Email = { para: string; assunto: string; html: string; texto: string };
export type ResultadoNotificacao = {
  status: "simulado" | "enviado" | "erro" | "pendente";
  email: string | null;
  assunto: string | null;
  corpo: string | null;
  erro_legivel: string | null;
  resposta: any;
};

const LOGO_URL = "https://planningbrain.com.br/brand/planning-logo-dark.png";
const VERDE = "#0ae18c";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}
const texto = (v: unknown) =>
  String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();

// Mascara CPF e CNPJ (com ou sem máscara, CNPJ alfanumérico incluído) em texto livre: ficam os 2 primeiros
// caracteres e os 2 dígitos verificadores do CNPJ, e os 2 dígitos verificadores do CPF.
export function semDocumento(v: unknown): string {
  return String(v ?? "")
    .replace(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?[0-9]{2}\b/g, (m) => {
      const d = m.replace(/[^0-9A-Z]/g, "");
      return /[0-9]/.test(d) && d.length === 14
        ? `${d.slice(0, 2)}.***.***/****-${d.slice(12)}`
        : m;
    })
    .replace(
      /\b[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}\b/g,
      (m) => `***.***.***-${m.replace(/\D/g, "").slice(9)}`,
    );
}

const reais = (v: unknown) =>
  Number.isFinite(Number(v))
    ? `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : null;
const dataBr = (iso: unknown) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
};
export const linkDoPedido = (id: string) =>
  `${APP_URL}/faturamento/pedido/${encodeURIComponent(id)}`;

function layout(o: {
  titulo: string;
  corpo: string;
  botao: { texto: string; url: string };
  rodape: string;
  preheader: string;
}) {
  return `<!doctype html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <title>${escapeHtml(o.titulo)} · Planning Brain</title>
  <style>@media only screen and (max-width:600px){.outer{padding:20px 12px!important}.content{padding-left:24px!important;padding-right:24px!important}.title{font-size:26px!important;line-height:34px!important}}</style>
</head>
<body style="margin:0;padding:0;background:#f4f7f9;color:#10171c;font-family:Poppins,'Segoe UI',Arial,sans-serif;-webkit-text-size-adjust:100%;">
  <div style="display:none;font-size:1px;line-height:1px;color:#f4f7f9;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(o.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f7f9;">
    <tr><td class="outer" align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border:1px solid #dde4e9;border-radius:20px;">
        <tr><td class="content" style="padding:32px 40px 28px;border-bottom:1px solid #dde4e9;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td><img src="${LOGO_URL}" alt="Planning" width="156" style="display:block;width:156px;max-width:100%;height:auto;border:0;" /></td>
            <td align="right" style="color:#4a5b66;font-size:12px;font-weight:600;letter-spacing:2px;">BRAIN</td>
          </tr></table>
        </td></tr>
        <tr><td class="content" style="padding:32px 40px 0;">
          <p style="margin:0 0 16px;color:#00875a;font-size:11px;line-height:16px;letter-spacing:1.5px;font-weight:700;">PORTAL DE FATURAMENTO</p>
          <h1 class="title" style="margin:0;font-size:28px;line-height:36px;letter-spacing:-0.5px;color:#10171c;font-weight:700;">${escapeHtml(o.titulo)}</h1>
        </td></tr>
        <tr><td class="content" style="padding:20px 40px 0;font-size:15px;line-height:25px;color:#4a5b66;">${o.corpo}</td></tr>
        <tr><td class="content" style="padding:28px 40px 0;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${VERDE}" style="border-radius:12px;background:${VERDE};">
            <a href="${escapeHtml(o.botao.url)}" style="display:inline-block;padding:16px 28px;border:1px solid ${VERDE};border-radius:12px;color:#06090b;text-decoration:none;font-size:15px;line-height:20px;font-weight:700;">${escapeHtml(o.botao.texto)}</a>
          </td></tr></table>
        </td></tr>
        <tr><td class="content" style="padding:24px 40px 32px;font-size:12px;line-height:20px;color:#4a5b66;">${escapeHtml(o.rodape)}</td></tr>
        <tr><td class="content" style="padding:24px 40px;border-top:1px solid #dde4e9;font-size:11px;line-height:18px;color:#4a5b66;">
          Se o botão não abrir, copie o endereço para o navegador:<br />
          <span style="word-break:break-all;overflow-wrap:anywhere;">${escapeHtml(o.botao.url)}</span>
        </td></tr>
      </table>
      <p style="margin:24px 0 0;font-size:12px;line-height:20px;color:#4a5b66;">Planning Brain<br />planningbrain.com.br</p>
    </td></tr>
  </table>
</body>
</html>`;
}

const p = (html: string) => `<p style="margin:0 0 12px 0;">${html}</p>`;

/**
 * O e-mail de uma notificação: assunto, HTML e texto. `n` é a linha reservada por fat_notificacoes_proximos
 * ({evento, papel, pedido_id, destinatario: {nome, email}, dados}).
 */
export function montarEmail(n: any): Email {
  const d = n?.dados ?? {};
  const numero = texto(d.numero) || "pedido";
  const emissora = texto(d.emissora);
  const cliente = texto(d.tomador_nome) || "o cliente";
  const valor = reais(d.valor);
  const projeto = texto(d.projeto);
  const motivo = semDocumento(texto(d.motivo));
  const nome = texto(n?.destinatario?.nome).split(" ")[0] || "Olá";
  const url = linkDoPedido(String(n?.pedido_id ?? ""));
  const simulacao = d.simulacao === true;
  const resumo = [
    `<strong>${escapeHtml(numero)}</strong>`,
    escapeHtml(cliente),
    valor && escapeHtml(valor),
    projeto && `projeto ${escapeHtml(projeto)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const resumoTexto = [numero, cliente, valor, projeto && `projeto ${projeto}`]
    .filter(Boolean)
    .join(" · ");
  let titulo = "";
  let assunto = "";
  let corpo: string[] = [];
  let linhas: string[] = [];
  let botao = "Abrir o pedido";
  switch (n?.evento) {
    case "ok_pendente": {
      const quem =
        n?.papel === "substituto"
          ? "Você é substituto(a) do dono deste pedido."
          : n?.papel === "gestor"
            ? `Você recebe porque é gestor(a) da ${emissora} e o pedido está sem dono ativo.`
            : null;
      titulo = "Um pedido espera o seu OK";
      assunto = `OK pendente: ${numero}${emissora ? ` (${emissora})` : ""}`;
      corpo = [
        p(`O pedido ${resumo} foi enviado e só vai para o Omie depois do seu OK.`),
        ...(quem ? [p(escapeHtml(quem))] : []),
      ];
      linhas = [
        `O pedido ${resumoTexto} foi enviado e só vai para o Omie depois do seu OK.`,
        ...(quem ? [quem] : []),
      ];
      botao = "Dar o OK ou devolver";
      break;
    }
    case "devolvido":
      titulo = "Seu pedido voltou para correção";
      assunto = `Pedido devolvido: ${numero}`;
      corpo = [
        p(`O pedido ${resumo} foi devolvido para você.`),
        p(`<strong>Motivo:</strong> ${escapeHtml(motivo || "não informado")}`),
        p("Corrija e envie de novo pelo portal."),
      ];
      linhas = [
        `O pedido ${resumoTexto} foi devolvido para você.`,
        `Motivo: ${motivo || "não informado"}`,
        "Corrija e envie de novo pelo portal.",
      ];
      botao = "Corrigir o pedido";
      break;
    case "faturado": {
      const nf = texto(d.nf_numero);
      const link = texto(d.nf_link);
      titulo = nf ? `Nota ${nf} emitida` : "Pedido faturado";
      assunto = `Pedido faturado: ${numero}${nf ? ` · NF ${nf}` : ""}`;
      corpo = [
        p(
          `O pedido ${resumo} foi faturado${nf ? ` com a nota <strong>${escapeHtml(nf)}</strong>` : ""}.`,
        ),
        ...(link
          ? [p(`<a href="${escapeHtml(link)}" style="color:#00875a;">Ver a nota na prefeitura</a>`)]
          : []),
      ];
      linhas = [
        `O pedido ${resumoTexto} foi faturado${nf ? ` com a nota ${nf}` : ""}.`,
        ...(link ? [`Nota: ${link}`] : []),
      ];
      break;
    }
    case "em_atraso": {
      const venc = dataBr(d.primeiro_vencimento);
      titulo = "Pagamento em atraso";
      assunto = `Em atraso: ${numero}`;
      corpo = [
        p(`O pedido ${resumo} tem parcela vencida e ainda não paga.`),
        ...(venc ? [p(`1º vencimento: ${escapeHtml(venc)}.`)] : []),
        p("Veja as parcelas no portal."),
      ];
      linhas = [
        `O pedido ${resumoTexto} tem parcela vencida e ainda não paga.`,
        ...(venc ? [`1º vencimento: ${venc}.`] : []),
        "Veja as parcelas no portal.",
      ];
      botao = "Ver as parcelas";
      break;
    }
    case "erro_omie": {
      const quem =
        n?.papel === "tesouraria"
          ? "O pedido está na fila da tesouraria com erro."
          : "Corrija o que o Omie pediu ou reenvie pelo portal.";
      titulo = "O Omie recusou um pedido";
      assunto = `Erro no Omie: ${numero}${emissora ? ` (${emissora})` : ""}`;
      corpo = [
        p(`O pedido ${resumo} não entrou no Omie${emissora ? ` da ${escapeHtml(emissora)}` : ""}.`),
        p(`<strong>O que o Omie disse:</strong> ${escapeHtml(motivo || "sem detalhe")}`),
        p(escapeHtml(quem)),
      ];
      linhas = [
        `O pedido ${resumoTexto} não entrou no Omie${emissora ? ` da ${emissora}` : ""}.`,
        `O que o Omie disse: ${motivo || "sem detalhe"}`,
        quem,
      ];
      botao = "Abrir o pedido";
      break;
    }
    default:
      titulo = "Atualização de pedido";
      assunto = `Pedido ${numero}`;
      corpo = [p(`O pedido ${resumo} mudou de situação.`)];
      linhas = [`O pedido ${resumoTexto} mudou de situação.`];
  }
  if (simulacao) {
    assunto = `[Simulação] ${assunto}`;
    corpo.push(p("<em>Pedido em simulação: nada foi gravado no Omie.</em>"));
    linhas.push("Pedido em simulação: nada foi gravado no Omie.");
  }
  const rodape =
    "Aviso automático do Portal de Faturamento do Planning Brain. Você recebe porque tem papel neste pedido.";
  return {
    para: texto(n?.destinatario?.email).toLowerCase(),
    assunto,
    html: layout({
      titulo: `${nome}, ${titulo.charAt(0).toLowerCase()}${titulo.slice(1)}`,
      corpo: corpo.join(""),
      botao: { texto: botao, url },
      rodape,
      preheader: assunto,
    }),
    texto: [`${nome},`, "", ...linhas, "", `${botao}: ${url}`, "", rodape].join("\n"),
  };
}

// ---------------------------------------------------------------------------------------------------- envio

/** Envia um e-mail (SendGrid). Devolve o HTTP; lança em erro de rede. */
export type EnviarEmail = (e: Email) => Promise<{ status: number; texto: string }>;

/** O corpo da chamada ao SendGrid (v3/mail/send), sem chave. */
export function corpoSendgrid(e: Email) {
  return {
    personalizations: [{ to: [{ email: e.para }] }],
    from: REMETENTE,
    subject: e.assunto,
    content: [
      { type: "text/plain", value: e.texto },
      { type: "text/html", value: e.html },
    ],
  };
}

export type ContextoNotificacao = {
  /** FATURAMENTO_EMAIL === "sim" na env da edge. */
  ligado: boolean;
  enviar: EnviarEmail | null;
};

const emailValido = (v: string) => /^[^@\s;,]+@[^@\s;,]+\.[^@\s;,]+$/.test(v);

/** Uma notificação reservada → resultado para fat_notificacoes_resultado. Nunca lança. */
export async function processarNotificacao(
  n: any,
  ctx: ContextoNotificacao,
): Promise<ResultadoNotificacao> {
  const cabeca = {
    versao: VERSAO_NOTIFICACOES,
    evento: n?.evento ?? null,
    papel: n?.papel ?? null,
  };
  let e: Email;
  try {
    e = montarEmail(n);
  } catch (x) {
    return {
      status: "erro",
      email: null,
      assunto: null,
      corpo: null,
      erro_legivel: "Falha ao montar o e-mail da notificação.",
      resposta: { ...cabeca, falha: String((x as Error)?.message ?? x).slice(0, 200) },
    };
  }
  const base = { email: e.para || null, assunto: e.assunto, corpo: e.html };
  if (!e.para || !emailValido(e.para) || n?.destinatario?.ativo === false) {
    return {
      status: "erro",
      ...base,
      erro_legivel: "O destinatário não tem e-mail ativo no Brain: nada foi enviado.",
      resposta: cabeca,
    };
  }
  const simulacao = n?.dados?.simulacao === true;
  if (!ctx.ligado || simulacao || !ctx.enviar) {
    const porque = simulacao
      ? "pedido simulado no Omie"
      : !ctx.ligado
        ? "FATURAMENTO_EMAIL desligado"
        : "SENDGRID_API_KEY ausente";
    return {
      status: "simulado",
      ...base,
      erro_legivel: null,
      resposta: { ...cabeca, simulado: porque, texto: e.texto },
    };
  }
  try {
    const r = await ctx.enviar(e);
    if (r.status >= 200 && r.status < 300)
      return {
        status: "enviado",
        ...base,
        erro_legivel: null,
        resposta: { ...cabeca, http: r.status },
      };
    const fala = String(r.texto ?? "").slice(0, 200);
    if (r.status === 429 || r.status >= 500) {
      const t = Number(n?.tentativas ?? 1);
      if (t >= MAX_TENTATIVAS_EMAIL)
        return {
          status: "erro",
          ...base,
          erro_legivel: `O SendGrid não aceitou o e-mail em ${t} tentativas (HTTP ${r.status}).`,
          resposta: { ...cabeca, http: r.status, fala },
        };
      return {
        status: "pendente",
        ...base,
        erro_legivel: `O SendGrid não respondeu agora (HTTP ${r.status}); a notificação volta sozinha.`,
        resposta: { ...cabeca, http: r.status, fala },
      };
    }
    return {
      status: "erro",
      ...base,
      erro_legivel: `O SendGrid recusou o e-mail (HTTP ${r.status}).`,
      resposta: { ...cabeca, http: r.status, fala },
    };
  } catch (x) {
    return {
      status: "pendente",
      ...base,
      erro_legivel: "O SendGrid não respondeu agora; a notificação volta sozinha.",
      resposta: { ...cabeca, falha: String((x as Error)?.message ?? x).slice(0, 200) },
    };
  }
}

export type DependenciasNotificacoes = {
  reservar: (limite: number) => Promise<any[]>;
  responder: (id: string, r: ResultadoNotificacao) => Promise<any>;
  ligado: boolean;
  enviar: EnviarEmail | null;
  relogio?: () => number;
  orcamentoMs: number;
  maxEnvios?: number;
};

/** Uma rodada da fila de notificações. Cada id é processado uma vez por rodada, mesmo que a reserva o repita. */
export async function rodarFilaNotificacoes(d: DependenciasNotificacoes) {
  const relogio = d.relogio ?? (() => Date.now());
  const inicio = relogio();
  const max = d.maxEnvios ?? 30;
  const vistos = new Set<string>();
  const resumo = {
    versao: VERSAO_NOTIFICACOES,
    ligado: d.ligado,
    reservados: 0,
    por_status: {} as Record<string, number>,
    erros_banco: [] as Array<Record<string, any>>,
  };
  while (resumo.reservados < max && relogio() - inicio < d.orcamentoMs) {
    const lista = await d.reservar(Math.min(10, max - resumo.reservados));
    if (!Array.isArray(lista) || !lista.length) break;
    resumo.reservados += lista.length;
    for (const n of lista) {
      const id = String(n?.id ?? "");
      if (!id || vistos.has(id)) continue;
      vistos.add(id);
      const r =
        relogio() - inicio >= d.orcamentoMs
          ? {
              status: "pendente" as const,
              email: null,
              assunto: null,
              corpo: null,
              erro_legivel: null,
              resposta: { liberado: "fim do tempo da rodada" },
            }
          : await processarNotificacao(n, { ligado: d.ligado, enviar: d.enviar });
      try {
        await d.responder(id, r);
      } catch (e) {
        resumo.erros_banco.push({
          notificacao: id,
          erro: String((e as Error)?.message ?? e).slice(0, 300),
        });
      }
      resumo.por_status[r.status] = (resumo.por_status[r.status] ?? 0) + 1;
    }
  }
  return resumo;
}
