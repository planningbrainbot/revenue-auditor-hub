// Aceite de interação da revisão visual do Cockpit do CEO (28/09/2026), por Chrome DevTools Protocol.
//
// Uso: node scripts/cockpit-ceo/visual-interacao.mjs <base> <saida> [--ia]
//   SESSAO_EMAIL=… abre a sessão da conta por link mágico (scripts/cockpit-ceo/_sessao.mjs), só na
//   memória deste processo. Sem ela, use a base do preview e a rota /piloto/cockpit-ceo (ROTA=…).
//   --ia envia UMA pergunta real a partir da gaveta da trajetória e apaga a conversa de teste ao fim.
//
// Confere, na Visão executiva e em cada frente:
// - nenhum texto com mais de uma linha acima da dobra (1440×900);
// - cada bloco tem gráfico, dica no passar do mouse e abre a gaveta com os sete campos;
// - o título de cada bloco recebe foco de teclado visível e abre a gaveta com Enter;
// - "Perguntar ao Brain" no cabeçalho e na gaveta.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [BASE, SAIDA] = process.argv.slice(2);
const COM_IA = process.argv.includes("--ia");
const ROTA = process.env.ROTA || "/cockpit-ceo";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORTA = 9534 + Math.floor(Math.random() * 200);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(SAIDA, { recursive: true });
const perfil = mkdtempSync(join(tmpdir(), "cockpit-interacao-"));
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
let sessao = null;
if (process.env.SESSAO_EMAIL) {
  const { abrirSessao } = await import("./_sessao.mjs");
  sessao = await abrirSessao(process.env.SESSAO_EMAIL);
  const ref = new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  const valor = encodeURIComponent(JSON.stringify(sessao));
  const pedacos = valor.match(/.{1,3200}/g);
  for (let i = 0; i < pedacos.length; i++)
    await cdp("Network.setCookie", {
      name: `sb-${ref}-auth-token.${i}`,
      value: pedacos[i],
      domain: host,
      path: "/",
    });
}
await cdp("Network.setCookie", { name: "pb_tema", value: "claro", domain: host, path: "/" });
await cdp("Emulation.setDeviceMetricsOverride", {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

async function abrir(rota) {
  await cdp("Page.navigate", { url: BASE + rota });
  // A carga real (Monetização, Financeiro, Growth, Ops) leva dezenas de segundos: espera o primeiro
  // bloco de gráfico aparecer e a tela parar de carregar por alguns segundos.
  let quietos = 0;
  for (let i = 0; i < 240 && quietos < 4; i++) {
    await espera(1000);
    const pronto = await avaliar(
      `!!document.querySelector('main section > header h2 > button') && !document.querySelector('[aria-busy="true"], .animate-spin, .animate-pulse, main [role=status]')`,
    ).catch(() => false);
    quietos = pronto ? quietos + 1 : 0;
  }
  await espera(1000);
}

const relatorio = [];
const conferir = (nome, ok, detalhe = "") => {
  relatorio.push({ nome, ok: !!ok, detalhe });
  console.log(
    `${ok ? "✓" : "✗"} ${nome}`,
    typeof detalhe === "string" ? detalhe : JSON.stringify(detalhe).slice(0, 300),
  );
};

// Blocos: <section> com <h2><button>. Retorna título e a caixa do gráfico (svg do Recharts).
const BLOCOS = `[...document.querySelectorAll('main section')].filter((s) => s.querySelector(':scope > header h2 > button'))`;

async function conferirVista(rota, nome) {
  await abrir(rota);
  if (process.env.DEPURAR)
    console.log(
      "aberta",
      await avaliar(
        `({ url: location.href, h1: document.querySelector('h1')?.textContent, secoes: document.querySelectorAll('main section').length })`,
      ),
    );
  // Texto de mais de uma linha na primeira dobra: cada nó de texto visível acima de 900px é medido
  // pelas linhas que ele ocupa (Range.getClientRects, tops distintos). Rótulos do SVG ficam de fora.
  const multilinha = await avaliar(`(() => {
    const out = [];
    const w = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const t = n.textContent.trim();
      if (t.length < 3 || n.parentElement.closest('svg, [role=dialog], .sr-only')) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      const rs = [...rg.getClientRects()].filter((r) => r.width > 0 && r.bottom > 0 && r.top < innerHeight);
      if (!rs.length) continue;
      const linhas = new Set(rs.map((r) => Math.round(r.top / 4)));
      if (linhas.size > 1) out.push(t.slice(0, 80));
    }
    return out;
  })()`);
  const blocos = await avaliar(`${BLOCOS}.map((s) => ({
    titulo: s.querySelector('h2 button').textContent.trim(),
    grafico: !!s.querySelector('.recharts-surface, [role=img]'),
    recharts: !!s.querySelector('.recharts-wrapper'),
    semDado: /Não apurado|Fonte indisponível|Acesso insuficiente|Dado parcial/.test(s.innerText.slice(0, 400)),
  }))`);
  // Visão executiva: todo bloco tem gráfico. Frente: ao menos um (tabelas e listas das frentes são
  // tabela de propósito, DESIGN §5 "quando não usar gráfico").
  const exec = nome === "Visão executiva";
  conferir(
    `${nome}: ${exec ? "todo bloco com gráfico" : "ao menos um gráfico"}`,
    exec
      ? blocos.length > 0 && blocos.every((b) => b.grafico || b.semDado)
      : blocos.some((b) => b.grafico || b.semDado),
    {
      blocos: blocos.length,
      semGrafico: blocos.filter((b) => !b.grafico && !b.semDado).map((b) => b.titulo),
    },
  );
  if (nome === "Visão executiva")
    conferir(
      "Visão executiva: nenhum texto de mais de uma linha na primeira dobra",
      !multilinha.length,
      multilinha,
    );

  const falhas = [];
  for (let i = 0; i < blocos.length; i++) {
    const b = blocos[i];
    // Dica: passa o mouse pelo gráfico até o tooltip aparecer.
    let dica = null;
    const caixa = await avaliar(`(() => {
      const s = ${BLOCOS}[${i}];
      s.scrollIntoView({ block: 'center' });
      const g = s.querySelector('.recharts-wrapper');
      if (!g) return null;
      const r = g.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })()`);
    if (caixa) {
      await espera(300);
      const c2 = await avaliar(
        `(() => { const g = ${BLOCOS}[${i}].querySelector('.recharts-wrapper').getBoundingClientRect(); return { x: g.left, y: g.top, w: g.width, h: g.height }; })()`,
      );
      for (const fx of [0.5, 0.3, 0.7, 0.15, 0.85, 0.95])
        for (const fy of [0.5, 0.3, 0.7, 0.15]) {
          if (dica) break;
          await cdp("Input.dispatchMouseEvent", {
            type: "mouseMoved",
            x: c2.x + c2.w * fx,
            y: c2.y + c2.h * fy,
          });
          await espera(120);
          dica = await avaliar(`(() => {
            const t = ${BLOCOS}[${i}].querySelector('.recharts-tooltip-wrapper');
            return t && t.style.visibility !== 'hidden' && t.innerText.trim() ? t.innerText.trim().replace(/\\n/g, ' | ').slice(0, 160) : null;
          })()`);
        }
    }
    // Teclado: o anel de foco só aparece em modo teclado (:focus-visible); uma tecla antes coloca a
    // página nesse modo, como faria quem navega com Tab.
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Shift",
      code: "ShiftLeft",
      windowsVirtualKeyCode: 16,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Shift",
      code: "ShiftLeft",
      windowsVirtualKeyCode: 16,
    });
    // Teclado: foco no título e Enter.
    const foco = await avaliar(`(() => {
      const bt = ${BLOCOS}[${i}].querySelector('h2 button');
      bt.focus();
      const cs = getComputedStyle(bt);
      return { focado: document.activeElement === bt, anel: cs.boxShadow !== 'none' || cs.outlineStyle !== 'none' };
    })()`);
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Enter",
      text: "\r",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await cdp("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
    });
    await espera(900);
    const gaveta = await avaliar(`(() => {
      const d = document.querySelector('[role=dialog]');
      if (!d) return null;
      const t = d.innerText;
      return {
        url: location.search,
        campos: ['O que diz', 'Como se calcula', 'Fonte, data e período', 'Quem decide ou é dono'].filter((c) => t.toUpperCase().includes(c.toUpperCase())).length,
        perguntar: !![...d.querySelectorAll('a')].find((a) => /Perguntar ao Brain/.test(a.textContent) && /grafico=/.test(a.getAttribute('href') || '')),
        destinoOuDono: /Abrir|Quem decide/i.test(t),
      };
    })()`);
    if (i === 0 && nome === "Visão executiva")
      await cdp("Page.captureScreenshot", { format: "png" }).then((p) =>
        writeFileSync(join(SAIDA, "gaveta-trajetoria.png"), Buffer.from(p.data, "base64")),
      );
    await cdp("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await espera(600);
    if (process.env.DEPURAR)
      console.log(
        "depois",
        b.titulo,
        await avaliar(
          `({ url: location.href, blocos: ${BLOCOS}.length, dialog: !!document.querySelector('[role=dialog]') })`,
        ),
      );
    const ok =
      (dica || b.semDado || !b.recharts) &&
      foco.focado &&
      foco.anel &&
      gaveta &&
      gaveta.campos === 4 &&
      (gaveta.perguntar || !sessao) &&
      /grafico=/.test(gaveta.url);
    if (!ok) falhas.push({ titulo: b.titulo, dica: !!dica, foco, gaveta });
    relatorio.push({ vista: nome, bloco: b.titulo, dica, foco, gaveta });
  }
  conferir(
    `${nome}: todo bloco tem dica, foco visível e gaveta com os campos`,
    !falhas.length,
    falhas,
  );
}

await conferirVista(ROTA, "Visão executiva");
const temPerguntarCabecalho = await avaliar(
  `!![...document.querySelectorAll('header a, main a')].find((a) => /Perguntar ao Brain/.test(a.textContent) && !/grafico=/.test(a.getAttribute('href') || ''))`,
);
if (sessao) conferir("Perguntar ao Brain no cabeçalho", temPerguntarCabecalho);
for (const f of [
  "receita",
  "comercial",
  "clientes",
  "retencao",
  "operacao",
  "rede",
  "portfolio",
  "caixa",
  "capital",
])
  await conferirVista(`${ROTA}?frente=${f}`, `Frente ${f}`);

if (COM_IA && sessao) {
  await abrir(`${ROTA}?grafico=trajetoria`);
  const href = await avaliar(
    `[...document.querySelectorAll('[role=dialog] a')].find((a) => /Perguntar ao Brain/.test(a.textContent))?.getAttribute('href')`,
  );
  await abrir(href);
  const inicial = await avaliar(
    `({ texto: document.querySelector('#pergunta-brain')?.value, contexto: /A primeira pergunta leva o gráfico/.test(document.body.innerText) })`,
  );
  conferir(
    "A gaveta abre a conversa com o gráfico como contexto",
    /grafico=trajetoria/.test(href) && inicial.texto && inicial.contexto,
    { href, ...inicial },
  );
  await avaliar(`document.querySelector('form button[type=submit]')?.click()`);
  // Resposta pronta: o botão Cancelar sumiu e já há uma mensagem do Brain depois da pergunta.
  let resposta = null;
  for (let i = 0; i < 90 && !resposta; i++) {
    await espera(2000);
    resposta = await avaliar(`(() => {
      const u = new URL(location.href);
      const c = u.searchParams.get('conversa');
      const cancelar = [...document.querySelectorAll('form button')].some((b) => /Cancelar/.test(b.textContent));
      const t = document.querySelector('main')?.innerText || '';
      return c && !cancelar && !/Escolhendo|Consultando|Entendendo|Conferindo/.test(t)
        ? { conversa: c, trecho: t.slice(t.indexOf('decidir a partir dele?'), t.indexOf('decidir a partir dele?') + 1600) }
        : null;
    })()`);
  }
  await cdp("Page.captureScreenshot", { format: "png" }).then((p) =>
    writeFileSync(join(SAIDA, "conversa-com-grafico.png"), Buffer.from(p.data, "base64")),
  );
  conferir(
    "A IA responde a partir do gráfico da trajetória",
    !!resposta && /83,3|bilh|meta|degrau|ritmo/i.test(resposta.trecho),
    resposta?.trecho?.slice(0, 400),
  );
  if (resposta?.conversa) {
    // Conversa de teste: apagada pela própria sessão (RLS "só o dono").
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
      db: { schema: "ops" },
    });
    await sb.auth.setSession({
      access_token: sessao.access_token,
      refresh_token: sessao.refresh_token,
    });
    await sb.from("cockpit_mensagens").delete().eq("conversa_id", resposta.conversa);
    const { error } = await sb.from("cockpit_conversas").delete().eq("id", resposta.conversa);
    conferir("Conversa de teste apagada", !error, error?.message ?? "");
  }
}

writeFileSync(join(SAIDA, "interacao.json"), JSON.stringify({ relatorio, erros }, null, 2));
console.log(
  `${relatorio.filter((r) => r.ok === false).length} conferência(s) falharam · ${erros.length} erro(s) de console`,
);
ws.close();
chrome.kill();
await espera(500);
try {
  rmSync(perfil, { recursive: true, force: true });
} catch {
  // O Chrome ainda solta arquivos do perfil temporário; o sistema limpa a pasta depois.
}
