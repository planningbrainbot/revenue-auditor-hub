#!/usr/bin/env node
/**
 * Troca cor crua do Tailwind por token semântico e fonte < 12px por text-xs.
 *
 *   node scripts/design/codemod-cores.mjs          # aplica em src/
 *   node scripts/design/codemod-cores.mjs --dry    # só relata
 *   node scripts/design/codemod-cores.mjs --json   # relatório em JSON (com ou sem --dry)
 *
 * Por que reexecutável: a branch de design vai se integrar com a main do
 * Eliezek, que continua recebendo tela com `text-emerald-600`. Em vez de
 * resolver conflito de classe à mão, roda-se o codemod de novo depois do merge.
 * Rodar duas vezes dá o mesmo resultado: tudo o que ele gera é token, e token
 * não casa com nenhuma regra de entrada.
 *
 * O que ele NÃO faz, de propósito:
 * - Não entra em components/ui, components/planning e lib/planning (já nascem
 *   com token), nem na casca e na vitrine (outra tarefa cuida delas).
 * - Não entra em arquivo que gera PDF, planilha ou HTML de e-mail/arquivo:
 *   ali a cor é impressa e não resolve CSS var.
 * - Não troca hex nem roxo/índigo/rosa (não existe token equivalente; só conta).
 *
 * Como decide:
 * - Matiz → papel: emerald/green/teal/lime → success, red/rose → danger,
 *   amber/yellow/orange → warning, sky/cyan/blue → info.
 * - Tom decide a variante: bg claro (50–200) vira `*-soft`, bg forte vira o
 *   sólido; borda clara (≤300) vira `/40`. Em `dark:` o tom é espelhado
 *   (950 no escuro faz o papel do 50 no claro), porque o token já troca de
 *   valor com o tema.
 * - Neutros viram foreground/muted-foreground/muted/card/border.
 * - Depois de mapear, `dark:X` some quando a mesma string já tem `X` do mesmo
 *   papel: o token resolve os dois temas sozinho.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(raiz, "src");
const DRY = process.argv.includes("--dry");
const JSON_OUT = process.argv.includes("--json");

// ---------------------------------------------------------------- escopo

const PASTAS_FORA = ["src/components/ui/", "src/components/planning/", "src/lib/planning/"];
const ARQUIVOS_FORA = new Set([
  "src/routes/vitrine.tsx",
  "src/components/app-sidebar.tsx",
  "src/components/app-shell.tsx",
  "src/routes/_authenticated/route.tsx",
  "src/routeTree.gen.ts",
  // Casca/KPI da tarefa paralela e o logo (hex da marca é legítimo ali).
  "src/components/audit/kpi-card.tsx",
  "src/components/planning-logo.tsx",
]);
// Arquivo que imprime cor (PDF, planilha, HTML exportado/e-mail).
const IMPRESSO = [
  /from\s+["'](jspdf|jspdf-autotable|xlsx|xlsx-js-style)["']/,
  /import\(\s*["'](jspdf|jspdf-autotable|xlsx|xlsx-js-style)["']\s*\)/,
  /<!doctype|<html[\s>]|<body[\s>]/i,
  /<(p|div|td|table|span|a|h[1-6])\s+style=["'][a-z-]+\s*:/i,
];

function listar(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) listar(p, acc);
    else if (/\.(tsx|ts)$/.test(nome) && !nome.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

function motivoFora(rel, texto) {
  if (PASTAS_FORA.some((p) => rel.startsWith(p))) return "pasta de token";
  if (ARQUIVOS_FORA.has(rel)) return "casca/vitrine/gerado";
  if (IMPRESSO.some((re) => re.test(texto))) return "gera PDF/planilha/HTML impresso";
  return null;
}

// ---------------------------------------------------------------- mapeamento

const STATUS = {
  emerald: "success", green: "success", teal: "success", lime: "success",
  red: "danger", rose: "danger",
  amber: "warning", yellow: "warning", orange: "warning",
  sky: "info", cyan: "info", blue: "info",
};
const NEUTRO = new Set(["slate", "gray", "zinc", "neutral", "stone"]);
const SEM_TOKEN = new Set(["violet", "purple", "indigo", "fuchsia", "pink"]);
const MATIZES = [...Object.keys(STATUS), ...NEUTRO, ...SEM_TOKEN].join("|");
const PREFIXOS = [
  "text", "bg", "border-[xytrblse]", "border", "ring-offset", "ring", "fill", "stroke",
  "from", "to", "via", "outline", "decoration", "divide", "placeholder", "caret", "accent", "shadow",
].join("|");

// Um token de classe: variantes (hover:, dark:, data-[x]:…), `!` opcional,
// prefixo, matiz, tom e opacidade opcional. Fronteira = início/fim da string
// ou espaço, para não pegar pedaço de identificador.
const RE_COR = new RegExp(
  `(^|\\s)((?:[^\\s:"'\`]+:)*)(!?)(${PREFIXOS})-(${MATIZES})-(50|[1-9]00|950)(?:/(\\d{1,3}|\\[[^\\]\\s]+\\]))?(!?)(?=\\s|$)`,
  "g",
);
// Para contar no arquivo inteiro a fronteira inclui aspas, crase e chaves.
const RE_COR_CONTA = new RegExp(RE_COR.source.replace("(^|\\s)", "(^|[\\s\"'`{(,])").replace("(?=\\s|$)", "(?=[\\s\"'`}),]|$)"), "g");
const RE_FONTE_CONTA = /(^|[\s"'`{(,])((?:[^\s:"'`]+:)*)(!?)text-\[(\d+(?:\.\d+)?)(px|rem)\](?=[\s"'`}),]|$)/g;
const RE_FONTE = /(^|\s)((?:[^\s:"'`]+:)*)(!?)text-\[(\d+(?:\.\d+)?)(px|rem)\](?=\s|$)/g;

const BORDAS = /^(border(-[xytrblse])?|ring|ring-offset|outline|divide)$/;

function mapearCor(prefixo, matiz, tom, escuro) {
  // No escuro o tom se espelha: dark:bg-amber-950 cumpre o papel de bg-amber-50.
  const efetivo = escuro ? 1000 - tom : tom;
  if (STATUS[matiz]) {
    const t = STATUS[matiz];
    if (prefixo === "bg") return { classe: efetivo <= 200 ? `bg-${t}-soft` : `bg-${t}`, papel: t, clara: efetivo <= 300 };
    if (BORDAS.test(prefixo)) return { classe: `${prefixo}-${t}`, papel: t, clara: efetivo <= 300, borda: true };
    return { classe: `${prefixo}-${t}`, papel: t };
  }
  // Neutros.
  if (prefixo === "text") return { classe: efetivo >= 700 ? "text-foreground" : "text-muted-foreground", papel: "neutro" };
  if (prefixo === "bg") {
    if (efetivo <= 300) return { classe: "bg-muted", papel: "neutro" };
    if (efetivo <= 600) return { classe: "bg-muted-foreground", papel: "neutro", fundoForte: true };
    return { classe: "bg-card", papel: "neutro", escuroSolido: true };
  }
  if (BORDAS.test(prefixo)) return { classe: `${prefixo}-border`, papel: "neutro" };
  if (/^(from|to|via)$/.test(prefixo)) return { classe: `${prefixo}-muted`, papel: "neutro" };
  return { classe: `${prefixo}-muted-foreground`, papel: "neutro" };
}

const TOKENS_NEUTROS = new Set(["foreground", "muted-foreground", "muted", "card", "border", "background"]);
const TOKENS_STATUS = /^(success|warning|danger|info)(-soft)?$/;

/** Separa `dark:hover:bg-success-soft/40` em cadeia, prefixo e papel. */
function anatomia(classe) {
  const partes = classe.split(":");
  const base = partes.pop().replace(/^!|!$/g, "").replace(/\/.*$/, "");
  const cadeia = partes;
  const m = base.match(new RegExp(`^(${PREFIXOS})-(.+)$`));
  if (!m) return null;
  const valor = m[2];
  let papel = null;
  if (TOKENS_STATUS.test(valor)) papel = valor.replace(/-soft$/, "");
  else if (TOKENS_NEUTROS.has(valor)) papel = "neutro";
  if (!papel) return null;
  return { cadeia, prefixo: m[1], papel };
}

// ---------------------------------------------------------------- literais

/**
 * Devolve os trechos de string do arquivo ("…", '…', e os pedaços estáticos
 * de `…`). O agrupamento importa só para a regra do `dark:` duplicado: o par
 * tem que estar na mesma string para ser do mesmo elemento.
 */
function trechosDeString(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  const pilha = []; // profundidade de chaves dentro de cada ${ } aberto
  let ultimoSignificativo = "";
  const podeRegex = () => ultimoSignificativo === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(ultimoSignificativo);

  function lerTemplate() {
    // i aponta para depois da crase (ou do } que fecha um ${ }).
    let ini = i;
    while (i < n) {
      const c = src[i];
      if (c === "\\") { i += 2; continue; }
      if (c === "`") { out.push([ini, i]); i++; return "fim"; }
      if (c === "$" && src[i + 1] === "{") { out.push([ini, i]); i += 2; pilha.push(0); return "expr"; }
      i++;
    }
    out.push([ini, n]);
    return "fim";
  }

  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const f = src.indexOf("*/", i + 2); i = f < 0 ? n : f + 2; continue; }
    if (c === '"' || c === "'") {
      const ini = ++i;
      while (i < n && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") i++; i++; }
      out.push([ini, i]);
      i++;
      ultimoSignificativo = "a";
      continue;
    }
    if (c === "`") { i++; lerTemplate(); ultimoSignificativo = "a"; continue; }
    if (c === "/" && podeRegex()) {
      // literal de regex: pula até a barra de fechamento fora de classe [ ].
      let j = i + 1, classe = false, ok = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") classe = true;
        else if (src[j] === "]") classe = false;
        else if (src[j] === "/" && !classe) { ok = true; break; }
        j++;
      }
      if (ok) { i = j + 1; ultimoSignificativo = "a"; continue; }
    }
    if (pilha.length) {
      if (c === "{") pilha[pilha.length - 1]++;
      else if (c === "}") {
        if (pilha[pilha.length - 1] === 0) { pilha.pop(); i++; lerTemplate(); ultimoSignificativo = "a"; continue; }
        pilha[pilha.length - 1]--;
      }
    }
    if (!/\s/.test(c)) ultimoSignificativo = c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------- contagem

function contar(texto) {
  const c = { status: 0, neutros: 0, semToken: 0, fonte: 0, hex: 0, porMatizSemToken: {} };
  for (const m of texto.matchAll(RE_COR_CONTA)) {
    const matiz = m[5];
    if (STATUS[matiz]) c.status++;
    else if (NEUTRO.has(matiz)) c.neutros++;
    else { c.semToken++; c.porMatizSemToken[matiz] = (c.porMatizSemToken[matiz] || 0) + 1; }
  }
  for (const m of texto.matchAll(RE_FONTE_CONTA)) if (pequena(m[4], m[5])) c.fonte++;
  c.hex = (texto.match(/(?<![\w&])#[0-9a-fA-F]{3,8}\b/g) || []).length;
  return c;
}

function pequena(num, unid) {
  const px = unid === "rem" ? parseFloat(num) * 16 : parseFloat(num);
  return px < 12;
}

// ---------------------------------------------------------------- transformação

function transformarTrecho(s, ctx) {
  // text-white em cima de fundo neutro escuro vira par invertido (bg-foreground
  // + text-background), senão o card escuro vira branco com texto branco no
  // tema claro.
  const temTextoBranco = /(^|\s)text-white(?=\s|$)/.test(s);
  let inverteu = false;

  let r = s.replace(RE_COR, (tudo, antes, cadeia, bang1, prefixo, matiz, tom, opac, bang2) => {
    if (SEM_TOKEN.has(matiz)) return tudo;
    const escuro = cadeia.split(":").includes("dark");
    const m = mapearCor(prefixo, matiz, Number(tom), escuro);
    let classe = m.classe;
    if (m.escuroSolido && temTextoBranco && !escuro) { classe = "bg-foreground"; inverteu = true; }
    if (m.fundoForte && temTextoBranco && !escuro) inverteu = true;
    let op = opac ? `/${opac}` : "";
    if (m.borda && m.clara && !opac && m.papel !== "neutro") op = "/40";
    ctx.trocas++;
    return `${antes}${cadeia}${bang1}${classe}${op}${bang2}`;
  });
  if (inverteu) r = r.replace(/(^|\s)text-white(?=\s|$)/g, "$1text-background");

  r = r.replace(RE_FONTE, (tudo, antes, cadeia, bang, num, unid) => {
    if (!pequena(num, unid)) return tudo;
    ctx.trocas++;
    return `${antes}${cadeia}${bang}text-xs`;
  });

  // dark:X redundante: mesma cadeia sem o dark, mesmo prefixo, mesmo papel.
  const classes = r.split(/(\s+)/);
  const chaves = new Set();
  for (const cl of classes) {
    const a = anatomia(cl);
    if (a && !a.cadeia.includes("dark")) chaves.add(`${a.cadeia.join(":")}|${a.prefixo}|${a.papel}`);
  }
  let removeu = false;
  const mantidas = classes.map((cl) => {
    const a = anatomia(cl);
    if (!a || !a.cadeia.includes("dark")) return cl;
    const semDark = a.cadeia.filter((v) => v !== "dark").join(":");
    if (chaves.has(`${semDark}|${a.prefixo}|${a.papel}`)) { ctx.darkRemovidos++; removeu = true; return null; }
    return cl;
  });
  if (removeu) {
    // Tira a classe junto com o espaço que a precede (ou o que a segue, se
    // for a primeira), sem mexer na quebra de linha das demais.
    const ehClasse = (x) => x !== null && x !== "" && !/^\s+$/.test(x);
    for (let k = 0; k < mantidas.length; k++) {
      if (mantidas[k] !== null) continue;
      mantidas[k] = "";
      const temAntes = mantidas.slice(0, k).some(ehClasse);
      if (temAntes) {
        let j = k - 1;
        while (j >= 0 && mantidas[j] === "") j--;
        if (j >= 0 && /^\s+$/.test(mantidas[j])) mantidas[j] = "";
      } else {
        let j = k + 1;
        while (j < mantidas.length && mantidas[j] === null) j++;
        if (j < mantidas.length && /^\s+$/.test(mantidas[j])) mantidas[j] = "";
      }
    }
    r = mantidas.join("");
  }

  // Texto sobre fundo sólido de status: `text-white` some no escuro (o sólido
  // lá é claro) e texto do mesmo papel (bg-amber-400 text-amber-950) vira
  // bg-warning text-warning, invisível nos dois temas. Os dois viram
  // text-background, que é tinta escura no escuro e clara no claro, como o
  // #04110b sobre o primary. Fica listado para revisão mesmo assim.
  const solido = r.match(/(^|\s)bg-(success|warning|danger|info)(?:\/(\d+))?(?=\s|$)/);
  if (solido && (!solido[3] || Number(solido[3]) >= 50)) {
    const tinta = new RegExp(`(^|\\s)(text-white|text-${solido[2]})(?=\\s|$)`, "g");
    if (tinta.test(r)) {
      const antes = r;
      r = r.replace(tinta, "$1text-background");
      ctx.textoBranco.push(`${antes.trim().replace(/\s+/g, " ").slice(0, 120)}  ⇒  ${r.trim().replace(/\s+/g, " ").slice(0, 120)}`);
    }
  }
  return r;
}

function transformar(texto, ctxArquivo) {
  const trechos = trechosDeString(texto);
  let out = "";
  let pos = 0;
  for (const [a, b] of trechos) {
    const s = texto.slice(a, b);
    if (!RE_COR.test(s) && !/text-\[/.test(s)) { RE_COR.lastIndex = 0; continue; }
    RE_COR.lastIndex = 0;
    const ctx = { trocas: 0, darkRemovidos: 0, textoBranco: [] };
    const novo = transformarTrecho(s, ctx);
    ctxArquivo.trocas += ctx.trocas;
    ctxArquivo.darkRemovidos += ctx.darkRemovidos;
    if (ctx.textoBranco.length) {
      const linha = texto.slice(0, a).split("\n").length;
      for (const t of ctx.textoBranco) ctxArquivo.textoBranco.push({ linha, classes: t });
    }
    if (novo !== s) { out += texto.slice(pos, a) + novo; pos = b; }
  }
  return out + texto.slice(pos);
}

// ---------------------------------------------------------------- execução

const soma = (x, y) => ({
  status: x.status + y.status, neutros: x.neutros + y.neutros, semToken: x.semToken + y.semToken,
  fonte: x.fonte + y.fonte, hex: x.hex + y.hex,
  porMatizSemToken: Object.fromEntries(
    [...new Set([...Object.keys(x.porMatizSemToken), ...Object.keys(y.porMatizSemToken)])]
      .map((k) => [k, (x.porMatizSemToken[k] || 0) + (y.porMatizSemToken[k] || 0)]),
  ),
});
const zero = () => ({ status: 0, neutros: 0, semToken: 0, fonte: 0, hex: 0, porMatizSemToken: {} });

const rel = { antes: { escopo: zero(), src: zero() }, depois: { escopo: zero(), src: zero() },
  darkRemovidos: 0, arquivos: [], fora: [], textoBranco: [], hexPorArquivo: [], semTokenPorArquivo: [] };

for (const caminho of listar(SRC).sort()) {
  const r = relative(raiz, caminho);
  const texto = readFileSync(caminho, "utf8");
  const antes = contar(texto);
  rel.antes.src = soma(rel.antes.src, antes);
  const fora = motivoFora(r, texto);
  if (fora) {
    rel.depois.src = soma(rel.depois.src, antes);
    if (antes.status + antes.neutros + antes.fonte + antes.semToken > 0) rel.fora.push({ arquivo: r, motivo: fora, ...antes });
    continue;
  }
  rel.antes.escopo = soma(rel.antes.escopo, antes);
  const ctx = { trocas: 0, darkRemovidos: 0, textoBranco: [] };
  const novo = transformar(texto, ctx);
  const depois = contar(novo);
  rel.depois.escopo = soma(rel.depois.escopo, depois);
  rel.depois.src = soma(rel.depois.src, depois);
  rel.darkRemovidos += ctx.darkRemovidos;
  if (depois.hex) rel.hexPorArquivo.push({ arquivo: r, hex: depois.hex });
  if (depois.semToken) rel.semTokenPorArquivo.push({ arquivo: r, ...depois.porMatizSemToken });
  for (const t of ctx.textoBranco) rel.textoBranco.push({ arquivo: r, ...t });
  if (novo !== texto) {
    rel.arquivos.push({ arquivo: r, trocas: ctx.trocas, darkRemovidos: ctx.darkRemovidos });
    if (!DRY) writeFileSync(caminho, novo);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(rel, null, 2));
} else {
  const linha = (nome, k) =>
    `${nome.padEnd(28)} ${String(rel.antes.escopo[k]).padStart(6)} → ${String(rel.depois.escopo[k]).padStart(5)}` +
    `   | src inteiro ${String(rel.antes.src[k]).padStart(6)} → ${String(rel.depois.src[k]).padStart(5)}`;
  console.log(DRY ? "== codemod-cores (--dry: nada gravado)" : "== codemod-cores (aplicado)");
  console.log(`${"categoria".padEnd(28)} ${"escopo: antes → depois".padStart(14)}`);
  console.log(linha("cor crua de status", "status"));
  console.log(linha("neutros crus", "neutros"));
  console.log(linha("fonte < 12px", "fonte"));
  console.log(linha("matizes sem token (só conta)", "semToken"));
  console.log(linha("hex (só conta)", "hex"));
  console.log(`${"dark: removidos".padEnd(28)} ${String(rel.darkRemovidos).padStart(6)}`);
  console.log(`arquivos alterados: ${rel.arquivos.length}`);
  const top = [...rel.arquivos].sort((a, b) => b.trocas - a.trocas).slice(0, 10);
  if (top.length) {
    console.log("\ntop 10 por trocas:");
    for (const a of top) console.log(`  ${String(a.trocas).padStart(4)}  ${a.arquivo}  (dark: −${a.darkRemovidos})`);
  }
  if (rel.textoBranco.length) {
    console.log(`\nrevisar: tinta sobre fundo sólido de status trocada por text-background (${rel.textoBranco.length}):`);
    for (const t of rel.textoBranco) console.log(`  ${t.arquivo}:${t.linha}  ${t.classes}`);
  }
  if (rel.fora.length) {
    console.log("\nfora do escopo com cor crua/fonte pequena:");
    for (const f of rel.fora) console.log(`  ${f.arquivo} [${f.motivo}] status=${f.status} neutros=${f.neutros} fonte=${f.fonte} semToken=${f.semToken}`);
  }
}
