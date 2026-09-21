// pipedrive-contrato-assinado-backfill
//
// Repõe `contratos.entrada_contrato_assinado_em`, que parou em 29/07/2026.
//
// A data nunca saiu do sync de contratos. Quem preenchia era um trecho à parte
// do script local `~/sync_pipedrive_contratos.py`: ele casava o contrato
// (pipeline 2/4) com o deal-cópia no pipeline 28 por (unidade, título) e lia
// no /flow a data de entrada no stage 170 ("Contrato Assinado"). Ao migrar
// para a nuvem, `pipedrive-contratos-sync` deixou o trecho de fora de
// propósito — custa uma chamada /flow por deal e foi julgado não crítico. O
// LaunchAgent foi arquivado em 31/08/2026 e a coluna secou: 630 dos 770
// contratos sem data, 100% dos ganhos de agosto e setembro.
//
// Fica em função separada, e não dentro do sync diário, justamente para o
// custo continuar isolado: este roda mais raro e com orçamento de tempo.
//
// Barato no regime permanente pela mesma razão do script original: o /flow só
// é chamado para deal que casou com um contrato ainda sem data. Depois que o
// retroativo fecha, sobra quase nada por execução.

type Row = Record<string, any>;

const URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PIPEDRIVE = Deno.env.get("PIPEDRIVE_TOKEN")!;
const CRON = Deno.env.get("CONTRATO_ASSINADO_CRON_SECRET");

// Pipeline 28 é a Central de Contratos no Pipedrive; 170 é a fase "Contrato
// Assinado" dentro dela. O deal que vive aqui é uma cópia do deal de venda.
const STAGE_ID = 170;
const ORCAMENTO_MS = 110_000;

const resposta = (body: Row, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

async function db(path: string, body?: unknown, method = "POST") {
  const escrita = body !== undefined;
  const headers: Record<string, string> = {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    "Accept-Profile": "ops",
    "Content-Profile": "ops",
  };
  if (escrita) headers.Prefer = "return=minimal";
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

async function pd(path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`https://api.pipedrive.com/v1${path}${sep}api_token=${PIPEDRIVE}`, {
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`Pipedrive indisponível (${r.status})`);
  return await r.json();
}

// O título do deal-cópia costuma repetir o do original. A normalização é a
// mesma do script antigo: sem caixa, sem espaço duplicado, sem acento — senão
// "Belém" e "Belem" viram clientes diferentes.
const normalizar = (v: unknown) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

// O deal do pipeline 28 é uma cópia e nasce com o sufixo: "R8/Favani (cópia)".
// Sem tirar isso, nenhum título casa com o do contrato. Era a outra metade do
// que o script local fazia, junto com a leitura do campo de unidade.
const limparTitulo = (v: unknown) =>
  normalizar(String(v ?? "").replace(/\s*\(c[óo]pia\)\s*$/i, ""));

// Campo customizado "Unidade de Negócio" do deal. O Pipedrive devolve custom
// field com a chave em hash e o valor como id da opção, não como rótulo — é a
// mesma tabela que `pipedrive-contratos-sync` usa, repetida aqui de propósito
// para as duas funções não precisarem compartilhar estado.
//
// A primeira versão tentava adivinhar a chave procurando "unidade" no nome do
// campo. Não existe nome nenhum na resposta, então ela devolvia vazio para
// todo deal e o casamento falhou em 187 dos 188 deals do stage.
const UNIDADE_FIELD = "5684f15458abf85ed384837a8eb515294350f5cc";

const UNIDADE_LABELS: Record<string, string> = {
  "694": "Matriz",
  "695": "Rio de Janeiro",
  "696": "Patos de Minas",
  "697": "Belém",
  "698": "Curitiba",
  "699": "Consultoria",
  "700": "Construção Civil",
  "701": "Agronegócio",
  "719": "São Paulo",
  "720": "ROIT",
  "857": "Itaúna",
  "929": "Fortaleza",
  "930": "Campo Novo",
  "931": "São Luis",
  "984": "Maceió",
};

function unidadeDoDeal(deal: Row): string {
  const bruto = deal[UNIDADE_FIELD];
  if (!bruto) return "";
  const id = String(bruto);
  // Id desconhecido cai para o próprio id, igual ao sync: some do casamento em
  // vez de casar com a unidade errada.
  return normalizar(UNIDADE_LABELS[id] ?? id);
}

async function dealsDoStage(): Promise<Row[]> {
  const deals: Row[] = [];
  let start = 0;
  while (true) {
    const data = await pd(
      `/deals?stage_id=${STAGE_ID}&status=all_not_deleted&limit=100&start=${start}`,
    );
    const lote: Row[] = data?.data ?? [];
    deals.push(...lote);
    if (!data?.additional_data?.pagination?.more_items_in_collection) break;
    start += 100;
  }
  return deals;
}

// Data em que o deal entrou no stage 170. Se reentrou mais de uma vez, a
// transição mais recente manda.
async function dataDeEntrada(dealId: number | string): Promise<string | null> {
  let data: Row;
  try {
    data = await pd(`/deals/${dealId}/flow?limit=100`);
  } catch {
    return null;
  }
  const datas = (data?.data ?? [])
    .filter((item: Row) =>
      item?.object === "dealChange" &&
      item?.data?.field_key === "stage_id" &&
      String(item?.data?.new_value) === String(STAGE_ID) &&
      item?.timestamp
    )
    .map((item: Row) => String(item.timestamp).slice(0, 10));
  return datas.length ? datas.sort().at(-1)! : null;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return resposta({ error: "Método não permitido" }, 405);
  const autorizado = req.headers.get("authorization") === `Bearer ${SERVICE}` ||
    (!!CRON && req.headers.get("x-planning-contrato-cron") === CRON);
  if (!autorizado) return resposta({ error: "Não autorizado" }, 401);

  const inicio = Date.now();
  try {
    // 1. Fonte barata primeiro: o que o próprio Pipefy já sabe.
    // Chamada crua em vez de db(): o helper devolve null em qualquer POST, e
    // aqui o retorno da função (quantas linhas preencheu) é o que se reporta.
    const rpcResp = await fetch(`${URL}/rest/v1/rpc/contratos_propagar_data_assinatura_pipefy`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
        "Accept-Profile": "ops",
        "Content-Profile": "ops",
      },
      body: "{}",
      signal: AbortSignal.timeout(30000),
    });
    if (!rpcResp.ok) throw new Error(`Propagação do Pipefy falhou (${rpcResp.status})`);
    const propagados = await rpcResp.json();

    // 2. O que sobrou vai pelo caminho caro.
    const pendentes: Row[] = [];
    for (let offset = 0; ; offset += 1000) {
      const lote: Row[] = await db(
        `contratos?entrada_contrato_assinado_em=is.null&select=id,titulo,unidade&offset=${offset}&limit=1000`,
      ) as Row[];
      if (!lote.length) break;
      pendentes.push(...lote);
      if (lote.length < 1000) break;
    }

    const porChave = new Map<string, number[]>();
    for (const c of pendentes) {
      const chave = `${normalizar(c.unidade)}|${normalizar(c.titulo)}`;
      const lista = porChave.get(chave) ?? [];
      lista.push(c.id);
      porChave.set(chave, lista);
    }

    const deals = await dealsDoStage();
    let atualizados = 0;
    let semMatch = 0;
    let semFlow = 0;
    let restantes = 0;

    for (const deal of deals) {
      const chave = `${unidadeDoDeal(deal)}|${limparTitulo(deal.title)}`;
      const alvos = porChave.get(chave);
      if (!alvos?.length) {
        semMatch++;
        continue;
      }
      if (Date.now() - inicio > ORCAMENTO_MS) {
        restantes++;
        continue;
      }
      const entrada = await dataDeEntrada(deal.id);
      if (!entrada) {
        semFlow++;
        continue;
      }
      for (const id of alvos) {
        await db(`contratos?id=eq.${id}`, { entrada_contrato_assinado_em: entrada }, "PATCH");
        atualizados++;
      }
      porChave.delete(chave);
    }

    const resultado = {
      status: restantes ? "parcial" : "completo",
      propagados_do_pipefy: propagados,
      pendentes_no_inicio: pendentes.length,
      deals_no_stage: deals.length,
      atualizados_pelo_flow: atualizados,
      sem_match_por_unidade_titulo: semMatch,
      sem_stage_170_no_flow: semFlow,
      nao_processados_por_tempo: restantes,
      segundos: Math.round((Date.now() - inicio) / 1000),
    };
    await db("sync_log", {
      fonte: "contrato_assinado_backfill",
      status: "sucesso",
      detalhes: resultado,
    });
    return resposta(resultado);
  } catch (e) {
    await db("sync_log", {
      fonte: "contrato_assinado_backfill",
      status: "erro",
      detalhes: { erro: (e as Error).message },
    }).catch(() => {});
    return resposta({ error: (e as Error).message }, 500);
  }
});
