// Teste real do "Perguntar ao Brain" do Cockpit do COO (29/09/2026): UMA pergunta, pela tela.
//
// Uso: SESSAO_EMAIL=… node scripts/cockpit-coo/capturas.mjs <base> <saida>
//   A sessão da conta é aberta por link mágico (scripts/cockpit-ceo/_sessao.mjs) só na memória
//   deste processo. Ambiente: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY.
//   As capturas têm dado real: a saída fica FORA do repositório.
//
// Confere em cada tema: h1 do tema, números (até 6), caixa de atenção (até 3 itens), bloco de OKRs,
// gráfico, nenhuma exceção de JavaScript, e a gaveta abrindo pelo clique no primeiro número.
// Não clica em nada que grave (Virar compromisso, ações da fila).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [BASE, SAIDA] = process.argv.slice(2);
if (!BASE || !SAIDA) throw new Error("uso: capturas.mjs <base> <saida>");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORTA = 9734 + Math.floor(Math.random() * 200);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SAIDA, { recursive: true });
const perfil = mkdtempSync(join(tmpdir(), "cockpit-coo-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${PORTA}`,
  `--user-data-dir=${perfil}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "about:blank",
]);
let alvo;
for (let i = 0; i < 160 && !alvo; i++) {
  try {
    alvo = await (await fetch(`http://127.0.0.1:${PORTA}/json/new?about:blank`, { method: "PUT" })).json();
  } catch {
    await espera(250);
  }
}
if (!alvo) throw new Error("Chrome não abriu a porta de depuração.");
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pendentes = new Map();
let erros = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendentes.has(msg.id)) {
    const { ok, falha } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    msg.error ? falha(new Error(msg.error.message)) : ok(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown")
    erros.push(msg.params.exceptionDetails.exception?.description?.split("\n")[0] || msg.params.exceptionDetails.text);
});
const cdp = (method, params = {}) =>
  new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (e) =>
  (await cdp("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");

const host = new URL(BASE).hostname;
if (process.env.SESSAO_EMAIL) {
  const { abrirSessao } = await import("../cockpit-ceo/_sessao.mjs");
  const sessao = await abrirSessao(process.env.SESSAO_EMAIL);
  const ref = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  const valor = encodeURIComponent(JSON.stringify(sessao));
  const pedacos = valor.match(/.{1,3200}/g);
  for (let i = 0; i < pedacos.length; i++)
    await cdp("Network.setCookie", { name: `sb-${ref}-auth-token.${i}`, value: pedacos[i], domain: host, path: "/" });
}
await cdp("Network.setCookie", { name: "pb_tema", value: process.env.TEMA_VISUAL || "claro", domain: host, path: "/" });
await cdp("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

// Depois de o Vite recompilar, a primeira foto pode pegar o HTML do servidor com o gráfico ainda
// sem traço (memória do Cockpit do CEO, 28/09): espera haver traço em todo gráfico da página.
const GRAFICOS_DESENHADOS = `(() => { const ws = [...document.querySelectorAll('main .recharts-wrapper')]; return ws.length > 0 && ws.every((w) => w.querySelector('path.recharts-curve, path.recharts-rectangle, rect.recharts-rectangle')); })()`;

async function abrir(rota, pronto) {
  await cdp("Page.navigate", { url: BASE + rota });
  let quietos = 0;
  for (let i = 0; i < 300 && quietos < 4; i++) {
    await espera(1000);
    const ok = await avaliar(
      `(${pronto}) && ${GRAFICOS_DESENHADOS} && !document.querySelector('[aria-busy="true"], .animate-spin, .animate-pulse')`,
    ).catch(() => false);
    quietos = ok ? quietos + 1 : 0;
  }
  await espera(1500);
}

async function foto(nome) {
  const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(SAIDA, `${nome}-viewport.png`), Buffer.from(data, "base64"));
  // Página inteira SEM redimensionar a janela: redimensionar fazia o ResponsiveContainer do
  // Recharts medir largura zero e a foto saía com o gráfico em branco (29/09).
  const altura = await avaliar("document.documentElement.scrollHeight");
  const pagina = await cdp("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
    clip: { x: 0, y: 0, width: 1440, height: Math.min(altura, 6000), scale: 1 },
  });
  writeFileSync(join(SAIDA, `${nome}-pagina.png`), Buffer.from(pagina.data, "base64"));
  return altura;
}


const PERGUNTA = process.env.PERGUNTA || "Quanto tempo de caixa o grupo tem no ritmo atual, e qual unidade está com apuração fechada sem fatura?";
await abrir("/cockpit-coo/perguntar?tema=financeiro-operacoes", "!!document.querySelector('textarea')");
await avaliar(`(() => {
  const t = document.querySelector('textarea');
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  set.call(t, ${JSON.stringify(PERGUNTA)});
  t.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
await espera(500);
await avaliar(`document.querySelector('form button[type=submit]').click()`);
const t0 = Date.now();
let resposta = null;
for (let i = 0; i < 180 && !resposta; i++) {
  await espera(1000);
  resposta = await avaliar(`(() => {
    const cards = [...document.querySelectorAll('main ol > li')].filter((li) => li.querySelector('div.rounded-xl'));
    if (!cards.length) return null;
    const ultimo = cards[cards.length - 1].querySelector('div.rounded-xl');
    return { texto: ultimo.innerText.slice(0, 2500) };
  })()`);
}
const { data } = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: Math.min(await avaliar("document.documentElement.scrollHeight"), 4000), scale: 1 } });
writeFileSync(join(SAIDA, "perguntar-resposta.png"), Buffer.from(data, "base64"));
console.log(JSON.stringify({ segundos: Math.round((Date.now() - t0) / 1000), resposta, erros }, null, 1));
ws.close();
chrome.kill();
await espera(1500);
try { rmSync(perfil, { recursive: true, force: true }); } catch {}
