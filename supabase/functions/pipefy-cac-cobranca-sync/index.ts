// pipefy-cac-cobranca-sync
//
// Sincroniza o pipe Pipefy "Cobrança CAC Adiantado" (307316953) na tabela
// cac_cobranca_cards. Nasceu em 15/09/2026 como fonte da tela /unidades/cac.
//
// A tela saiu em 18/09/2026 e este sync ficou: quem consome hoje é o extrato
// do broker. ops.broker_cac_sync() lê v_cac_cobranca_pipe (esta tabela) e
// lança os débitos de CAC das unidades com origem 'cac_pipe'. Sem este sync,
// cobrança nova de CAC não chega ao broker.
//
// Existe cobrança de CAC porque existe card, e a fase do card diz o que já
// pode ser cobrado da unidade. O valor não vem do card: sai de
// contratos.mrr_mensal, porque o pipe não tem campo de valor.

const PIPEFY_TOKEN = Deno.env.get("PIPEFY_TOKEN")!;
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// No banco único as tabelas do Ops vivem em `ops`, mas o schema padrão do
// PostgREST é `public` — e ler o schema errado devolve VAZIO sem erro, que é
// indistinguível de "não há card". O default é `ops` porque é lá que esta
// função roda; DB_SCHEMA existe para quem precisar apontar noutro lugar.
const SCHEMA = Deno.env.get("DB_SCHEMA") ?? "ops";

const PIPE_ID = "307316953";

// Campos do start form. São os três que existem: o pipe não tem CNPJ nem
// Deal ID, então o casamento com o contrato é feito pelo nome do cliente.
const F_UNIDADE = "unidade_de_neg_cio";
const F_CLIENTE = "cliente";
const F_DATA_ASSINATURA = "data_da_assinatura";
// O dinheiro. Dois pares, um por fase: a parcela 1 mora na fase "Cobrar 50%" e
// a parcela 2 na "Cobrar 100%". Cliente cobrado 100% de uma vez usa só o
// segundo par. O honorário é do start form e é a base, não a cobrança.
const F_VALOR_HONORARIO = "valor_1_honor_rio";
const F_DATA_P1 = "data_da_cobran_a";
const F_VALOR_P1 = "valor_cobrado";
const F_DATA_P2 = "data_da_cobran_a_1";
const F_VALOR_P2 = "valor_cobrado_1";

/**
 * Campo de moeda do Pipefy volta formatado em pt-BR ("1.722,32") e campo de
 * número volta cru ("3444.63"). Ler os dois com o mesmo parser transformaria
 * 3444.63 em 344463, que é o erro que quase entrou no relatório de conferência.
 * Por isso: se tem vírgula, é pt-BR; se não tem, já é número.
 */
function parseValorPipefy(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const limpo = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

const QUERY = `
  query($pipeId: ID!, $cursor: String) {
    allCards(pipeId: $pipeId, first: 50, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          title
          createdAt
          current_phase { id name }
          fields { field { id } value }
        }
      }
    }
  }
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pipefyGraphql(variables: Record<string, unknown>): Promise<any> {
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${PIPEFY_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: QUERY, variables }),
  });
  const body = await resp.json();
  if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

/**
 * O formato de data do Pipefy **muda de pipe para pipe**, e essa função já
 * nasceu errada por causa disso.
 *
 * A regra de 24/08/2026 (DATA-RULES.md) mediu o pipe de contratos (307285170) e
 * concluiu MM/DD/YYYY, o que está certo para aquele pipe. Este pipe
 * (307316953) devolve **dd/mm/yyyy**, e a prova é direta: gravamos
 * `2026-08-15` no card 1445474815 e a leitura devolveu `15/08/2026`.
 *
 * Com o parser americano toda data de dia > 12 virava mês inválido e era
 * descartada em silêncio: os 83 cards vieram com valor e **sem data nenhuma**.
 * É também a explicação do caso Velox Guincho anotado no DECISIONS.md, lido
 * como "6 de outubro" quando o card diz 10/06/2026, ou seja, 10 de junho.
 *
 * Estratégia: desambiguar pelo componente que não pode ser mês. Quando os dois
 * cabem em 1..12 a data é genuinamente ambígua e aí vale o padrão do pipe, que
 * aqui é dia primeiro.
 */
function parseDataPipefy(v: string | null | undefined): string | null {
  if (!v) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return iso[0];
  const barras = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (!barras) return null;
  const a = Number(barras[1]);
  const b = Number(barras[2]);
  const ano = barras[3];

  let dia: number;
  let mes: number;
  if (a > 12 && b <= 12) {
    dia = a;
    mes = b; // 15/08 só pode ser dia primeiro
  } else if (b > 12 && a <= 12) {
    dia = b;
    mes = a; // 01/29 só pode ser mês primeiro
  } else {
    dia = a;
    mes = b; // ambíguo: padrão deste pipe
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapCard(card: any) {
  const fieldMap = new Map<string, string>(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (card.fields ?? []).map((f: any) => [f.field?.id, f.value]),
  );
  return {
    pipefy_card_id: String(card.id),
    titulo: card.title ?? null,
    cliente: fieldMap.get(F_CLIENTE) ?? card.title ?? null,
    unidade: fieldMap.get(F_UNIDADE) ?? null,
    data_assinatura: parseDataPipefy(fieldMap.get(F_DATA_ASSINATURA)),
    valor_1_honorario: parseValorPipefy(fieldMap.get(F_VALOR_HONORARIO)),
    data_cobranca_p1: parseDataPipefy(fieldMap.get(F_DATA_P1)),
    valor_cobrado_p1: parseValorPipefy(fieldMap.get(F_VALOR_P1)),
    data_cobranca_p2: parseDataPipefy(fieldMap.get(F_DATA_P2)),
    valor_cobrado_p2: parseValorPipefy(fieldMap.get(F_VALOR_P2)),
    fase_id: card.current_phase?.id ? String(card.current_phase.id) : null,
    fase_atual: card.current_phase?.name ?? null,
    criado_em: card.createdAt ?? null,
    synced_at: new Date().toISOString(),
  };
}

// ── Supabase REST ─────────────────────────────────────────────────────────
function headers(escrita: boolean): Record<string, string> {
  return {
    apikey: SB_KEY,
    Authorization: `Bearer ${SB_KEY}`,
    "Content-Type": "application/json",
    ...(escrita ? { "Content-Profile": SCHEMA } : { "Accept-Profile": SCHEMA }),
  };
}

async function supaUpsert(tabela: string, rows: Record<string, unknown>[], onConflict: string) {
  if (rows.length === 0) return;
  const r = await fetch(`${SB_URL}/rest/v1/${tabela}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: { ...headers(true), Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`upsert ${tabela} ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function supaGet(path: string): Promise<any[]> {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: headers(false) });
  if (!r.ok) throw new Error(`GET ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function supaDelete(path: string) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method: "DELETE",
    headers: { ...headers(true), Prefer: "return=minimal" },
  });
  if (!r.ok) throw new Error(`DELETE ${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

async function insertSyncLog(
  executadoEm: Date,
  duracao: number,
  total: number,
  detalhes: Record<string, unknown>,
  status = "sucesso",
) {
  const r = await fetch(`${SB_URL}/rest/v1/sync_log`, {
    method: "POST",
    headers: { ...headers(true), Prefer: "return=minimal" },
    body: JSON.stringify([
      {
        fonte: "pipefy_cac_cobranca",
        executado_em: executadoEm.toISOString(),
        duracao_segundos: duracao,
        total_registros: total,
        detalhes,
        status,
      },
    ]),
  });
  if (!r.ok) throw new Error(`sync_log ${r.status}`);
}

async function runSync() {
  const inicio = new Date();
  const rows: ReturnType<typeof mapCard>[] = [];

  let cursor: string | null = null;
  do {
    const data = await pipefyGraphql({ pipeId: PIPE_ID, cursor });
    for (const edge of data.allCards.edges) rows.push(mapCard(edge.node));
    cursor = data.allCards.pageInfo.hasNextPage ? data.allCards.pageInfo.endCursor : null;
  } while (cursor);

  await supaUpsert("cac_cobranca_cards", rows, "pipefy_card_id");

  // Card apagado no Pipefy sai da tabela. O item da apuração que ele criou
  // NÃO é apagado junto: pagamento já marcado e vínculo com royalties são
  // história, e a tela mostra esses casos como "fora do pipe".
  const atuais = new Set(rows.map((r) => r.pipefy_card_id));
  const existentes = await supaGet("cac_cobranca_cards?select=pipefy_card_id");
  const sumidos = existentes
    .map((e: { pipefy_card_id: string }) => String(e.pipefy_card_id))
    .filter((id: string) => !atuais.has(id));
  if (sumidos.length > 0) {
    await supaDelete(`cac_cobranca_cards?pipefy_card_id=in.(${sumidos.join(",")})`);
  }

  const elapsed = Math.round((Date.now() - inicio.getTime()) / 1000);
  const resultado = { cards: rows.length, removidos: sumidos.length, elapsed };
  await insertSyncLog(inicio, elapsed, rows.length, { pipe_id: PIPE_ID, ...resultado });
  return resultado;
}

Deno.serve(async (_req) => {
  const inicio = new Date();
  try {
    const resultado = await runSync();
    return new Response(JSON.stringify({ ok: true, ...resultado }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error("Sync falhou:", err);
    try {
      await insertSyncLog(
        inicio,
        Math.round((Date.now() - inicio.getTime()) / 1000),
        0,
        { error: err },
        "erro",
      );
    } catch {
      // se nem o log der certo, não bloqueia a resposta de erro
    }
    return new Response(JSON.stringify({ ok: false, error: err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
