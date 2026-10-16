// gente-vigencia-alertas
//
// E-mail diário ao RH da unidade com os contratos de estágio (TCE) e de terceiro que
// vencem em 30 dias, em 15 dias ou já venceram (pedido do RH de Maceió, 13/10/2026).
// Quem entra e para quem vai é decidido no banco, por ops.gente_vigencias_a_avisar();
// esta função só agrupa por destinatário, manda pelo SendGrid e registra o que saiu
// em ops.gente_vigencia_avisos, para não repetir.
//
// Agendada no n8n (wrapper fino, como as outras rotinas). Corpo opcional:
// {"simular": true} devolve o que sairia, sem mandar nem registrar nada.

type Row = Record<string, any>;

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("GENTE_VIGENCIA_CRON_SECRET");
const SENDGRID = Deno.env.get("SENDGRID_API_KEY");
const APP = "https://planningbrain.com.br";

const resposta = (body: Row, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function rpc(nome: string, corpo: Row = {}) {
  const r = await fetch(`${URL}/rest/v1/rpc/${nome}`, {
    method: "POST",
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      "Content-Profile": "ops",
      "Accept-Profile": "ops",
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Banco recusou ${nome} (${r.status}): ${await r.text()}`);
  return await r.json();
}

const fmt = (d: string) => d.split("-").reverse().join("/");
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

function situacao(a: Row): string {
  if (a.dias < 0)
    return `venceu em ${fmt(a.vigencia_fim)}, há ${-a.dias} dia${a.dias === -1 ? "" : "s"}`;
  if (a.dias === 0) return `vence hoje (${fmt(a.vigencia_fim)})`;
  return `vence em ${a.dias} dia${a.dias === 1 ? "" : "s"} (${fmt(a.vigencia_fim)})`;
}

function linha(a: Row): string {
  const tipo = a.tipo_vinculo === "estagio" ? "Estágio (TCE)" : "Terceiro";
  const limite = a.passa_dois_anos
    ? " Atenção: com essa data o estágio passa de 2 anos na mesma empresa (Lei 11.788/2008, art. 11)."
    : "";
  return `${a.nome} · ${a.unidade ?? "sem unidade"} · ${tipo}: ${situacao(a)}.${limite}`;
}

async function enviar(para: string, itens: Row[]): Promise<boolean> {
  const n = itens.length;
  const assunto = `Planning People: ${n} contrato${n === 1 ? "" : "s"} de estágio ou terceiro para renovar`;
  const texto = [
    "Olá,",
    "",
    "Estes contratos vencem em breve ou já venceram. Renove e atualize a data de fim no Editar da pessoa, ou registre o desligamento.",
    "",
    ...itens.map((a) => `- ${linha(a)}`),
    "",
    `Cadastro: ${APP}/gente?tela=cadastro&vigencia=vence30`,
    "",
    "Aviso automático do Planning Brain (30 e 15 dias antes e no dia do vencimento).",
  ].join("\n");
  const html = `<p>Olá,</p><p>Estes contratos vencem em breve ou já venceram. Renove e atualize a data de fim no <b>Editar</b> da pessoa, ou registre o desligamento.</p><ul>${itens
    .map((a) => `<li>${esc(linha(a))}</li>`)
    .join(
      "",
    )}</ul><p><a href="${APP}/gente?tela=cadastro&amp;vigencia=vence30">Abrir o Cadastro</a></p><p style="color:#64748b;font-size:12px">Aviso automático do Planning Brain (30 e 15 dias antes e no dia do vencimento).</p>`;
  const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${SENDGRID}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: para }] }],
      from: { email: "noreply@planningbrain.com.br", name: "Planning Brain" },
      subject: assunto,
      content: [
        { type: "text/plain", value: texto },
        { type: "text/html", value: html },
      ],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok)
    console.error(`[gente-vigencia-alertas] SendGrid ${r.status} para ${para}: ${await r.text()}`);
  return r.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);
  const autorizado =
    req.headers.get("authorization") === `Bearer ${SERVICE}` ||
    (!!CRON && req.headers.get("x-planning-gente-cron") === CRON);
  if (!autorizado) return resposta({ error: "Não autorizado" }, 401);

  let simular = false;
  try {
    simular = (await req.json())?.simular === true;
  } catch {
    /* corpo vazio */
  }

  try {
    const avisos = (await rpc("gente_vigencias_a_avisar")) as Row[];
    const semDestinatario = avisos.filter((a) => !a.destinatarios?.length);
    const porEmail = new Map<string, Row[]>();
    for (const a of avisos) {
      for (const e of a.destinatarios ?? []) porEmail.set(e, [...(porEmail.get(e) ?? []), a]);
    }
    if (simular) {
      return resposta({
        simulado: true,
        avisos: avisos.length,
        emails: Object.fromEntries([...porEmail].map(([e, it]) => [e, it.map(linha)])),
        sem_destinatario: semDestinatario.map(linha),
      });
    }
    if (!SENDGRID) return resposta({ error: "SENDGRID_API_KEY ausente" }, 500);

    // Um aviso conta como dado quando ao menos um destinatário recebeu.
    const saiu = new Set<number>();
    const falhas: string[] = [];
    for (const [email, itens] of porEmail) {
      if (await enviar(email, itens)) itens.forEach((a) => saiu.add(a.pessoa_id));
      else falhas.push(email);
    }
    const registrar = avisos
      .filter((a) => saiu.has(a.pessoa_id))
      .map((a) => ({
        pessoa_id: a.pessoa_id,
        vigencia_fim: a.vigencia_fim,
        marco: a.marco,
        destinatarios: a.destinatarios,
      }));
    const registrados = registrar.length
      ? await rpc("gente_vigencia_registrar_avisos", { _avisos: registrar })
      : 0;
    return resposta(
      {
        avisos: avisos.length,
        emails_enviados: porEmail.size - falhas.length,
        falhas,
        registrados,
        sem_destinatario: semDestinatario.length,
      },
      falhas.length ? 502 : 200,
    );
  } catch (e) {
    console.error("[gente-vigencia-alertas]", e);
    return resposta({ error: e instanceof Error ? e.message : "erro" }, 500);
  }
});
