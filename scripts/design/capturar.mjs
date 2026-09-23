#!/usr/bin/env node
/**
 * Fotografa a vitrine (/vitrine) nos temas escuro e claro.
 *
 *   node scripts/design/capturar.mjs <rotulo>      # ex.: antes, depois
 *
 * Grava em docs/design/capturas/<rotulo>/:
 *   <tema>-viewport.png   1440×900, o que a pessoa vê ao abrir
 *   <tema>-pagina.png     página inteira, 1440 de largura
 *   <tema>-<secao>.png    recorte de cada seção (#casca, #controles, …)
 *
 * Como funciona: sobe `vite dev` numa porta livre, espera /vitrine responder
 * 200, abre o Chrome headless e fala com ele pelo DevTools Protocol, e no fim
 * derruba os dois.
 *
 * Por que CDP e não `chrome --screenshot`: neste Mac o headless ignora
 * `--window-size` e renderiza a ~485px de largura, o que já invalidou medição
 * antes. `Emulation.setDeviceMetricsOverride` fixa a largura de verdade, e com
 * ela dá para esticar a altura até o `scrollHeight` (página inteira) e recortar
 * cada seção pelo retângulo da âncora, sem depender de altura prevista.
 * Usa o WebSocket nativo do Node 22; nenhuma dependência nova.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LARGURA = 1440;
const ALTURA = 900;
const SECOES = ["casca", "controles", "dados", "graficos", "estados"];
const TEMAS = ["escuro", "claro"];

const rotulo = process.argv[2];
if (!rotulo || !/^[\w-]+$/.test(rotulo)) {
  console.error("uso: node scripts/design/capturar.mjs <rotulo>   (ex.: antes, depois)");
  process.exit(1);
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const destino = join(raiz, "docs/design/capturas", rotulo);
mkdirSync(destino, { recursive: true });

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre(inicial) {
  return new Promise((ok, falha) => {
    const tentar = (p) => {
      if (p > inicial + 50) return falha(new Error("nenhuma porta livre"));
      const s = net.createServer();
      s.once("error", () => tentar(p + 1));
      s.once("listening", () => s.close(() => ok(p)));
      s.listen(p, "127.0.0.1");
    };
    tentar(inicial);
  });
}

async function esperarHttp(url, { status = 200, timeoutMs = 120_000 } = {}) {
  const fim = Date.now() + timeoutMs;
  while (Date.now() < fim) {
    try {
      const r = await fetch(url);
      if (r.status === status) return r;
    } catch {
      /* ainda subindo */
    }
    await esperar(500);
  }
  throw new Error(`${url} não respondeu ${status} em ${timeoutMs / 1000}s`);
}

// Cliente CDP mínimo: um id por chamada, eventos por nome.
function conectarCdp(wsUrl) {
  return new Promise((ok, falha) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pendentes = new Map();
    const ouvintes = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pendentes.has(msg.id)) {
        const { resolve: res, reject: rej } = pendentes.get(msg.id);
        pendentes.delete(msg.id);
        msg.error ? rej(new Error(`${msg.error.message} (${msg.error.code})`)) : res(msg.result);
      } else if (msg.method && ouvintes.has(msg.method)) {
        for (const f of ouvintes.get(msg.method).splice(0)) f(msg.params);
      }
    };
    ws.onerror = () => falha(new Error("falha ao conectar no DevTools"));
    ws.onopen = () =>
      ok({
        enviar: (method, params = {}) =>
          new Promise((res, rej) => {
            const n = ++id;
            pendentes.set(n, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: n, method, params }));
          }),
        umaVez: (method) =>
          new Promise((res) => {
            if (!ouvintes.has(method)) ouvintes.set(method, []);
            ouvintes.get(method).push(res);
          }),
        fechar: () => ws.close(),
      });
  });
}

const processos = [];
let perfilChrome;
async function encerrar() {
  const saidas = processos.map((p) =>
    p.exitCode !== null || p.signalCode !== null
      ? Promise.resolve()
      : new Promise((ok) => p.once("exit", ok)),
  );
  for (const p of processos) {
    try {
      // Grupo inteiro: `npx` abre filhos, e matar só o pai deixa o vite de pé.
      process.kill(-p.pid, "SIGTERM");
    } catch {
      /* já saiu */
    }
  }
  // O Chrome ainda grava no perfil enquanto fecha; apagar antes dá ENOTEMPTY.
  await Promise.race([Promise.all(saidas), esperar(5000)]);
  if (perfilChrome) {
    try {
      rmSync(perfilChrome, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      /* pasta temporária do sistema; sobrar não quebra nada */
    }
  }
}
process.on("SIGINT", async () => {
  await encerrar();
  process.exit(130);
});

async function main() {
  const portaVite = await portaLivre(5199);
  const portaCdp = await portaLivre(9333);
  const base = `http://localhost:${portaVite}`;

  console.log(`vite dev em ${base}…`);
  const vite = spawn("npx", ["vite", "dev", "--port", String(portaVite), "--strictPort"], {
    cwd: raiz,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
  });
  processos.push(vite);
  let errosVite = "";
  vite.stderr.on("data", (d) => (errosVite = (errosVite + d).slice(-4000)));
  try {
    await esperarHttp(`${base}/vitrine`);
  } catch (e) {
    console.error(errosVite);
    throw e;
  }

  perfilChrome = mkdtempSync(join(tmpdir(), "vitrine-chrome-"));
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${LARGURA},${ALTURA}`,
      `--remote-debugging-port=${portaCdp}`,
      `--user-data-dir=${perfilChrome}`,
      "about:blank",
    ],
    { detached: true, stdio: "ignore" },
  );
  processos.push(chrome);

  await esperarHttp(`http://127.0.0.1:${portaCdp}/json/version`, { timeoutMs: 30_000 });
  const alvos = await (await fetch(`http://127.0.0.1:${portaCdp}/json/list`)).json();
  const pagina = alvos.find((a) => a.type === "page");
  const cdp = await conectarCdp(pagina.webSocketDebuggerUrl);
  await cdp.enviar("Page.enable");
  await cdp.enviar("Runtime.enable");

  const gravar = async (nome, clip) => {
    const { data } = await cdp.enviar("Page.captureScreenshot", {
      format: "png",
      ...(clip ? { clip: { ...clip, scale: 1 } } : {}),
    });
    writeFileSync(join(destino, `${nome}.png`), Buffer.from(data, "base64"));
    console.log(`  ${rotulo}/${nome}.png`);
  };
  const avaliar = async (expr) =>
    (
      await cdp.enviar("Runtime.evaluate", {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  const viewport = (altura) =>
    cdp.enviar("Emulation.setDeviceMetricsOverride", {
      width: LARGURA,
      height: altura,
      deviceScaleFactor: 1,
      mobile: false,
    });

  for (const tema of TEMAS) {
    await viewport(ALTURA);
    const carregou = cdp.umaVez("Page.loadEventFired");
    await cdp.enviar("Page.navigate", {
      url: `${base}/vitrine${tema === "claro" ? "?tema=claro" : ""}`,
    });
    await carregou;
    // Rota com ssr:false: o conteúdo só existe depois da hidratação. Espera a
    // última seção, as fontes do Google e um respiro para o Recharts medir.
    const pronto = await avaliar(`(async () => {
      const fim = Date.now() + 30000;
      while (!document.querySelector('[data-vitrine-secao="estados"]')) {
        if (Date.now() > fim) return false;
        await new Promise(r => setTimeout(r, 200));
      }
      await document.fonts.ready;
      await new Promise(r => setTimeout(r, 1500));
      return true;
    })()`);
    if (!pronto) throw new Error(`vitrine não renderizou (tema ${tema})`);

    await gravar(`${tema}-viewport`);

    const alturaTotal = await avaliar("document.documentElement.scrollHeight");
    await viewport(alturaTotal);
    await avaliar("new Promise(r => setTimeout(r, 800))");
    await gravar(`${tema}-pagina`);

    for (const secao of SECOES) {
      const r = await avaliar(`(() => {
        const el = document.getElementById(${JSON.stringify(secao)});
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height };
      })()`);
      if (!r) throw new Error(`seção #${secao} não encontrada`);
      const m = 16; // margem para a foto não cortar borda e sombra
      await gravar(`${tema}-${secao}`, {
        x: Math.max(0, r.x - m),
        y: Math.max(0, r.y - m),
        width: Math.min(LARGURA, r.width + 2 * m),
        height: r.height + 2 * m,
      });
    }
  }

  cdp.fechar();
}

main()
  .then(async () => {
    await encerrar();
    console.log(`ok: docs/design/capturas/${rotulo}/`);
    process.exit(0);
  })
  .catch(async (e) => {
    await encerrar();
    console.error(e);
    process.exit(1);
  });
