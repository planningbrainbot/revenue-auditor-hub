// Capturas e aceite visual do Cockpit do COO (29/09/2026), por Chrome DevTools Protocol.
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

const relatorio = [];
// TEMAS=monetizacao,estrategico captura só esses (e pula as telas de execução).
const TEMAS = process.env.TEMAS ? process.env.TEMAS.split(",") : ["growth", "financeiro-operacoes", "cs-rh", "monetizacao", "estrategico"];
for (const tema of TEMAS) {
  erros = [];
  const t0 = Date.now();
  await abrir(`/cockpit-coo?tema=${tema}`, `document.querySelectorAll('main h2').length >= 3 || !!document.querySelector('main [data-estado-erro], main .text-danger')`);
  const leitura = await avaliar(`(() => {
    const txt = (el) => (el?.textContent || '').trim().replace(/\\s+/g, ' ');
    const cards = [...document.querySelectorAll('main a[href], main button')].filter((b) => /Ver explicação/.test(b.textContent || '') || b.getAttribute('aria-label')?.includes('Ver explicação'));
    const atencao = document.querySelector('#coo-atencao')?.closest('section');
    return {
      h1: txt(document.querySelector('h1')),
      universo: txt(document.querySelector('main header p')),
      numeros: document.querySelectorAll('main .grid > *').length,
      atencao: atencao ? atencao.querySelectorAll('li').length : null,
      atencaoTexto: atencao ? [...atencao.querySelectorAll('li')].map((l) => txt(l).slice(0, 110)) : [],
      okrs: !!document.querySelector('main')?.textContent?.includes('Como evoluem os OKRs'),
      graficos: document.querySelectorAll('main .recharts-wrapper').length,
      semAcesso: (document.querySelector('main')?.textContent || '').match(/Sem acesso|Acesso insuficiente/g)?.length ?? 0,
      naoApurado: (document.querySelector('main')?.textContent || '').match(/Não apurado/g)?.length ?? 0,
    };
  })()`);
  const altura = await foto(tema);
  // Gaveta: primeiro número clicável.
  const abriu = await avaliar(`(async () => {
    const alvo = [...document.querySelectorAll('main button, main a')].find((b) => /Ver explicação|Abrir registros/.test(b.textContent || '') || /Ver explicação/.test(b.getAttribute('aria-label') || ''));
    if (!alvo) return 'sem alvo';
    alvo.click();
    await new Promise((r) => setTimeout(r, 1500));
    const d = document.querySelector('[role=dialog]');
    return d ? (d.querySelector('h2')?.textContent || 'dialog') : 'não abriu';
  })()`);
  if (typeof abriu === "string" && abriu !== "sem alvo" && abriu !== "não abriu") {
    const { data } = await cdp("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SAIDA, `${tema}-gaveta.png`), Buffer.from(data, "base64"));
  }
  const r = { tema, segundos: Math.round((Date.now() - t0) / 1000), altura, ...leitura, gaveta: abriu, erros: [...new Set(erros)].slice(0, 5) };
  relatorio.push(r);
  console.log(JSON.stringify(r));
}

for (const [nome, rota, pronto] of process.env.TEMAS ? [] : [
  ["compromissos", "/cockpit-coo/compromissos", "!!document.querySelector('h1')"],
  ["perguntar", "/cockpit-coo/perguntar?tema=financeiro-operacoes", "!!document.querySelector('textarea')"],
]) {
  erros = [];
  await abrir(rota, pronto);
  const altura = await foto(nome);
  const r = { tela: nome, altura, h1: await avaliar(`document.querySelector('h1')?.textContent`), erros: [...new Set(erros)].slice(0, 5) };
  relatorio.push(r);
  console.log(JSON.stringify(r));
}

writeFileSync(join(SAIDA, "relatorio.json"), JSON.stringify(relatorio, null, 2));
ws.close();
chrome.kill();
await espera(1500);
try {
  rmSync(perfil, { recursive: true, force: true });
} catch {
  // o Chrome ainda fechando: a pasta temporária fica para o sistema limpar
}
