#!/usr/bin/env node
// Fotografa o preview sintético do Cockpit do CEO nos temas escuro e claro, para o comparativo
// antes/depois do Design System v2.
//
//   node scripts/cockpit-ceo/capturar-ds.mjs <rotulo>     # ex.: antes, depois
//
// Grava em docs/design/capturas/cockpit-ceo/<rotulo>/<tema>-<vista>-{viewport,pagina}.png, onde
// <vista> é "executiva" e cada frente (?frente=…). Sobe o próprio `vite dev` com a mesma
// configuração do scripts/cockpit-ceo/preview.sh (Supabase morto, Jev desligado) e usa CDP pelo
// mesmo motivo do scripts/design/capturar.mjs: o headless deste Mac ignora --window-size.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LARGURA = 1440;
const ALTURA = 900;
const TEMAS = { escuro: "escuro", claro: "claro" };
const VISTAS = [
  ["executiva", ""],
  // As nove frentes da versão empresarial (23/09), na ordem da lateral.
  ...[
    "receita",
    "comercial",
    "clientes",
    "retencao",
    "operacao",
    "rede",
    "portfolio",
    "caixa",
    "capital",
  ].map((f) => [f, `?frente=${f}`]),
];

const rotulo = process.argv[2];
if (!rotulo || !/^[\w-]+$/.test(rotulo)) {
  console.error("uso: node scripts/cockpit-ceo/capturar-ds.mjs <rotulo>");
  process.exit(1);
}
const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const destino = join(raiz, "docs/design/capturas/cockpit-ceo", rotulo);
mkdirSync(destino, { recursive: true });
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const portaLivre = () =>
  new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });

const portaVite = await portaLivre();
const vite = spawn(
  join(raiz, "node_modules/.bin/vite"),
  ["dev", "--host", "127.0.0.1", "--port", String(portaVite), "--strictPort"],
  {
    cwd: raiz,
    stdio: "ignore",
    detached: true,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "http://127.0.0.1:9",
      VITE_SUPABASE_PUBLISHABLE_KEY: "piloto-sem-supabase",
      SUPABASE_URL: "http://127.0.0.1:9",
      SUPABASE_PUBLISHABLE_KEY: "piloto-sem-supabase",
      COCKPIT_JEV_PILOTO: "",
      NODE_OPTIONS: "--max-old-space-size=8192",
    },
  },
);
const base = `http://127.0.0.1:${portaVite}/piloto/cockpit-ceo`;
let pronto = false;
for (let i = 0; i < 120 && !pronto; i++) {
  await esperar(1000);
  pronto = await fetch(base)
    .then((r) => r.ok)
    .catch(() => false);
}
if (!pronto) {
  process.kill(-vite.pid);
  throw new Error("vite não respondeu em 120 s");
}

const portaCdp = await portaLivre();
const perfil = mkdtempSync(join(tmpdir(), "cockpit-ds-"));
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${portaCdp}`,
  `--user-data-dir=${perfil}`,
  "--no-first-run",
  "--hide-scrollbars",
  "about:blank",
]);
let alvo;
for (let i = 0; i < 50 && !alvo; i++) {
  try {
    alvo = await (
      await fetch(`http://127.0.0.1:${portaCdp}/json/new?about:blank`, { method: "PUT" })
    ).json();
  } catch {
    await esperar(200);
  }
}
const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pendentes = new Map();
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendentes.has(msg.id)) {
    const { ok, falha } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    msg.error ? falha(new Error(msg.error.message)) : ok(msg.result);
  }
});
const cdp = (method, params = {}) =>
  new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (expr) =>
  (await cdp("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))
    .result.value;
const foto = async (arquivo, altura = ALTURA) => {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: LARGURA,
    height: altura,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await esperar(400);
  const { data } = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(destino, arquivo), Buffer.from(data, "base64"));
};

await cdp("Page.enable");
await cdp("Runtime.enable");
const gravadas = [];
for (const [tema, modo] of Object.entries(TEMAS)) {
  const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", {
    // O cookie vence o localStorage no script de tema da casa, e o app regrava o cookie: os dois.
    source: `try { document.cookie = "pb_tema=${modo}; path=/"; localStorage.setItem("pb:tema", "${modo}"); } catch {}`,
  });
  for (const [vista, busca] of VISTAS) {
    await cdp("Emulation.setDeviceMetricsOverride", {
      width: LARGURA,
      height: ALTURA,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp("Page.navigate", { url: base + busca });
    // Espera o conteúdo, não um tempo fixo: na primeira carga o Vite ainda otimiza dependências.
    for (let i = 0; i < 60 && !(await avaliar("!!document.querySelector('main h1')")); i++)
      await esperar(500);
    await esperar(1200);
    // O tema tem de ser o pedido: a foto de "claro" com a página escura já enganou uma vez.
    const escuro = await avaliar("document.documentElement.classList.contains('dark')");
    if (escuro !== (modo === "escuro")) throw new Error(`${tema}/${vista}: tema aplicado não bate`);
    await foto(`${tema}-${vista}-viewport.png`);
    const altura = Math.min(await avaliar("document.documentElement.scrollHeight"), 12000);
    await foto(`${tema}-${vista}-pagina.png`, altura);
    gravadas.push(`${tema}-${vista}`);
  }
  await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
}
ws.close();
await new Promise((r) => {
  chrome.once("exit", r);
  chrome.kill();
});
rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
process.kill(-vite.pid);
console.log(`${gravadas.length} vistas × 2 imagens em ${destino.replace(raiz + "/", "")}`);
process.exit(0);
