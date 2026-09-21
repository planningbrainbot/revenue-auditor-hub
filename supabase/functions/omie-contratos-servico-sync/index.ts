// omie-contratos-servico-sync
//
// Traz os contratos de serviço do Omie (servicos/contrato · ListarContratos)
// de todas as unidades com credencial ativa para ops.omie_contratos_servico.
//
// Por que existe: decisão do usuário em 21/09/2026 sobre a ordem do MRR —
// "tem no Omie usa do Omie, não tem puxa do Pipefy, não tem puxa do
// Pipedrive". O Omie é o único dos três que conhece o cliente de base antiga,
// aquele que as unidades integraram e que nunca teve deal no Pipedrive. Ele é
// a maioria da lista em /clientes e aparecia zerado.
//
// O valor é `cabecalho.nValTotMes`, o que o contrato fatura por mês. O CNPJ
// não vem no contrato: só o `nCodCli`, resolvido em lote por ListarClientes
// (mesmo caminho que `base-clientes-sync` já usa para a vigência).
//
// Não confundir com `base_omie_contratos`, que é da classificação de origem
// da base (só Curitiba, só vigência inicial, fechada a service_role).
//
// Retomada: cada execução atende as unidades menos recentemente sincronizadas
// primeiro e para quando acaba o orçamento de tempo. Rodar de novo termina o
// resto, sem precisar de tabela de fila.

type Row = Record<string, any>;

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("OMIE_CONTRATOS_CRON_SECRET");

// A função roda em wall clock limitado. 110s deixa folga para o upsert final
// da última unidade antes do corte.
const ORCAMENTO_MS = 110_000;
const POR_PAGINA = 50;

const resposta = (body: Row, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function db(path: string, body?: unknown, method = "POST", merge = false) {
  const escrita = body !== undefined;
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    "Accept-Profile": "ops",
    "Content-Profile": "ops",
  };
  // `Prefer` só na escrita: em GET o return=minimal devolveria corpo vazio e a
  // leitura viraria lista vazia sem erro nenhum.
  if (escrita) headers.Prefer = `return=minimal${merge ? ",resolution=merge-duplicates" : ""}`;
  const r = await fetch(`${URL}/rest/v1/${path}`, {
    method: escrita ? method : "GET",
    headers,
    body: escrita ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Banco recusou operação (${r.status}): ${await r.text()}`);
  if (escrita || r.status === 204) return null;
  return await r.json();
}

async function omie(
  endpoint: string,
  call: string,
  cred: { app_key: string; app_secret: string },
  param: Row,
) {
  const r = await fetch(`https://app.omie.com.br/api/v1/${endpoint}/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ call, app_key: cred.app_key, app_secret: cred.app_secret, param: [param] }),
    signal: AbortSignal.timeout(40000),
  });
  if (!r.ok) throw new Error(`Omie indisponível (${r.status})`);
  const b = await r.json();
  // "Não existem registros" é resposta legítima de unidade sem contrato
  // cadastrado, não erro: devolve vazio em vez de derrubar a unidade inteira.
  if (b.faultstring && /não existem|nao existem/i.test(String(b.faultstring))) {
    return { contratoCadastro: [], clientes_cadastro: [], total_de_paginas: 0 };
  }
  if (b.faultcode) throw new Error(`Omie recusou consulta: ${b.faultstring ?? b.faultcode}`);
  return b;
}

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

// dd/mm/aaaa é o formato do Omie. Data vazia ou impossível vira null em vez de
// derrubar o lote inteiro com 22008.
function data(raw: unknown): string | null {
  const m = String(raw ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function numero(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function sincronizarUnidade(
  unidade: string,
  cred: { app_key: string; app_secret: string },
  at: string,
) {
  let pagina = 1;
  let total = 1;
  let gravados = 0;
  while (pagina <= total) {
    const page = await omie("servicos/contrato", "ListarContratos", cred, {
      pagina,
      registros_por_pagina: POR_PAGINA,
      apenas_importado_api: "N",
    });
    const contratos: Row[] = Array.isArray(page.contratoCadastro) ? page.contratoCadastro : [];
    total = Number.isInteger(page.total_de_paginas) ? page.total_de_paginas : 0;
    if (!contratos.length) break;

    // O contrato só carrega o código do cliente. Uma chamada por página
    // resolve todos os CNPJs dela.
    const ids = [...new Set(contratos.map((c) => c.cabecalho?.nCodCli).filter(Boolean))];
    const clientes = ids.length
      ? await omie("geral/clientes", "ListarClientes", cred, {
        pagina: 1,
        registros_por_pagina: POR_PAGINA,
        apenas_importado_api: "N",
        clientesPorCodigo: ids.map((id) => ({ codigo_cliente_omie: id })),
      })
      : { clientes_cadastro: [] };
    const cnpjPorCliente = new Map<string, string>();
    for (const c of clientes.clientes_cadastro ?? []) {
      const doc = digitos(c.cnpj_cpf);
      if (doc) cnpjPorCliente.set(String(c.codigo_cliente_omie), doc);
    }

    const linhas = contratos.map((c) => {
      const cab = c.cabecalho ?? {};
      return {
        unidade,
        contrato_id: String(cab.nCodCtr ?? ""),
        cliente_id: cab.nCodCli != null ? String(cab.nCodCli) : null,
        cnpj: cnpjPorCliente.get(String(cab.nCodCli)) ?? null,
        numero: cab.cNumCtr ?? null,
        situacao: cab.cCodSit ?? null,
        valor_mensal: numero(cab.nValTotMes),
        vigencia_inicial: data(cab.dVigInicial),
        vigencia_final: data(cab.dVigFinal),
        categoria: c.infAdic?.cCodCateg ?? null,
        sincronizado_em: at,
      };
    }).filter((l) => l.contrato_id);

    if (linhas.length) {
      await db("omie_contratos_servico?on_conflict=unidade,contrato_id", linhas, "POST", true);
      gravados += linhas.length;
    }
    pagina += 1;
  }
  return gravados;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);
  const autorizado = req.headers.get("authorization") === `Bearer ${SERVICE}` ||
    (!!CRON && req.headers.get("x-planning-omie-cron") === CRON);
  if (!autorizado) return resposta({ error: "Não autorizado" }, 401);

  const inicio = Date.now();
  const at = new Date().toISOString();
  let corpo: Row = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio é chamada de cron */ }

  try {
    const credenciais: Row[] = await db(
      "omie_credentials?ativo=eq.true&select=unidade,app_key,app_secret",
    ) as Row[];
    // Unidade nunca sincronizada primeiro, depois a mais antiga. É o que faz a
    // execução seguinte continuar de onde a anterior parou por tempo. Se a
    // agregação não estiver disponível, a ordem da credencial serve: o upsert
    // é idempotente e a pior consequência é repetir uma unidade já feita.
    let ultima = new Map<string, string>();
    try {
      const marcas: Row[] = await db(
        "omie_contratos_servico?select=unidade,sincronizado_em.max()",
      ) as Row[];
      ultima = new Map(marcas.map((m) => [m.unidade, m.max]));
    } catch { /* ordem da credencial */ }
    const alvo = corpo.unidade
      ? credenciais.filter((c) => c.unidade === corpo.unidade)
      : [...credenciais].sort((a, b) =>
        String(ultima.get(a.unidade) ?? "").localeCompare(String(ultima.get(b.unidade) ?? ""))
      );

    const feitas: Row[] = [];
    let restantes = 0;
    for (const cred of alvo) {
      if (Date.now() - inicio > ORCAMENTO_MS) {
        restantes += 1;
        continue;
      }
      try {
        const gravados = await sincronizarUnidade(
          cred.unidade,
          { app_key: cred.app_key, app_secret: cred.app_secret },
          at,
        );
        feitas.push({ unidade: cred.unidade, contratos: gravados });
      } catch (e) {
        // Uma unidade com credencial vencida não pode impedir as outras.
        feitas.push({ unidade: cred.unidade, erro: (e as Error).message });
      }
    }

    const resultado = {
      status: restantes ? "parcial" : "completo",
      unidades: feitas,
      pendentes: restantes,
      segundos: Math.round((Date.now() - inicio) / 1000),
    };
    await db("sync_log", {
      fonte: "omie_contratos_servico",
      status: feitas.some((f) => f.erro) ? "parcial" : "sucesso",
      detalhes: resultado,
    });
    return resposta(resultado);
  } catch (e) {
    await db("sync_log", {
      fonte: "omie_contratos_servico",
      status: "erro",
      detalhes: { erro: (e as Error).message },
    });
    return resposta({ error: (e as Error).message }, 500);
  }
});
