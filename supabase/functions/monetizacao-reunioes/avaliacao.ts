/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive, do banco e do modelo chega sem tipo. */
// Avaliação de reunião da Monetização pelo playbook do Caixa. Porte de
// monetizacao/comercial/guia-closer/avaliacao/avaliar.py (protótipo validado em 01/10/2026), que segue o método da
// aderência de reunião do Growth: a IA não dá nota; para cada fase ela diz sim, parcial ou não com um trecho LITERAL
// da transcrição; o código confere o trecho e calcula a nota. Sem API do Deno aqui: o módulo roda também no Node, nos
// testes de scripts/monetizacao/testar-avaliacao-reunioes.mjs.
import { RUBRICA, type Execucao } from "./rubrica.ts";

export type TipoReuniao = "levantamento" | "proposta";
export type Fala = { ordem: number; inicio_s: number | string; falante: string; texto: string };
type Bruto = Record<string, any>;

export type FaseApurada = {
  id: number;
  nome: string;
  peso: number;
  executou: Execucao;
  rebaixada: boolean;
  evidencia: string;
  antipadroes: string[];
  nota_curta: string;
};
export type Avaliacao = {
  tipo: TipoReuniao;
  versao_rubrica: string;
  nota: number | null;
  blocos: Record<string, number | null>;
  fases: FaseApurada[];
  ofertado: Record<
    "cella" | "consultoria" | "finance",
    { apresentado: "sim" | "nao"; evidencia: string }
  >;
  produtos_que_seguem: string[];
  quem_falou_mais: string | null;
  desfecho: string | null;
  recomendacao: string;
};

const PRODUTOS = ["cella", "consultoria", "finance"] as const;

/** As falas do Brain Meet no formato que o modelo lê: "[mm:ss] Falante N: texto", uma por linha. */
export function transcricaoDasFalas(falas: Fala[]): string {
  return [...falas]
    .sort((a, b) => a.ordem - b.ordem)
    .map((f) => {
      const s = Number(f.inicio_s) || 0;
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(Math.floor(s % 60)).padStart(2, "0");
      return `[${mm}:${ss}] ${f.falante}: ${f.texto}`;
    })
    .join("\n");
}

/** Minúsculas, sem acento, só letras e dígitos separados por um espaço (o normal() do protótipo). */
export function normal(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** O trecho conta se aparece inteiro na transcrição ou numa janela de 12 palavras seguidas. */
export function confere(evidencia: string | undefined, baseNormal: string, janela = 12): boolean {
  const e = normal(evidencia || "");
  if (e.length < 30) return false;
  if (baseNormal.includes(e)) return true;
  const pal = e.split(" ");
  if (pal.length < janela) return false;
  for (let i = 0; i + janela <= pal.length; i++)
    if (baseNormal.includes(pal.slice(i, i + janela).join(" "))) return true;
  return false;
}

export function montarSystem(tipo: TipoReuniao): string {
  const t = RUBRICA.tipos[tipo];
  const fases = t.fases
    .map((f) => {
      const ev = f.evidencias.map((e) => `  - ${e}`).join("\n");
      const ap =
        Object.entries(f.antipadroes)
          .map(([k, v]) => `  - ${k}: ${v}`)
          .join("\n") || "  (nenhum)";
      return `### Fase ${f.id}: ${f.nome}\nObjetivo: ${f.objetivo}\nEvidências esperadas:\n${ev}\nAntipadrões (use estes ids):\n${ap}`;
    })
    .join("\n\n");
  const leitura = Object.entries(RUBRICA.leitura)
    .map(([k, v]) => `- "${k}": ${v}`)
    .join("\n");
  return `Você é o gerente comercial do Caixa de Oportunidade da Planning (Departamento de Receitas). O Caixa junta três
frentes vendidas aos clientes de contabilidade da rede: Cella (tese tributária judicial, especialista Igor), Consultoria
(recuperação administrativa de crédito, especialista Jordana) e Finance (captação de crédito mais barato, especialista
Dárcio). Você recebe a TRANSCRIÇÃO de uma ${t.titulo.toUpperCase()}, separada por falante, e o PLAYBOOK da casa para esse
tipo de reunião.

Sua tarefa é UMA só: verificar, fase por fase, se a Planning executou o que o playbook manda. Você NÃO dá nota.

REGRAS CRÍTICAS:
1. Retorne APENAS JSON válido, sem markdown, sem texto antes ou depois.
2. Para cada fase, responda "executou": "sim" | "parcial" | "nao".
   - "sim": a maioria das evidências esperadas aparece. Não exija todas.
   - "parcial": a fase aconteceu de forma claramente incompleta.
   - "nao": a fase não aconteceu.
3. Toda fase "sim" ou "parcial" EXIGE "evidencia": um trecho LITERAL da transcrição, copiado caractere por caractere,
   de 40 a 300 caracteres, sem o nome do falante. Não parafraseie. Se não consegue copiar um trecho que prove, é "nao".
4. "antipadroes": ids da fase que você observou, cada um com prova literal em "evidencia_antipadrao". Na dúvida, não
   marque. Antipadrão é exceção.
5. A gravação cobre a conversa inteira. Fase ausente é fase pulada.
6. Falantes podem vir sem nome ("Falante 1"). Identifique pelo conteúdo quem é da Planning (o closer, que apresenta a
   Planning e conduz) e quem é o cliente. Especialistas convidados (Igor, Jordana, Dárcio, ou alguém da Diehl & Cella)
   contam como Planning.
7. Português do Brasil, direto, sem emoji, sem travessão.

PLAYBOOK (${t.titulo}):

${fases}

LEITURA (responda junto, no fim):
${leitura}

SCHEMA EXATO:
{
  "fases": [{"id": <int>, "executou": "sim"|"parcial"|"nao", "evidencia": "<trecho literal ou vazio>",
             "antipadroes": ["<id>"], "evidencia_antipadrao": {"<id>": "<trecho literal>"},
             "nota_curta": "<uma frase objetiva sobre a fase>"}],
  "ofertado": {"cella": {"apresentado": "sim"|"nao", "evidencia": "<trecho literal ou vazio>"},
               "consultoria": {"apresentado": "sim"|"nao", "evidencia": "<trecho literal ou vazio>"},
               "finance": {"apresentado": "sim"|"nao", "evidencia": "<trecho literal ou vazio>"}},
  "produtos_que_seguem": ["cella"|"consultoria"|"finance"],
  "quem_falou_mais": "closer"|"cliente"|"equilibrado",
  "desfecho": "proxima_reuniao_marcada"|"proposta_combinada"|"sem_proximo_passo"|"cliente_encerrou",
  "recomendacao": "<uma ou duas frases>"
}`;
}

export const mensagemUsuario = (transcricao: string) =>
  "TRANSCRIÇÃO DA REUNIÃO (separada por falante):\n\n" +
  transcricao +
  "\n\nRetorne apenas o JSON conforme o schema. Evidência é trecho LITERAL copiado da transcrição.";

/** Lê o JSON do modelo, tolerando a cerca ```json que às vezes vem em volta. */
export function lerResposta(conteudo: string): Bruto {
  const limpo = conteudo
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return JSON.parse(limpo);
}

const umaCasa = (x: number) => Math.round(x * 10) / 10;

export function apurar(tipo: TipoReuniao, resposta: Bruto, transcricao: string): Avaliacao {
  const t = RUBRICA.tipos[tipo];
  const base = normal(transcricao);
  const cred = RUBRICA.credito;
  const porId = new Map<number, Bruto>((resposta.fases || []).map((f: Bruto) => [Number(f.id), f]));
  const fases: FaseApurada[] = t.fases.map((f) => {
    const r = porId.get(f.id) || {};
    const ex: Execucao = ["sim", "parcial", "nao"].includes(r.executou) ? r.executou : "nao";
    const ok = ex === "nao" || confere(r.evidencia, base);
    const provas = r.evidencia_antipadrao || {};
    const aps = (r.antipadroes || []).filter(
      (a: string) => a in f.antipadroes && confere(provas[a], base),
    );
    return {
      id: f.id,
      nome: f.nome,
      peso: f.peso,
      executou: ok ? ex : "nao",
      rebaixada: !ok,
      evidencia: ok ? r.evidencia || "" : "",
      antipadroes: aps,
      nota_curta: r.nota_curta || "",
    };
  });
  const nota = (ids: number[]) => {
    const fs = fases.filter((x) => ids.includes(x.id));
    const peso = fs.reduce((s, x) => s + x.peso, 0);
    return peso
      ? umaCasa((10 * fs.reduce((s, x) => s + cred[x.executou] * x.peso, 0)) / peso)
      : null;
  };
  const ofertado = {} as Avaliacao["ofertado"];
  for (const p of PRODUTOS) {
    const o = (resposta.ofertado || {})[p] || {};
    const sim = o.apresentado === "sim" && confere(o.evidencia, base);
    ofertado[p] = { apresentado: sim ? "sim" : "nao", evidencia: sim ? o.evidencia || "" : "" };
  }
  const blocos: Record<string, number | null> = {};
  for (const [b, ids] of Object.entries(t.blocos)) blocos[b] = nota(ids);
  return {
    tipo,
    versao_rubrica: RUBRICA.versao,
    nota: nota(t.fases.map((f) => f.id)),
    blocos,
    fases,
    ofertado,
    produtos_que_seguem: (resposta.produtos_que_seguem || []).filter((p: string) =>
      (PRODUTOS as readonly string[]).includes(p),
    ),
    quem_falou_mais: resposta.quem_falou_mais ?? null,
    desfecho: resposta.desfecho ?? null,
    recomendacao: resposta.recomendacao || "",
  };
}

const ROTULO_BLOCO: Record<string, string> = {
  abertura: "Abertura",
  diagnostico: "Diagnóstico",
  saida: "Saída",
  proposta: "Proposta",
};
const MARCA: Record<Execucao, string> = { sim: "✔", parcial: "◐", nao: "✘" };
const NOME: Record<string, string> = {
  cella: "Cella",
  consultoria: "Consultoria",
  finance: "Finance",
};
const esc = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!,
  );
const br = (x: number | null) => (x === null ? "—" : x.toFixed(1).replace(".", ","));

/** O HTML da nota do card (nota_pipedrive() do protótipo). */
export function notaPipedrive(av: Avaliacao, dataReuniao: string, fonte: string): string {
  const t = RUBRICA.tipos[av.tipo];
  const partes = [
    "<b>Avaliação da reunião por IA (playbook do Caixa) - confira antes de usar</b><br><br>",
    `<b>${esc(t.titulo)} · ${esc(dataReuniao)} · nota ${br(av.nota)}/10</b><br><br>`,
  ];
  for (const b of Object.keys(t.blocos))
    partes.push(`${ROTULO_BLOCO[b] ?? b} - ${br(av.blocos[b])}/10<br>`);
  partes.push("<br>");
  for (const f of av.fases) {
    let linha = `${MARCA[f.executou]} <b>${esc(f.nome)}</b>: ${esc(f.nota_curta)}`;
    if (f.evidencia) {
      const trecho = f.evidencia.length <= 160 ? f.evidencia : f.evidencia.slice(0, 157) + "...";
      linha += ` <i>"${esc(trecho)}"</i>`;
    }
    if (f.antipadroes.length) linha += ` · atenção: ${esc(f.antipadroes.join(", "))}`;
    partes.push(linha + "<br>");
  }
  const of = PRODUTOS.map(
    (p) => `${NOME[p]} ${av.ofertado[p].apresentado === "sim" ? "sim" : "não"}`,
  ).join(" · ");
  const seg = av.produtos_que_seguem.map((p) => NOME[p]).join(", ") || "nenhum";
  partes.push(
    `<br><b>O que foi ofertado:</b> ${of}<br>`,
    `<b>Segue para a proposta:</b> ${seg}<br>`,
    `<b>Para a próxima:</b> ${esc(av.recomendacao)}<br><br>`,
    `<i>Base: ${esc(fonte)}; rubrica de ${RUBRICA.versao}. Trecho que não foi achado na transcrição não conta.</i>`,
  );
  return partes.join("");
}

/** Nota curta para reunião que não foi gravada ou ficou sem conversa. */
export function notaSemGravacao(tipo: TipoReuniao, dataReuniao: string, motivo: string): string {
  const t = RUBRICA.tipos[tipo];
  return (
    `<b>${esc(t.titulo)} de ${esc(dataReuniao)} sem gravação</b>: ${esc(motivo)}.<br>` +
    "Para a próxima, admita o convidado <b>Planning - Assistente de Reuniao</b> no lobby do Teams, " +
    "e confira se a atividade de Reunião do card tem o link e a hora certos.<br><br>" +
    "<i>Nota automática da Monetização (Planning Brain).</i>"
  );
}
