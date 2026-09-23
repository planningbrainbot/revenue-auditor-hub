#!/usr/bin/env node
/**
 * Portão de design do Brain: confere por código as regras V de
 * docs/design/DESIGN.md §10 que dá para conferir por código.
 *
 *   node scripts/design/lint.mjs              # src/ inteiro + catraca
 *   node scripts/design/lint.mjs --changed    # só o que mudou vs merge-base com origin/main
 *   node scripts/design/lint.mjs --baseline   # regrava lint-baseline.json e a tabela de medicoes.md
 *   node scripts/design/lint.mjs --json       # relatório em JSON
 *   node scripts/design/lint.mjs --estrito    # qualquer ERRO no escopo reprova, mesmo antigo
 *
 * Quando reprova (exit 1), e por quê assim:
 * - Catraca: a contagem global de uma regra de ERRO subiu acima de
 *   docs/design/lint-baseline.json. A dívida antiga só pode cair (PROCESSO §5).
 * - Modo completo: ERRO dentro do próprio design system (components/ui,
 *   components/planning, lib/planning, styles.css). O sistema que cobra a regra
 *   não pode violá-la; o resto do legado entra na baseline e cai pelo codemod.
 * - Modo --changed: arquivo alterado com MAIS erros de uma regra do que tinha
 *   no merge-base. "Violação nova em arquivo tocado bloqueia o PR; violação
 *   antiga em arquivo não tocado cai pelo codemod" (DESIGN §10) — mexer numa
 *   linha de uma tela com 15 hex antigos não obriga a limpar os 15 no mesmo PR.
 * AVISO nunca reprova.
 *
 * Detecção de classe de cor e a lista de arquivos que imprimem cor (PDF,
 * planilha, HTML exportado) vêm de codemod-cores.mjs. Estão copiadas, e não
 * importadas, porque o codemod executa ao ser importado; se mudar lá, mude aqui.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = join(raiz, "src");
const BASELINE = join(raiz, "docs/design/lint-baseline.json");
const MEDICOES = join(raiz, "docs/design/medicoes.md");
const args = new Set(process.argv.slice(2));
const CHANGED = args.has("--changed");
const GRAVAR_BASELINE = args.has("--baseline");
const JSON_OUT = args.has("--json");
const ESTRITO = args.has("--estrito");

// ---------------------------------------------------------------- regras

const REGRAS = {
  V1: { nivel: "ERRO", titulo: "hsl(var(--x)) sobre token que é hex: cor inválida; use var(--x)" },
  V2: { nivel: "ERRO", titulo: "hex literal em .tsx fora da allowlist (logo, PDF/planilha/e-mail); use token" },
  V3: { nivel: "ERRO", titulo: "cor crua de status/neutro do Tailwind fora de components/ui|planning; use success/warning/danger/info/muted" },
  V4: { nivel: "ERRO", titulo: "fonte abaixo de 12px; o mínimo é text-xs" },
  V5: { nivel: "AVISO", titulo: "rota de _authenticated sem PageHeader/AppShell" },
  V6: { nivel: "AVISO", titulo: "confirm() nativo; ação destrutiva usa AlertDialog" },
  "V3-matiz": { nivel: "AVISO", titulo: "matiz sem token (indigo/purple/violet/fuchsia/pink): categoria vai para StatusBadge neutro ou CORES_SERIE" },
  V13: { nivel: "AVISO", titulo: "var(--area-*) fora de components/planning e da casca: cor de área só em filete, anel e grade" },
  V15: { nivel: "AVISO", titulo: "biblioteca de ícone que não é lucide-react" },
  V16: { nivel: "ERRO", titulo: "styles.css sem @media (prefers-reduced-motion)" },
  V17: { nivel: "AVISO", titulo: "linear-gradient fora de styles.css e do logo: gradiente da marca só no logo e na casca" },
  V18: { nivel: "ERRO", titulo: '__root.tsx sem lang="pt-BR"' },
  V19: { nivel: "ERRO", titulo: "__root.tsx sem <Toaster/>: toast() não aparece" },
};
const IDS = Object.keys(REGRAS);
const ERROS = IDS.filter((id) => REGRAS[id].nivel === "ERRO");

// ---------------------------------------------------------------- escopo

// O próprio design system: erro aqui reprova sempre.
const PASTAS_DS = ["src/components/ui/", "src/components/planning/", "src/lib/planning/"];
const ehDS = (rel) => PASTAS_DS.some((p) => rel.startsWith(p)) || rel === "src/styles.css";
const LIVRE_DE_COR_CRUA = ["src/components/ui/", "src/components/planning/"];
const CASCA = new Set(["src/components/app-sidebar.tsx", "src/components/app-shell.tsx", "src/routes/_authenticated/route.tsx"]);
// Hex legítimo: logo da casa, e o logo da Microsoft no botão "Entrar com Microsoft"
// (auth.tsx), que tem de sair nas cores oficiais de terceiro, não nas nossas.
const HEX_OK = new Set(["src/components/planning-logo.tsx", "src/routes/auth.tsx"]);
const IGNORADOS = new Set(["src/routeTree.gen.ts"]);
// A vitrine reproduz de propósito o "antes" (cor crua, fonte de 9–10px) para a
// captura comparativa (plano T1). Só V2–V4 ficam de fora; o resto vale nela.
const ANTES_DE_PROPOSITO = new Set(["src/routes/vitrine.tsx"]);
// Arquivo que imprime cor (PDF, planilha, HTML exportado/e-mail): mesma lista do codemod.
const IMPRESSO = [
  /from\s+["'](jspdf|jspdf-autotable|xlsx|xlsx-js-style)["']/,
  /import\(\s*["'](jspdf|jspdf-autotable|xlsx|xlsx-js-style)["']\s*\)/,
  /<!doctype|<html[\s>]|<body[\s>]/i,
  /<(p|div|td|table|span|a|h[1-6])\s+style=["'][a-z-]+\s*:/i,
];

// ---------------------------------------------------------------- padrões (de codemod-cores.mjs)

const STATUS = ["emerald", "green", "teal", "lime", "red", "rose", "amber", "yellow", "orange", "sky", "cyan", "blue"];
const NEUTRO = ["slate", "gray", "zinc", "neutral", "stone"];
const SEM_TOKEN = ["violet", "purple", "indigo", "fuchsia", "pink"];
const PREFIXOS = [
  "text", "bg", "border-[xytrblse]", "border", "ring-offset", "ring", "fill", "stroke",
  "from", "to", "via", "outline", "decoration", "divide", "placeholder", "caret", "accent", "shadow",
].join("|");
const classeDeCor = (matizes) =>
  new RegExp(
    `(^|[\\s"'\`{(,])((?:[^\\s:"'\`]+:)*)(!?)(${PREFIXOS})-(${matizes.join("|")})-(50|[1-9]00|950)(?:/(\\d{1,3}|\\[[^\\]\\s]+\\]))?(!?)(?=[\\s"'\`}),]|$)`,
    "g",
  );
const RE_COR_CRUA = classeDeCor([...STATUS, ...NEUTRO]);
const RE_SEM_TOKEN = classeDeCor(SEM_TOKEN);
const RE_FONTE = /(^|[\s"'`{(,])((?:[^\s:"'`]+:)*)(!?)text-\[(\d+(?:\.\d+)?)(px|rem)\](?=[\s"'`}),]|$)/g;
const RE_HSL_VAR = /hsl\(\s*var\(/g;
// Seletor de atributo ([stroke='#ccc'] no chart.tsx do shadcn) casa a cor padrão do Recharts; não pinta nada.
// A exclusão vale só dentro de colchete: até 23/09 ela pegava qualquer `="#`, e
// `fill="#f59e0b"` em JSX (27 casos, a forma mais comum de pintar série) passava calado.
const RE_HEX = /(?<![\w&/]|\[[\w-]+=['"])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g;
const RE_CONFIRM = /(?:\bwindow\.|(?<![\w$.]))confirm\s*\(/g;
const RE_AREA = /var\(--area-/g;
const RE_GRADIENTE = /linear-gradient\(/g;
const RE_ICONE = /from\s+["'](react-icons[^"']*|@heroicons\/[^"']*|@radix-ui\/react-icons|@tabler\/icons[^"']*|phosphor-react|@phosphor-icons\/[^"']*)["']/g;

const pequena = (num, unid) => (unid === "rem" ? parseFloat(num) * 16 : parseFloat(num)) < 12;
const ehComentario = (linha) => /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(linha);

// ---------------------------------------------------------------- arquivos

function listar(dir, acc = []) {
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) listar(p, acc);
    else if (/\.(tsx|ts|css)$/.test(nome) && !nome.endsWith(".d.ts")) acc.push(p);
  }
  return acc;
}

const git = (...a) => execFileSync("git", a, { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

function mergeBase() {
  try {
    return git("merge-base", "HEAD", "origin/main");
  } catch {
    console.error("design:lint --changed: não achei o merge-base com origin/main. Rode `git fetch origin main` e tente de novo.");
    process.exit(2);
  }
}

function alterados(base) {
  const lista = new Set([
    ...git("diff", "--name-only", "--diff-filter=ACMR", base).split("\n"),
    ...git("ls-files", "--others", "--exclude-standard").split("\n"),
  ]);
  return [...lista].filter((f) => f.startsWith("src/") && /\.(tsx|ts|css)$/.test(f) && !f.endsWith(".d.ts") && existsSync(join(raiz, f)));
}

function versaoNaBase(base, rel) {
  try {
    return execFileSync("git", ["show", `${base}:${rel}`], { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 << 20 });
  } catch {
    return ""; // arquivo novo
  }
}

// ---------------------------------------------------------------- V5: rota com cabeçalho

/** Rota que só redireciona ou só repassa para filhas não tem tela própria. */
function rotaSemTela(texto) {
  if (!/\bcomponent\s*:/.test(texto)) return true;
  if (/component\s*:\s*\(\)\s*=>\s*(null|<Outlet\s*\/>)/.test(texto)) return true;
  // Componente que só decide o destino com <Navigate> (ex.: _authenticated/index.tsx).
  if (/<Navigate\b/.test(texto) && !/className=/.test(texto)) return true;
  return false;
}

const RE_IMPORT_LOCAL = /from\s+["'](@\/[^"']+|\.\.?\/[^"']+)["']/g;
function resolverImport(de, spec) {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : resolve(dirname(de), spec);
  for (const c of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** A rota desenha cabeçalho se ela ou um componente local que ela importa (até 2 níveis) usa PageHeader/AppShell. */
function temCabecalho(caminho, texto, profundidade = 0, vistos = new Set()) {
  if (/\b(PageHeader|AppShell)\b/.test(texto)) return true;
  if (profundidade >= 2) return false;
  for (const m of texto.matchAll(RE_IMPORT_LOCAL)) {
    const alvo = resolverImport(caminho, m[1]);
    if (!alvo || vistos.has(alvo) || alvo.includes("/components/ui/") || alvo.includes("/integrations/")) continue;
    vistos.add(alvo);
    if (temCabecalho(alvo, readFileSync(alvo, "utf8"), profundidade + 1, vistos)) return true;
  }
  return false;
}

// ---------------------------------------------------------------- análise

function analisar(rel, texto, caminho) {
  const achados = [];
  const add = (id, linha, trecho) => achados.push({ arquivo: rel, linha, id, nivel: REGRAS[id].nivel, trecho: trecho.trim().replace(/^["'`{(,]/, "").slice(0, 80) });
  const tsx = rel.endsWith(".tsx");
  const codigo = /\.(tsx|ts)$/.test(rel);
  const impresso = codigo && IMPRESSO.some((re) => re.test(texto));
  const livreDeCor = LIVRE_DE_COR_CRUA.some((p) => rel.startsWith(p));
  const areaOk = rel.startsWith("src/components/planning/") || rel.startsWith("src/lib/planning/") || rel.startsWith("src/components/ui/") || CASCA.has(rel) || rel === "src/styles.css";

  texto.split("\n").forEach((l, i) => {
    const n = i + 1;
    for (const m of l.matchAll(RE_HSL_VAR)) add("V1", n, l.slice(m.index, m.index + 40));
    if (!codigo || ehComentario(l)) return;
    const antes = ANTES_DE_PROPOSITO.has(rel);
    if (tsx && !impresso && !HEX_OK.has(rel) && !antes) for (const m of l.matchAll(RE_HEX)) add("V2", n, m[0]);
    if (!livreDeCor && !antes) for (const m of l.matchAll(RE_COR_CRUA)) add("V3", n, m[0]);
    for (const m of l.matchAll(RE_SEM_TOKEN)) add("V3-matiz", n, m[0]);
    if (!antes) for (const m of l.matchAll(RE_FONTE)) if (pequena(m[4], m[5])) add("V4", n, m[0]);
    for (const m of l.matchAll(RE_CONFIRM)) add("V6", n, l.slice(m.index, m.index + 60));
    if (!areaOk) for (const m of l.matchAll(RE_AREA)) add("V13", n, l.slice(m.index, m.index + 40));
    for (const m of l.matchAll(RE_ICONE)) add("V15", n, m[0]);
    if (!HEX_OK.has(rel)) for (const m of l.matchAll(RE_GRADIENTE)) add("V17", n, l.slice(m.index, m.index + 40));
  });

  if (rel.startsWith("src/routes/_authenticated/") && rel.endsWith(".tsx") && rel !== "src/routes/_authenticated/route.tsx") {
    if (!rotaSemTela(texto) && !temCabecalho(caminho, texto)) add("V5", 1, "sem PageHeader/AppShell");
  }
  if (rel === "src/styles.css" && !/prefers-reduced-motion/.test(texto)) add("V16", 1, "styles.css");
  if (rel === "src/routes/__root.tsx") {
    if (!/lang=["']pt-BR["']/.test(texto)) add("V18", 1, "<html>");
    if (!/<Toaster\b/.test(texto)) add("V19", 1, "<Toaster/>");
  }
  return achados;
}

const contagem = (achados) => Object.fromEntries(IDS.map((id) => [id, achados.filter((a) => a.id === id).length]));

// ---------------------------------------------------------------- execução

const todos = listar(SRC).map((p) => relative(raiz, p)).filter((r) => !IGNORADOS.has(r)).sort();
const achadosGlobais = [];
for (const rel of todos) {
  const caminho = join(raiz, rel);
  achadosGlobais.push(...analisar(rel, readFileSync(caminho, "utf8"), caminho));
}
const global = contagem(achadosGlobais);

let base = null;
let escopo = todos;
if (CHANGED) {
  base = mergeBase();
  escopo = alterados(base).filter((r) => !IGNORADOS.has(r)).sort();
}
const noEscopo = new Set(escopo);
const achados = achadosGlobais.filter((a) => noEscopo.has(a.arquivo));

// Catraca contra a baseline.
const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
const subiram = baseline ? ERROS.filter((id) => global[id] > (baseline.regras?.[id] ?? 0)) : [];
const cairam = baseline ? IDS.filter((id) => global[id] < (baseline.regras?.[id] ?? 0)) : [];

// Arquivos que reprovam.
const reprovados = [];
if (CHANGED) {
  for (const rel of escopo) {
    const atuais = achados.filter((a) => a.arquivo === rel && a.nivel === "ERRO");
    if (!atuais.length) continue;
    const antes = contagem(analisar(rel, versaoNaBase(base, rel), join(raiz, rel)));
    const agora = contagem(atuais);
    const novas = ERROS.filter((id) => agora[id] > antes[id]).map((id) => `${id} ${antes[id]}→${agora[id]}`);
    if (ESTRITO || novas.length) reprovados.push({ arquivo: rel, motivo: ESTRITO && !novas.length ? "erro (--estrito)" : `violação nova: ${novas.join(", ")}` });
  }
} else {
  for (const rel of new Set(achados.filter((a) => a.nivel === "ERRO").map((a) => a.arquivo))) {
    if (ESTRITO || ehDS(rel)) reprovados.push({ arquivo: rel, motivo: ESTRITO ? "erro (--estrito)" : "erro dentro do design system" });
  }
}

let commit = "";
try {
  commit = git("rev-parse", "--short", "HEAD") + (git("status", "--porcelain", "--", "src").length ? "+local" : "");
} catch { commit = "?"; }
const hoje = new Date().toISOString().slice(0, 10);

// A baseline conta o que está COMMITADO em HEAD, não a árvore de trabalho:
// assim ela é reproduzível pelo hash e não absorve trabalho pela metade.
let contagemBaseline = null;
if (GRAVAR_BASELINE) {
  const doHead = [];
  const arquivosHead = git("ls-tree", "-r", "--name-only", "HEAD", "--", "src")
    .split("\n")
    .filter((r) => /\.(tsx|ts|css)$/.test(r) && !r.endsWith(".d.ts") && !IGNORADOS.has(r));
  for (const rel of arquivosHead) doHead.push(...analisar(rel, versaoNaBase("HEAD", rel), join(raiz, rel)));
  contagemBaseline = contagem(doHead);
  const head = git("rev-parse", "--short", "HEAD");
  writeFileSync(BASELINE, JSON.stringify({ gerado_em: hoje, commit: head, regras: contagemBaseline }, null, 2) + "\n");
  atualizarMedicoes(head, contagemBaseline);
}

const falhou = !GRAVAR_BASELINE && (subiram.length > 0 || reprovados.length > 0);

if (JSON_OUT) {
  console.log(JSON.stringify({
    modo: CHANGED ? "changed" : "completo", mergeBase: base, commit, arquivos: escopo.length,
    contagem: { escopo: contagem(achados), global }, baseline: baseline?.regras ?? null,
    catraca: { subiram, cairam }, reprovados, achados, ok: !falhou,
  }, null, 2));
} else {
  imprimir();
}
process.exit(falhou ? 1 : 0);

// ---------------------------------------------------------------- saída

function imprimir() {
  const porArquivo = new Map();
  for (const a of achados) (porArquivo.get(a.arquivo) ?? porArquivo.set(a.arquivo, []).get(a.arquivo)).push(a);
  for (const [arq, lista] of porArquivo) {
    console.log(`\n${arq}`);
    for (const a of lista) console.log(`  ${arq}:${a.linha}  ${a.nivel.padEnd(5)} ${a.id.padEnd(8)} ${REGRAS[a.id].titulo}  [${a.trecho}]`);
  }
  const esc = contagem(achados);
  console.log(`\n== design:lint (${CHANGED ? `--changed vs ${base.slice(0, 7)}, ${escopo.length} arquivos` : `src inteiro, ${escopo.length} arquivos`}) · ${commit}`);
  console.log(`${"regra".padEnd(9)} ${"nível".padEnd(6)} ${"escopo".padStart(7)} ${"global".padStart(7)} ${"baseline".padStart(9)}`);
  for (const id of IDS) {
    const b = baseline?.regras?.[id];
    const marca = b === undefined ? "" : global[id] > b ? (REGRAS[id].nivel === "ERRO" ? "  ▲ SUBIU" : "  ▲") : global[id] < b ? "  ▼" : "";
    console.log(`${id.padEnd(9)} ${REGRAS[id].nivel.padEnd(6)} ${String(esc[id]).padStart(7)} ${String(global[id]).padStart(7)} ${String(b ?? "—").padStart(9)}${marca}`);
  }
  if (!baseline) console.log("\nSem docs/design/lint-baseline.json: catraca desligada. Gere com --baseline.");
  for (const id of subiram) {
    console.log(`\nCATRACA: ${id} subiu de ${baseline.regras[id]} para ${global[id]} no src inteiro. A contagem de erro só pode cair; corrija a violação nova (veja a lista acima ou rode com --changed).`);
  }
  if (cairam.length && !GRAVAR_BASELINE) console.log(`\nCaiu abaixo da baseline: ${cairam.join(", ")}. Rode \`npm run design:lint -- --baseline\` para travar o ganho.`);
  if (reprovados.length) {
    console.log("\nReprovado:");
    for (const r of reprovados) console.log(`  ${r.arquivo}: ${r.motivo}`);
  }
  if (GRAVAR_BASELINE) {
    console.log(`\nBaseline gravada em docs/design/lint-baseline.json e docs/design/medicoes.md (${hoje}, contagem do HEAD commitado):`);
    console.log("  " + IDS.map((id) => `${id}=${contagemBaseline[id]}`).join("  "));
  }
  console.log(falhou ? "\nRESULTADO: reprovado" : "\nRESULTADO: ok");
}

function atualizarMedicoes(commit, global) {
  const titulo = "## Lint — contagens";
  const cab = `| Data | Commit | ${IDS.join(" | ")} |`;
  const sep = `|---|---|${IDS.map(() => "---:").join("|")}|`;
  const linha = `| ${hoje} | \`${commit}\` | ${IDS.map((id) => global[id]).join(" | ")} |`;
  let md = existsSync(MEDICOES) ? readFileSync(MEDICOES, "utf8") : "# Medições do design system v2\n";
  const ini = md.indexOf(titulo);
  let linhas = [];
  if (ini >= 0) {
    const fim = md.indexOf("\n## ", ini + titulo.length);
    const secao = md.slice(ini, fim < 0 ? md.length : fim);
    linhas = secao.split("\n").filter((l) => /^\| \d{4}-\d{2}-\d{2} \|/.test(l));
    md = md.slice(0, ini) + md.slice(fim < 0 ? md.length : fim + 1);
  }
  linhas = linhas.filter((l) => !l.includes(`\`${commit}\``));
  linhas.push(linha);
  const secao = [
    titulo,
    "",
    "Gerada por `npm run design:lint -- --baseline`, que também regrava `docs/design/lint-baseline.json` (a catraca). Contagem no `src/` inteiro do commit indicado (a árvore commitada, não o que está sem commit), uma linha por gravação. Regras de ERRO: V1–V4, V16, V18, V19; o resto é aviso. IDs de `DESIGN.md` §10; `V3-matiz` é a parte de V3 sem token equivalente (indigo/purple/violet/fuchsia/pink). V2 conta só `.tsx`, fora de comentário, de seletor de atributo e da allowlist; por isso é menor que o \"hex\" do codemod, que conta `.ts` também. A vitrine fica fora de V2–V4 porque reproduz o \"antes\" de propósito.",
    "",
    cab,
    sep,
    ...linhas,
    "",
  ].join("\n");
  md = md.replace(/\s*$/, "\n\n") + secao;
  writeFileSync(MEDICOES, md);
}
