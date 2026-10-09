/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// Cadência da pré-venda da Monetização (pipe 39): quando o card sai de "1 · Base elegível" (274) e entra em
// "2 · Abordagem iniciada" (276), o Brain cria no card as atividades da régua (regua.ts). Quando o card sai da 276,
// o Brain encerra a cadência e apaga só as atividades dela que ainda não foram feitas.
//
// Sem API do Deno: roda na Edge Function (index.ts) e nos testes do Node. Pipedrive e banco entram injetados (`pd` e
// `store`), para os testes usarem fakes em memória.
//
// Etapas pelo id, e não pelo nome: a régua é amarrada a estas duas etapas, e o id não muda quando o pipe é renomeado
// ou reordenado.
import { HORARIO, type ItemRegua, type Turno } from "./regua.ts";

export const ETAPA_BASE = 274; // 1 · Base elegível
export const ETAPA_ABORDAGEM = 276; // 2 · Abordagem iniciada
export const FUSO = "America/Sao_Paulo";
/** Duração de cada atividade no Pipedrive: só ocupa a agenda do pré-vendedor, não muda a régua. */
export const DURACAO_ATIVIDADE = "00:15";
/**
 * Tempo de trabalho por rodada. O cron espera 150 s pela função; depois disso a rodada para de pegar card novo e o
 * que sobrou fica para a rodada seguinte (5 minutos depois), contado em `adiados`.
 */
export const ORCAMENTO_MS = 90_000;
/** Tolerância entre o `stage_change_time` do card e o `log_time` da mudança no histórico. */
const TOLERANCIA_HISTORICO_MS = 60_000;

/**
 * Feriados que tiram o dia útil da cadência (2026–2027). Lista fixa desta função; a do app mora em
 * src/lib/monetizacao/feriados.ts. Para um ano que não está aqui, só sábado e domingo saem da conta: acrescente o
 * ano antes que ele chegue.
 */
export const FERIADOS: ReadonlySet<string> = new Set([
  "2026-10-12", // Nossa Senhora Aparecida
  "2026-11-02", // Finados
  "2026-11-15", // Proclamação da República
  "2026-11-20", // Consciência Negra
  "2026-12-25", // Natal
  "2027-01-01", // Confraternização Universal
  "2027-02-08", // Carnaval (ponto facultativo)
  "2027-02-09", // Carnaval (ponto facultativo)
  "2027-03-26", // Sexta-feira Santa
  "2027-04-21", // Tiradentes
  "2027-05-01", // Dia do Trabalho
  "2027-05-27", // Corpus Christi (ponto facultativo)
  "2027-09-07", // Independência
  "2027-10-12", // Nossa Senhora Aparecida
  "2027-11-02", // Finados
  "2027-11-15", // Proclamação da República
  "2027-11-20", // Consciência Negra
  "2027-12-25", // Natal
]);

// ---------------------------------------------------------------------------- datas

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Instante de um campo de data do Pipedrive. `stage_change_time`, `add_time` e `log_time` vêm como
 * "AAAA-MM-DD HH:MM:SS" em UTC; ISO com fuso também é aceito, e ISO sem fuso é tratado como UTC.
 */
export function instante(v: unknown): Date | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v).trim();
  const semFuso = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(s);
  const t = semFuso ? Date.parse(`${semFuso[1]}T${semFuso[2]}Z`) : Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

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

/** Data de São Paulo (aaaa-mm-dd) de um instante. */
export function dataSP(quando: Date): string {
  const p = partesSP(quando.getTime());
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Quanto o relógio de São Paulo está à frente do UTC nesse instante (negativo: -3 h hoje). Lido do Intl. */
function deslocamentoSP(ms: number): number {
  const p = partesSP(ms);
  const comoUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return comoUtc - Math.floor(ms / 1000) * 1000;
}

/** O instante em que o relógio de São Paulo marca `hora` (HH:MM) no dia `dia` (aaaa-mm-dd). */
export function instanteSP(dia: string, hora: string): Date {
  const [a, m, d] = dia.split("-").map(Number);
  const [h, mi] = hora.split(":").map(Number);
  const parede = Date.UTC(a, m - 1, d, h, mi);
  let t = parede - deslocamentoSP(parede);
  // Se o fuso mudar entre o palpite e o instante (horário de verão), o segundo cálculo corrige.
  const conferido = parede - deslocamentoSP(t);
  if (conferido !== t) t = conferido;
  return new Date(t);
}

/** `due_date` e `due_time` em UTC ("HH:MM"), como a API v1 do Pipedrive espera. */
export function vencimentoUtc(dia: string, hora: string): { due_date: string; due_time: string } {
  const iso = instanteSP(dia, hora).toISOString();
  return { due_date: iso.slice(0, 10), due_time: iso.slice(11, 16) };
}

function somarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Segunda a sexta, fora de FERIADOS. `dia` em aaaa-mm-dd (data de São Paulo). */
export function ehDiaUtil(dia: string): boolean {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return semana !== 0 && semana !== 6 && !FERIADOS.has(dia);
}

/**
 * D0: o dia da entrada na etapa, na data de São Paulo. Se esse dia não for útil (sábado, domingo ou feriado), D0
 * passa a ser o próximo dia útil. Entrada num dia útil depois das 14h continua sendo D0 naquele dia: as atividades
 * de D0 nascem com o horário já passado e aparecem atrasadas no Pipedrive, sem empurrar o resto da régua.
 */
export function diaZero(entrada: Date): string {
  let dia = dataSP(entrada);
  while (!ehDiaUtil(dia)) dia = somarDias(dia, 1);
  return dia;
}

/** Dn: o n-ésimo dia útil depois de D0 (D0 + 0 = o próprio D0). */
export function diaUtilApos(d0: string, n: number): string {
  let dia = d0;
  for (let falta = n; falta > 0;) {
    dia = somarDias(dia, 1);
    if (ehDiaUtil(dia)) falta--;
  }
  return dia;
}

// ---------------------------------------------------------------------------- régua → atividades

const ROTULO_TURNO: Record<Turno, string> = { manha: "manhã", tarde: "tarde" };

/** "Caixa · D2 · WhatsApp retomada · tarde". */
export function assunto(item: Pick<ItemRegua, "dia" | "canal" | "turno">): string {
  return `Caixa · D${item.dia} · ${item.canal} · ${ROTULO_TURNO[item.turno]}`;
}

/** Texto pronto em HTML simples: escapa &, < e >, e quebra de linha vira <br>. Colchetes ficam como estão. */
export function notaHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r?\n/g, "<br>");
}

/**
 * Chave estável de cada item da régua: `d{dia}-{turno}-{tipo}`, com sufixo -2, -3... se a régua tiver dois itens
 * do mesmo tipo no mesmo turno. É ela que diz, na retomada, o que já foi criado.
 */
export function chavesDaRegua(regua: readonly ItemRegua[]): string[] {
  const vistas = new Map<string, number>();
  return regua.map((item) => {
    const base = `d${item.dia}-${item.turno}-${item.tipo}`;
    const n = (vistas.get(base) || 0) + 1;
    vistas.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  });
}

export type AtividadePlanejada = ItemRegua & {
  chave: string;
  subject: string;
  note: string;
  due_date: string;
  due_time: string;
};

/** As atividades da régua para um card que entrou na etapa em `entrada`, com dia e hora já em UTC. */
export function planejar(
  entrada: Date,
  regua: readonly ItemRegua[],
  horario: Readonly<Record<Turno, string>> = HORARIO,
): AtividadePlanejada[] {
  const d0 = diaZero(entrada);
  const chaves = chavesDaRegua(regua);
  return regua.map((item, i) => ({
    ...item,
    chave: chaves[i],
    subject: assunto(item),
    note: notaHtml(item.nota),
    ...vencimentoUtc(diaUtilApos(d0, item.dia), horario[item.turno]),
  }));
}

// ---------------------------------------------------------------------------- Pipedrive

/** Status HTTP de um erro do Pipedrive ("Pipedrive HTTP 404"), ou null. */
export function statusHttp(e: unknown): number | null {
  const m = /HTTP (\d{3})/.exec(String((e as Error)?.message ?? e));
  return m ? Number(m[1]) : null;
}

const sumiu = (e: unknown) => [404, 410].includes(statusHttp(e) ?? 0);
const feita = (done: unknown) => done === true || done === 1 || done === "1";
const mensagem = (e: unknown) => String((e as Error)?.message ?? e).slice(0, 300);

/** Quando o card entrou na etapa em que está: `stage_change_time`; card que nunca mudou de etapa, `add_time`. */
export function entradaNaEtapa(deal: any): Date | null {
  return instante(deal?.stage_change_time) ?? instante(deal?.add_time);
}

/** Dono do card: `user_id` vem como objeto ({id, name...}) na listagem e às vezes como número. */
export function donoDoDeal(deal: any): number | null {
  const u = deal?.user_id;
  const id = Number(typeof u === "object" && u !== null ? (u.id ?? u.value) : u);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * De onde o card veio na entrada em 276, pelo histórico (`GET deals/{id}/flow`, itens `dealChange`). Vale a mudança
 * de `stage_id` para 276 cujo `log_time` bate com a entrada; sem nenhuma que bata, a mais recente.
 * `de` = 274 libera a cadência; qualquer outra coisa vem com o motivo.
 */
export function origemDaEntrada(flow: any[], entrada: Date): { de: number | null; motivo: string } {
  const mudancas = (flow || [])
    .filter((e) => e?.object === "dealChange" && e?.data)
    .map((e) => e.data)
    .filter((c) => c.field_key === "stage_id" && Number(c.new_value) === ETAPA_ABORDAGEM)
    .map((c) => ({ c, t: instante(c.log_time)?.getTime() ?? Number.NaN }));
  if (!mudancas.length)
    return {
      de: null,
      motivo: `criado direto na etapa ${ETAPA_ABORDAGEM}, sem vir da ${ETAPA_BASE}`,
    };
  const alvo = entrada.getTime();
  const perto = mudancas
    .filter((x) => Math.abs(x.t - alvo) <= TOLERANCIA_HISTORICO_MS)
    .sort((x, y) => Math.abs(x.t - alvo) - Math.abs(y.t - alvo))[0];
  const ultima = [...mudancas].sort((x, y) => (y.t || 0) - (x.t || 0))[0];
  const de = Number((perto ?? ultima).c.old_value);
  if (de === ETAPA_BASE) return { de, motivo: "" };
  return {
    de: Number.isFinite(de) && de > 0 ? de : null,
    motivo:
      Number.isFinite(de) && de > 0 ? `veio da etapa ${de}` : "origem da entrada desconhecida",
  };
}

/** Tipo de atividade do Pipedrive para cada tipo da régua: o `key_string` ativo, ou "task". */
export function escolherTipos(
  tiposPipedrive: any[],
  regua: readonly ItemRegua[],
): { usar: Map<string, string>; substituidos: { tipo: string; usado: string }[] } {
  const normal = (s: unknown) =>
    String(s ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const ativos = (tiposPipedrive || []).filter((t) => t?.key_string && t.active_flag !== false);
  const usar = new Map<string, string>();
  const substituidos: { tipo: string; usado: string }[] = [];
  for (const tipo of new Set(regua.map((r) => r.tipo))) {
    // Pelo key_string; um tipo criado na conta (WhatsApp) pode ter key_string gerado, então o nome também serve.
    const achado =
      ativos.find((t) => t.key_string === tipo) ??
      ativos.find((t) => normal(t.key_string) === normal(tipo)) ??
      ativos.find((t) => normal(t.name) === normal(tipo));
    if (achado) usar.set(tipo, String(achado.key_string));
    else {
      usar.set(tipo, "task");
      substituidos.push({ tipo, usado: "task" });
    }
  }
  return { usar, substituidos };
}

// ---------------------------------------------------------------------------- tipos da rodada

export type AtividadeCriada = {
  id: number;
  chave: string;
  dia: number;
  canal: string;
  /** Tipo usado no Pipedrive (o da régua, ou "task" quando ele não existe na conta). */
  tipo: string;
  turno: Turno;
  due_date: string;
  due_time: string;
  /** Lido do Pipedrive a cada rodada (marcarFeitas). Ausente = ainda não conferida. */
  feita?: boolean;
  /** `marked_as_done_time` da atividade, em UTC (ISO). null quando não feita. */
  feita_em?: string | null;
};

export type StatusCadencia = "ativa" | "encerrada" | "ignorada";

/** Uma linha de ops.monetizacao_cadencia. */
export type LinhaCadencia = {
  deal_id: number;
  entrou_em: string;
  dono: number | null;
  versao_regua: string;
  atividades: AtividadeCriada[];
  status: StatusCadencia;
  encerrado_em?: string | null;
  motivo_encerramento?: string | null;
};

/** A tabela ops.monetizacao_cadencia. */
export type StoreCadencia = {
  /** Todas as linhas (qualquer status) desses cards. */
  linhasDosDeals(deals: number[]): Promise<LinhaCadencia[]>;
  /** As linhas com status 'ativa'. */
  ativas(): Promise<LinhaCadencia[]>;
  /** Insere ignorando duplicata de (deal_id, entrou_em). true = inseriu; false = a linha já existia. */
  inserir(linha: LinhaCadencia): Promise<boolean>;
  atualizar(deal: number, entrouEm: string, patch: Partial<LinhaCadencia>): Promise<void>;
};

/** O Pipedrive v1. Erro HTTP sai como `Error("Pipedrive HTTP <status>")`. */
export type PipedriveCadencia = {
  get(path: string, params?: Record<string, string>): Promise<any>;
  pages(path: string, params?: Record<string, string>): Promise<any[]>;
  post(path: string, payload: Record<string, unknown>): Promise<any>;
  del(path: string): Promise<unknown>;
};

export type ResumoCadencia = {
  status: "ok" | "com_erros";
  modo: "dry-run" | "ativo";
  versao_regua: string;
  inicio: string | null;
  aviso?: string;
  criados: { deal: number; entrou_em: string; atividades: number; retomada?: boolean }[];
  encerrados: {
    deal: number;
    motivo: string;
    apagadas: number;
    mantidas: number;
    ja_nao_existiam: number;
  }[];
  ignorados: { deal: number; motivo: string }[];
  erros: { deal: number; etapa: "criar" | "retomar" | "encerrar" | "ler"; erro: string }[];
  tipos_substituidos: { tipo: string; usado: string }[];
  /** Cards na 276 que entraram antes de MONET_CADENCIA_INICIO: não recebem cadência. */
  anteriores_ao_inicio: number;
  /** Cards deixados para a próxima rodada porque o tempo da rodada acabou. */
  adiados: number;
};

export type OpcoesCadencia = {
  pd: PipedriveCadencia;
  store: StoreCadencia;
  agora: Date;
  /** MONET_CADENCIA_INICIO (ISO): só ganha cadência quem entrou na 276 a partir daqui. */
  inicio: string | null | undefined;
  /** false = dry-run: não escreve no Pipedrive nem no banco, só responde o que faria. */
  ativo: boolean;
  regua: readonly ItemRegua[];
  versao: string;
  horario?: Readonly<Record<Turno, string>>;
  relogio?: () => number;
  orcamentoMs?: number;
};

// ---------------------------------------------------------------------------- rodada

/** Por que a cadência acabou. null = o card segue na 276 com a mesma entrada (a listagem estava defasada). */
async function motivoDaSaida(pd: PipedriveCadencia, linha: LinhaCadencia): Promise<string | null> {
  let d: any;
  try {
    d = (await pd.get(`deals/${Number(linha.deal_id)}`))?.data;
  } catch (e) {
    if (sumiu(e)) return "apagado";
    throw e;
  }
  if (!d || d.deleted === true || d.status === "deleted") return "apagado";
  if (d.status === "lost") return "perdido";
  if (d.status === "won") return "ganho";
  const etapa = Number(d.stage_id);
  if (etapa !== ETAPA_ABORDAGEM) return `saiu para a etapa ${d.stage_id ?? "desconhecida"}`;
  const entrou = entradaNaEtapa(d);
  if (entrou && entrou.getTime() === Date.parse(linha.entrou_em)) return null;
  return "saiu e voltou à etapa";
}

/** Encerra a cadência: apaga só as atividades da lista que ainda não foram feitas. Nunca toca em outra. */
async function encerrar(
  op: OpcoesCadencia,
  linha: LinhaCadencia,
  voltou: boolean,
): Promise<ResumoCadencia["encerrados"][number] | null> {
  const { pd, store, ativo, agora } = op;
  const deal = Number(linha.deal_id);
  const motivo = voltou ? "saiu e voltou à etapa" : await motivoDaSaida(pd, linha);
  if (!motivo) return null;
  let apagadas = 0,
    mantidas = 0,
    ja_nao_existiam = 0;
  for (const a of linha.atividades || []) {
    const id = Number(a?.id);
    if (!id) continue;
    let atv: any;
    try {
      atv = (await pd.get(`activities/${id}`))?.data;
    } catch (e) {
      if (sumiu(e)) {
        ja_nao_existiam++;
        continue;
      }
      throw e;
    }
    if (!atv || atv.active_flag === false || atv.deleted === true) {
      ja_nao_existiam++;
      continue;
    }
    // Feita fica; atividade que alguém mudou para outro card também fica.
    if (feita(atv.done) || (atv.deal_id != null && Number(atv.deal_id) !== deal)) {
      mantidas++;
      continue;
    }
    if (ativo) {
      try {
        await pd.del(`activities/${id}`);
      } catch (e) {
        if (sumiu(e)) {
          ja_nao_existiam++;
          continue;
        }
        throw e;
      }
    }
    apagadas++;
  }
  if (ativo)
    await store.atualizar(deal, linha.entrou_em, {
      status: "encerrada",
      encerrado_em: agora.toISOString(),
      motivo_encerramento: motivo,
    });
  return { deal, motivo, apagadas, mantidas, ja_nao_existiam };
}

/**
 * Cria no Pipedrive os itens do plano que ainda não estão na linha. Grava a lista na linha a cada atividade criada
 * (e de novo no finally, se a última gravação falhou): se a rodada morrer no meio, a seguinte completa só o que falta.
 */
async function criarAtividades(
  op: OpcoesCadencia,
  linha: LinhaCadencia,
  plano: AtividadePlanejada[],
  dono: number | null,
  tipos: Map<string, string>,
): Promise<number> {
  const { pd, store, ativo } = op;
  const feitas = [...(linha.atividades || [])];
  const ja = new Set(feitas.map((a) => a.chave));
  const faltam = plano.filter((p) => !ja.has(p.chave));
  if (!ativo) return faltam.length;
  let naoGravada = false;
  try {
    for (const p of faltam) {
      const tipo = tipos.get(p.tipo) ?? "task";
      const r = await pd.post("activities", {
        subject: p.subject,
        type: tipo,
        due_date: p.due_date,
        due_time: p.due_time,
        duration: DURACAO_ATIVIDADE,
        deal_id: Number(linha.deal_id),
        ...(dono ? { user_id: dono } : {}),
        note: p.note,
        done: 0,
      });
      const id = Number(r?.data?.id);
      if (!id) throw new Error(`Pipedrive não devolveu o id da atividade ${p.chave}`);
      feitas.push({
        id,
        chave: p.chave,
        dia: p.dia,
        canal: p.canal,
        tipo,
        turno: p.turno,
        due_date: p.due_date,
        due_time: p.due_time,
      });
      naoGravada = true;
      await store.atualizar(Number(linha.deal_id), linha.entrou_em, { atividades: feitas });
      naoGravada = false;
    }
  } finally {
    if (naoGravada)
      await store
        .atualizar(Number(linha.deal_id), linha.entrou_em, { atividades: feitas })
        .catch(() => undefined);
  }
  return faltam.length;
}

/**
 * Uma rodada: encerra as cadências de quem saiu da 276 (regra 2) e cria as de quem entrou vindo da 274 (regra 1).
 * Erro de um card vai para `erros` e não derruba a rodada; sem a lista de cards da 276 a rodada inteira falha (sem
 * ela não dá para saber quem saiu).
 */
export async function rodarCadencia(op: OpcoesCadencia): Promise<ResumoCadencia> {
  const { pd, store, ativo, regua, versao } = op;
  const horario = op.horario ?? HORARIO;
  const relogio = op.relogio ?? (() => Date.now());
  const comeco = relogio();
  const orcamento = op.orcamentoMs ?? ORCAMENTO_MS;
  const semTempo = () => relogio() - comeco > orcamento;
  const inicio = op.inicio ? instante(op.inicio) : null;

  const resumo: ResumoCadencia = {
    status: "ok",
    modo: ativo ? "ativo" : "dry-run",
    versao_regua: versao,
    inicio: inicio ? inicio.toISOString() : null,
    criados: [],
    encerrados: [],
    ignorados: [],
    erros: [],
    tipos_substituidos: [],
    anteriores_ao_inicio: 0,
    adiados: 0,
  };
  if (!inicio)
    resumo.aviso = op.inicio
      ? `MONET_CADENCIA_INICIO inválida (${String(op.inicio).slice(0, 40)}): nenhuma cadência é criada; o encerramento roda normalmente.`
      : "MONET_CADENCIA_INICIO ausente: nenhuma cadência é criada; o encerramento roda normalmente.";

  const abertos = await pd.pages("deals", { stage_id: String(ETAPA_ABORDAGEM), status: "open" });
  const naEtapa = new Map<number, { deal: any; entrou: Date | null }>();
  for (const d of abertos) {
    const id = Number(d?.id);
    if (!id || (d?.stage_id != null && Number(d.stage_id) !== ETAPA_ABORDAGEM)) continue;
    naEtapa.set(id, { deal: d, entrou: entradaNaEtapa(d) });
  }

  // Regra 2: cadência ativa de card que não está mais na 276 com a mesma entrada.
  for (const linha of await store.ativas()) {
    const atual = naEtapa.get(Number(linha.deal_id));
    if (atual?.entrou && atual.entrou.getTime() === Date.parse(linha.entrou_em)) continue;
    if (semTempo()) {
      resumo.adiados++;
      continue;
    }
    try {
      const r = await encerrar(op, linha, !!atual?.entrou);
      if (r) resumo.encerrados.push(r);
    } catch (e) {
      resumo.erros.push({ deal: Number(linha.deal_id), etapa: "encerrar", erro: mensagem(e) });
    }
  }

  // Regra 1: card que entrou na 276 vindo da 274, a partir de MONET_CADENCIA_INICIO.
  if (inicio) {
    const tipos = escolherTipos((await pd.get("activityTypes"))?.data || [], regua);
    resumo.tipos_substituidos = tipos.substituidos;
    const linhas = naEtapa.size ? await store.linhasDosDeals([...naEtapa.keys()]) : [];
    const fila = [...naEtapa.entries()].sort(
      ([, a], [, b]) => (a.entrou?.getTime() ?? 0) - (b.entrou?.getTime() ?? 0),
    );
    for (const [id, { deal, entrou }] of fila) {
      if (!entrou) {
        resumo.erros.push({
          deal: id,
          etapa: "ler",
          erro: "card sem stage_change_time e add_time",
        });
        continue;
      }
      if (entrou.getTime() < inicio.getTime()) {
        resumo.anteriores_ao_inicio++;
        continue;
      }
      const entrouEm = entrou.toISOString();
      const linha = linhas.find(
        (l) => Number(l.deal_id) === id && Date.parse(l.entrou_em) === entrou.getTime(),
      );
      // Ignorada e encerrada não voltam. Cadência começada com outra versão da régua não é completada com esta.
      if (linha && (linha.status !== "ativa" || linha.versao_regua !== versao)) continue;
      const plano = planejar(entrou, regua, horario);
      if (linha) {
        const ja = new Set((linha.atividades || []).map((a) => a.chave));
        if (plano.every((p) => ja.has(p.chave))) continue;
      }
      if (semTempo()) {
        resumo.adiados++;
        continue;
      }
      const dono = donoDoDeal(deal);
      try {
        let alvo = linha;
        if (!alvo) {
          const origem = origemDaEntrada(
            await pd.pages(`deals/${id}/flow`, { items: "dealChange" }),
            entrou,
          );
          if (origem.de !== ETAPA_BASE) {
            resumo.ignorados.push({ deal: id, motivo: origem.motivo });
            if (ativo)
              await store.inserir({
                deal_id: id,
                entrou_em: entrouEm,
                dono,
                versao_regua: versao,
                atividades: [],
                status: "ignorada",
                motivo_encerramento: origem.motivo,
              });
            continue;
          }
          alvo = {
            deal_id: id,
            entrou_em: entrouEm,
            dono,
            versao_regua: versao,
            atividades: [],
            status: "ativa",
          };
          // A linha vem antes da atividade: se outra rodada já gravou, ela é a dona da criação.
          if (ativo && !(await store.inserir(alvo))) continue;
        }
        const n = await criarAtividades(op, alvo, plano, dono ?? alvo.dono ?? null, tipos.usar);
        resumo.criados.push({
          deal: id,
          entrou_em: entrouEm,
          atividades: n,
          ...(linha ? { retomada: true } : {}),
        });
      } catch (e) {
        resumo.erros.push({ deal: id, etapa: linha ? "retomar" : "criar", erro: mensagem(e) });
      }
    }
  }

  if (resumo.erros.length) resumo.status = "com_erros";
  return resumo;
}

// ---------------------------------------------------------------------------- feitas

/** Cadência encerrada ainda é conferida por 2 dias: a atividade pode ser marcada como feita depois da saída. */
export const JANELA_FEITAS_MS = 2 * 86_400_000;
/** Cards conferidos ao mesmo tempo (um GET deals/{id}/activities por card). */
export const PARALELO_FEITAS = 4;

/** O que marcarFeitas lê e grava em ops.monetizacao_cadencia. */
export type StoreFeitas = {
  /** As cadências ativas e as encerradas desde `desde` (ISO). */
  paraConferir(desde: string): Promise<LinhaCadencia[]>;
  atualizar(deal: number, entrouEm: string, patch: Partial<LinhaCadencia>): Promise<void>;
};

export type ResumoFeitas = {
  modo: "dry-run" | "ativo";
  conferidos: number;
  /** Cadências cuja lista mudou (gravada no modo ativo). */
  atualizados: number;
  marcadas: number;
  desmarcadas: number;
  /** Cards deixados para a próxima rodada porque o tempo acabou. */
  adiados: number;
  erros: { deal: number; erro: string }[];
};

/**
 * A lista da cadência com `feita` e `feita_em` lidos das atividades do card (`GET deals/{id}/activities`, feitas e
 * não feitas). Atividade que não está mais no card (apagada no encerramento ou à mão) fica como estava.
 */
export function aplicarFeitas(
  lista: readonly AtividadeCriada[],
  doCard: readonly any[],
  agora: Date,
): { lista: AtividadeCriada[]; mudou: boolean; marcadas: number; desmarcadas: number } {
  const porId = new Map((doCard || []).map((a) => [Number(a?.id), a]));
  let mudou = false,
    marcadas = 0,
    desmarcadas = 0;
  const nova = (lista || []).map((item) => {
    const a = porId.get(Number(item?.id));
    if (!a) return item;
    const f = feita(a.done);
    const em = f
      ? (instante(a.marked_as_done_time)?.toISOString() ?? item.feita_em ?? agora.toISOString())
      : null;
    if (item.feita === f && (item.feita_em ?? null) === em) return item;
    mudou = true;
    if (f && item.feita !== true) marcadas++;
    if (!f && item.feita === true) desmarcadas++;
    return { ...item, feita: f, feita_em: em };
  });
  return { lista: nova, mudou, marcadas, desmarcadas };
}

/** Próximo vencimento ainda não feito da lista (ms), para conferir primeiro quem está mais perto de vencer. */
function proximoAberto(linha: LinhaCadencia): number {
  let menor = Number.POSITIVE_INFINITY;
  for (const a of linha.atividades || []) {
    if (a?.feita === true) continue;
    const t = instante(`${a.due_date} ${a.due_time || "00:00"}`)?.getTime();
    if (t !== undefined && t < menor) menor = t;
  }
  return menor;
}

/**
 * Atualiza `feita`/`feita_em` de cada atividade das cadências ativas e das encerradas há menos de 2 dias, pelo estado
 * no Pipedrive: um GET por card, nunca um por atividade. Cadência com tudo feito não é relida. No dry-run só conta.
 */
export async function marcarFeitas(op: {
  pd: Pick<PipedriveCadencia, "pages">;
  store: StoreFeitas;
  agora: Date;
  ativo: boolean;
  relogio?: () => number;
  orcamentoMs?: number;
  paralelo?: number;
}): Promise<ResumoFeitas> {
  const { pd, store, agora, ativo } = op;
  const relogio = op.relogio ?? (() => Date.now());
  const comeco = relogio();
  const orcamento = op.orcamentoMs ?? 30_000;
  const resumo: ResumoFeitas = {
    modo: ativo ? "ativo" : "dry-run",
    conferidos: 0,
    atualizados: 0,
    marcadas: 0,
    desmarcadas: 0,
    adiados: 0,
    erros: [],
  };
  const desde = new Date(agora.getTime() - JANELA_FEITAS_MS).toISOString();
  const fila = (await store.paraConferir(desde))
    .filter(
      (l) =>
        (l.status === "ativa" || l.status === "encerrada") &&
        (l.atividades || []).some((a) => a?.id && a.feita !== true),
    )
    .sort((a, b) => proximoAberto(a) - proximoAberto(b));
  const passo = Math.max(1, op.paralelo ?? PARALELO_FEITAS);
  for (let i = 0; i < fila.length; i += passo) {
    if (relogio() - comeco >= orcamento) {
      resumo.adiados += fila.length - i;
      break;
    }
    await Promise.all(
      fila.slice(i, i + passo).map(async (linha) => {
        const deal = Number(linha.deal_id);
        try {
          const doCard = await pd.pages(`deals/${deal}/activities`, {});
          const r = aplicarFeitas(linha.atividades || [], doCard, agora);
          resumo.conferidos++;
          if (!r.mudou) return;
          if (ativo) await store.atualizar(deal, linha.entrou_em, { atividades: r.lista });
          resumo.atualizados++;
          resumo.marcadas += r.marcadas;
          resumo.desmarcadas += r.desmarcadas;
        } catch (e) {
          resumo.erros.push({ deal, erro: mensagem(e) });
        }
      }),
    );
  }
  return resumo;
}
