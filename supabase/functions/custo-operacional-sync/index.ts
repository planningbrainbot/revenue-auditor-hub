// custo-operacional-sync
//
// Sincroniza a aba "Controle de Gastos Geral" da planilha Google Sheets
// (id 1waLaMOUCF3l8eOkRKJ6er2jvYe5Oc28d64HL324ca10), linhas com
// Departamento = Operação, na tabela custo_operacional_mensal — usada na
// página /ebit-operacional junto com vendas_servicos_unidades pra
// acompanhar a meta de zerar o custo operacional do time.
//
// Achado em 14/08/2026 (DATA-RULES.md): a linha "Total" no topo da aba
// diverge ~4x da soma dos itens de despesa individuais listados na própria
// aba — provável causa é a fórmula da linha Total puxando de outro
// range/aba. Decisão confirmada com o usuário: somar os itens individuais,
// não usar a linha Total. Se a planilha for corrigida no futuro, reavaliar.
//
// Export via gviz (CSV público, não precisa de auth) — mesma técnica já
// usada em tools/sync_investimento_bu.py.

const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const SUPA_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function fetchRows() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(SHEET_NAME)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Falha ao buscar Google Sheets: HTTP ${resp.status}`);
  const csv = await resp.text();
  const lines = csv.split("\n").filter((l) => l.trim().length > 0);
  const headerIdx = lines.findIndex((l) => l.startsWith('"Despesa"'));
  if (headerIdx === -1) throw new Error("Cabeçalho 'Despesa' não encontrado na aba Controle de Gastos Geral.");
  const header = parseCsvLine(lines[headerIdx]);
  const mesCols = header.slice(5).map((label, i) => ({ idx: 5 + i, mes: mesLabelToDate(label) }));

  const rows: { despesa: string; categoria: string | null; tipo: string | null; cobranca: string | null; mes: string; valor: number; synced_at: string }[] = [];
  const syncedAt = new Date().toISOString();
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
      rows.push({ despesa, categoria, tipo, cobranca, mes, valor, synced_at: syncedAt });
    }
  }
  return rows;
}

async function supaUpsert(path: string, rows: Record<string, unknown>[], onConflict: string): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}?on_conflict=${onConflict}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function supaInsert(path: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase POST ${path} -> HTTP ${res.status}: ${await res.text()}`);
}

async function insertSyncLog(
  executadoEm: Date,
  duracao: number,
  total: number,
  detalhes: Record<string, unknown>,
  status = "sucesso",
) {
  await supaInsert("sync_log", [
    {
      fonte: "custo_operacional_sheets",
      executado_em: executadoEm.toISOString(),
      duracao_segundos: duracao,
      total_registros: total,
      detalhes,
      status,
    },
  ]);
}

async function runSync() {
  const startTime = new Date();
  console.log(`Sync Custo Operacional (Sheets) → Supabase | ${startTime.toISOString()}`);

  const rows = await fetchRows();
  await supaUpsert("custo_operacional_mensal", rows, "despesa,categoria,mes");

  const elapsed = Math.round((Date.now() - startTime.getTime()) / 1000);
  const result = { linhas: rows.length, elapsed };
  await insertSyncLog(startTime, elapsed, rows.length, { sheet_id: SHEET_ID, aba: SHEET_NAME, ...result, trigger: "cron" });
  return result;
}

Deno.serve(async (_req) => {
  const startTime = new Date();
  try {
    const result = await runSync();
    return new Response(JSON.stringify({ ok: true, ...result }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    console.error("Sync falhou:", err);
    try {
      await insertSyncLog(
        startTime,
        Math.round((Date.now() - startTime.getTime()) / 1000),
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
