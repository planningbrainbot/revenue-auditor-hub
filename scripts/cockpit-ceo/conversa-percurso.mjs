// Percurso real do "Perguntar ao Brain" sem modelo: visão salva → reabrir com a sessão → conferir
// cada número da tabela contra SQL independente → trocar a base pelo controle da tela → conferir de
// novo → renomear e excluir. Tudo com a sessão da conta autorizada (scripts/cockpit-ceo/_sessao.mjs).
//
// Uso: SESSAO_EMAIL=… SUPABASE_ACCESS_TOKEN=… SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=…
//      SUPABASE_SERVICE_ROLE_KEY=… node scripts/cockpit-ceo/conversa-percurso.mjs <base> <saida>
// As capturas têm número real: <saida> deve ficar fora do repositório.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { abrirSessao } from "./_sessao.mjs";
import { consultar } from "./brain-ro.mjs";

const [BASE, SAIDA] = process.argv.slice(2);
mkdirSync(SAIDA, { recursive: true });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const resultados = [];
const confere = (nome, ok, detalhe = "") => {
  resultados.push({ nome, ok, detalhe });
  console.log(`${ok ? "ok   " : "FALHA"} ${nome}${detalhe ? ` · ${detalhe}` : ""}`);
};

// ── Sessão e visão salva pela própria pessoa (RLS) ──
const s = await abrirSessao(process.env.SESSAO_EMAIL);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
  global: { headers: { Authorization: `Bearer ${s.access_token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "ops" },
});
const args = {
  filtros: {
    leitura: "rede",
    unidades: ["Curitiba", "Belém"],
    periodo: { tipo: "ultimos_meses", meses: 3 },
  },
};
const definicao = {
  versao: 1,
  titulo: "Curitiba × Belém (percurso de teste)",
  filtros: {},
  blocos: [
    { id: "b1", tipo: "serie", consulta: { nome: "serie_faturamento", args } },
    { id: "b2", tipo: "tabela", consulta: { nome: "serie_faturamento", args } },
  ],
};
const ins = await db
  .from("cockpit_visoes")
  .insert({ nome: "Percurso de teste", definicao })
  .select("id")
  .single();
confere("salvar visão com a própria sessão", !ins.error, ins.error?.message);
const visaoId = ins.data?.id;

// ── Esperado por SQL independente (somente leitura) ──
const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const m0 = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 4, 1))
  .toISOString()
  .slice(0, 10);
const m2 = new Date(Date.UTC(+hoje.slice(0, 4), +hoje.slice(5, 7) - 2, 1))
  .toISOString()
  .slice(0, 10);
const esperado = async (base) =>
  Object.fromEntries(
    (
      await consultar(`select to_char(a.mes_referencia,'MM/YY') m, u.nome_da_praca u,
        sum(${base === "nova" ? "coalesce(a.receita_base,0)" : "coalesce(a.receita_base,0)+coalesce(a.receita_base_antiga,0)"})::numeric(14,2) v
        from ops.royalties_apuracao a join ops.unidades u on u.id=a.unidade_id
        where a.status='confirmado' and u.tipo='regional' and u.nome_da_praca in ('Curitiba','Belém')
          and a.mes_referencia between '${m0}' and '${m2}' group by 1,2`)
    ).map((r) => [`${r.m}|${r.u}`, Number(r.v)]),
  );

// ── Navegador ──
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORTA = 9600 + Math.floor(Math.random() * 200);
const perfil = mkdtempSync(join(tmpdir(), "cockpit-percurso-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${perfil}`,
  "--no-first-run",
  "about:blank",
]);
let alvo;
for (let i = 0; i < 60 && !alvo; i++) {
  try {
    alvo = await (
      await fetch(`http://127.0.0.1:${PORTA}/json/new?about:blank`, { method: "PUT" })
    ).json();
  } catch {
    await espera(200);
  }
}
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pend = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pend.has(msg.id)) {
    const { ok, falha } = pend.get(msg.id);
    pend.delete(msg.id);
    msg.error ? falha(new Error(msg.error.message)) : ok(msg.result);
  }
});
const cdp = (method, params = {}) =>
  new Promise((ok, falha) => {
    const id = ++seq;
    pend.set(id, { ok, falha });
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (e) =>
  (await cdp("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result
    .value;
await cdp("Page.enable");
await cdp("Network.enable");
const host = new URL(BASE).hostname;
const ref = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
const valor = encodeURIComponent(JSON.stringify(s)).match(/.{1,3200}/g);
for (let i = 0; i < valor.length; i++)
  await cdp("Network.setCookie", {
    name: `sb-${ref}-auth-token.${i}`,
    value: valor[i],
    domain: host,
    path: "/",
  });
await cdp("Network.setCookie", { name: "pb_tema", value: "claro", domain: host, path: "/" });
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});
const foto = async (nome) => {
  const p = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SAIDA, `${nome}.png`), Buffer.from(p.data, "base64"));
};
const esperarAte = async (expr, s = 120) => {
  for (let i = 0; i < s; i++) {
    if (await avaliar(expr)) return true;
    await espera(1000);
  }
  return false;
};
const lerTabela = () =>
  avaliar(`(() => { const t = [...document.querySelectorAll('section[aria-label="Área visual"] table')].at(-1); if (!t) return null;
    const cab = [...t.querySelectorAll('thead th')].map(th => th.textContent.trim());
    return [...t.querySelectorAll('tbody tr')].map(tr => Object.fromEntries([...tr.querySelectorAll('td')].map((td,i) => [cab[i], td.textContent.trim()]))); })()`);
const reais = (t) => (t === "—" ? null : Number(t.replace(/[^\d,-]/g, "").replace(",", ".")));
const comparar = async (rotulo, base) => {
  const tab = await lerTabela();
  const exp = await esperado(base);
  let diferencas = 0;
  let celulas = 0;
  for (const linha of tab ?? [])
    for (const u of ["Curitiba", "Belém"]) {
      const k = `${linha["Mês"]}|${u}`;
      celulas++;
      const tela = reais(linha[u]);
      const sql = exp[k] ?? null;
      if (tela === null ? sql !== null : Math.abs(tela - (sql ?? NaN)) > 0.005 || sql === null)
        diferencas++;
    }
  confere(
    `${rotulo}: tabela × SQL independente`,
    !!tab && celulas === 6 && diferencas === 0,
    `${celulas} células, ${diferencas} diferenças`,
  );
};

await cdp("Page.navigate", { url: `${BASE}/cockpit-ceo/perguntar?visao=${visaoId}` });
confere(
  "reabrir a visão salva consulta de novo",
  await esperarAte(
    `!!document.querySelector('section[aria-label="Área visual"] table') && /consultada agora/.test(document.body.innerText)`,
    180,
  ),
);
await espera(1500);
await foto("percurso-1-visao-salva");
await comparar("visão reaberta (base nova + antiga)", "todas");

// Troca a base pelo controle da tela (Select do Radix: abre o gatilho e escolhe a opção).
await avaliar(
  `document.querySelector('[aria-label="Base"]').dispatchEvent(new PointerEvent('pointerdown', {bubbles:true, button:0, pointerType:'mouse'}))`,
);
await espera(600);
await avaliar(
  `[...document.querySelectorAll('[role="option"]')].find(o => o.textContent.trim() === 'Base nova')?.click()`,
);
confere(
  "controle de base refaz a consulta sem o modelo",
  await esperarAte(
    `/Filtros alterados/.test(document.body.innerText) && !/Consultando com o seu acesso/.test(document.body.innerText)`,
    120,
  ),
);
await espera(1500);
await foto("percurso-2-base-nova");
await comparar("depois do controle (só base nova)", "nova");
confere(
  "filtro aplicado aparece no bloco",
  await avaliar(
    `/Base nova/.test(document.querySelector('section[aria-label="Área visual"]').innerText)`,
  ),
);

// Renomear e excluir com a própria sessão (as mesmas tabelas que a tela usa).
const ren = await db
  .from("cockpit_visoes")
  .update({ nome: "Percurso renomeado" })
  .eq("id", visaoId)
  .select("nome")
  .single();
confere("renomear", ren.data?.nome === "Percurso renomeado", ren.error?.message);
const del = await db.from("cockpit_visoes").delete({ count: "exact" }).eq("id", visaoId);
confere("excluir", del.count === 1, del.error?.message);
await cdp("Page.navigate", { url: `${BASE}/cockpit-ceo/perguntar?visao=${visaoId}` });
confere(
  "visão excluída não abre",
  await esperarAte(`/Visão não encontrada/.test(document.body.innerText)`, 60),
);
await foto("percurso-3-excluida");

writeFileSync(join(SAIDA, "percurso.json"), JSON.stringify(resultados, null, 2));
ws.close();
chrome.kill();
const falhas = resultados.filter((r) => !r.ok).length;
console.log(falhas ? `${falhas} falha(s)` : "percurso completo sem falha");
process.exit(falhas ? 1 : 0);
