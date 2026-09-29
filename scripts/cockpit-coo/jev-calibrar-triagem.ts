// Calibração do assistente de triagem do Cockpit do COO (Jev), 29/09/2026.
//
// Tema: rótulo REAL, sem trabalho humano: cada KR do quadro de OKRs da Expansão Nacional pertence a
// uma pasta (departamento), e o mapa tema → departamento foi aprovado pelo COO. Pergunta: o Jev,
// lendo só o nome da KR e do objetivo, acerta o tema?
// Unidade: conjunto SINTÉTICO (frases de compromisso escritas para o teste, com a resposta certa),
// porque nenhuma fonte real ainda traz tarefa com unidade. Marcado como sintético no relatório.
//
// Uso (somente leitura no banco; a chave OpenRouter vem do Keychain e não sai do processo):
//   node scripts/cockpit-coo/jev-calibrar-triagem.ts
// Saída: docs/dev_notes/cockpit-coo/jev-calibracao.json e .md
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { JEV_ENDPOINT, validarResposta } from "../../src/lib/cockpit-ceo/jev/contrato.ts";
import { temasDoDepartamento, TEMAS } from "../../src/lib/cockpit-coo/contrato.ts";
import { lerUnidades } from "../../src/lib/cockpit-coo/unidades.ts";
import { confiancaDa, pedidoTriagem, textoDaTarefa, TAXONOMIA_TRIAGEM } from "../../src/lib/cockpit-coo/triagem.ts";

// fileURLToPath: o caminho tem espaço ("AI Projects"); `.pathname` devolveria "%20".
const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const ENV = "/Users/pluca/Desktop/AI Projects/PM Work/execution/brain-financeiro-planning/.deploy.local.env";
const token = readFileSync(ENV, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1]?.replace(/["'\r\s]/g, "");
if (!token) throw new Error("PAT do Supabase ausente");
const chave = execFileSync("security", ["find-generic-password", "-s", "planning-openrouter-cockpit-2", "-w"]).toString().trim();

async function sql(query: string) {
  const r = await fetch("https://api.supabase.com/v1/projects/npknehhyyzelmrbbxvtu/database/query", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "curl/8" },
    body: JSON.stringify({ query: `begin transaction read only; ${query}; rollback;` }),
  });
  if (!r.ok) throw new Error(`SQL ${r.status}`);
  return (await r.json()) as Record<string, unknown>[];
}

const unidades = lerUnidades((await sql("select id, nome_da_praca, tipo, data_inauguracao from ops.unidades order by id")) as never);
const krs = await sql(
  "select distinct on (kr_id) kr_id, departamento, objetivo, kr_nome from growth.okr_snapshot where dia = (select max(dia) from growth.okr_snapshot) order by kr_id",
);

// Frases sintéticas de compromisso, com a unidade certa (id do cadastro, 'rede' ou 'nenhuma').
const SINTETICOS: [string, string][] = [
  ["Cobrar a fatura de royalties de agosto de Belém", "u3"],
  ["Reunião com o sócio de Curitiba sobre o CAC do trimestre", "u1"],
  ["Rever a carteira do Rio antes do comitê", "u4"],
  ["Destravar a abertura da unidade de Recife (contrato social)", "u13"],
  ["Checar onboarding parado em Patos de Minas", "u2"],
  ["Plano de ação de churn para São Luís", "u6"],
  ["Contratar analista fiscal para Fortaleza", "u7"],
  ["Alinhar a base de Maceió com o Matheus", "u8"],
  ["Visita técnica em Campo Novo do Parecis", "u5"],
  ["Rever as metas do Pacto Trimestral de todas as unidades", "rede"],
  ["Enviar o ranking do IDU para todos os sócios regionais", "rede"],
  ["Padronizar o processo de repasse da rede", "rede"],
  ["Atualizar o manual de marca do site da matriz", "nenhuma"],
  ["Renovar o contrato do ClickUp", "nenhuma"],
  ["Fechar a DRE projetada do grupo com a controladoria", "nenhuma"],
  ["Resolver o caixa da Matriz em outubro", "u9"],
  ["Cobrar o time da Partners sobre as notas em aberto", "u9"],
  ["Proposta de Consultoria Tributária para os clientes da Construção Civil", "u10"],
  ["Pipeline da Consultoria: 3 propostas paradas", "u11"],
  ["Sorocaba: definir sócio operador", "u14"],
  ["São Bernardo: aprovar o layout do escritório", "u12"],
  ["Operação de São Paulo: rever a folha", "u15"],
  ["Cobrar o NPS dos detratores de Belém e do Rio", "rede"],
  ["Sudeste (RJ): reunião de resultados de setembro", "u4"],
];

async function jev(pedido: ReturnType<typeof pedidoTriagem>) {
  const r = await fetch(JEV_ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
    body: JSON.stringify(pedido),
  });
  const texto = await r.text();
  if (r.status !== 200) return { erro: `http_${r.status}` };
  const v = validarResposta(JSON.parse(texto), pedido.questions);
  return { v };
}

type Linha = { id: string; pergunta: "tema" | "unidade"; esperado: string; escolha: string | null; confianca: number | null; custo: number | null; erro?: string };
const linhas: Linha[] = [];
let custo = 0;

for (const k of krs) {
  const esperado = temasDoDepartamento(String(k.departamento))[0];
  if (!esperado) continue;
  const texto = textoDaTarefa({ nome: `${k.kr_nome}`, lista: `Objetivo: ${k.objetivo}` });
  const r = await jev(pedidoTriagem(texto, unidades, { tema: true, unidade: false }));
  if ("erro" in r) { linhas.push({ id: String(k.kr_id), pergunta: "tema", esperado, escolha: null, confianca: null, custo: null, erro: r.erro }); continue; }
  const t = r.v.respostas.tema;
  custo += r.v.custoUsd ?? 0;
  linhas.push({ id: String(k.kr_id), pergunta: "tema", esperado, escolha: t?.type === "choice" ? t.choice : null, confianca: confiancaDa(t), custo: r.v.custoUsd });
}
for (const [i, [frase, esperado]] of SINTETICOS.entries()) {
  const r = await jev(pedidoTriagem(textoDaTarefa({ nome: frase }), unidades, { tema: false, unidade: true }));
  if ("erro" in r) { linhas.push({ id: `s${i}`, pergunta: "unidade", esperado, escolha: null, confianca: null, custo: null, erro: r.erro }); continue; }
  const u = r.v.respostas.unidade;
  custo += r.v.custoUsd ?? 0;
  linhas.push({ id: `s${i}`, pergunta: "unidade", esperado, escolha: u?.type === "choice" ? u.choice : null, confianca: confiancaDa(u), custo: r.v.custoUsd });
}

function curva(p: "tema" | "unidade") {
  const ls = linhas.filter((l) => l.pergunta === p && !l.erro);
  return [0, 0.5, 0.6, 0.7, 0.8, 0.85, 0.9].map((lim) => {
    const acima = ls.filter((l) => (l.confianca ?? 0) >= lim);
    const certos = acima.filter((l) => l.escolha === l.esperado).length;
    return { limiar: lim, acima: acima.length, de: ls.length, acerto: acima.length ? certos / acima.length : null };
  });
}

const saida = {
  taxonomia: TAXONOMIA_TRIAGEM,
  em: new Date().toISOString(),
  amostras: { tema: linhas.filter((l) => l.pergunta === "tema").length, unidade: linhas.filter((l) => l.pergunta === "unidade").length },
  falhas: linhas.filter((l) => l.erro).length,
  custoUsd: Number(custo.toFixed(6)),
  curvas: { tema: curva("tema"), unidade: curva("unidade") },
  confusoesTema: linhas.filter((l) => l.pergunta === "tema" && l.escolha !== l.esperado).map((l) => ({ kr: l.id, esperado: l.esperado, escolha: l.escolha, confianca: l.confianca })),
  errosUnidade: linhas.filter((l) => l.pergunta === "unidade" && l.escolha !== l.esperado).map((l) => ({ id: l.id, esperado: l.esperado, escolha: l.escolha, confianca: l.confianca })),
  linhas,
};
mkdirSync(`${RAIZ}docs/dev_notes/cockpit-coo`, { recursive: true });
writeFileSync(`${RAIZ}docs/dev_notes/cockpit-coo/jev-calibracao.json`, JSON.stringify(saida, null, 2));
const tab = (p: "tema" | "unidade") =>
  saida.curvas[p].map((c) => `| ${c.limiar} | ${c.acima} de ${c.de} | ${c.acerto == null ? "—" : `${(c.acerto * 100).toFixed(1)}%`} |`).join("\n");
writeFileSync(
  `${RAIZ}docs/dev_notes/cockpit-coo/jev-calibracao.md`,
  `# Calibração da triagem do Cockpit do COO (Jev), ${saida.em.slice(0, 10)}

Taxonomia \`${TAXONOMIA_TRIAGEM}\`. ${saida.amostras.tema} KRs reais (tema rotulado pelo departamento, mapa aprovado pelo COO) e ${saida.amostras.unidade} frases SINTÉTICAS de compromisso (unidade). Falhas de chamada: ${saida.falhas}. Custo informado: US$ ${saida.custoUsd}.

## Tema (rótulo real)
| Limiar | Sugestões acima | Acerto |
|---|---|---|
${tab("tema")}

## Unidade (conjunto sintético)
| Limiar | Sugestões acima | Acerto |
|---|---|---|
${tab("unidade")}

Temas: ${Object.values(TEMAS).map((t) => t.titulo).join(", ")}. Dados completos em \`jev-calibracao.json\`.
`,
);
console.log(JSON.stringify({ amostras: saida.amostras, falhas: saida.falhas, custoUsd: saida.custoUsd, curvas: saida.curvas }, null, 1));
