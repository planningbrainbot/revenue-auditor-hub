// Verificação visual e de navegação do preview do Cockpit do CEO, por Chrome DevTools Protocol.
//
// Uso: node scripts/cockpit-ceo/capturas.mjs [base=http://127.0.0.1:8080] [saida=docs/dev_notes/cockpit-ceo-piloto/capturas]
// Pré-requisito: scripts/cockpit-ceo/preview.sh rodando. Não clica em nada que chame o Jev.
//
// Além das imagens, registra todo host que a página contatou: o preview não pode sair de
// 127.0.0.1 (a única exceção esperada é a fonte Poppins do Google, que o layout raiz carrega).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.argv[2] || "http://127.0.0.1:8080";
const SAIDA = process.argv[3] || "docs/dev_notes/cockpit-ceo-piloto/capturas";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORTA = 9333;
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(SAIDA, { recursive: true });
const perfil = mkdtempSync(join(tmpdir(), "cockpit-cdp-"));
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
for (let i = 0; i < 50 && !alvo; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORTA}/json/new?about:blank`, { method: "PUT" });
    alvo = await r.json();
  } catch {
    await espera(200);
  }
}
if (!alvo) throw new Error("Chrome não abriu a porta de depuração.");

const ws = new WebSocket(alvo.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pendentes = new Map();
const hosts = new Map();
const erros = [];
const eventos = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pendentes.has(msg.id)) {
    const { ok, falha } = pendentes.get(msg.id);
    pendentes.delete(msg.id);
    msg.error ? falha(new Error(msg.error.message)) : ok(msg.result);
    return;
  }
  if (msg.method === "Network.requestWillBeSent") {
    const u = new URL(msg.params.request.url);
    if (u.protocol.startsWith("http")) hosts.set(u.host, (hosts.get(u.host) || 0) + 1);
  }
  if (msg.method === "Runtime.exceptionThrown")
    erros.push(
      msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text,
    );
  if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error")
    erros.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  eventos.push(msg.method);
});
const cdp = (method, params = {}) =>
  new Promise((ok, falha) => {
    const id = ++seq;
    pendentes.set(id, { ok, falha });
    ws.send(JSON.stringify({ id, method, params }));
  });
const avaliar = async (expressao) =>
  (
    await cdp("Runtime.evaluate", {
      expression: expressao,
      returnByValue: true,
      awaitPromise: true,
    })
  ).result.value;

await cdp("Page.enable");
await cdp("Network.enable");
await cdp("Runtime.enable");

async function janela(largura, altura) {
  await cdp("Emulation.setDeviceMetricsOverride", {
    width: largura,
    height: altura,
    deviceScaleFactor: 1,
    mobile: false,
  });
}
async function abrir(caminho) {
  await cdp("Page.navigate", { url: BASE + caminho });
  for (let i = 0; i < 100; i++) {
    await espera(150);
    const pronto = await avaliar(
      "document.readyState === 'complete' && !!document.querySelector('h1')",
    ).catch(() => false);
    if (pronto) break;
  }
  await espera(1200);
}
async function foto(nome, { inteira = false } = {}) {
  let params = { format: "png" };
  if (inteira) {
    const { cssContentSize } = await cdp("Page.getLayoutMetrics");
    params = {
      ...params,
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
    };
  }
  const { data } = await cdp("Page.captureScreenshot", params);
  writeFileSync(join(SAIDA, nome + ".png"), Buffer.from(data, "base64"));
}

const relatorio = [];
const conferir = (nome, ok, detalhe = "") => relatorio.push({ nome, ok: !!ok, detalhe });

await janela(1440, 900);
await abrir("/piloto/cockpit-ceo");
await foto("01-primeira-dobra-1440x900");
const dobra = await avaliar(`(() => {
  const cards = [...document.querySelectorAll('[aria-label$="abrir composição"]')];
  const decisoes = [...document.querySelectorAll('ol > li')];
  const r = (e) => e.getBoundingClientRect();
  return {
    cards: cards.length,
    cardsNaDobra: cards.filter((c) => r(c).bottom <= innerHeight).length,
    decisoes: decisoes.length,
    rolagemHorizontal: document.documentElement.scrollWidth > innerWidth,
    universo: document.querySelector('h1 + p')?.textContent,
    sintetico: /dados sintéticos/i.test(document.body.innerText),
  };
})()`);
conferir(
  "Seis indicadores na primeira dobra (1440×900)",
  dobra.cards === 6 && dobra.cardsNaDobra === 6,
  JSON.stringify(dobra),
);
conferir("Até três decisões", dobra.decisoes > 0 && dobra.decisoes <= 3, `${dobra.decisoes}`);
conferir("Sem rolagem horizontal", !dobra.rolagemHorizontal);
conferir("Selo de dados sintéticos visível", dobra.sintetico);
await foto("02-pagina-inteira", { inteira: true });

// Número → composição → retorno.
await avaliar(
  `document.querySelector('[aria-label="Contas prontas para trabalhar: abrir composição"]').click()`,
);
await espera(900);
const url1 = await avaliar("location.search");
const folha = await avaliar(
  `(() => { const d = document.querySelector('[role=dialog]'); return d ? d.innerText : null })()`,
);
conferir(
  "Clique no número abre a composição e grava na URL",
  url1.includes("indicador=contas-prontas") && !!folha,
  url1,
);
conferir("Composição reconstrói o número (∑ ✓)", !!folha && folha.includes("✓"));
await foto("03-composicao-contas-prontas");
await avaliar("history.back()");
await espera(900);
const depoisVoltar = await avaliar(
  `({ search: location.search, aberta: !!document.querySelector('[role=dialog]') })`,
);
conferir(
  "Voltar do navegador fecha a composição",
  !depoisVoltar.aberta && !depoisVoltar.search.includes("indicador"),
  JSON.stringify(depoisVoltar),
);

// Fechar pelo X desempilha a entrada da composição: o "voltar" seguinte sai da tela.
await abrir("/piloto/cockpit-ceo?periodo=ano");
await abrir("/piloto/cockpit-ceo");
await avaliar(
  `document.querySelector('[aria-label="Contratos ganhos no CRM: abrir composição"]').click()`,
);
await espera(800);
await avaliar(
  `[...document.querySelectorAll('[role=dialog] button')].find((b) => /Close/.test(b.textContent))?.click()`,
);
await espera(800);
const aposX = await avaliar(
  `({ search: location.search, aberta: !!document.querySelector('[role=dialog]') })`,
);
await avaliar("history.back()");
await espera(1200);
const aposVoltar = await avaliar("location.search");
conferir(
  "Fechar no X e depois voltar sai da tela num clique só",
  !aposX.aberta && !aposX.search.includes("indicador") && aposVoltar.includes("periodo=ano"),
  JSON.stringify({ aposX, aposVoltar }),
);

// Filtros persistem na URL e todos os componentes respondem ao recorte.
await abrir("/piloto/cockpit-ceo?periodo=mes_anterior&perimetro=ex-norte&frente=comercial");
const recorte = await avaliar(`(() => ({
  universo: document.querySelector('h1 + p')?.textContent,
  perimetro: document.querySelector('select')?.value,
  grafico: !!document.querySelector('figure svg'),
}))()`);
conferir(
  "Período e perímetro vêm da URL",
  recorte.perimetro === "ex-norte" && /Unidade Exemplo Norte/.test(recorte.universo || ""),
  JSON.stringify(recorte),
);
conferir("Frente comercial mostra o gráfico diário", recorte.grafico);
await avaliar("document.getElementById('frentes').scrollIntoView()");
await espera(600);
await foto("04-frente-comercial-grafico-diario");

// Trajetória para R$ 1 bi: leituras candidatas lado a lado, sem soma, com mês parcial fora.
await abrir("/piloto/cockpit-ceo?frente=receita");
const traj = await avaliar(`(() => {
  const s = document.querySelector('[aria-label="Trajetória para a meta"]');
  return {
    existe: !!s,
    texto: s?.innerText || "",
    cartoes: s ? s.querySelectorAll("article").length : 0,
    graficos: s ? s.querySelectorAll("svg.recharts-surface").length : 0,
  };
})()`);
conferir(
  "Frente Receita mostra as duas leituras candidatas com série",
  traj.existe && traj.cartoes === 2 && traj.graficos === 2,
  JSON.stringify({ cartoes: traj.cartoes, graficos: traj.graficos }),
);
conferir(
  "Trajetória diz que as leituras não se somam, usa 2030 e se identifica como sintética",
  /não se somam/.test(traj.texto) && /2030/.test(traj.texto) && /SINTÉTICO/.test(traj.texto),
);
await avaliar(`document.querySelector('[aria-label="Trajetória para a meta"]').scrollIntoView()`);
await espera(600);
await foto("07-trajetoria-bilhao-candidatas");

// Clientes ativos: quatro definições lado a lado, com sobreposição e penetração ganha no CRM.
await abrir("/piloto/cockpit-ceo?frente=clientes");
const cli = await avaliar(`(() => {
  const s = document.querySelector('[aria-label="Clientes ativos por definição"]');
  return { existe: !!s, texto: s?.innerText || "", linhas: s ? s.querySelectorAll("tbody tr").length : 0 };
})()`);
conferir(
  "Frente Clientes mostra as quatro definições com sobreposição",
  cli.existe &&
    cli.linhas === 4 &&
    /Em pelo menos uma/.test(cli.texto) &&
    /Em todas/.test(cli.texto),
  JSON.stringify({ linhas: cli.linhas }),
);
conferir(
  "Penetração se declara ganho no CRM e a fonte se identifica como sintética",
  /ganho no CRM/.test(cli.texto) && /não é consumo/.test(cli.texto) && /SINTÉTICO/.test(cli.texto),
);
await avaliar(
  `document.querySelector('[aria-label="Clientes ativos por definição"]').scrollIntoView()`,
);
await espera(600);
await foto("09-clientes-ativos-definicoes");

// Composição de um indicador não apurado: diz o que falta e quem responde.
await abrir("/piloto/cockpit-ceo?indicador=meta-bilhao");
const meta = await avaliar(`document.querySelector('[role=dialog]')?.innerText || ''`);
conferir(
  "Meta de R$ 1 bi aparece como não apurada com responsável",
  /Não apurado/.test(meta) && /CEO \+ CFO/.test(meta),
);
await foto("05-composicao-meta-nao-apurada");

// Período inválido na URL não derruba a página.
await abrir("/piloto/cockpit-ceo?periodo=personalizado&de=2026-02-30&ate=2026-03-10");
const invalido = await avaliar(
  `document.body.innerText.includes('Período personalizado inválido')`,
);
conferir("Período inválido cai no mês atual com aviso", invalido);

// Tela estreita, para conferir que nada vaza da largura.
await janela(1280, 800);
await abrir("/piloto/cockpit-ceo");
await foto("06-notebook-1280x800");
conferir(
  "Sem rolagem horizontal em 1280",
  !(await avaliar("document.documentElement.scrollWidth > innerWidth")),
);

const externos = [...hosts.keys()].filter((h) => !h.startsWith("127.0.0.1"));
conferir(
  "Nenhuma requisição fora de 127.0.0.1 além da fonte do Google",
  externos.every((h) => /fonts\.(googleapis|gstatic)\.com$/.test(h)),
  JSON.stringify(Object.fromEntries(hosts)),
);
// O layout raiz grava o tema no <html> antes de o React hidratar (SCRIPT_TEMA_COMPARTILHADO): o
// React avisa em toda página do app, não só aqui. Fica registrado à parte, como preexistente.
const doTema = (e) => /hydrated but some attributes/.test(e) && /data-theme/.test(e);
const preexistentes = erros.filter(doTema);
const novos = erros.filter((e) => !doTema(e));
conferir("Sem exceção de JavaScript do cockpit", novos.length === 0, novos.slice(0, 5).join(" | "));
if (preexistentes.length)
  relatorio.push({
    nome: `Aviso preexistente do layout raiz (tema no <html>), ${preexistentes.length}×`,
    ok: true,
    detalhe: "hydration mismatch em data-theme; não é do cockpit",
  });

writeFileSync(
  join(SAIDA, "relatorio.json"),
  JSON.stringify({ base: BASE, relatorio, hosts: Object.fromEntries(hosts), erros }, null, 2) +
    "\n",
);
for (const r of relatorio)
  console.log(`${r.ok ? "ok  " : "FALHA"} ${r.nome}${r.ok ? "" : " — " + r.detalhe}`);
ws.close();
// O Chrome ainda grava no perfil depois do kill: espera a saída e tenta a limpeza de novo.
await new Promise((r) => {
  chrome.once("exit", r);
  chrome.kill();
});
rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
process.exit(relatorio.every((r) => r.ok) ? 0 : 1);
