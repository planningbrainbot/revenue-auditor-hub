import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ Vendas de Serviços para Unidades (Pipefy) ============
// Versão server-side da Edge Function pipefy-vendas-servicos-sync (pg_cron
// 15min) — permite forçar atualização imediata pelo botão da tela
// /ebit-operacional. Mesma lógica de mapeamento; manter as duas em sincronia
// se as fases/campos do pipe 307297295 mudarem.
const VENDAS_PIPE_ID = "307297295";

export const FASES_ORDEM_VENDAS: string[] = [
  "Demanda",
  "Reunião Agendada",
  "Negociação",
  "Aditivo Contratual",
  "Ganho",
  "Perdido",
];

// Fases em que "Venda feita = Sim" já conta como MRR vendido pra abater o
// custo operacional — decisão do usuário em 14/08/2026 (DATA-RULES.md):
// "Aditivo Contratual" é a etapa de formalização pós-venda, não pipeline
// aberto.
const FASES_QUE_CONTAM_COMO_VENDIDO = new Set(["Aditivo Contratual", "Ganho"]);

function parseCurrency(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function parseUnidade(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const arr = JSON.parse(v);
    return Array.isArray(arr) && arr.length > 0 ? String(arr[0]) : null;
  } catch {
    return v;
  }
}

function parseData(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

const VENDAS_QUERY = `
  query($pipeId: ID!) {
    pipe(id: $pipeId) {
      phases {
        name
        cards(first: 50) {
          edges {
            node {
              id
              title
              createdAt
              fields { field { id } value }
            }
          }
        }
      }
    }
  }
`;

async function pipefyGraphql(token: string, query: string, variables: Record<string, unknown>) {
  const resp = await fetch("https://api.pipefy.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await resp.json();
  if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
  return body.data;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapVendaCard(faseNome: string, card: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fieldMap = new Map<string, string>((card.fields ?? []).map((f: any) => [f.field.id, f.value]));
  const vendaFeitaRaw = fieldMap.get("venda_feita");
  const reuniaoRaw = fieldMap.get("reuni_o_aconteceu");
  return {
    pipefy_card_id: String(card.id),
    titulo: card.title ?? null,
    solucao: fieldMap.get("solu_o") ?? card.title ?? null,
    unidade: parseUnidade(fieldMap.get("unidade")),
    fase_atual: faseNome,
    venda_feita: vendaFeitaRaw ? vendaFeitaRaw === "Sim" : null,
    reuniao_aconteceu: reuniaoRaw ? reuniaoRaw === "Sim" : null,
    valor_mensal_1_mes: parseCurrency(fieldMap.get("valor_mensal_1_m_s")),
    valor_teto_rampa: parseCurrency(fieldMap.get("valor_no_teto_da_rampa")),
    gatilho_reajuste: fieldMap.get("gatilho_do_reajuste") ?? null,
    negociacao: fieldMap.get("negocia_o") ?? null,
    data_reuniao: parseData(fieldMap.get("data_da_reuni_o")),
    criado_em: card.createdAt ?? null,
    synced_at: new Date().toISOString(),
  };
}

export const syncVendasServicos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ total: number; removidos: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    const start = Date.now();
    const data = await pipefyGraphql(pipefyToken, VENDAS_QUERY, { pipeId: VENDAS_PIPE_ID });
    const rows: ReturnType<typeof mapVendaCard>[] = [];
    for (const phase of data.pipe.phases) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const edge of phase.cards.edges) {
        rows.push(mapVendaCard(phase.name, edge.node));
      }
    }

    const { error: upsertErr } = await supabase
      .from("vendas_servicos_unidades")
      .upsert(rows, { onConflict: "pipefy_card_id" });
    if (upsertErr) throw new Error(upsertErr.message);

    const currentIds = new Set(rows.map((r) => r.pipefy_card_id));
    const { data: existing, error: exErr } = await supabase
      .from("vendas_servicos_unidades")
      .select("pipefy_card_id");
    if (exErr) throw new Error(exErr.message);
    const staleIds = (existing ?? [])
      .map((e: { pipefy_card_id: string }) => String(e.pipefy_card_id))
      .filter((id: string) => !currentIds.has(id));

    if (staleIds.length > 0) {
      const { error: delErr } = await supabase
        .from("vendas_servicos_unidades")
        .delete()
        .in("pipefy_card_id", staleIds);
      if (delErr) throw new Error(delErr.message);
    }

    const duracao = Math.round((Date.now() - start) / 1000);
    await supabase.from("sync_log").insert({
      fonte: "pipefy_vendas_servicos",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: { pipe_id: VENDAS_PIPE_ID, cards: rows.length, removidos: staleIds.length, trigger: "manual" },
      status: "sucesso",
    });

    return { total: rows.length, removidos: staleIds.length };
  });

export function isVendida(fase: string | null | undefined, vendaFeita: boolean | null | undefined): boolean {
  return !!vendaFeita && !!fase && FASES_QUE_CONTAM_COMO_VENDIDO.has(fase);
}

// ============ Custo Operacional (Google Sheets) ============
// Aba "Controle de Gastos Geral" — a linha "Total" do topo diverge da soma
// dos itens (ver DATA-RULES.md 14/08/2026); somamos os itens individuais.
const SHEET_ID = "1waLaMOUCF3l8eOkRKJ6er2jvYe5Oc28d64HL324ca10";
const SHEET_NAME = "Controle de Gastos Geral";
const DEPARTAMENTO_ALVO = "Operação";

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

function parsePtBrNumber(v: string): number | null {
  const s = v.trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? null : n;
}

// "jul./26" -> "2026-07-01"
function mesLabelToDate(label: string): string | null {
  const meses: Record<string, string> = {
    jan: "01", fev: "02", mar: "03", abr: "04", mai: "05", jun: "06",
    jul: "07", ago: "08", set: "09", out: "10", nov: "11", dez: "12",
  };
  const m = label.trim().toLowerCase().match(/^([a-z]{3})\.?\/(\d{2})$/);
  if (!m) return null;
  const mes = meses[m[1]];
  if (!mes) return null;
  const ano = `20${m[2]}`;
  return `${ano}-${mes}-01`;
}

async function fetchCustoOperacionalRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao buscar Google Sheets: HTTP ${resp.status}`);
  const csv = await resp.text();
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  // Linha 3 (índice 2) é o cabeçalho: Despesa,Categoria,Departamento,Tipo,Cobrança,jul./26,...
  const headerIdx = lines.findIndex((l) => l.startsWith('"Despesa"'));
  if (headerIdx === -1) throw new Error("Cabeçalho 'Despesa' não encontrado na aba Controle de Gastos Geral.");
  const header = parseCsvLine(lines[headerIdx]);
  const mesCols = header.slice(5).map((label, i) => ({ idx: 5 + i, mes: mesLabelToDate(label) }));

  const rows: { despesa: string; categoria: string | null; tipo: string | null; cobranca: string | null; mes: string; valor: number }[] = [];
  for (const line of lines.slice(headerIdx + 1)) {
    const cols = parseCsvLine(line);
    const despesa = (cols[0] ?? "").trim();
    const departamento = (cols[2] ?? "").trim();
    if (!despesa || departamento !== DEPARTAMENTO_ALVO) continue;
    const categoria = (cols[1] ?? "").trim() || null;
    const tipo = (cols[3] ?? "").trim() || null;
    const cobranca = (cols[4] ?? "").trim() || null;
    for (const { idx, mes } of mesCols) {
      if (!mes) continue;
      const valor = parsePtBrNumber(cols[idx] ?? "");
      if (valor == null) continue;
      rows.push({ despesa, categoria, tipo, cobranca, mes, valor });
    }
  }
  return rows;
}

export const syncCustoOperacional = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ total: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const start = Date.now();
    const rowsRaw = await fetchCustoOperacionalRows();
    const rows = rowsRaw.map((r) => ({ ...r, synced_at: new Date().toISOString() }));

    const { error } = await supabase
      .from("custo_operacional_mensal")
      .upsert(rows, { onConflict: "despesa,categoria,mes" });
    if (error) throw new Error(error.message);

    const duracao = Math.round((Date.now() - start) / 1000);
    await supabase.from("sync_log").insert({
      fonte: "custo_operacional_sheets",
      executado_em: new Date().toISOString(),
      duracao_segundos: duracao,
      total_registros: rows.length,
      detalhes: { sheet_id: SHEET_ID, aba: SHEET_NAME, linhas: rows.length, trigger: "manual" },
      status: "sucesso",
    });

    return { total: rows.length };
  });
