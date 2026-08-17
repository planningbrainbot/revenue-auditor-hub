// Webhook do Pipefy: ao um card do pipe Central de Contratos (307285170)
// entrar na fase "Contrato Assinado" (343967222), cria automaticamente o
// card correspondente no pipe [PTRS-CLI-01] Onboarding Cliente (307173656,
// EXPANSÃO — este pipe nunca cria card no Onboarding Matriz/305834263, fora
// de escopo por decisão do usuário) e liga os dois conectores
// (card_de_contrato / card_de_onboarding).
//
// Duas guardas antes de criar qualquer coisa:
//   1. Campo "Precisa de novo Onboarding?" (precisa_de_novo_onboarding, fase
//      Confecção do Contrato) tem que ser "Sim" — renovação/aditivo de
//      cliente já existente marca "Não" e não gera card novo.
//   2. contratos.tipo_unidade (Supabase, resolvido via pipedrive_deal_id) tem
//      que ser 'franquia' — contratos de matriz/vendas não entram aqui, o
//      pipe de Contratos processa o grupo todo mas o Onboarding automático é
//      só pra expansão (decisão do usuário, 17/08/2026).
//
// Idempotência: se o card de Contratos já tem card_de_onboarding preenchido,
// não faz nada (protege contra reentrega de webhook do Pipefy).
//
// Ver PLANO-CONTRATOS-PIPEFY.md (AI Projects) pro desenho completo e o
// histórico da migração de campos que precedeu esta automação.

const CONTRATOS_PIPE_ID = "307285170";
const ONBOARDING_EXPANSAO_PIPE_ID = "307173656";
const ONBOARDING_NOVA_VENDA_PHASE_ID = "343257591";
const FASE_CONTRATO_ASSINADO_ID = "343967222";

// Campos do card de Contratos
const F_PRECISA_ONBOARDING = "precisa_de_novo_onboarding";
const F_CARD_DE_ONBOARDING = "card_de_onboarding"; // connector -> Onboarding
const F_DEAL_ID_A = "id_neg_cio_pipedrive";
const F_DEAL_ID_B = "deal_id_1"; // fallback, ver achado 17/08 sobre campos "ocultos"
const F_CLIENTE = "cliente";
const F_NOME_FANTASIA = "nome_fantasia_1";
const F_UNIDADE_A = "unidade";
const F_UNIDADE_B = "unidade_2";
const F_HONORARIO = "honor_rio_mensal";
const F_ERP = "erp_atual_do_cliente";
const F_REGIME = "regime_tribut_rio_1";
const F_SEGMENTO = "segmento";
const F_EMAIL = "e_mail_1";
const F_TELEFONE = "n_mero_de_telefone_1";
const F_NOME_CONTATO = "nome_do_contato_1"; // achado 17/08 — nem sempre presente

// Campos do card novo de Onboarding (fase Nova venda)
const OF_ORG_ID = "id_organiza_o_pipedrive";
const OF_HONORARIO = "honor_rio_mensal";
const OF_UNIDADE = "unidade_1"; // formato "Planning <Cidade>"
const OF_ERP = "erp";
const OF_REGIME = "regime_tribut_rio";
const OF_SEGMENTO = "segmento_cnae_principal";
const OF_CONTATO_NOME = "contato_principal_nome";
const OF_CONTATO_EMAIL = "e_mail_do_contato";
const OF_CONTATO_TELEFONE = "telefone_do_contato";
const OF_CARD_DE_CONTRATO = "card_de_contrato"; // connector -> Contratos

async function pipefyGraphql(token: string, query: string, variables?: Record<string, unknown>) {
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json();
  if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

// deno-lint-ignore no-explicit-any
function fieldMap(card: any): Map<string, string> {
  // deno-lint-ignore no-explicit-any
  return new Map(card.fields.map((f: any) => [f.field.id, f.value]));
}

function clean(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  if (t === "" || t === "undefined") return null;
  return t;
}

async function logResultado(
  supabaseUrl: string,
  serviceKey: string,
  detalhes: Record<string, unknown>,
  status: string,
) {
  await fetch(`${supabaseUrl}/rest/v1/sync_log`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      fonte: "pipefy_contrato_onboarding_link",
      executado_em: new Date().toISOString(),
      duracao_segundos: 0,
      total_registros: detalhes.criado ? 1 : 0,
      detalhes,
      status,
    }),
  }).catch(() => {}); // log nunca deve derrubar a resposta do webhook
}

Deno.serve(async (req: Request) => {
  // Autenticação: Pipefy manda o header configurado em `headers` na criação
  // do webhook (ver seção de registro no PLANO-CONTRATOS-PIPEFY.md) — não é
  // o service role key do Supabase, é um segredo próprio deste webhook.
  const webhookSecret = Deno.env.get("PIPEFY_WEBHOOK_SECRET")!;
  const gotSecret = req.headers.get("x-webhook-secret");
  if (gotSecret !== webhookSecret) {
    return new Response("Unauthorized", { status: 401 });
  }

  const pipefyToken = Deno.env.get("PIPEFY_TOKEN")!;
  const pipedriveToken = Deno.env.get("PIPEDRIVE_TOKEN")!;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // O payload exato do webhook do Pipefy varia por tipo de evento — extrai o
  // card_id de forma defensiva e trata o payload só como "algo mudou nesse
  // card", revalidando tudo via GraphQL (fonte de verdade) em vez de confiar
  // em valores do corpo do webhook.
  // deno-lint-ignore no-explicit-any
  const data = (payload as any)?.data ?? payload;
  const cardId = String(data?.card?.id ?? data?.id ?? "");
  if (!cardId) {
    await logResultado(supabaseUrl, serviceKey, { erro: "sem card_id no payload", payload }, "erro");
    return new Response("Sem card_id", { status: 400 });
  }

  try {
    const cardQuery = `{ card(id: "${cardId}") { id title current_phase { id name } pipe { id } fields { field { id label } value } } }`;
    const { card } = await pipefyGraphql(pipefyToken, cardQuery);

    if (String(card.pipe.id) !== CONTRATOS_PIPE_ID) {
      await logResultado(supabaseUrl, serviceKey, { cardId, motivo: "não é do pipe de Contratos" }, "ignorado");
      return new Response("Fora de escopo", { status: 200 });
    }

    if (String(card.current_phase.id) !== FASE_CONTRATO_ASSINADO_ID) {
      await logResultado(supabaseUrl, serviceKey, { cardId, fase: card.current_phase.name, motivo: "não está em Contrato Assinado" }, "ignorado");
      return new Response("Fora de escopo", { status: 200 });
    }

    const fm = fieldMap(card);

    // Idempotência — se já tem card de Onboarding linkado, não repete.
    if (clean(fm.get(F_CARD_DE_ONBOARDING))) {
      await logResultado(supabaseUrl, serviceKey, { cardId, motivo: "já linkado" }, "ignorado");
      return new Response("Já linkado", { status: 200 });
    }

    // Guarda 1 — precisa de onboarding?
    const precisaOnboarding = clean(fm.get(F_PRECISA_ONBOARDING));
    if (precisaOnboarding !== "Sim") {
      await logResultado(supabaseUrl, serviceKey, { cardId, precisaOnboarding, motivo: "campo 'Precisa de novo Onboarding?' não é Sim" }, "ignorado");
      return new Response("Não precisa de onboarding", { status: 200 });
    }

    // Guarda 2 — é expansão? (via contratos.tipo_unidade no Supabase, fonte
    // reconciliada — não confiar só no campo texto "Unidade" do card)
    const dealId = clean(fm.get(F_DEAL_ID_A)) ?? clean(fm.get(F_DEAL_ID_B));
    if (!dealId) {
      await logResultado(supabaseUrl, serviceKey, { cardId, motivo: "sem deal_id, não dá pra classificar" }, "erro");
      return new Response("Sem deal_id", { status: 200 });
    }

    const contratoResp = await fetch(
      `${supabaseUrl}/rest/v1/contratos?pipedrive_deal_id=eq.${dealId}&select=tipo_unidade&limit=1`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    );
    const contratoRows: { tipo_unidade: string | null }[] = await contratoResp.json();
    const tipoUnidade = contratoRows[0]?.tipo_unidade ?? null;
    if (tipoUnidade !== "franquia") {
      await logResultado(supabaseUrl, serviceKey, { cardId, dealId, tipoUnidade, motivo: "não é franquia/expansão" }, "ignorado");
      return new Response("Fora do escopo de expansão", { status: 200 });
    }

    // Org ID via Pipedrive (não existe direto no card de Contratos antes da
    // fase Vigente) — necessário pro campo "ID Organização (Pipedrive)" do
    // Onboarding, que é como o resto do fluxo casa os dois lados.
    const dealResp = await fetch(`https://api.pipedrive.com/v1/deals/${dealId}?api_token=${pipedriveToken}`);
    const dealBody = await dealResp.json();
    const orgId = dealBody?.data?.org_id?.value ? String(dealBody.data.org_id.value) : null;
    if (!orgId) {
      await logResultado(supabaseUrl, serviceKey, { cardId, dealId, motivo: "sem org_id no Pipedrive" }, "erro");
      return new Response("Sem org_id", { status: 200 });
    }

    const clienteNome = clean(fm.get(F_CLIENTE)) ?? clean(fm.get(F_NOME_FANTASIA)) ?? card.title;
    const cidade = clean(fm.get(F_UNIDADE_A)) ?? clean(fm.get(F_UNIDADE_B));
    const unidadeOnboarding = cidade ? `Planning ${cidade}` : null;

    // deno-lint-ignore no-explicit-any
    const fieldsAttrs: any[] = [{ field_id: OF_ORG_ID, field_value: [orgId] }];
    const push = (fieldId: string, value: string | null) => {
      if (value) fieldsAttrs.push({ field_id: fieldId, field_value: [value] });
    };
    push(OF_HONORARIO, clean(fm.get(F_HONORARIO))?.replace(/,/g, "") ?? null);
    push(OF_UNIDADE, unidadeOnboarding);
    push(OF_ERP, clean(fm.get(F_ERP)));
    push(OF_REGIME, clean(fm.get(F_REGIME)));
    push(OF_SEGMENTO, clean(fm.get(F_SEGMENTO)));
    push(OF_CONTATO_NOME, clean(fm.get(F_NOME_CONTATO)));
    push(OF_CONTATO_EMAIL, clean(fm.get(F_EMAIL)));
    push(OF_CONTATO_TELEFONE, clean(fm.get(F_TELEFONE)));
    fieldsAttrs.push({ field_id: OF_CARD_DE_CONTRATO, field_value: [cardId] });

    const createMutation = `
      mutation($input: CreateCardInput!) {
        createCard(input: $input) { card { id } }
      }
    `;
    const createData = await pipefyGraphql(pipefyToken, createMutation, {
      input: {
        pipe_id: ONBOARDING_EXPANSAO_PIPE_ID,
        phase_id: ONBOARDING_NOVA_VENDA_PHASE_ID,
        title: clienteNome,
        fields_attributes: fieldsAttrs,
      },
    });
    const newCardId = createData.createCard.card.id;

    // Fecha o vínculo do outro lado.
    const linkMutation = `
      mutation {
        updateCardField(input: { card_id: "${cardId}", field_id: "${F_CARD_DE_ONBOARDING}", new_value: ${JSON.stringify([newCardId])} }) {
          card { id }
        }
      }
    `;
    await pipefyGraphql(pipefyToken, linkMutation);

    await logResultado(supabaseUrl, serviceKey, { cardId, dealId, orgId, newCardId, cliente: clienteNome, criado: true }, "sucesso");
    return new Response(JSON.stringify({ criado: true, onboardingCardId: newCardId }), { status: 200 });
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    await logResultado(supabaseUrl, serviceKey, { cardId, erro: errorMsg }, "erro");
    return new Response(JSON.stringify({ error: errorMsg }), { status: 500 });
  }
});
