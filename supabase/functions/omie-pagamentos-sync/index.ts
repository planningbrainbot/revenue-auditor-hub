// omie-pagamentos-sync
//
// Traz quem recebe pagamento da Planning, a prova de fornecedor pelo dinheiro (pedido do Pedro em 01/10/2026: "garanta
// que quem não é admin não tenha acesso a fornecedor"). A tag do Omie é declaração e erra: Curitiba quase não usa, e a
// Matriz marca Cliente em quem ela paga (Facebook, Telefônica, TAM). Duas fontes:
//
// 1. Contas a pagar do Omie de cada unidade com credencial ativa (financas/contapagar · ListarContasPagar), gravadas
//    título a título em ops.base_omie_pagamentos. O fornecedor é o cadastro (codigo_cliente_fornecedor), que liga em
//    ops.base_omie_tags pela unidade. Uma unidade por execução, com retomada pela página: a leitura mais longa medida
//    em 01/10 (Rio de Janeiro, 46 páginas) levou 84 s, perto do limite de 150 s da Edge Function.
// 2. Contas a pagar das empresas do grupo no Financial Brain (public.titulos_pagar_live, só os títulos em aberto),
//    acumuladas por CNPJ em ops.base_pagamentos_grupo: o título pago sai da tabela de lá, o CNPJ fica aqui. Lida no
//    máximo uma vez por hora. Sem as variáveis FINANCEIRO_*, a etapa é pulada e a resposta diz por quê.
//
// A regra (quem é fornecedor) mora no banco: ops.base_conta_prova. Aqui só se grava o que as fontes devolvem.

type Row = Record<string, any>;

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");
const FIN_URL = Deno.env.get("FINANCEIRO_SUPABASE_URL");
const FIN_KEY = Deno.env.get("FINANCEIRO_SERVICE_ROLE_KEY");

const POR_PAGINA = 500;
// Janela: três anos para trás e dois para a frente, pela data de vencimento.
const ANOS_ATRAS = 3;
const ANOS_FRENTE = 2;
// Orçamento de tempo de uma execução: para antes do limite de 150 s e retoma na próxima.
const ORCAMENTO_MS = 110_000;
const FINANCEIRO = "Financial Brain";
const FINANCEIRO_A_CADA_MS = 60 * 60 * 1000;

const resposta = (body: Row, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function db(path: string, body?: unknown, method = "POST", merge = false) {
  const escrita = body !== undefined || method === "DELETE" || method === "PATCH";
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    "Accept-Profile": "ops",
    "Content-Profile": "ops",
  };
  if (escrita) headers.Prefer = `return=minimal${merge ? ",resolution=merge-duplicates" : ""}`;
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: escrita ? method : "GET",
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Banco recusou operação (${r.status}): ${await r.text()}`);
  if (escrita || r.status === 204) return null;
  return await r.json();
}

const dataBr = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
const isoDeBr = (v: unknown) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(v ?? ""));
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listarContasPagar(cred: { app_key: string; app_secret: string }, pagina: number) {
  const hoje = new Date();
  const de = new Date(Date.UTC(hoje.getUTCFullYear() - ANOS_ATRAS, hoje.getUTCMonth(), 1));
  const ate = new Date(Date.UTC(hoje.getUTCFullYear() + ANOS_FRENTE, 11, 31));
  for (let tentativa = 1; ; tentativa++) {
    try {
      const r = await fetch("https://app.omie.com.br/api/v1/financas/contapagar/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          call: "ListarContasPagar",
          app_key: cred.app_key,
          app_secret: cred.app_secret,
          param: [{
            pagina,
            registros_por_pagina: POR_PAGINA,
            apenas_importado_api: "N",
            filtrar_por_data_de: dataBr(de),
            filtrar_por_data_ate: dataBr(ate),
          }],
        }),
        signal: AbortSignal.timeout(60000),
      });
      const b = await r.json().catch(() => ({}));
      // Unidade sem conta a pagar é resposta legítima, não erro.
      if (b.faultstring && /não existem|nao existem/i.test(String(b.faultstring))) {
        return { conta_pagar_cadastro: [], total_de_paginas: 0 };
      }
      if (!r.ok || b.faultcode) throw new Error(`Omie recusou consulta: ${b.faultstring ?? r.status}`);
      return b;
    } catch (e) {
      // Conexão derrubada pelo Omie acontece no meio de leituras longas (medido em 01/10): tenta de novo.
      if (tentativa >= 3 || /recusou consulta/.test((e as Error).message)) throw e;
      await pausa(3000 * tentativa);
    }
  }
}

/** Lê a unidade a partir da página registrada. Devolve se terminou a passada. */
async function sincronizarUnidade(
  unidade: string,
  cred: { app_key: string; app_secret: string },
  leitura: Row | undefined,
  inicioExecucao: number,
) {
  // Passada em curso: a execução anterior parou no orçamento de tempo e gravou a próxima página.
  const retoma = !!(leitura?.inicio_em && leitura?.proxima_pagina);
  const inicio: string = retoma ? leitura!.inicio_em : new Date().toISOString();
  let pagina: number = retoma ? Number(leitura!.proxima_pagina) : 1;
  let total = pagina;
  let titulos = retoma ? Number(leitura!.titulos ?? 0) : 0;
  const registro = "base_omie_pagamentos_leituras?on_conflict=unidade";
  while (pagina <= total) {
    if (Date.now() - inicioExecucao > ORCAMENTO_MS) {
      await db(registro, [{ unidade, inicio_em: inicio, proxima_pagina: pagina, titulos, erro: null }], "POST", true);
      return { terminou: false, titulos, pagina };
    }
    const page = await listarContasPagar(cred, pagina);
    const lista: Row[] = Array.isArray(page.conta_pagar_cadastro) ? page.conta_pagar_cadastro : [];
    total = Number.isInteger(page.total_de_paginas) ? page.total_de_paginas : 0;
    const linhas = lista
      .filter((t) => t.codigo_lancamento_omie && t.codigo_cliente_fornecedor)
      .map((t) => ({
        unidade,
        codigo_lancamento: Number(t.codigo_lancamento_omie),
        codigo_omie: Number(t.codigo_cliente_fornecedor),
        valor: Number(t.valor_documento ?? 0),
        vencimento: isoDeBr(t.data_vencimento),
        status: t.status_titulo ? String(t.status_titulo) : null,
        sincronizado_em: inicio,
      }));
    if (linhas.length) {
      await db("base_omie_pagamentos?on_conflict=unidade,codigo_lancamento", linhas, "POST", true);
      titulos += linhas.length;
    }
    pagina += 1;
    await pausa(300);
  }
  // Só depois de ler todas as páginas da passada: o título que não veio saiu do Omie da unidade (ou da janela).
  await db(
    `base_omie_pagamentos?unidade=eq.${encodeURIComponent(unidade)}&sincronizado_em=lt.${encodeURIComponent(inicio)}`,
    undefined,
    "DELETE",
  );
  await db(
    registro,
    [{ unidade, inicio_em: null, proxima_pagina: null, concluida_em: new Date().toISOString(), titulos, erro: null }],
    "POST",
    true,
  );
  return { terminou: true, titulos, pagina: pagina - 1 };
}

async function fin(path: string) {
  const r = await fetch(`${FIN_URL}/rest/v1/${path}`, {
    headers: { apikey: FIN_KEY!, Authorization: `Bearer ${FIN_KEY}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Financial Brain recusou leitura (${r.status}): ${await r.text()}`);
  return (await r.json()) as Row[];
}

/** Contas a pagar das empresas do grupo, acumuladas por CNPJ. */
async function sincronizarFinanceiro() {
  const empresas = new Map((await fin("empresas?select=id,apelido")).map((e) => [e.id, e.apelido]));
  const porCnpj = new Map<string, { nome: string; empresas: Set<string>; titulos: number }>();
  for (let de = 0; ; de += 1000) {
    const lote = await fin(
      `titulos_pagar_live?select=empresa_id,fornecedor_cnpj,fornecedor_nome&order=id&offset=${de}&limit=1000`,
    );
    for (const t of lote) {
      const cnpj = digitos(t.fornecedor_cnpj);
      if (cnpj.length !== 14) continue;
      const atual = porCnpj.get(cnpj) ?? { nome: String(t.fornecedor_nome ?? ""), empresas: new Set(), titulos: 0 };
      atual.empresas.add(String(empresas.get(t.empresa_id) ?? t.empresa_id));
      atual.titulos += 1;
      porCnpj.set(cnpj, atual);
    }
    if (lote.length < 1000) break;
  }
  const agora = new Date().toISOString();
  const linhas = [...porCnpj].map(([cnpj, v]) => ({
    cnpj,
    nome: v.nome || null,
    empresas: [...v.empresas].sort(),
    titulos_abertos: v.titulos,
    visto_em: agora,
  }));
  for (let i = 0; i < linhas.length; i += 500) {
    await db("base_pagamentos_grupo?on_conflict=cnpj", linhas.slice(i, i + 500), "POST", true);
  }
  await db(
    "base_omie_pagamentos_leituras?on_conflict=unidade",
    [{ unidade: FINANCEIRO, concluida_em: agora, titulos: linhas.length, erro: null }],
    "POST",
    true,
  );
  return linhas.length;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);
  const autorizado = req.headers.get("authorization") === `Bearer ${SERVICE}` ||
    (!!CRON && req.headers.get("x-planning-sinais-cron") === CRON);
  if (!autorizado) return resposta({ error: "Não autorizado" }, 401);
  const inicioExecucao = Date.now();

  let corpo: Row = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio é chamada de cron */ }

  try {
    const leituras = (await db("base_omie_pagamentos_leituras?select=*")) as Row[];
    const leituraDe = new Map(leituras.map((l) => [l.unidade, l]));
    const feitas: Row[] = [];

    // Financial Brain primeiro (rápido): no máximo uma vez por hora, ou quando pedido.
    const fl = leituraDe.get(FINANCEIRO);
    const devido = !fl?.concluida_em || Date.now() - Date.parse(fl.concluida_em) > FINANCEIRO_A_CADA_MS;
    if ((corpo.financeiro || (devido && !corpo.unidade)) && corpo.financeiro !== false) {
      if (!FIN_URL || !FIN_KEY) {
        feitas.push({ unidade: FINANCEIRO, erro: "FINANCEIRO_SUPABASE_URL ou FINANCEIRO_SERVICE_ROLE_KEY ausente" });
      } else {
        try {
          feitas.push({ unidade: FINANCEIRO, cnpjs: await sincronizarFinanceiro() });
        } catch (e) {
          const erro = (e as Error).message;
          await db("base_omie_pagamentos_leituras?on_conflict=unidade", [{ unidade: FINANCEIRO, erro }], "POST", true)
            .catch(() => {});
          feitas.push({ unidade: FINANCEIRO, erro });
        }
      }
    }
    if (corpo.financeiro && !corpo.unidade) return resposta({ status: "completo", feitas });

    const credenciais = (await db("omie_credentials?ativo=eq.true&select=unidade,app_key,app_secret")) as Row[];
    // Fila pela TENTATIVA, como a omie-tags-sync: a passada em curso vai primeiro (para terminar), depois a nunca
    // tentada, depois a tentada há mais tempo. A tentativa é gravada antes de ler, para uma unidade que sempre falha
    // (Sorocaba, sem o addon da API) não prender a fila.
    const ordem = (c: Row) => {
      const l = leituraDe.get(c.unidade);
      return `${l?.proxima_pagina ? "0" : "1"}${String(l?.tentativa_em ?? "")}`;
    };
    const alvo = corpo.unidade
      ? credenciais.filter((c) => c.unidade === corpo.unidade)
      : [...credenciais].sort((a, b) => ordem(a).localeCompare(ordem(b))).slice(0, 1);

    for (const cred of alvo) {
      const registro = "base_omie_pagamentos_leituras?on_conflict=unidade";
      await db(registro, [{ unidade: cred.unidade, tentativa_em: new Date().toISOString() }], "POST", true);
      try {
        const r = await sincronizarUnidade(
          cred.unidade,
          { app_key: cred.app_key, app_secret: cred.app_secret },
          leituraDe.get(cred.unidade),
          inicioExecucao,
        );
        feitas.push({ unidade: cred.unidade, ...r });
      } catch (e) {
        // Credencial vencida ou addon desligado numa unidade não impede as outras. A passada em curso recomeça.
        const erro = (e as Error).message;
        await db(registro, [{ unidade: cred.unidade, erro, inicio_em: null, proxima_pagina: null }], "POST", true)
          .catch(() => {});
        feitas.push({ unidade: cred.unidade, erro });
      }
    }
    return resposta({ status: "completo", feitas });
  } catch (e) {
    return resposta({ error: (e as Error).message }, 500);
  }
});
