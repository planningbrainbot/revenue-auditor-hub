// Única integração de escrita do Aquário com o pipe 39. Segredos só no runtime Supabase.
import { summarize, PRODUCT } from "./crm.mjs";
import { localDate } from "./dates.mjs";
const URL_BASE = Deno.env.get("SUPABASE_URL")!;
const ADMIN = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const PD = Deno.env.get("PIPEDRIVE_TOKEN")!;
const LABELS: Record<string, string> = { consultoria: "Consultoria", finance: "Finance", cella: "Cella" };
const OPTIONS: Record<string, number> = { consultoria: 1129, finance: 1130, cella: 1128 };
const PIPE = 39;
type Row = Record<string, any>;
const id = (v: any) => Number(typeof v === "object" ? v?.id ?? v?.value : v) || null;
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "https://planningbrain.com.br", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
function result(body: Row, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
async function db(path: string, token: string, body?: unknown, method = "POST") {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { method: body === undefined ? "GET" : method, headers: { apikey: token === ADMIN ? ADMIN : ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Accept-Profile": "ops", "Content-Profile": "ops", Prefer: "return=representation" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const text = await res.text(); let json: any; try { json = text ? JSON.parse(text) : null; } catch { throw new Error("Resposta inválida do banco"); }
  if (!res.ok) throw new Error(json?.message || "Falha ao consultar o banco");
  return json;
}
const rpc = (name: string, body: Row, token = ADMIN) => db("rpc/" + name, token, body);
async function pd(path: string, params: Row = {}, payload?: Row) {
  const query = new URLSearchParams({ ...params, api_token: PD });
  const res = await fetch(`https://api.pipedrive.com/v1/${path}?${query}`, { method: payload ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Pipedrive HTTP ${res.status}`);
  const body = await res.json();
  if (!body.success) throw new Error("Pipedrive não confirmou a operação");
  return body;
}
async function pages(path: string, params: Row = {}) {
  const rows: Row[] = []; let start = 0;
  for (let page = 0; page < 100; page++) {
    const body = await pd(path, { ...params, start, limit: 500 });
    if (body.data && !Array.isArray(body.data)) throw new Error("Formato inesperado da paginação do CRM");
    rows.push(...(body.data || []));
    const pagination = body.additional_data?.pagination;
    if (!pagination?.more_items_in_collection) return rows;
    const next = Number(pagination.next_start);
    if (!Number.isFinite(next) || next <= start) throw new Error("Paginação do CRM não avançou");
    start = next;
  }
  throw new Error("CRM excedeu o limite de paginação. Carga anterior preservada.");
}
async function limited(rows: Row[], fn: (r: Row) => Promise<any>, n = 6) {
  const out = []; for (let i = 0; i < rows.length; i += n) out.push(...await Promise.all(rows.slice(i, i + n).map(fn))); return out;
}
async function stages() {
  const rows = (await pages("stages")).filter(s => s.pipeline_id === PIPE && s.active_flag !== false).sort((a,b) => a.order_nr-b.order_nr);
  if (!rows.length || !rows.some(s => /negocia/i.test(s.name))) throw new Error("Etapas do pipe de Monetização não identificadas");
  return rows;
}
async function collect() {
  const stageRows = await stages();
  const deals = [...new Map((await limited(stageRows, s => pages("deals", { stage_id: s.id, status: "all_not_deleted" }))).flat().filter(d => d.pipeline_id === PIPE).map(d => [d.id, d])).values()];
  const summary = await Promise.all(["open", "won", "lost"].map(status => pd("deals/summary", { pipeline_id: PIPE, status })));
  const expected = summary.reduce((n, b) => n + Number(b.data?.total_count || 0), 0);
  if (deals.length !== expected) throw new Error("A contagem do CRM não fechou com a paginação. Carga anterior preservada.");
  const [cachedRows, previous] = await Promise.all([
    db("monetizacao_deals?select=id,payload&limit=1000", ADMIN),
    db("monetizacao_sync?select=stages&id=eq.true", ADMIN),
  ]);
  const cache = new Map(cachedRows.map((r: Row) => [r.id, r.payload]));
  const signature = (rows: Row[], live = false) => JSON.stringify(rows.filter(s => !/(reciclad|perdid|descart|estacion|parking)/i.test(s.name)).map(s => [s.id, s.name, live ? s.order_nr : s.order]));
  const sameStages = signature(previous[0]?.stages || []) === signature(stageRows, true);
  const now = Date.now(), month = localDate(new Date().toISOString()).slice(0,7);
  const changed = deals.filter(d => {
    const old = cache.get(d.id) as Row | undefined;
    return !sameStages || !old?.history_known || !d.update_time || old.updated_at !== d.update_time || !old.history_refreshed_at || now - Date.parse(old.history_refreshed_at) > 86400000;
  });
  const flows = Object.fromEntries(await limited(changed, async d => [d.id, await pages(`deals/${d.id}/flow`, { items: "dealChange" })]));
  const snapshot = summarize(deals, stageRows, flows);
  const changedIds = new Set(changed.map(d => d.id));
  snapshot.cards = snapshot.cards.map((c: Row) => {
    if (changedIds.has(c.id)) return { ...c, history_refreshed_at: new Date(now).toISOString() };
    const old = cache.get(c.id) as Row;
    const flags = Object.fromEntries(Object.entries(old.events).map(([key, rows]) => [key, (rows as Row[]).some(e => e.date.startsWith(month))]));
    return { ...old, ...flags };
  });
  snapshot.verified_count = expected;
  return { snapshot, deals };
}
async function sync() {
  const run = await rpc("monetizacao_start_sync", {});
  if (!run) return { status: "running" };
  try {
    await rpc("monetizacao_intake_ops", {});
    const { snapshot, deals } = await collect();
    await rpc("monetizacao_refresh_ops", {});
    await rpc("monetizacao_replace_snapshot", { _run: run, _snapshot: snapshot });
    // Reconciliar efeitos remotos confirmados depois de um timeout; nunca repetir o POST.
    const pending: Row[] = await db("monetizacao_envios?select=id,item_id,status,org_id&status=in.(sending,uncertain)&order=created_at&limit=1000", ADMIN);
    for (const e of pending) {
      const found = deals.filter(d => String(d.title).includes(`[AQ:${e.id}]`));
      if (found.length === 1) await rpc("monetizacao_finish", { _nonce: e.id, _status: "sent", _deal: found[0].id, _org: id(found[0].org_id), _reason: "Envio conciliado pelo identificador único no CRM." });
    }
    return { status: "ok", count: snapshot.cards.length, measured_at: snapshot.measured_at };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Falha ao atualizar CRM";
    await db(`monetizacao_sync?id=eq.true&run_id=eq.${run}`, ADMIN, { status: "error", error: message.slice(0, 240) }, "PATCH").catch(() => {});
    throw e;
  }
}

async function send(itemIds: string[], token: string) {
  const stageRows = await stages(), users = await pages("users"), month = localDate(new Date().toISOString()).slice(0,7);
  const results: Row[] = [];
  for (const item of itemIds) {
    const claim = await rpc("monetizacao_claim", { _item: item }, token);
    if (!claim.claimed) { results.push({ item, ...claim }); continue; }
    let remoteStarted = false, org: number | null = null;
    const finish = async (status: string, deal: number | null, reason: string) => { await rpc("monetizacao_finish", { _nonce: claim.nonce, _status: status, _deal: deal, _org: org, _reason: reason }); results.push({ item, status, deal_id: deal, reason }); };
    try {
      if (!users.some(u => u.id === claim.owner_id && u.active_flag)) throw new Error("Hunter não está ativo no Pipedrive");
      const account = claim.account, product = claim.item.product, orgs: number[] = claim.org_ids || [];
      if (!OPTIONS[product]) throw new Error("Produto canônico inválido");
      // O contrato confirmado é um ID de negócio, nunca um ID de organização.
      // Reconsulta antes do envio para não criar organização duplicada nem usar contrato desfeito.
      if (account.pipedrive_contract_id) {
        const contract = (await pd(`deals/${Number(account.pipedrive_contract_id)}`)).data;
        if (product === "finance" && contract?.status !== "won") throw new Error("O contrato de origem não está ganho no Pipedrive; revise o cadastro.");
        const contractOrg = id(contract?.org_id);
        if (contractOrg && !orgs.includes(contractOrg)) orgs.push(contractOrg);
      }
      // Verifica todas as organizações da conta, e somente a oferta do produto selecionado.
      const existing: Row[] = [];
      for (const orgId of orgs) existing.push(...await pages(`organizations/${orgId}/deals`, { status: "all_not_deleted" }));
      const duplicate = existing.find(d => d.pipeline_id === PIPE && String(d[PRODUCT]) === String(OPTIONS[product]) && (d.status === "open" || localDate(d.add_time)?.startsWith(month)));
      if (duplicate) { org = id(duplicate.org_id); await finish("sent", duplicate.id, "Vinculada à oportunidade existente do mesmo produto."); continue; }
      org = orgs[0] || null;
      if (org) {
        const found = await pd(`organizations/${org}`);
        if (!found.data || found.data.active_flag === false) throw new Error("Organização vinculada indisponível; concilie o cadastro");
      } else {
        const matches = await pd("organizations/search", { term: account.name.trim(), fields: "name", exact_match: "true" });
        if (matches.data?.items?.length) throw new Error("Há organização com este nome no CRM. Vincule a organização correta ao cadastro antes de enviar.");
        remoteStarted = true;
        org = (await pd("organizations", {}, { name: account.name.trim(), owner_id: claim.owner_id })).data.id;
        await rpc("monetizacao_record_org", { _nonce: claim.nonce, _org: org });
      }
      await rpc("monetizacao_record_org", { _nonce: claim.nonce, _org: org });
      // Contato não é requisito para criar uma oportunidade validada pelo sócio.
      const payload = { title: `${account.name.trim()} · ${LABELS[product]} [AQ:${claim.nonce}]`, org_id: org, user_id: claim.owner_id, pipeline_id: PIPE, stage_id: stageRows[0].id, [PRODUCT]: OPTIONS[product] };
      remoteStarted = true;
      const created = await pd("deals", {}, payload);
      await finish("sent", created.data.id, "Criada na etapa de entrada após validação registrada.");
    } catch(e) {
      const message = e instanceof Error ? e.message : "Não foi possível confirmar o envio";
      const definite = !remoteStarted || /^Pipedrive HTTP (400|401|403|404|422|429)$/.test(message);
      await finish(definite ? "blocked" : "uncertain", null, definite ? message : "Resposta incerta. Atualize para conciliar antes de qualquer reenvio.").catch(() => { results.push({ item, status: "uncertain", reason: "Não foi possível confirmar o registro. Atualize para conciliar." }); });
    }
  }
  // A próxima sincronização da nuvem também captura efeitos que terminaram depois da resposta.
  EdgeRuntime.waitUntil(sync().catch(() => {}));
  return { status: "ok", results };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return result({ error: "Método inválido" }, 405);
  try {
    if (!PD || !ADMIN || !ANON || !URL_BASE) throw new Error("Integração não configurada no servidor");
    const body = await req.json();
    const cronSecret = Deno.env.get("MONETIZACAO_SYNC_SECRET");
    const scheduled = !!cronSecret && req.headers.get("x-monetizacao-sync") === cronSecret;
    if (scheduled && body.action === "sync") return result(await sync());
    const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return result({ error: "Autenticação obrigatória" }, 401);
    const auth = await fetch(`${URL_BASE}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${token}` } });
    if (!auth.ok) return result({ error: "Sessão inválida" }, 401);
    const key = body.action === "send" ? "send.monetizacao" : "view.monetizacao";
    if (!await rpc("monetizacao_can", { _key: key }, token)) return result({ error: "Sem permissão para esta operação" }, 403);
    if (body.action === "sync") {
      if (!await rpc("monetizacao_scope", { _ids: [] }, token)) return result({ error: "Atualização global restrita à equipe central" }, 403);
      return result(await sync());
    }
    if (body.action === "send" && Array.isArray(body.items) && body.items.length >= 1 && body.items.length <= 10 && new Set(body.items).size === body.items.length && body.items.every((x: unknown) => typeof x === "string" && /^[0-9a-f-]{36}$/.test(x))) return result(await send(body.items, token));
    return result({ error: "Ação ou seleção inválida" }, 400);
  } catch(e) { return result({ error: e instanceof Error ? e.message : "Falha na integração" }, 400); }
});
