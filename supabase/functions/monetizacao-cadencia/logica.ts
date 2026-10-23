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

// ---------------------------------------------------------------------------- campos que o Brain preenche

/**
 * Campos entre colchetes que o Brain troca na criação da atividade (pedido do Pedro, 19/10/2026): o que o card já
 * sabe. Campo sem valor fica entre colchetes para o pré-vendedor, como antes. Chave = o texto entre os colchetes.
 */
export type CamposDoCard = Record<string, string>;

/** Campo "Caixa · Produto do cluster": a frente por onde a conta entrou (PRODUCT_OPTIONS em send.mjs). */
export const CAMPO_PRODUTO = "0646513ee16829605c0af8b15b415ebf05beb6c5";
/** "Qual é o regime tributário da sua empresa?" e "Faturamento anual", preenchidos pelo handoff do envio. */
export const CAMPO_REGIME = "093e25bbb3aff5d379b996da8fcec39667c6ae4e";
export const CAMPO_FAIXA = "b92a608454a6648327f24c5cc3bf87a95bb7fbcd";
const FRENTES: Readonly<Record<string, string>> = {
  "1128": "Cella",
  "1129": "Consultoria",
  "1130": "Finance",
};
/** A régua de cada frente na Base, para o card que não tem regime nem faixa. */
const REGRA_DA_FRENTE: Readonly<Record<string, string>> = {
  Cella: "faturamento a partir de R$ 25 milhões, fora do Simples",
  Consultoria: "Lucro Real, ou Lucro Presumido acima de R$ 20 milhões",
  Finance: "contrato ganho, faturamento abaixo de R$ 25 milhões e fora do Simples",
};
const REGIMES = new Set(["Lucro Real", "Lucro Presumido", "Simples Nacional"]);

/** Rótulos das opções dos campos de lista do negócio: chave do campo → (id da opção → rótulo). */
export function rotulosDosCampos(dealFields: any[]): Map<string, Map<string, string>> {
  const r = new Map<string, Map<string, string>>();
  for (const f of dealFields || []) {
    if (!f?.key || !Array.isArray(f.options)) continue;
    r.set(String(f.key), new Map(f.options.map((o: any) => [String(o.id), String(o.label)])));
  }
  return r;
}

/** Primeiro nome; nome todo em caixa alta vira "Anderson". */
export function primeiroNome(nome: unknown): string {
  const p =
    String(nome ?? "")
      .trim()
      .split(/\s+/)[0] || "";
  return p && p === p.toUpperCase() ? p[0] + p.slice(1).toLowerCase() : p;
}

/**
 * O campo "Caixa · Sócio no e-mail" é preenchido à mão, ora com artigo ("o José Felix", "a Jordana", "ao José
 * Felix"), ora sem ("Lando"). Sem artigo, o gênero sai do nome (termina em "a" = feminino). Mais de um sócio no campo
 * fica para o pré-vendedor: "da equipe do [SÓCIO]" não cabe dois nomes.
 */
export function socioDoCampo(v: unknown): { nome: string; artigo: "o" | "a" } | null {
  const s = String(v ?? "").trim();
  if (!s || /,|\/|\se\s/i.test(s)) return null;
  const m = /^(ao|à|o|a)\s+(.+)$/i.exec(s);
  const nome = (m ? m[2] : s).trim();
  if (!nome) return null;
  const art = m ? m[1].toLowerCase() : "";
  const artigo =
    art === "a" || art === "à" ? "a" : art ? "o" : /a$/i.test(nome.split(/\s+/)[0]) ? "a" : "o";
  return { nome, artigo };
}

/** O usuário do Pipedrive com o nome sem acento ("Heloa Jesus"): o nome que vai na mensagem. */
const NOME_DO_DONO: Readonly<Record<number, string>> = { 28897937: "Heloá" };

/**
 * Nome da empresa para a mensagem. Tira o sufixo societário (LTDA, S.A., EIRELI...). Nome ainda cru (caixa alta com
 * mais de duas palavras, ou longo demais) fica como [EMPRESA]: a decisão de 14/10/2026 é o time corrigir o nome da
 * organização antes de mover o card, e mensagem com razão social em caixa alta não sai.
 */
export function empresaParaMensagem(nome: unknown): string {
  const s = String(nome ?? "")
    .trim()
    .replace(/[\s.,-]*\b(ltda|s\.?\s?a|s\/a|eireli|epp|me)\.?\s*$/i, "")
    .replace(/[\s.,-]+$/, "")
    .trim();
  if (!s || s.length > 40) return "";
  const palavras = s.split(/\s+/);
  return s === s.toUpperCase() && /[A-ZÀ-Ú]/.test(s) && palavras.length > 2 ? "" : s;
}

/** "Lucro Presumido, faturamento de R$ 2 milhões até R$ 4,8 milhões", a partir dos campos do card. */
function regraDoCard(deal: any, rotulos: Map<string, Map<string, string>>, frente: string): string {
  const rotulo = (campo: string) => rotulos.get(campo)?.get(String(deal?.[campo] ?? "")) ?? "";
  const regime = rotulo(CAMPO_REGIME);
  const faixa = rotulo(CAMPO_FAIXA);
  // A Consultoria entra pelo regime: sem ele no card, a faixa sozinha não explica a entrada.
  if (frente === "Consultoria" && !REGIMES.has(regime)) return REGRA_DA_FRENTE[frente];
  const partes = [REGIMES.has(regime) ? regime : ""];
  if (faixa && !/^\[|sem movimenta/i.test(faixa))
    partes.push(
      /^R\$/.test(faixa)
        ? `faturamento de ${faixa}`
        : `faturamento ${faixa[0].toLowerCase()}${faixa.slice(1)}`,
    );
  return partes.filter(Boolean).join(", ") || REGRA_DA_FRENTE[frente] || "";
}

/** O que o card já sabe, no formato dos colchetes da régua. `deal` é o da listagem v1 (org_name, person_id, user_id). */
export function camposDoCard(
  deal: any,
  rotulos = new Map<string, Map<string, string>>(),
): CamposDoCard {
  const pessoa = deal?.person_id && typeof deal.person_id === "object" ? deal.person_id : null;
  const dono = deal?.user_id && typeof deal.user_id === "object" ? deal.user_id : null;
  const frente = FRENTES[String(deal?.[CAMPO_PRODUTO] ?? "")] ?? "";
  const socio = socioDoCampo(deal?.[CAMPO_SOCIO_NO_EMAIL]);
  const c: CamposDoCard = {
    EMPRESA: empresaParaMensagem(deal?.org_name ?? deal?.org_id?.name),
    NOME: primeiroNome(pessoa?.name ?? deal?.person_name),
    "SEU NOME": NOME_DO_DONO[Number(dono?.id)] ?? primeiroNome(dono?.name ?? deal?.owner_name),
    FRENTE: frente,
    REGRA: frente ? regraDoCard(deal, rotulos, frente) : "",
  };
  if (socio) {
    c["SÓCIO"] = socio.nome;
    c["SÓCIO_ARTIGO"] = socio.artigo;
  }
  return c;
}

/**
 * Troca os colchetes que têm valor em `campos`; os outros ficam como estão. O sócio leva o artigo: "do [SÓCIO]" vira
 * "da Jordana" e "o [SÓCIO]" vira "a Jordana"; no vocativo ("[SÓCIO], tentei...") vai só o nome.
 */
export function preencher(texto: string, campos: CamposDoCard): string {
  let t = texto;
  const socio = campos["SÓCIO"]?.trim();
  if (socio) {
    const a = campos["SÓCIO_ARTIGO"] === "a" ? "a" : "o";
    t = t.replace(/\bdo \[SÓCIO\]/g, `d${a} ${socio}`).replace(/\bo \[SÓCIO\]/g, `${a} ${socio}`);
  }
  return t.replace(/\[([^\]]+)\]/g, (todo, chave) =>
    chave !== "SÓCIO_ARTIGO" && campos[chave]?.trim() ? campos[chave].trim() : todo,
  );
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

/**
 * As atividades da régua para um card que entrou na etapa em `entrada`, com dia e hora já em UTC. Com `campos`, a
 * nota sai com o que o card já sabe preenchido; o [DIA DO D0] vem do próprio D0.
 */
export function planejar(
  entrada: Date,
  regua: readonly ItemRegua[],
  horario: Readonly<Record<Turno, string>> = HORARIO,
  campos?: CamposDoCard,
): AtividadePlanejada[] {
  const d0 = diaZero(entrada);
  const chaves = chavesDaRegua(regua);
  const todos = campos ? { ...campos, "DIA DO D0": `${d0.slice(8, 10)}/${d0.slice(5, 7)}` } : null;
  return regua.map((item, i) => ({
    ...item,
    chave: chaves[i],
    subject: assunto(item),
    note: notaHtml(todos ? preencher(item.nota, todos) : item.nota),
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
  put(path: string, payload: Record<string, unknown>): Promise<any>;
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
    /** Dia gravado em "Caixa · Data 1ª abordagem" no encerramento (só com `naoRepetir`). */
    primeira_abordagem?: string;
  }[];
  ignorados: { deal: number; motivo: string }[];
  /** Cards que voltaram à 276 depois de já terem tido contato: ganharam a tarefa de retomar, não a cadência. */
  ja_abordados: {
    deal: number;
    contatos: number;
    primeiro_contato: string;
    tarefa: number | null;
    primeira_abordagem: string | null;
  }[];
  erros: {
    deal: number;
    etapa: "criar" | "retomar" | "encerrar" | "ler" | "ja_abordado";
    erro: string;
  }[];
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
  /**
   * MONET_CADENCIA_EMAIL_D0_AUTO=sim: a automação do Pipedrive manda o e-mail de apresentação na entrada da 276, pela
   * caixa do dono do card (pedido do Pedro, 13/10/2026). O e-mail do D0 da régua nasce já feito, com a nota dizendo
   * onde conferir, para o pré-vendedor não mandar de novo.
   */
  emailD0Automatico?: boolean;
  /**
   * MONET_CADENCIA_NAO_REPETIR=sim (regra do Pedro, 23/10/2026): card que volta à 276 depois de já ter tido contato
   * com o cliente não recomeça a cadência; ganha uma tarefa de retomar a conversa. E o Brain grava "Caixa · Data 1ª
   * abordagem", que a automação do e-mail do D0 exige vazio.
   */
  naoRepetir?: boolean;
};

export const NOTA_EMAIL_D0_AUTOMATICO =
  "Enviado pela automação do Pipedrive na entrada da etapa, pela caixa do dono do card. Confira na aba E-mails do card. Se não estiver lá, mande o texto abaixo e deixe esta atividade como feita.\n\n";

/** O item da régua que a automação do Pipedrive cobre: o e-mail do D0. */
export const ehEmailD0 = (item: Pick<ItemRegua, "dia" | "tipo">) =>
  item.dia === 0 && item.tipo === "email";

/** Campo "Caixa · Sócio no e-mail" do negócio (id 323, criado em 14/10/2026). Sai no e-mail do D0. */
export const CAMPO_SOCIO_NO_EMAIL = "73bd1e4b5cecc29824871f097f18e6757e17a9ac";

/**
 * A automação do Pipedrive só manda o e-mail do D0 com o sócio preenchido (condição dela, 14/10/2026) e com e-mail
 * na pessoa do card. Fora disso o e-mail não sai, e o D0 · E-mail da régua nasce a fazer, como sempre.
 */
export function emailD0SaiPelaAutomacao(deal: any): boolean {
  const socio = String(deal?.[CAMPO_SOCIO_NO_EMAIL] ?? "").trim();
  const pessoa = deal?.person_id && typeof deal.person_id === "object" ? deal.person_id : null;
  const emails = Array.isArray(pessoa?.email) ? pessoa.email : [];
  return socio !== "" && emails.some((e: any) => String(e?.value ?? "").includes("@"));
}

// ---------------------------------------------------------------------------- card já abordado (23/10/2026)

/**
 * Campo "Caixa · Data 1ª abordagem" do negócio (id 318): o dia do primeiro contato que chegou ao cliente. A automação
 * do e-mail do D0 no Pipedrive passa a exigir este campo vazio: card que já teve contato não recebe a apresentação de
 * novo quando volta para a 276 (caso Cinc, 23/10/2026).
 */
export const CAMPO_PRIMEIRA_ABORDAGEM = "f77498351abaaf2200ea4ed0d754b51e755f5c61";

/** Um contato que chegou ao cliente (ou veio dele). `em` em UTC (ISO). */
export type Contato = { em: string; quem: string; como: string };

const COMO_POR_TIPO: Readonly<Record<string, string>> = {
  email: "e-mail",
  whatsapp: "WhatsApp",
  meeting: "reunião",
};

/**
 * E-mail recebido que não é do cliente: aviso de entrega do servidor ("Não é possível entregar", do Microsoft Outlook
 * da Planning), resposta automática ou remetente da própria Planning.
 */
function ehAvisoAutomatico(de: any, assunto: unknown): boolean {
  const quem = `${de?.name ?? ""} ${de?.email_address ?? ""}`;
  return (
    /@planning\.com\.br\b|mailer-daemon|postmaster|microsoftexchange|no-?reply/i.test(quem) ||
    /^\s*(não é possível entregar|undeliverable|delivery status|falha na entrega|resposta automática|automatic reply|ausência temporária|out of office)/i.test(
      String(assunto ?? ""),
    )
  );
}

/**
 * Os contatos com o cliente antes de `ate`, do mais antigo ao mais recente: atividades feitas de e-mail, WhatsApp e
 * reunião, ligação atendida (a Api4Com registra "Ligação para ... atendida às ...") e e-mails do card, enviados ou
 * recebidos. Ligação sem resposta não conta, nem o WhatsApp aos sócios da unidade (vai para o sócio, não ao cliente),
 * nem aviso automático recebido (e-mail que voltou, resposta automática). O e-mail enviado que voltou ainda conta: o
 * aviso fica no histórico do card, para o pré-vendedor ver na retomada.
 */
export function contatosDoCard(
  atividades: readonly any[],
  emails: readonly any[],
  ate?: Date | null,
): Contato[] {
  const limite = ate?.getTime() ?? Number.POSITIVE_INFINITY;
  const r: Contato[] = [];
  for (const a of atividades || []) {
    if (!feita(a?.done)) continue;
    const texto = String(a?.subject ?? "");
    if (/aos sócios/i.test(texto)) continue;
    const atendida = /atendida às/i.test(texto) && !/não foi atendida/i.test(texto);
    const como = atendida ? "ligação atendida" : COMO_POR_TIPO[String(a?.type ?? "")];
    if (!como) continue;
    const em =
      instante(a?.marked_as_done_time) ?? instante(`${a?.due_date} ${a?.due_time || "00:00"}`);
    if (!em || em.getTime() >= limite) continue;
    r.push({ em: em.toISOString(), quem: String(a?.owner_name ?? "").trim(), como });
  }
  for (const item of emails || []) {
    const m = item?.data ?? item;
    if (feita(m?.draft_flag)) continue;
    const em = instante(m?.message_time) ?? instante(m?.add_time);
    if (!em || em.getTime() >= limite) continue;
    const de = Array.isArray(m?.from) ? m.from[0] : null;
    const enviado = feita(m?.sent_flag);
    if (!enviado && ehAvisoAutomatico(de, m?.subject)) continue;
    r.push({
      em: em.toISOString(),
      quem: String(de?.name ?? "").trim(),
      como: enviado ? "e-mail" : "e-mail recebido do cliente",
    });
  }
  return r.sort((x, y) => x.em.localeCompare(y.em));
}

/** Os contatos do card no Pipedrive antes de `ate`: atividades feitas e e-mails, dois GET por card. */
export async function contatosAnteriores(
  pd: Pick<PipedriveCadencia, "pages">,
  deal: number,
  ate?: Date | null,
): Promise<Contato[]> {
  const [atividades, emails] = await Promise.all([
    pd.pages(`deals/${deal}/activities`, { done: "1" }),
    pd.pages(`deals/${deal}/mailMessages`, {}),
  ]);
  return contatosDoCard(atividades, emails, ate);
}

/** "15/10", na data de São Paulo. */
const diaMes = (iso: string) => {
  const d = dataSP(new Date(iso));
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
};

/** O primeiro horário da régua (09:00 ou 14:00, em dia útil) que ainda não passou. */
export function proximoHorario(
  agora: Date,
  horario: Readonly<Record<Turno, string>> = HORARIO,
): { dia: string; turno: Turno } {
  const hoje = dataSP(agora);
  if (ehDiaUtil(hoje))
    for (const turno of ["manha", "tarde"] as const)
      if (instanteSP(hoje, horario[turno]).getTime() >= agora.getTime())
        return { dia: hoje, turno };
  return { dia: ehDiaUtil(hoje) ? diaUtilApos(hoje, 1) : diaZero(agora), turno: "manha" };
}

/** Quantos contatos (os mais recentes) a nota da tarefa lista. */
const CONTATOS_NA_NOTA = 6;

/** A tarefa que substitui a cadência no card já abordado: assunto, nota em HTML e vencimento em UTC. */
export function tarefaJaAbordado(
  contatos: readonly Contato[],
  agora: Date,
  horario: Readonly<Record<Turno, string>> = HORARIO,
): { subject: string; note: string; turno: Turno; due_date: string; due_time: string } {
  const linhas: string[] = [];
  for (const c of contatos) {
    const l = [diaMes(c.em), c.quem, c.como].filter(Boolean).join(" · ");
    if (linhas[linhas.length - 1] !== l) linhas.push(l);
  }
  const { dia, turno } = proximoHorario(agora, horario);
  return {
    subject: `Caixa · Retomar a conversa (contato desde ${diaMes(contatos[0].em)})`,
    note: notaHtml(
      "Este card já teve contato com o cliente. A cadência não recomeçou, para o cliente não receber a " +
        "apresentação de novo (regra de 23/10/2026).\n\nContatos registrados:\n" +
        linhas
          .slice(-CONTATOS_NA_NOTA)
          .map((l) => `• ${l}`)
          .join("\n") +
        "\n\nAntes de falar com o cliente, leia o histórico do card (e-mails, WhatsApp, ligações e notas) e retome de " +
        "onde a conversa parou, sem se apresentar como num primeiro contato. Se o cliente já disse que não tem " +
        "interesse ou que não é mais cliente da Planning, marque o card como perdido com esse motivo.",
    ),
    turno,
    ...vencimentoUtc(dia, horario[turno]),
  };
}

/** Grava o dia (São Paulo) do primeiro contato em "Caixa · Data 1ª abordagem" se o campo estiver vazio. */
export async function marcarPrimeiraAbordagem(
  pd: Pick<PipedriveCadencia, "put">,
  id: number,
  deal: any,
  em: string,
): Promise<string | null> {
  if (String(deal?.[CAMPO_PRIMEIRA_ABORDAGEM] ?? "").trim()) return null;
  const dia = dataSP(new Date(em));
  await pd.put(`deals/${id}`, { [CAMPO_PRIMEIRA_ABORDAGEM]: dia });
  return dia;
}

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
  // Card que sai da 276 depois de contato leva a data da 1ª abordagem: se voltar, a automação do D0 não reenvia.
  let primeira: string | null = null;
  if (ativo && op.naoRepetir)
    try {
      const d = (await pd.get(`deals/${deal}`))?.data;
      if (d && !String(d[CAMPO_PRIMEIRA_ABORDAGEM] ?? "").trim()) {
        const contatos = await contatosAnteriores(pd, deal);
        if (contatos.length) primeira = await marcarPrimeiraAbordagem(pd, deal, d, contatos[0].em);
      }
    } catch {
      // Fica sem a data: na volta à 276, a regra do card já abordado lê os contatos de novo.
    }
  return {
    deal,
    motivo,
    apagadas,
    mantidas,
    ja_nao_existiam,
    ...(primeira ? { primeira_abordagem: primeira } : {}),
  };
}

/**
 * Card que voltou à 276 depois de já ter tido contato (regra de 23/10/2026): em vez da cadência, uma tarefa de
 * retomar a conversa para o dono, e a linha fica `ignorada` com o motivo (não volta nas rodadas seguintes). A linha
 * vem antes da tarefa: se outra rodada já gravou, ela é a dona da criação.
 */
async function jaAbordado(
  op: OpcoesCadencia,
  deal: any,
  id: number,
  entrouEm: string,
  dono: number | null,
  contatos: Contato[],
  horario: Readonly<Record<Turno, string>>,
): Promise<ResumoCadencia["ja_abordados"][number] | null> {
  const { pd, store, ativo, agora, versao } = op;
  const r: ResumoCadencia["ja_abordados"][number] = {
    deal: id,
    contatos: contatos.length,
    primeiro_contato: contatos[0].em,
    tarefa: null,
    primeira_abordagem: null,
  };
  if (!ativo) return r;
  const inseriu = await store.inserir({
    deal_id: id,
    entrou_em: entrouEm,
    dono,
    versao_regua: versao,
    atividades: [],
    status: "ignorada",
    motivo_encerramento: `já abordado: contato desde ${diaMes(contatos[0].em)}`,
  });
  if (!inseriu) return null;
  const t = tarefaJaAbordado(contatos, agora, horario);
  const criada = await pd.post("activities", {
    subject: t.subject,
    type: "task",
    due_date: t.due_date,
    due_time: t.due_time,
    duration: DURACAO_ATIVIDADE,
    deal_id: id,
    ...(dono ? { user_id: dono } : {}),
    note: t.note,
    done: 0,
  });
  const tarefa = Number(criada?.data?.id) || null;
  if (tarefa) {
    r.tarefa = tarefa;
    await store.atualizar(id, entrouEm, {
      atividades: [
        {
          id: tarefa,
          chave: "ja-abordado",
          dia: 0,
          canal: "Retomar a conversa",
          tipo: "task",
          turno: t.turno,
          due_date: t.due_date,
          due_time: t.due_time,
        },
      ],
    });
  }
  r.primeira_abordagem = await marcarPrimeiraAbordagem(pd, id, deal, contatos[0].em);
  return r;
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
  emailD0Auto = false,
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
      const automatico = emailD0Auto && ehEmailD0(p);
      const r = await pd.post("activities", {
        subject: p.subject,
        type: tipo,
        due_date: p.due_date,
        due_time: p.due_time,
        duration: DURACAO_ATIVIDADE,
        deal_id: Number(linha.deal_id),
        ...(dono ? { user_id: dono } : {}),
        note: automatico ? notaHtml(NOTA_EMAIL_D0_AUTOMATICO) + p.note : p.note,
        done: automatico ? 1 : 0,
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
    ja_abordados: [],
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
    // Rótulos de regime e faixa, lidos uma vez por rodada e só se houver cadência para criar. Sem eles, o [REGRA]
    // sai com a régua da frente.
    let rotulos: Map<string, Map<string, string>> | null = null;
    const lerRotulos = async () =>
      (rotulos ??= await pd
        .pages("dealFields", {})
        .then(rotulosDosCampos)
        .catch(() => new Map<string, Map<string, string>>()));
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
          if (op.naoRepetir) {
            const contatos = await contatosAnteriores(pd, id, entrou);
            if (contatos.length) {
              try {
                const r = await jaAbordado(op, deal, id, entrouEm, dono, contatos, horario);
                if (r) resumo.ja_abordados.push(r);
              } catch (e) {
                resumo.erros.push({ deal: id, etapa: "ja_abordado", erro: mensagem(e) });
              }
              continue;
            }
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
        // Com a regra de 23/10, a automação do D0 também exige "Caixa · Data 1ª abordagem" vazia.
        const emailD0 =
          !!op.emailD0Automatico &&
          emailD0SaiPelaAutomacao(deal) &&
          !(op.naoRepetir && String(deal?.[CAMPO_PRIMEIRA_ABORDAGEM] ?? "").trim());
        const n = await criarAtividades(
          op,
          alvo,
          planejar(entrou, regua, horario, camposDoCard(deal, await lerRotulos())),
          dono ?? alvo.dono ?? null,
          tipos.usar,
          emailD0,
        );
        // O e-mail do D0 chegou ao cliente: a data da 1ª abordagem é a da entrada.
        if (ativo && op.naoRepetir && !linha && emailD0)
          await marcarPrimeiraAbordagem(pd, id, deal, entrouEm).catch(() => null);
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
