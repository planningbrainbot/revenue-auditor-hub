/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive, do banco e do modelo chega sem tipo. */
// Avaliação automática das ligações da pré-venda da Monetização (pipe 39). Pedido do Pedro em 09/10/2026 (E3 do PRD
// da tela Pré-venda). Contrato das tabelas: monetizacao/outputs/2026-10-09-pre-venda-v2/contrato-pre-venda.md.
//
// Uma rodada (a cada 5 minutos):
//   a. Captura: as atividades de ligação (type=call) de todos os usuários, de hoje e dos 2 dias anteriores, só dos
//      cards do pipe 39, no formato da Api4Com ("Ligação para (DD) … atendida às … duração: HH:MM:SS" ou "… não foi
//      atendida pelo seguinte motivo: …"), vão para ops.monetizacao_ligacoes. Atividade manual fica de fora.
//   b. Escolha (decisão 3B): por card, a ligação atendida mais longa, com 60 s ou mais e mp3. Mudou a escolhida, a
//      avaliação do card volta a "pendente" (as notas do card são reaproveitadas).
//   c. Transcrição de UMA ligação pela OpenRouter (modelo com áudio), pendente → transcrevendo → transcrita.
//   d. Avaliação de UMA transcrição contra o script v2 (rubrica-ligacao.ts) → avaliada, com a nota calculada no código.
//   e. Duas notas no card (qualificação para o sócio e avaliação), sempre as MESMAS: refeita a avaliação, a nota é
//      atualizada (PUT), não duplicada.
//
// Sem API do Deno: roda na Edge Function (index.ts) e nos testes do Node (tests/monetizacao-ligacoes.test.mjs).
// Pipedrive, banco, download e IA entram injetados.
import {
  VERSAO_REGUA,
  apurar,
  lerResposta,
  mensagemUsuario,
  montarSystem,
  transcricaoTexto,
  type Avaliacao,
  type Fala,
} from "./rubrica-ligacao.ts";

export const FUSO = "America/Sao_Paulo";
export const DURACAO_MINIMA_SEG = 60;
/** Dias anteriores a hoje (São Paulo) que a captura relê a cada rodada. */
export const DIAS_ANTERIORES = 2;
/** Tempo de trabalho por rodada. O cron espera 150 s pela função. */
export const ORCAMENTO_MS = 125_000;
/** Teto do áudio: o mp3 vai em base64 dentro do JSON, e o Gemini recusa pedido acima de ~20 MB. */
export const LIMITE_MP3_BYTES = 14 * 1024 * 1024;
/** Tentativas de transcrição ou avaliação antes de a linha ir para "erro". */
export const MAX_TENTATIVAS = 3;
/** A Api4Com publica o mp3 uns 30 minutos depois da ligação. Depois disso, áudio que não abre é erro. */
export const ESPERA_AUDIO_MS = 6 * 60 * 60 * 1000;
/** Linha presa em "transcrevendo" (rodada que morreu no meio) volta para a fila depois disso. */
export const TRAVADA_MS = 10 * 60 * 1000;
export const NOTAS_POR_RODADA = 5;
export const TEMPO_TRANSCRICAO_MS = 60_000;
export const TEMPO_AVALIACAO_MS = 95_000;

export const MODELO_TRANSCRICAO = "google/gemini-3.8-flash";
export const MODELO_AVALIACAO = "anthropic/claude-sonnet-5.5";

// ---------------------------------------------------------------------------- datas

const pad = (n: number) => String(n).padStart(2, "0");
const relogioSP = new Intl.DateTimeFormat("en-US", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
function partesSP(ms: number) {
  const p: Record<string, number> = {};
  for (const x of relogioSP.formatToParts(new Date(ms)))
    if (x.type !== "literal") p[x.type] = Number(x.value);
  return p;
}

/** Data de São Paulo (aaaa-mm-dd). */
export function dataSP(quando: Date): string {
  const p = partesSP(quando.getTime());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** O instante em que o relógio de São Paulo marca `dd/mm/aaaa hh:mm:ss`. Deslocamento lido do Intl. */
export function instanteSaoPaulo(dataBr: string, hora: string): Date | null {
  const d = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dataBr.trim());
  const h = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(hora.trim());
  if (!d || !h) return null;
  const parede = Date.UTC(+d[3], +d[2] - 1, +d[1], +h[1], +h[2], +(h[3] || 0));
  const deslocamento = (ms: number) => {
    const p = partesSP(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - ms;
  };
  let t = parede - deslocamento(parede);
  const conferido = parede - deslocamento(t);
  if (conferido !== t) t = conferido;
  return Number.isNaN(t) ? null : new Date(t);
}

/** Campo de data do Pipedrive ("AAAA-MM-DD HH:MM:SS" em UTC, ou ISO). */
export function instanteUtc(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const semFuso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(s);
  const t = semFuso ? Date.parse(`${semFuso[1]}T${semFuso[2]}Z`) : Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/** Janela da captura: hoje e os 2 dias anteriores em São Paulo. `ate` da API vai um dia além (due_date é UTC). */
export function janela(agora: Date): { de: string; ate: string; ate_api: string } {
  const hoje = dataSP(agora);
  return { de: somarDias(hoje, -DIAS_ANTERIORES), ate: hoje, ate_api: somarDias(hoje, 1) };
}

// ---------------------------------------------------------------------------- formato da Api4Com

export type LigacaoApi4Com = {
  telefone: string;
  atendida: boolean;
  /** "atendida às", em UTC (ISO). Só na atendida. */
  inicio: string | null;
  duracao_seg: number;
  motivo: string | null;
  mp3_url: string | null;
};

// Regex do Growth (marketing-planning, automacoes/pipedrive-snapshot/atividades_lib.py), sobre assunto + nota.
const RE_ATENDIDA =
  /Liga[çc][ãa]o para\s+(\(\d{2}\)\s*[\d\-\s]+?)\s+atendida\s+[àa]s\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})\s+e\s+encerrada\s+[àa]s\s+(\d{2}\/\d{2}\/\d{4})\s+(\d{2}:\d{2}:\d{2})/i;
const RE_DURACAO = /dura[çc][ãa]o:\s*(\d{1,2}):(\d{2}):(\d{2})/i;
const RE_NAO_ATENDIDA =
  /Liga[çc][ãa]o para\s+(\(\d{2}\)\s*[\d\-\s]+?)\s+n[ãa]o\s+foi\s+atendida\s+pelo\s+seguinte\s+motivo:\s*([^\n<]+)/i;
const RE_MP3 = /https?:\/\/[^\s"'<>)\]]*api4com\.com\/[^\s"'<>)\]]+\.mp3/i;

const limpaTelefone = (s: string) => s.replace(/\s+/g, " ").trim();

/** Lê a atividade de ligação criada pela integração Api4Com → Pipedrive. Texto livre do pré-vendedor = null. */
export function lerApi4Com(assunto: unknown, nota: unknown): LigacaoApi4Com | null {
  const texto = `${String(assunto ?? "")} ${String(nota ?? "")}`;
  const mp3 = RE_MP3.exec(texto)?.[0] ?? null;
  const a = RE_ATENDIDA.exec(texto);
  if (a) {
    const inicio = instanteSaoPaulo(a[2], a[3]);
    const fim = instanteSaoPaulo(a[4], a[5]);
    const d = RE_DURACAO.exec(texto);
    const duracao = d
      ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3])
      : inicio && fim
        ? Math.max(0, Math.round((fim.getTime() - inicio.getTime()) / 1000))
        : 0;
    return {
      telefone: limpaTelefone(a[1]),
      atendida: true,
      inicio: inicio ? inicio.toISOString() : null,
      duracao_seg: duracao,
      motivo: null,
      mp3_url: mp3,
    };
  }
  // O motivo fecha o assunto; a nota (quando houver) não entra nele.
  const n = RE_NAO_ATENDIDA.exec(String(assunto ?? "")) ?? RE_NAO_ATENDIDA.exec(texto);
  if (n)
    return {
      telefone: limpaTelefone(n[1]),
      atendida: false,
      inicio: null,
      duracao_seg: 0,
      motivo: n[2].trim() || null,
      mp3_url: null,
    };
  return null;
}

/** Uma linha de ops.monetizacao_ligacoes. */
export type Ligacao = {
  activity_id: number;
  deal_id: number;
  user_id: number | null;
  pessoa: string | null;
  inicio: string | null;
  duracao_seg: number;
  atendida: boolean;
  motivo: string | null;
  mp3_url: string | null;
  telefone: string | null;
};

/** A atividade do Pipedrive como linha de ligação; null quando não é do formato da Api4Com. */
export function ligacaoDaAtividade(a: any): Ligacao | null {
  const l = lerApi4Com(a?.subject, a?.note);
  const id = Number(a?.id),
    deal = Number(a?.deal_id);
  if (!l || !id || !deal) return null;
  const dono = Number(typeof a.user_id === "object" && a.user_id ? a.user_id.id : a.user_id);
  // Não atendida não traz hora no texto: vale a da atividade (due_date + due_time, UTC), senão a de criação.
  const daAtividade =
    instanteUtc(a.due_date && a.due_time ? `${a.due_date} ${a.due_time}` : null) ??
    instanteUtc(a.add_time);
  return {
    activity_id: id,
    deal_id: deal,
    user_id: Number.isFinite(dono) && dono > 0 ? dono : null,
    pessoa: (a.owner_name || (typeof a.user_id === "object" ? a.user_id?.name : null) || null) as
      string | null,
    inicio: l.inicio ?? (daAtividade ? daAtividade.toISOString() : null),
    duracao_seg: l.duracao_seg,
    atendida: l.atendida,
    motivo: l.motivo,
    mp3_url: l.mp3_url,
    telefone: l.telefone,
  };
}

const CAMPOS_LIGACAO: (keyof Ligacao)[] = [
  "deal_id",
  "user_id",
  "pessoa",
  "inicio",
  "duracao_seg",
  "atendida",
  "motivo",
  "mp3_url",
  "telefone",
];

/** A linha do banco difere da lida agora? (o mp3 que chegou depois é o caso comum). */
export function mudou(atual: Partial<Ligacao>, nova: Ligacao): boolean {
  return CAMPOS_LIGACAO.some((k) => {
    const a = atual[k] ?? null,
      b = nova[k] ?? null;
    if (k === "inicio")
      return (a ? Date.parse(String(a)) : null) !== (b ? Date.parse(String(b)) : null);
    if (k === "deal_id" || k === "user_id" || k === "duracao_seg")
      return (a === null ? null : Number(a)) !== (b === null ? null : Number(b));
    return a !== b;
  });
}

/** Decisão 3B: a ligação atendida mais longa do card, com 60 s ou mais e mp3. Empate: a mais recente. */
export function escolher(ligacoes: readonly Ligacao[]): Ligacao | null {
  const candidatas = ligacoes.filter(
    (l) => l.atendida && !!l.mp3_url && Number(l.duracao_seg) >= DURACAO_MINIMA_SEG,
  );
  if (!candidatas.length) return null;
  return [...candidatas].sort(
    (a, b) =>
      Number(b.duracao_seg) - Number(a.duracao_seg) ||
      (Date.parse(b.inicio || "") || 0) - (Date.parse(a.inicio || "") || 0) ||
      Number(b.activity_id) - Number(a.activity_id),
  )[0];
}

// ---------------------------------------------------------------------------- avaliação do card

export type StatusAvaliacao = "pendente" | "transcrevendo" | "transcrita" | "avaliada" | "erro";

/** Uma linha de ops.monetizacao_ligacao_avaliacoes. */
export type LinhaAvaliacao = {
  deal_id: number;
  activity_id: number | null;
  user_id: number | null;
  pessoa: string | null;
  empresa: string | null;
  inicio: string | null;
  duracao_seg: number | null;
  mp3_url: string | null;
  status: StatusAvaliacao;
  erro: string | null;
  transcricao: Fala[] | null;
  avaliacao: Avaliacao | null;
  nota: number | null;
  regua_versao: string | null;
  nota_qualificacao_id: number | null;
  nota_avaliacao_id: number | null;
  tentativas: number;
  custo_usd: number | null;
  modelos: string | null;
  notas_em: string | null;
  atualizado_em?: string;
};

/** A linha do card zerada para a ligação escolhida. As notas do card ficam (serão atualizadas, não recriadas). */
export function linhaPendente(
  l: Ligacao,
  empresa: string | null,
  anterior: Partial<LinhaAvaliacao> | undefined,
  agora: Date,
): LinhaAvaliacao {
  return {
    deal_id: l.deal_id,
    activity_id: l.activity_id,
    user_id: l.user_id,
    pessoa: l.pessoa,
    empresa,
    inicio: l.inicio,
    duracao_seg: l.duracao_seg,
    mp3_url: l.mp3_url,
    status: "pendente",
    erro: null,
    transcricao: null,
    avaliacao: null,
    nota: null,
    regua_versao: null,
    nota_qualificacao_id: anterior?.nota_qualificacao_id ?? null,
    nota_avaliacao_id: anterior?.nota_avaliacao_id ?? null,
    tentativas: 0,
    custo_usd: null,
    modelos: null,
    notas_em: null,
    atualizado_em: agora.toISOString(),
  };
}

// ---------------------------------------------------------------------------- notas do card

const esc = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" })[c]!,
  );

/** "09/10/2026 14:32" em São Paulo. */
export function quandoSP(iso: string | null): string {
  if (!iso) return "data desconhecida";
  const p = partesSP(Date.parse(iso));
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** "9 min 48 s". */
export function duracaoTexto(seg: number | null): string {
  const s = Math.max(0, Math.round(Number(seg) || 0));
  return s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`;
}

const MARCA: Record<string, string> = { sim: "✔", parcial: "◐", nao: "✘" };
const SINAL: Record<string, string> = {
  segue: "segue",
  nao_segue: "não segue",
  sem_dado: "sem dado",
};
const NOME_FRENTE: Record<string, string> = { finance: "Finance", cella: "Cella" };
const nota1 = (x: number | null) =>
  x === null || x === undefined ? "—" : Number(x).toFixed(1).replace(".", ",");
const cabecalho = (l: LinhaAvaliacao) =>
  `<b>${esc(l.pessoa || "Pré-venda")} · ${esc(quandoSP(l.inicio))} · ${esc(duracaoTexto(l.duracao_seg))}</b>`;

/** Nota para o sócio da área: o que o cliente disse e o sinal por frente. */
export function notaQualificacaoHtml(l: LinhaAvaliacao): string {
  const q = l.avaliacao!.qualificacao;
  const partes = [
    "<b>Qualificação da ligação por IA (Planning Brain) — para o sócio da área · confira antes de usar</b><br><br>",
    `${cabecalho(l)}<br><br>`,
    `<b>Resumo:</b> ${esc(q.resumo || "o cliente não deu dado sobre as perguntas do script.")}<br><br>`,
  ];
  for (const f of q.frentes)
    partes.push(
      `<b>${NOME_FRENTE[f.frente] ?? esc(f.frente)}:</b> ${SINAL[f.sinal] ?? esc(f.sinal)}. ${esc(f.porque)}<br>`,
    );
  partes.push(
    `<br><b>Quem decide:</b> ${esc(q.quem_decide)}<br>`,
    `<b>Próximo passo:</b> ${esc(q.proximo_passo)}<br><br>`,
  );
  if (l.mp3_url) partes.push(`<a href="${esc(l.mp3_url)}">Ouvir a ligação</a><br><br>`);
  partes.push(
    "<i>Rascunho automático a partir da gravação da Api4Com. Sinal sem trecho achado na transcrição vira " +
      `"sem dado". Régua do script v2 (${esc(l.regua_versao || VERSAO_REGUA)}).</i>`,
  );
  return partes.join("");
}

/** Nota da aderência ao script: a nota, a trilha dos 3 blocos, as perguntas e os antipadrões. */
export function notaAvaliacaoHtml(l: LinhaAvaliacao): string {
  const av = l.avaliacao!;
  const partes = [
    "<b>Avaliação da ligação por IA (script v2) — confira antes de usar</b><br><br>",
    `${cabecalho(l)}<br>`,
    `<b>Aderência ao script: ${nota1(l.nota)}%</b><br><br>`,
  ];
  for (const b of av.blocos) {
    let linha = `${MARCA[b.executou] ?? ""} <b>${esc(b.titulo)}</b> (peso ${b.peso})`;
    if (b.nota_curta) linha += `: ${esc(b.nota_curta)}`;
    if (b.trecho) {
      const t = b.trecho.length <= 160 ? b.trecho : b.trecho.slice(0, 157) + "...";
      linha += ` <i>"${esc(t)}"</i>`;
    }
    partes.push(linha + "<br>");
  }
  const feitas = av.perguntas.filter((p) => p.feita).map((p) => p.titulo);
  const faltaram = av.perguntas.filter((p) => !p.feita).map((p) => p.titulo);
  partes.push(
    `<br><b>Perguntas feitas:</b> ${esc(feitas.join(", ") || "nenhuma")}<br>`,
    `<b>Faltaram:</b> ${esc(faltaram.join(", ") || "nenhuma")}<br><br>`,
  );
  if (av.antipadroes.length) {
    partes.push("<b>Atenção:</b><br>");
    for (const a of av.antipadroes)
      partes.push(`✘ ${esc(a.titulo)}: <i>"${esc(a.trecho)}"</i><br>`);
  } else partes.push("<b>Atenção:</b> nenhum antipadrão encontrado.<br>");
  partes.push(
    "<br><i>Nota = abertura (peso 1) + perguntas (peso 3, a fração das 4) + fechamento (peso 2), sobre 6. " +
      "Trecho que não foi achado na transcrição não conta. Antipadrão não desconta.</i>",
  );
  return partes.join("");
}

// ---------------------------------------------------------------------------- injeções

/** O Pipedrive v1. Erro HTTP sai como `Error("Pipedrive HTTP <status>")`. */
export type PipedriveLigacoes = {
  pages(path: string, params?: Record<string, string>): Promise<any[]>;
  post(path: string, payload: Record<string, unknown>): Promise<any>;
  put(path: string, payload: Record<string, unknown>): Promise<any>;
};

/** As duas tabelas (ops.monetizacao_ligacoes e ops.monetizacao_ligacao_avaliacoes) e os cards do pipe 39. */
export type StoreLigacoes = {
  /** Cards do pipe 39 (ops.monetizacao_deals): id → empresa. */
  dealsDoPipe(): Promise<Map<number, string | null>>;
  ligacoesPorAtividade(ids: number[]): Promise<Ligacao[]>;
  /** Upsert por activity_id. */
  gravarLigacoes(linhas: Ligacao[]): Promise<void>;
  ligacoesDosDeals(deals: number[]): Promise<Ligacao[]>;
  avaliacoesDosDeals(deals: number[]): Promise<LinhaAvaliacao[]>;
  /** Upsert por deal_id (a linha inteira). */
  gravarAvaliacao(linha: LinhaAvaliacao): Promise<void>;
  /** PATCH condicional; true = alguma linha casou. */
  atualizarAvaliacao(
    deal: number,
    patch: Partial<LinhaAvaliacao>,
    se?: { activity_id?: number | null; status?: StatusAvaliacao[] },
  ): Promise<boolean>;
  /** A pendente mais antiga (ou uma presa em "transcrevendo" desde antes de `travadaAntesDe`). */
  proximaParaTranscrever(travadaAntesDe: string): Promise<LinhaAvaliacao | null>;
  proximaParaAvaliar(): Promise<LinhaAvaliacao | null>;
  /** Avaliadas cujas notas ainda não estão no card (notas_em nulo). */
  paraNotas(limite: number): Promise<LinhaAvaliacao[]>;
};

export type ResultadoIa<T> = { valor: T; custo: number | null; modelo: string | null };
export type IaLigacoes = {
  transcrever(mp3: Uint8Array, timeoutMs: number): Promise<ResultadoIa<Fala[]>>;
  avaliar(falas: readonly Fala[], timeoutMs: number): Promise<ResultadoIa<any>>;
};

// ---------------------------------------------------------------------------- OpenRouter

/** Bytes → base64, em blocos (o spread de um mp3 inteiro estoura a pilha). Igual no Deno e no Node. */
export function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const SYSTEM_TRANSCRICAO = `Você transcreve ligações telefônicas comerciais em português do Brasil.
Quem liga é o pré-vendedor da Planning; ele se apresenta com "Aqui é o [nome], da equipe do [sócio]".
Marque como "pre_venda" as falas de quem ligou (a pessoa da Planning) e como "cliente" as falas de quem atendeu.
Transcreva TUDO o que foi dito, palavra por palavra, sem resumir, sem corrigir e sem inventar. Trecho inaudível: escreva [inaudível].
Junte frases seguidas da mesma pessoa numa fala só. "inicio_seg" é o segundo em que a fala começa, contado do início do áudio.
Responda só com JSON: {"falas":[{"falante":"pre_venda"|"cliente","texto":"...","inicio_seg":0}]}`;

/** Pedido de transcrição. max_tokens explícito: sem ele a OpenRouter reserva 65.536 tokens. */
export function corpoTranscricao(modelo: string, mp3Base64: string): Record<string, unknown> {
  return {
    model: modelo,
    max_tokens: 24000,
    reasoning: { max_tokens: 1024 },
    temperature: 0,
    usage: { include: true },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "transcricao",
        strict: true,
        schema: {
          type: "object",
          properties: {
            falas: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  falante: { type: "string", enum: ["pre_venda", "cliente"] },
                  texto: { type: "string" },
                  inicio_seg: { type: "number" },
                },
                required: ["falante", "texto", "inicio_seg"],
                additionalProperties: false,
              },
            },
          },
          required: ["falas"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: SYSTEM_TRANSCRICAO },
      {
        role: "user",
        content: [
          { type: "text", text: "Transcreva esta ligação." },
          { type: "input_audio", input_audio: { data: mp3Base64, format: "mp3" } },
        ],
      },
    ],
  };
}

/** Pedido de avaliação: como o das reuniões (max_tokens 9000, raciocínio com teto de 2000). */
export function corpoAvaliacao(modelo: string, falas: readonly Fala[]): Record<string, unknown> {
  return {
    model: modelo,
    max_tokens: 9000,
    reasoning: { max_tokens: 2000 },
    usage: { include: true },
    messages: [
      { role: "system", content: montarSystem() },
      { role: "user", content: mensagemUsuario(transcricaoTexto(falas)) },
    ],
  };
}

/** Chama a OpenRouter e recusa resposta cortada (finish_reason ≠ stop) ou vazia. O erro nunca leva a chave. */
export async function chamarOpenRouter(
  fetcher: typeof fetch,
  chave: string,
  corpo: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ conteudo: string; custo: number | null; modelo: string | null }> {
  if (!chave) throw new Error("OPENROUTER_API_KEY ausente");
  const res = await fetcher("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${chave}`,
      "Content-Type": "application/json",
      "User-Agent": "planning-monetizacao-ligacoes/1",
    },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const r: any = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `OpenRouter HTTP ${res.status}${r?.error?.message ? `: ${String(r.error.message).slice(0, 200)}` : ""}`,
    );
  const escolha = r?.choices?.[0];
  const conteudo = escolha?.message?.content;
  if (escolha?.finish_reason !== "stop" || typeof conteudo !== "string" || !conteudo.trim())
    throw new Error(`resposta incompleta do modelo: ${escolha?.finish_reason ?? "sem resposta"}`);
  return {
    conteudo,
    custo: typeof r?.usage?.cost === "number" ? r.usage.cost : null,
    modelo: r?.model ?? null,
  };
}

/** As falas da transcrição, validadas. Lista vazia ou falante fora do contrato é erro (a rodada tenta de novo). */
export function lerTranscricao(conteudo: string): Fala[] {
  const j = lerResposta(conteudo);
  const lista = Array.isArray(j) ? j : j?.falas;
  if (!Array.isArray(lista)) throw new Error("transcrição sem a lista de falas");
  const falas: Fala[] = [];
  let ultimo = 0;
  for (const f of lista) {
    const texto = typeof f?.texto === "string" ? f.texto.trim() : "";
    if (!texto) continue;
    if (f.falante !== "pre_venda" && f.falante !== "cliente")
      throw new Error(`falante fora do contrato: ${String(f.falante).slice(0, 30)}`);
    const s = Number(f.inicio_seg);
    ultimo = Number.isFinite(s) && s >= 0 ? Math.round(s * 10) / 10 : ultimo;
    falas.push({ falante: f.falante, texto, inicio_seg: ultimo });
  }
  if (!falas.length) throw new Error("transcrição vazia");
  return falas;
}

/** A IA de verdade: transcrição pelo modelo de áudio, avaliação pelo modelo de texto. */
export function criarIa(op: {
  fetcher: typeof fetch;
  chave: string;
  modeloTranscricao?: string;
  modeloAvaliacao?: string;
}): IaLigacoes {
  const mt = op.modeloTranscricao || MODELO_TRANSCRICAO;
  const ma = op.modeloAvaliacao || MODELO_AVALIACAO;
  return {
    async transcrever(mp3, timeoutMs) {
      const r = await chamarOpenRouter(
        op.fetcher,
        op.chave,
        corpoTranscricao(mt, base64(mp3)),
        timeoutMs,
      );
      return { valor: lerTranscricao(r.conteudo), custo: r.custo, modelo: r.modelo ?? mt };
    },
    async avaliar(falas, timeoutMs) {
      const r = await chamarOpenRouter(op.fetcher, op.chave, corpoAvaliacao(ma, falas), timeoutMs);
      return { valor: lerResposta(r.conteudo), custo: r.custo, modelo: r.modelo ?? ma };
    },
  };
}

// ---------------------------------------------------------------------------- rodada

export type ResumoLigacoes = {
  status: "ok" | "com_erros";
  modo: "dry-run" | "só captura" | "ativo";
  ia: string;
  escrita_no_pipedrive: string;
  janela: { de: string; ate: string };
  capturadas: {
    atividades_call: number;
    no_pipe39: number;
    api4com: number;
    manuais_ignoradas: number;
    novas: number;
    atualizadas: number;
  };
  escolhidas: { deal: number; activity_id: number; duracao_seg: number; antes: number | null }[];
  transcritas: { deal: number; activity_id: number; falas: number; custo_usd: number | null }[];
  avaliadas: { deal: number; activity_id: number; nota: number; custo_usd: number | null }[];
  notas: { deal: number; criadas: number; atualizadas: number }[];
  faria: { transcrever: number | null; avaliar: number | null; notas_pendentes: number };
  adiado: string[];
  erros: { deal?: number; etapa: string; erro: string }[];
};

export type OpcoesLigacoes = {
  pd: PipedriveLigacoes;
  store: StoreLigacoes;
  ia: IaLigacoes;
  /** Baixa o mp3. Erro HTTP sai como `Error("áudio HTTP <status>")`. */
  baixar(url: string, timeoutMs: number): Promise<Uint8Array>;
  agora: Date;
  /** MONET_LIGACOES_ATIVA=sim: liga transcrição e avaliação. */
  ativa: boolean;
  /** MONET_LIGACOES_NOTAS=sim: liga as notas no card. */
  notas: boolean;
  /** {"dry": true}: não escreve em lugar nenhum, só responde o que faria. */
  dry: boolean;
  relogio?: () => number;
  orcamentoMs?: number;
};

const mensagem = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);
const sumiu = (e: unknown) => /HTTP (404|410)\b/.test(mensagem(e));
const somaCusto = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? null : Math.round(((a || 0) + (b || 0)) * 1e6) / 1e6;

/** Grava (ou atualiza) as duas notas do card. Id salvo assim que a nota nasce: rodada que morre não duplica. */
export async function gravarNotas(
  pd: PipedriveLigacoes,
  store: StoreLigacoes,
  l: LinhaAvaliacao,
  agora: Date,
): Promise<{ criadas: number; atualizadas: number }> {
  const conteudos: [keyof LinhaAvaliacao, string][] = [
    ["nota_qualificacao_id", notaQualificacaoHtml(l)],
    ["nota_avaliacao_id", notaAvaliacaoHtml(l)],
  ];
  let criadas = 0,
    atualizadas = 0;
  for (const [campo, html] of conteudos) {
    const id = Number(l[campo]) || null;
    if (id) {
      try {
        await pd.put(`notes/${id}`, { content: html });
        atualizadas++;
        continue;
      } catch (e) {
        // Nota apagada à mão no card: nasce outra.
        if (!sumiu(e)) throw e;
      }
    }
    const r = await pd.post("notes", { deal_id: Number(l.deal_id), content: html });
    const novo = Number(r?.data?.id);
    if (!novo) throw new Error("Pipedrive não devolveu o id da nota");
    criadas++;
    (l as any)[campo] = novo;
    await store.atualizarAvaliacao(Number(l.deal_id), { [campo]: novo } as Partial<LinhaAvaliacao>);
  }
  await store.atualizarAvaliacao(
    Number(l.deal_id),
    { notas_em: agora.toISOString() },
    { activity_id: l.activity_id, status: ["avaliada"] },
  );
  return { criadas, atualizadas };
}

/** Uma rodada inteira. Erro de um card vai para `erros` e não derruba a rodada; sem a captura, a rodada falha. */
export async function rodarLigacoes(op: OpcoesLigacoes): Promise<ResumoLigacoes> {
  const { pd, store, ia, agora, dry } = op;
  const relogio = op.relogio ?? (() => Date.now());
  const comeco = relogio();
  const orcamento = op.orcamentoMs ?? ORCAMENTO_MS;
  const resta = () => orcamento - (relogio() - comeco);
  const ativa = op.ativa && !dry;
  const notas = op.notas && !dry;
  const j = janela(agora);
  const resumo: ResumoLigacoes = {
    status: "ok",
    modo: dry ? "dry-run" : ativa ? "ativo" : "só captura",
    ia: op.ativa ? "ligada" : "desligada (MONET_LIGACOES_ATIVA diferente de sim)",
    escrita_no_pipedrive: op.notas ? "ligada" : "desligada (MONET_LIGACOES_NOTAS diferente de sim)",
    janela: { de: j.de, ate: j.ate },
    capturadas: {
      atividades_call: 0,
      no_pipe39: 0,
      api4com: 0,
      manuais_ignoradas: 0,
      novas: 0,
      atualizadas: 0,
    },
    escolhidas: [],
    transcritas: [],
    avaliadas: [],
    notas: [],
    faria: { transcrever: null, avaliar: null, notas_pendentes: 0 },
    adiado: [],
    erros: [],
  };

  // a. Captura ------------------------------------------------------------------------------------------------
  const deals = await store.dealsDoPipe();
  // /v1/activities?deal_id=X ignora o filtro; a lista é por usuário (0 = todos) e por data de vencimento (UTC).
  const atividades = await pd.pages("activities", {
    user_id: "0",
    type: "call",
    start_date: j.de,
    end_date: j.ate_api,
  });
  resumo.capturadas.atividades_call = atividades.length;
  const lidas = new Map<number, Ligacao>();
  for (const a of atividades) {
    if (!deals.has(Number(a?.deal_id))) continue;
    resumo.capturadas.no_pipe39++;
    const l = ligacaoDaAtividade(a);
    if (!l) {
      resumo.capturadas.manuais_ignoradas++;
      continue;
    }
    resumo.capturadas.api4com++;
    lidas.set(l.activity_id, l);
  }
  const atuais = new Map(
    (lidas.size ? await store.ligacoesPorAtividade([...lidas.keys()]) : []).map((l) => [
      Number(l.activity_id),
      l,
    ]),
  );
  const gravar: Ligacao[] = [];
  for (const l of lidas.values()) {
    const atual = atuais.get(l.activity_id);
    if (!atual) resumo.capturadas.novas++;
    else if (mudou(atual, l)) resumo.capturadas.atualizadas++;
    else continue;
    gravar.push(l);
  }
  if (!dry && gravar.length) await store.gravarLigacoes(gravar);

  // b. Escolha (3B) -------------------------------------------------------------------------------------------
  const tocados = [...new Set([...lidas.values()].map((l) => l.deal_id))];
  if (tocados.length) {
    const todas = new Map<number, Ligacao>();
    for (const l of await store.ligacoesDosDeals(tocados)) todas.set(Number(l.activity_id), l);
    for (const l of lidas.values()) todas.set(l.activity_id, l); // no dry-run, a captura não foi gravada
    const avaliacoes = new Map(
      (await store.avaliacoesDosDeals(tocados)).map((a) => [Number(a.deal_id), a]),
    );
    for (const deal of tocados) {
      const escolhida = escolher([...todas.values()].filter((l) => Number(l.deal_id) === deal));
      if (!escolhida) continue;
      const atual = avaliacoes.get(deal);
      if (atual && Number(atual.activity_id) === escolhida.activity_id) continue;
      resumo.escolhidas.push({
        deal,
        activity_id: escolhida.activity_id,
        duracao_seg: escolhida.duracao_seg,
        antes: atual?.activity_id != null ? Number(atual.activity_id) : null,
      });
      if (dry) continue;
      try {
        await store.gravarAvaliacao(
          linhaPendente(escolhida, deals.get(deal) ?? null, atual, agora),
        );
      } catch (e) {
        resumo.erros.push({ deal, etapa: "escolha", erro: mensagem(e) });
      }
    }
  }

  // c. Transcrição (uma por rodada) ---------------------------------------------------------------------------
  const travadaAntesDe = new Date(agora.getTime() - TRAVADA_MS).toISOString();
  if (!ativa) {
    const p = await store.proximaParaTranscrever(travadaAntesDe);
    resumo.faria.transcrever = p ? Number(p.deal_id) : null;
  } else if (resta() < TEMPO_TRANSCRICAO_MS / 2) resumo.adiado.push("transcrição");
  else {
    const l = await store.proximaParaTranscrever(travadaAntesDe);
    if (l) await transcreverUma(op, l, resumo, Math.min(TEMPO_TRANSCRICAO_MS, resta() - 5_000));
  }

  // d. Avaliação (uma por rodada) -----------------------------------------------------------------------------
  if (!ativa) {
    const p = await store.proximaParaAvaliar();
    resumo.faria.avaliar = p ? Number(p.deal_id) : null;
  } else if (resta() < 45_000) resumo.adiado.push("avaliação");
  else {
    const l = await store.proximaParaAvaliar();
    if (l) await avaliarUma(op, l, resumo, Math.min(TEMPO_AVALIACAO_MS, resta() - 5_000));
  }

  // e. Notas no card ------------------------------------------------------------------------------------------
  if (!notas) resumo.faria.notas_pendentes = (await store.paraNotas(50)).length;
  else
    for (const l of await store.paraNotas(NOTAS_POR_RODADA)) {
      if (resta() < 8_000) {
        resumo.adiado.push(`notas do card ${l.deal_id}`);
        continue;
      }
      try {
        const r = await gravarNotas(pd, store, l, agora);
        resumo.notas.push({ deal: Number(l.deal_id), ...r });
      } catch (e) {
        resumo.erros.push({ deal: Number(l.deal_id), etapa: "notas", erro: mensagem(e) });
      }
    }

  if (resumo.erros.length) resumo.status = "com_erros";
  return resumo;
}

async function transcreverUma(
  op: OpcoesLigacoes,
  l: LinhaAvaliacao,
  resumo: ResumoLigacoes,
  timeoutMs: number,
) {
  const { store, ia, agora } = op;
  const deal = Number(l.deal_id);
  const se = { activity_id: l.activity_id };
  const pegou = await store.atualizarAvaliacao(
    deal,
    { status: "transcrevendo", atualizado_em: agora.toISOString() },
    { ...se, status: ["pendente", "transcrevendo"] },
  );
  if (!pegou) return;
  try {
    if (!l.mp3_url) throw new Error("ligação sem mp3");
    const mp3 = await op.baixar(l.mp3_url, 30_000);
    // Arquivo quase vazio é áudio ainda não publicado (1 minuto de ligação dá ~240 KB a 32 kbps).
    if (mp3.byteLength < 4096) throw new Error("áudio HTTP 404 (arquivo vazio)");
    if (mp3.byteLength > LIMITE_MP3_BYTES)
      throw Object.assign(
        new Error(`áudio grande demais (${(mp3.byteLength / 1048576).toFixed(1)} MB)`),
        { definitivo: true },
      );
    const r = await ia.transcrever(mp3, timeoutMs);
    await store.atualizarAvaliacao(
      deal,
      {
        status: "transcrita",
        transcricao: r.valor,
        erro: null,
        tentativas: 0,
        custo_usd: somaCusto(l.custo_usd, r.custo),
        modelos: `transcrição ${r.modelo ?? "?"}`,
        atualizado_em: agora.toISOString(),
      },
      { ...se, status: ["transcrevendo"] },
    );
    resumo.transcritas.push({
      deal,
      activity_id: Number(l.activity_id),
      falas: r.valor.length,
      custo_usd: r.custo,
    });
  } catch (e) {
    const msg = mensagem(e);
    // O mp3 da Api4Com sai ~30 min depois da ligação: até ESPERA_AUDIO_MS, áudio que não abre volta para a fila sem
    // gastar tentativa; depois disso, não vem mais.
    const semAudio = /áudio HTTP (403|404)\b/.test(msg);
    const aguardaAudio =
      semAudio && agora.getTime() - (Date.parse(l.inicio || "") || 0) < ESPERA_AUDIO_MS;
    const tentativas = aguardaAudio ? Number(l.tentativas) || 0 : (Number(l.tentativas) || 0) + 1;
    const desiste =
      (e as any)?.definitivo === true ||
      (semAudio && !aguardaAudio) ||
      (!semAudio && tentativas >= MAX_TENTATIVAS);
    await store
      .atualizarAvaliacao(
        deal,
        {
          status: desiste ? "erro" : "pendente",
          erro: `transcrição: ${msg}`,
          tentativas,
          atualizado_em: agora.toISOString(),
        },
        { ...se, status: ["transcrevendo"] },
      )
      .catch(() => undefined);
    resumo.erros.push({ deal, etapa: "transcrição", erro: msg });
  }
}

async function avaliarUma(
  op: OpcoesLigacoes,
  l: LinhaAvaliacao,
  resumo: ResumoLigacoes,
  timeoutMs: number,
) {
  const { store, ia, agora } = op;
  const deal = Number(l.deal_id);
  const se = { activity_id: l.activity_id, status: ["transcrita"] as StatusAvaliacao[] };
  try {
    const falas = l.transcricao || [];
    if (!falas.length) throw new Error("transcrição vazia");
    const r = await ia.avaliar(falas, timeoutMs);
    const { avaliacao, nota } = apurar(r.valor, falas);
    await store.atualizarAvaliacao(
      deal,
      {
        status: "avaliada",
        avaliacao,
        nota,
        regua_versao: VERSAO_REGUA,
        erro: null,
        tentativas: 0,
        notas_em: null,
        custo_usd: somaCusto(l.custo_usd, r.custo),
        modelos: [l.modelos, `avaliação ${r.modelo ?? "?"}`].filter(Boolean).join(" · "),
        atualizado_em: agora.toISOString(),
      },
      se,
    );
    resumo.avaliadas.push({ deal, activity_id: Number(l.activity_id), nota, custo_usd: r.custo });
  } catch (e) {
    const msg = mensagem(e);
    const tentativas = (Number(l.tentativas) || 0) + 1;
    await store
      .atualizarAvaliacao(
        deal,
        {
          status: tentativas >= MAX_TENTATIVAS ? "erro" : "transcrita",
          erro: `avaliação: ${msg}`,
          tentativas,
          atualizado_em: agora.toISOString(),
        },
        se,
      )
      .catch(() => undefined);
    resumo.erros.push({ deal, etapa: "avaliação", erro: msg });
  }
}
