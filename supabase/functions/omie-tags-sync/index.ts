// omie-tags-sync
//
// Traz as tags do cadastro "Clientes e Fornecedores" do Omie (geral/clientes · ListarClientes) de todas as
// unidades com credencial ativa para ops.base_omie_tags.
//
// Por que existe: pedido do Pedro em 29/09/2026 — "um filtro geral nas tags do omie de todos os clientes pra
// saber o que é cliente e o que é fornecedor". O cadastro do Omie mistura quem a unidade atende com quem ela
// paga, e a Base puxa o cadastro inteiro; a tag (Cliente, Fornecedor, Funcionário...) é o que separa. A regra
// das tags mora no banco (trigger `base_omie_tags_flags`); aqui só se grava o que o Omie devolve.
//
// Uma unidade por execução (a nunca lida primeiro, depois a de leitura mais antiga): a Matriz sozinha tem 12
// páginas de 500 e, na primeira carga de 29/09, várias unidades numa execução passaram do limite de 150 s no
// meio da Matriz. O cron roda a cada 10 minutos; a volta nas 11 credenciais fecha em menos de duas horas.
// Unidade concluída apaga os cadastros que sumiram do Omie dela; a interrompida não apaga nada.

type Row = Record<string, any>;

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON = Deno.env.get("SINAIS_CRON_SECRET");

const POR_PAGINA = 500;

const resposta = (body: Row, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function db(path: string, body?: unknown, method = "POST", merge = false) {
  const escrita = body !== undefined || method === "DELETE";
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

async function listarClientes(cred: { app_key: string; app_secret: string }, pagina: number) {
  const r = await fetch("https://app.omie.com.br/api/v1/geral/clientes/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call: "ListarClientes",
      app_key: cred.app_key,
      app_secret: cred.app_secret,
      param: [{ pagina, registros_por_pagina: POR_PAGINA, apenas_importado_api: "N" }],
    }),
    signal: AbortSignal.timeout(60000),
  });
  const b = await r.json().catch(() => ({}));
  // Cadastro vazio é resposta legítima, não erro.
  if (b.faultstring && /não existem|nao existem/i.test(String(b.faultstring))) {
    return { clientes_cadastro: [], total_de_paginas: 0 };
  }
  if (!r.ok || b.faultcode) throw new Error(`Omie recusou consulta: ${b.faultstring ?? r.status}`);
  return b;
}

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

async function sincronizarUnidade(unidade: string, cred: { app_key: string; app_secret: string }) {
  const at = new Date().toISOString();
  let pagina = 1;
  let total = 1;
  let gravados = 0;
  while (pagina <= total) {
    const page = await listarClientes(cred, pagina);
    const cadastros: Row[] = Array.isArray(page.clientes_cadastro) ? page.clientes_cadastro : [];
    total = Number.isInteger(page.total_de_paginas) ? page.total_de_paginas : 0;
    const linhas = cadastros
      .filter((c) => c.codigo_cliente_omie)
      .map((c) => ({
        unidade,
        codigo_omie: Number(c.codigo_cliente_omie),
        cnpj: digitos(c.cnpj_cpf) || null,
        tags: [
          ...new Set(
            (Array.isArray(c.tags) ? c.tags : [])
              .map((t: Row) => String(t?.tag ?? "").trim())
              .filter(Boolean),
          ),
        ],
        inativo: c.inativo === "S",
        sincronizado_em: at,
      }));
    if (linhas.length) {
      await db("base_omie_tags?on_conflict=unidade,codigo_omie", linhas, "POST", true);
      gravados += linhas.length;
    }
    pagina += 1;
  }
  // Só depois de ler todas as páginas: o que não veio saiu do Omie da unidade.
  await db(
    `base_omie_tags?unidade=eq.${encodeURIComponent(unidade)}&sincronizado_em=lt.${encodeURIComponent(at)}`,
    undefined,
    "DELETE",
  );
  return gravados;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);
  const autorizado = req.headers.get("authorization") === `Bearer ${SERVICE}` ||
    (!!CRON && req.headers.get("x-planning-sinais-cron") === CRON);
  if (!autorizado) return resposta({ error: "Não autorizado" }, 401);

  let corpo: Row = {};
  try {
    corpo = await req.json();
  } catch { /* corpo vazio é chamada de cron */ }

  try {
    const credenciais = (await db(
      "omie_credentials?ativo=eq.true&select=unidade,app_key,app_secret",
    )) as Row[];
    // A marca da unidade é a leitura mais ANTIGA dela (min): unidade interrompida no meio fica com registros
    // velhos e volta à frente da fila; a que nunca foi lida vem antes de todas.
    let marca = new Map<string, string>();
    try {
      const marcas = (await db("base_omie_tags?select=unidade,sincronizado_em.min()")) as Row[];
      marca = new Map(marcas.map((m) => [m.unidade, m.min]));
    } catch { /* ordem da credencial */ }
    const alvo = corpo.unidade
      ? credenciais.filter((c) => c.unidade === corpo.unidade)
      : [...credenciais]
        .sort((a, b) =>
          String(marca.get(a.unidade) ?? "").localeCompare(String(marca.get(b.unidade) ?? ""))
        )
        .slice(0, 1);

    const feitas: Row[] = [];
    for (const cred of alvo) {
      try {
        const cadastros = await sincronizarUnidade(cred.unidade, {
          app_key: cred.app_key,
          app_secret: cred.app_secret,
        });
        feitas.push({ unidade: cred.unidade, cadastros });
      } catch (e) {
        // Credencial vencida ou addon desligado numa unidade não impede as outras.
        feitas.push({ unidade: cred.unidade, erro: (e as Error).message });
      }
    }
    return resposta({ status: "completo", feitas });
  } catch (e) {
    return resposta({ error: (e as Error).message }, 500);
  }
});
