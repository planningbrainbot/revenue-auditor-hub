#!/usr/bin/env node
/**
 * Captura das telas REAIS do Ops (com login) para o comparativo antes/depois da migração DS v2.
 *
 *   node capturar-telas.mjs login    <porta>                      # abre um Chrome visível para o login (uma vez)
 *   node capturar-telas.mjs capturar <porta> <saida> <rota...>    # fotografa cada rota, escuro e claro
 *
 * O login fica num perfil próprio e persistente (PERFIL). A sessão do Supabase mora num cookie
 * de localhost (cookie-storage.ts); todo worktree sobe na MESMA porta, um por vez, para a
 * origem ser a mesma. O tema é o `pb:tema` do localStorage
 * (src/lib/tema-compartilhado.ts).
 *
 * Nunca capture /royalties/$unidadeId/$mes: abrir a ficha cria a apuração no banco.
 * CDP pelo WebSocket nativo do Node 22 (mesma técnica de scripts/design/capturar.mjs).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PERFIL = join(homedir(), ".cache", "ds-v2-captura-perfil");
const LARGURA = 1440;
const ALTURA = 900;
const PORTA_CDP = 9344;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const [modo, porta, ...resto] = process.argv.slice(2);
if (!["login", "capturar"].includes(modo) || !porta) {
  console.error("uso: capturar-telas.mjs login <porta> | capturar <porta> <saida> <rota...>");
  process.exit(1);
}
const base = `http://localhost:${porta}`;
mkdirSync(PERFIL, { recursive: true });

if (modo === "login") {
  spawn(CHROME, [`--user-data-dir=${PERFIL}`, "--no-first-run", `${base}/auth`], {
    detached: true,
    stdio: "ignore",
  }).unref();
  console.log(`Chrome aberto em ${base}/auth. Faça login e FECHE o Chrome antes de capturar.`);
  process.exit(0);
}

const [saida, ...rotas] = resto;
mkdirSync(saida, { recursive: true });

async function esperarHttp(url, ms = 60_000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await esperar(500);
  }
  throw new Error(`${url} não respondeu`);
}

function conectar(ws) {
  return new Promise((ok, falha) => {
    const s = new WebSocket(ws);
    let id = 0;
    const pend = new Map();
    const ouv = new Map();
    s.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) {
        const { res, rej } = pend.get(m.id);
        pend.delete(m.id);
        m.error ? rej(new Error(m.error.message)) : res(m.result);
      } else if (m.method && ouv.has(m.method)) for (const f of ouv.get(m.method).splice(0)) f(m.params);
    };
    s.onerror = () => falha(new Error("DevTools"));
    s.onopen = () =>
      ok({
        enviar: (method, params = {}) =>
          new Promise((res, rej) => {
            const n = ++id;
            pend.set(n, { res, rej });
            s.send(JSON.stringify({ id: n, method, params }));
          }),
        umaVez: (method) =>
          new Promise((res) => {
            if (!ouv.has(method)) ouv.set(method, []);
            ouv.get(method).push(res);
          }),
        fechar: () => s.close(),
      });
  });
}

const nomeArquivo = (rota) =>
  rota.replace(/^\//, "").replace(/[?&=/]+/g, "_").replace(/_+$/, "") || "raiz";

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    `--remote-debugging-port=${PORTA_CDP}`,
    `--user-data-dir=${PERFIL}`,
    "about:blank",
  ],
  { detached: true, stdio: "ignore" },
);
const fim = () => {
  try {
    process.kill(-chrome.pid, "SIGTERM");
  } catch {}
};
process.on("exit", fim);

try {
  await esperarHttp(`http://127.0.0.1:${PORTA_CDP}/json/version`, 30_000);
  const alvos = await (await fetch(`http://127.0.0.1:${PORTA_CDP}/json/list`)).json();
  const cdp = await conectar(alvos.find((a) => a.type === "page").webSocketDebuggerUrl);
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");
  const avaliar = async (expr) =>
    (await cdp.enviar("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result
      .value;
  const viewport = (h) =>
    cdp.enviar("Emulation.setDeviceMetricsOverride", { width: LARGURA, height: h, deviceScaleFactor: 1, mobile: false });
  const foto = async (arq) => {
    const { data } = await cdp.enviar("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(saida, arq), Buffer.from(data, "base64"));
  };
  const ir = async (url) => {
    const carregou = cdp.umaVez("Page.loadEventFired");
    await cdp.enviar("Page.navigate", { url });
    await Promise.race([carregou, esperar(20_000)]);
  };

  await viewport(ALTURA);
  await ir(`${base}/`);
  // A sessão mora em cookie (src/integrations/supabase/cookie-storage.ts), sem Domain em localhost.
  const logado = await avaliar("document.cookie.includes('auth-token')");
  if (!logado) throw new Error("sem sessão: rode `login` primeiro e feche o Chrome");

  for (const tema of ["escuro", "claro"]) {
    // O cookie pb_tema vence o localStorage (lib/tema-compartilhado.ts): grava os dois.
    await avaliar(`localStorage.setItem('pb:tema', ${JSON.stringify(tema)}); document.cookie = 'pb_tema=${tema}; path=/; max-age=31536000'`);
    for (const rota of rotas) {
      const nome = nomeArquivo(rota);
      if (existsSync(join(saida, `${nome}--${tema}-pagina.png`))) { console.log(`  ${nome} (${tema}) já existe`); continue; }
      // A página pode se recarregar sozinha (o vite otimiza dependências na primeira visita): tenta de novo.
      for (let tentativa = 1; tentativa <= 4; tentativa++) {
        try {
          await viewport(ALTURA);
          await ir(`${base}${rota}`);
          // Espera a hidratação, as fontes e as consultas: até 25 s ou até sumirem os esqueletos.
          await avaliar(`(async () => {
            const fim = Date.now() + ${Number(process.env.ESPERA_MS || 45000)};
            await new Promise(r => setTimeout(r, 2500));
            while (Date.now() < fim) {
              const carregando = document.querySelector('[aria-busy="true"], .animate-pulse, .skeleton-shimmer')
                || [...document.querySelectorAll('[role="status"]')].some(n => /Carregando/.test(n.textContent || ''));
              // Página em branco (primeira compilação do vite) também é "carregando".
              const vazia = !document.querySelector('h1') || (document.body.innerText || '').trim().length < 40;
              if (!carregando && !vazia) break;
              await new Promise(r => setTimeout(r, 500));
            }
            await document.fonts.ready;
            await new Promise(r => setTimeout(r, 1500));
          })()`);
          const aindaCarregando = await avaliar(`!!(document.querySelector('[aria-busy="true"], .animate-pulse, .skeleton-shimmer') || [...document.querySelectorAll('[role="status"]')].some(n => /Carregando/.test(n.textContent || '')))`);
          if (aindaCarregando) console.log(`  AVISO ${nome} (${tema}): ainda carregando no fim da espera`);
          await foto(`${nome}--${tema}-viewport.png`);
          const h = await avaliar("Math.min(document.documentElement.scrollHeight, 12000)");
          await viewport(h);
          await esperar(700);
          await foto(`${nome}--${tema}-pagina.png`);
          console.log(`  ${nome} (${tema})`);

          break;
        } catch (e) {
          if (tentativa === 4) { console.error(`  ${nome} (${tema}) FALHOU: ${e.message}`); break; }
          await esperar(4000);
        }
      }
    }
  }
  cdp.fechar();
  fim();
  process.exit(0);
} catch (e) {
  console.error(e.message);
  fim();
  process.exit(1);
}
