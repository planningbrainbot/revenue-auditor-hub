// Capturas e medições da Visão executiva e do "Perguntar ao Brain" por Chrome DevTools Protocol,
// em 1280×800 e 1440×900, temas claro e escuro.
//
// Uso:
//   node scripts/cockpit-ceo/leitura-capturas.mjs <base> <saida> <rotulo> <rota> [<rota>…]
//   SESSAO_EMAIL=… (opcional) abre a sessão da conta por link mágico (scripts/cockpit-ceo/_sessao.mjs)
//   e injeta no cookie do app, só na memória deste processo. Sem ela, só rotas sem login (preview).
//
// Mede, por vista: largura do documento × janela (corte lateral), quantos cartões de número e se o
// gráfico principal e a caixa de atenção terminam acima da dobra, e erros do console.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [BASE, SAIDA, ROTULO, ...ROTAS] = process.argv.slice(2);
if (!BASE || !SAIDA || !ROTAS.length) {
  console.error("uso: leitura-capturas.mjs <base> <saida> <rotulo> <rota>…");
  process.exit(2);
}
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORTA = 9334 + Math.floor(Math.random() * 200);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
const VISTAS = [
  { largura: 1280, altura: 800 },
  { largura: 1440, altura: 900 },
];
const TEMAS = ["claro", "escuro"];

mkdirSync(SAIDA, { recursive: true });
const perfil = mkdtempSync(join(tmpdir(), "cockpit-leitura-"));
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
for (let i = 0; i < 60 && !alvo; i++) {
  try {
    alvo = await (
      await fetch(`http://127.0.0.1:${PORTA}/json/new?about:blank`, { method: "PUT" })
    ).json();
  } catch {
    await espera(200);
  }
}
if (!alvo) throw new Error("Chrome não abriu a porta de depuração.");
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pendentes = new Map();
const erros = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendentes.has(msg.id)) {
    const { ok, falha } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    msg.error ? falha(new Error(msg.error.message)) : ok(msg.result);
    return;
  }
  if (msg.method === "Runtime.exceptionThrown")
    erros.push(
      msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
    );
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    erros.push(
      msg.params.args
        .map((a) => a.value ?? a.description)
        .join(" ")
        .slice(0, 300),
    );
});
const cdp = (method, params = {}) =>
  new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (e) =>
  (await cdp("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result
    .value;
await cdp("Page.enable");
await cdp("Runtime.enable");
await cdp("Network.enable");

const host = new URL(BASE).hostname;
if (process.env.SESSAO_EMAIL) {
  const { abrirSessao } = await import("./_sessao.mjs");
  const s = await abrirSessao(process.env.SESSAO_EMAIL);
  const ref = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  const chave = `sb-${ref}-auth-token`;
  const valor = encodeURIComponent(JSON.stringify(s));
  const pedacos = valor.match(/.{1,3200}/g);
  for (let i = 0; i < pedacos.length; i++)
    await cdp("Network.setCookie", {
      name: `${chave}.${i}`,
      value: pedacos[i],
      domain: host,
      path: "/",
    });
}

const medir = () =>
  avaliar(`(() => {
    const vh = innerHeight;
    const r = (el) => el && el.getBoundingClientRect();
    const kpis = [...document.querySelectorAll('main [class*="rounded-xl"][class*="border"]')].filter(e => e.querySelector('.num.text-\\\\[30px\\\\]'));
    const titulo = (t) => [...document.querySelectorAll('h2,h3')].find(h => h.textContent.includes(t));
    const caixa = (t) => titulo(t)?.closest('section');
    const g = caixa('faturamento evoluiu'), a = caixa('pede sua atenção');
    return {
      larguraDoc: document.documentElement.scrollWidth, janela: innerWidth,
      alturaPagina: document.documentElement.scrollHeight,
      cartoesNaDobra: kpis.filter(k => r(k).bottom <= vh).length,
      cartoes: kpis.length,
      graficoAcimaDaDobra: g ? Math.round(r(g).bottom) <= vh : null, graficoFim: g ? Math.round(r(g).bottom) : null,
      atencaoAcimaDaDobra: a ? Math.round(r(a).bottom) <= vh : null, atencaoFim: a ? Math.round(r(a).bottom) : null,
      menorFonte: Math.min(...[...document.querySelectorAll('main *')].filter(e => e.childNodes.length && [...e.childNodes].some(n => n.nodeType===3 && n.textContent.trim())).map(e => parseFloat(getComputedStyle(e).fontSize))),
      naoApurado: /não apurado/i.test(document.querySelector('main')?.innerText.slice(0, 3000) || ''),
    };
  })()`);

const relatorio = [];
for (const rota of ROTAS) {
  const nome = rota.replace(/^\//, "").replace(/[/?=&]+/g, "-") || "raiz";
  for (const tema of TEMAS) {
    await cdp("Network.setCookie", { name: "pb_tema", value: tema, domain: host, path: "/" });
    for (const v of VISTAS) {
      await cdp("Emulation.setDeviceMetricsOverride", {
        width: v.largura,
        height: v.altura,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp("Page.navigate", { url: BASE + rota });
      // Espera a carga real (várias fontes) assentar: nada de "Carregando" nem spinner por 2 s.
      for (let i = 0; i < 180; i++) {
        await espera(1000);
        const ocupado = await avaliar(
          `!!document.querySelector('[aria-busy="true"], .animate-spin') || [...document.querySelectorAll('[role=status]')].some((e) => /Carregando|Consultando|Abrindo/.test(e.textContent)) || !document.querySelector('main h1')`,
        );
        if (!ocupado && i > 3) break;
      }
      await espera(1500);
      const m = await medir();
      const png = await cdp("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width: v.largura, height: v.altura, scale: 1 },
      });
      const arq = `${ROTULO}-${nome}-${tema}-${v.largura}x${v.altura}.png`;
      writeFileSync(join(SAIDA, arq), Buffer.from(png.data, "base64"));
      if (v.largura === 1440) {
        const alt = Math.min(6000, m.alturaPagina);
        await cdp("Emulation.setDeviceMetricsOverride", {
          width: 1440,
          height: alt,
          deviceScaleFactor: 1,
          mobile: false,
        });
        await espera(800);
        const p = await cdp("Page.captureScreenshot", {
          format: "png",
          clip: { x: 0, y: 0, width: 1440, height: alt, scale: 1 },
        });
        writeFileSync(
          join(SAIDA, `${ROTULO}-${nome}-${tema}-pagina.png`),
          Buffer.from(p.data, "base64"),
        );
      }
      relatorio.push({ rota, tema, vista: `${v.largura}x${v.altura}`, ...m });
      console.log(JSON.stringify(relatorio.at(-1)));
    }
  }
}
writeFileSync(
  join(SAIDA, `${ROTULO}-medicoes.json`),
  JSON.stringify({ relatorio, erros: [...new Set(erros)] }, null, 2),
);
if (erros.length) console.log("erros do console:", [...new Set(erros)].slice(0, 8));
ws.close();
chrome.kill();
await espera(500);
try {
  rmSync(perfil, { recursive: true, force: true });
} catch {
  /* o Chrome ainda solta arquivos; a pasta temporária fica para o sistema */
}
