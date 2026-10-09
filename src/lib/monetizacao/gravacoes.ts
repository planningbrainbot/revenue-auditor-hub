/**
 * Tela Gravações da Monetização (`/monetizacao?aba=gravacoes`): a lista de reuniões do pipe 39, montada do histórico
 * do card e de `ops.monetizacao_reunioes`. Spec `docs/superpowers/specs/2026-10-02-monetizacao-gravacoes-tela.md`,
 * contrato `docs/design/contratos/monetizacao-gravacoes.md`.
 *
 * O que é sensível (avaliação, trechos, transcrição) chega do servidor já recortado pela trava: a RPC só devolve as
 * reuniões que a pessoa pode ver. As linhas do histórico vêm da carga do CRM, que a Operação já mostra a todos com
 * `view.monetizacao`; aqui elas seguem o mesmo recorte (closer vê só os próprios cards) para a tela não misturar
 * reunião alheia com as dele.
 */
import {
  detalharOfertado,
  localizarTrecho,
  PRODUTOS_OFERTADOS,
  type Confianca,
  type ItemOfertado,
  type OfertadoDetalhado,
  type ProdutoOfertado,
} from "../../../supabase/functions/monetizacao-reunioes/ofertado.ts";
import type { Fala } from "../../../supabase/functions/monetizacao-reunioes/avaliacao.ts";
import { chaveDaEtapa } from "../../../supabase/functions/_shared/etapas-pipe39.ts";
import { ficou, instante, reguaDoPipe, trajeto, type Etapa } from "./funil-cumulativo.ts";
import type { Negocio, Produto } from "./types";

export { detalharOfertado, localizarTrecho, PRODUTOS_OFERTADOS };
export type { Confianca, Fala, ItemOfertado, OfertadoDetalhado, ProdutoOfertado };

export type TipoReuniao = "levantamento" | "proposta";
export type StatusBanco =
  "na_fila" | "cancelada" | "gravando" | "avaliada" | "sem_gravacao" | "erro";
export const SITUACOES_GRAVACAO = [
  "na_fila",
  "gravando",
  "avaliada",
  "sem_gravacao",
  "erro",
  "sem_registro",
] as const;
export type SituacaoGravacao = (typeof SITUACOES_GRAVACAO)[number];

export const ROTULO_SITUACAO: Record<SituacaoGravacao, string> = {
  na_fila: "Na fila",
  gravando: "Gravando",
  avaliada: "Avaliada",
  sem_gravacao: "Sem gravação",
  erro: "Erro",
  sem_registro: "Sem registro no card",
};
export const ROTULO_TIPO: Record<TipoReuniao, string> = {
  levantamento: "Levantamento com sócio",
  proposta: "Proposta",
};

/** Uma reunião como a RPC da lista devolve (sem transcrição e sem trecho). */
export interface ReuniaoBanco {
  event_id: string;
  deal_id: number;
  tipo: TipoReuniao;
  inicio: string;
  fim: string | null;
  status: StatusBanco;
  closer_pipedrive_id: number | null;
  nota: number | null;
  /** Só se cada produto foi apresentado; o trecho fica na ficha. */
  ofertado: Partial<Record<ProdutoOfertado, boolean>> | null;
  ofertados_gravados: ProdutoOfertado[] | null;
  ofertados_gravados_em: string | null;
  erro: string | null;
  nota_pipedrive_id: number | null;
  updated_at: string | null;
  /** `joiner_status` da fila do bot. */
  bot: string | null;
  /** Situação da transcrição no Brain Meet. */
  transcricao: string | null;
}

/** Resposta de `ops.monetizacao_gravacoes_lista()`. */
export interface ListaGravacoes {
  admin: boolean;
  closers: number[];
  reunioes: ReuniaoBanco[];
}

/** Resposta de `ops.monetizacao_gravacao(event_id)`: a ficha, com a transcrição depois da checagem. */
export interface DetalheGravacao extends Omit<
  ReuniaoBanco,
  "ofertado" | "updated_at" | "transcricao"
> {
  avaliacao: AvaliacaoGravada | null;
  ofertado: Partial<Record<ProdutoOfertado, Partial<ItemOfertado>>> | null;
  bot_erro: string | null;
  transcricao: string | null;
  transcricao_erro: string | null;
  duracao_s: number | null;
  falas: Fala[];
  /** "Falante 1" → nome, quando alguém nomeou no Brain Meet. */
  nomes: Record<string, string>;
}

/** O que a Edge Function grava em `avaliacao` (saída de apurar(), com custo e modelo). */
export interface AvaliacaoGravada {
  tipo: TipoReuniao;
  versao_rubrica: string;
  nota: number | null;
  blocos: Record<string, number | null>;
  fases: {
    id: number;
    nome: string;
    peso: number;
    executou: "sim" | "parcial" | "nao";
    rebaixada: boolean;
    evidencia: string;
    antipadroes: string[];
    nota_curta: string;
  }[];
  produtos_que_seguem: string[];
  quem_falou_mais: string | null;
  desfecho: string | null;
  recomendacao: string;
}

/** Uma linha da lista. */
export interface Reuniao {
  /** `event_id` da reunião registrada, ou `hist-<deal>-<tipo>` para a do histórico do card. */
  chave: string;
  origem: "registrada" | "historico";
  deal_id: number;
  empresa: string;
  /** Título do card no Pipedrive. */
  card: string;
  url: string | null;
  closer_id: number | null;
  closer: string;
  tipo: TipoReuniao;
  /** Instante (ISO, UTC): início da reunião registrada, ou entrada do card na etapa (histórico). */
  data: string | null;
  /** aaaa-mm em São Paulo. */
  mes: string | null;
  etapa: string;
  encerrado: "won" | "lost" | "other" | null;
  produto: Produto | "sem_produto" | null;
  situacao: SituacaoGravacao;
  nota: number | null;
  /** Produtos apresentados, lidos da gravação. */
  ofertado: ProdutoOfertado[];
  banco: ReuniaoBanco | null;
}

const SP = "America/Sao_Paulo";
const fmtMes = new Intl.DateTimeFormat("en-CA", {
  timeZone: SP,
  year: "numeric",
  month: "2-digit",
});
/** aaaa-mm do instante, em São Paulo. */
export const mesSaoPaulo = (iso: string | null) => {
  if (!iso) return null;
  const t = instante(iso);
  return Number.isFinite(t) ? fmtMes.format(new Date(t)).slice(0, 7) : null;
};

/** Desde quando a etapa "Reunião de proposta" existe (funil novo do pipe 39, 01/10/2026 em São Paulo). */
export const INICIO_REUNIAO_PROPOSTA = "2026-10-01T03:00:00Z";

// Pelo nome, antigo ou novo ("Agendado - Levantamento com sócio" desde 09/10/2026): `_shared/etapas-pipe39.ts`.
const ehAgendada = (nome: string) => chaveDaEtapa(nome) === "agendada";
const ehProposta = (nome: string) => chaveDaEtapa(nome) === "reuniaoProposta";
const ISO = (t: number) => new Date(t).toISOString();

/** Situação de uma reunião registrada. */
export function situacaoDoBanco(r: Pick<ReuniaoBanco, "status">): SituacaoGravacao {
  return r.status === "cancelada" ? "sem_gravacao" : r.status;
}

const ofertadoDaLista = (o: ReuniaoBanco["ofertado"]): ProdutoOfertado[] =>
  PRODUTOS_OFERTADOS.filter((p) => o?.[p] === true);

/**
 * A reunião de levantamento que o histórico do card mostra, pela régua cumulativa: o card chegou a levantamento
 * agendado ou além (etapa em que ficou 30 min, de onde avançou ou em que terminou). A data é a primeira entrada em
 * levantamento realizado ou além (Stand by conta como realizado), senão a primeira em agendado.
 */
export function levantamentoDoHistorico(
  c: Negocio,
  regua: ReturnType<typeof reguaDoPipe>,
): { data: string; pendente: boolean } | null {
  const agendada = regua.nivelDe.agendada;
  const realizada = regua.nivelDe.realizada;
  if (agendada === undefined) return null;
  const mv = trajeto(c, regua);
  const alcancou = mv.filter((m, i) => ficou(mv, i));
  const realiz = realizada === undefined ? undefined : alcancou.find((m) => m.nivel >= realizada);
  const agend = alcancou.find((m) => m.nivel >= agendada);
  const passo = realiz ?? agend;
  if (!passo) return null;
  // Pendente: o card está aberto hoje na etapa de levantamento agendado e nunca passou dela.
  const pendente = !realiz && c.status === "open" && ehAgendada(c.stage);
  return { data: ISO(passo.t), pendente };
}

/** A reunião de proposta do histórico: entrada em "Reunião de proposta" desde 01/10 (a etapa nasceu então). */
export function propostaDoHistorico(
  c: Negocio,
  stages: Etapa[],
): { data: string; pendente: boolean } | null {
  const ids = new Set(stages.filter((s) => ehProposta(s.name)).map((s) => s.id));
  if (!ids.size) return null;
  const desde = instante(INICIO_REUNIAO_PROPOSTA);
  const entradas = (c.moves ?? [])
    .filter((m) => ids.has(m.stage_id))
    .map((m) => instante(m.at))
    .filter((t) => Number.isFinite(t) && t >= desde)
    .sort((a, b) => a - b);
  const pendente = c.status === "open" && ids.has(c.stage_id);
  if (!entradas.length) return null;
  return { data: ISO(entradas[0]), pendente };
}

function etapaDeHoje(c: Negocio | undefined): Pick<Reuniao, "etapa" | "encerrado"> {
  if (!c) return { etapa: "Fora do pipe 39", encerrado: null };
  const nome = c.stage.replace(/^\d+\s*·\s*/, "");
  if (c.status === "won") return { etapa: `Ganho · ${nome}`, encerrado: "won" };
  if (c.status === "lost") return { etapa: `Perdido · ${nome}`, encerrado: "lost" };
  if (c.status !== "open") return { etapa: `Encerrado · ${nome}`, encerrado: "other" };
  return { etapa: nome, encerrado: null };
}

/**
 * A lista da tela: as reuniões registradas (bot pedido pela atividade do card) e, para cada card e tipo sem reunião
 * registrada, a do histórico. Closer que não é admin vê só os cards dele. Mais recente primeiro.
 */
export function montarReunioes(entrada: {
  cards: Negocio[];
  stages: Etapa[];
  lista: ListaGravacoes;
}): Reuniao[] {
  const { cards, stages, lista } = entrada;
  const porId = new Map(cards.map((c) => [c.id, c]));
  const meus = new Set(lista.closers);
  const visivel = (closer: number | null) => lista.admin || (closer !== null && meus.has(closer));
  const regua = reguaDoPipe(stages);
  const saida: Reuniao[] = [];
  const registradas = new Set<string>();

  for (const r of lista.reunioes) {
    if (r.status === "cancelada") continue;
    const c = porId.get(Number(r.deal_id));
    registradas.add(`${r.deal_id}-${r.tipo}`);
    saida.push({
      chave: r.event_id,
      origem: "registrada",
      deal_id: Number(r.deal_id),
      empresa: c?.org || c?.title || `Card ${r.deal_id}`,
      card: c?.title || `Card ${r.deal_id}`,
      url: c?.url ?? null,
      closer_id: r.closer_pipedrive_id,
      closer:
        c && c.owner_id === r.closer_pipedrive_id
          ? c.owner
          : nomeDoCloser(r.closer_pipedrive_id, cards),
      tipo: r.tipo,
      data: r.inicio,
      mes: mesSaoPaulo(r.inicio),
      ...etapaDeHoje(c),
      produto: c?.route ?? null,
      situacao: situacaoDoBanco(r),
      nota: r.nota === null || r.nota === undefined ? null : Number(r.nota),
      ofertado: ofertadoDaLista(r.ofertado),
      banco: r,
    });
  }

  for (const c of cards) {
    if (!visivel(c.owner_id)) continue;
    const candidatos: [TipoReuniao, { data: string; pendente: boolean } | null][] = [
      ["levantamento", levantamentoDoHistorico(c, regua)],
      ["proposta", propostaDoHistorico(c, stages)],
    ];
    for (const [tipo, h] of candidatos) {
      if (!h || registradas.has(`${c.id}-${tipo}`)) continue;
      saida.push({
        chave: `hist-${c.id}-${tipo}`,
        origem: "historico",
        deal_id: c.id,
        empresa: c.org || c.title,
        card: c.title,
        url: c.url,
        closer_id: c.owner_id,
        closer: c.owner,
        tipo,
        data: h.data,
        mes: mesSaoPaulo(h.data),
        ...etapaDeHoje(c),
        produto: c.route,
        situacao: h.pendente ? "sem_registro" : "sem_gravacao",
        nota: null,
        ofertado: [],
        banco: null,
      });
    }
  }

  return saida.sort(
    (a, b) =>
      (b.data ? instante(b.data) : 0) - (a.data ? instante(a.data) : 0) ||
      a.chave.localeCompare(b.chave),
  );
}

function nomeDoCloser(id: number | null, cards: Negocio[]): string {
  if (id === null) return "Sem closer";
  return cards.find((c) => c.owner_id === id)?.owner ?? `Usuário ${id}`;
}

export type FiltroGravacoes = { mes?: string; gravacao?: SituacaoGravacao; q?: string };

const semAcento = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

/** O recorte de mês e busca (os números do topo); a situação filtra só a lista. */
export function recorte(lista: Reuniao[], f: FiltroGravacoes): Reuniao[] {
  const q = semAcento((f.q ?? "").trim());
  return lista.filter(
    (r) =>
      (!f.mes || r.mes === f.mes) &&
      (!q || semAcento([r.empresa, r.card, String(r.deal_id), r.closer].join(" ")).includes(q)),
  );
}

export function filtrar(lista: Reuniao[], f: FiltroGravacoes): Reuniao[] {
  return recorte(lista, f).filter((r) => !f.gravacao || r.situacao === f.gravacao);
}

/** Quantas reuniões em cada situação; contagem inteira, zero quando não há. */
export function contarSituacoes(lista: Reuniao[]): Record<SituacaoGravacao, number> {
  const n = Object.fromEntries(SITUACOES_GRAVACAO.map((s) => [s, 0])) as Record<
    SituacaoGravacao,
    number
  >;
  for (const r of lista) n[r.situacao]++;
  return n;
}

/** Meses com reunião, do mais recente ao mais antigo. */
export function mesesDaLista(lista: Reuniao[]): string[] {
  return [...new Set(lista.map((r) => r.mes).filter((m): m is string => !!m))].sort().reverse();
}

/** "mm:ss" (ou "h:mm:ss" acima de uma hora). */
export function minuto(segundos: number | string | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(segundos) || 0));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * O ofertado da ficha, com minuto e confiança. A Edge Function grava os dois desde 02/10; para avaliação sem eles,
 * a tela calcula a partir das falas que a RPC devolveu.
 */
export function ofertadoDaFicha(d: Pick<DetalheGravacao, "ofertado" | "falas">): OfertadoDetalhado {
  const gravado = d.ofertado ?? {};
  const calculado = detalharOfertado(gravado, d.falas ?? []);
  const saida = {} as OfertadoDetalhado;
  for (const p of PRODUTOS_OFERTADOS) {
    const g = gravado[p];
    saida[p] =
      g && "confianca" in g && g.apresentado === "sim"
        ? {
            apresentado: "sim",
            evidencia: String(g.evidencia ?? ""),
            confianca: (g.confianca as Confianca | null) ?? null,
            inicio_s: g.inicio_s ?? null,
          }
        : calculado[p];
  }
  return saida;
}

/** Nome de quem fala: o nome dado no Brain Meet, senão o rótulo ("Falante 1"). */
export const nomeDoFalante = (falante: string, nomes: Record<string, string> | null | undefined) =>
  nomes?.[falante]?.trim() || falante;

/** A transcrição em texto, para exportar: cabeçalho da reunião e "[mm:ss] Falante: texto" por linha. */
export function transcricaoEmTexto(
  r: Pick<Reuniao, "empresa" | "deal_id" | "tipo" | "data" | "closer">,
  d: Pick<DetalheGravacao, "falas" | "nomes">,
): string {
  const quando = r.data
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: SP,
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
        .format(new Date(instante(r.data)))
        .replace(",", "")
    : "sem data";
  const linhas = [...(d.falas ?? [])]
    .sort((a, b) => a.ordem - b.ordem)
    .map((f) => `[${minuto(f.inicio_s)}] ${nomeDoFalante(f.falante, d.nomes)}: ${f.texto}`);
  return [
    `Reunião de ${ROTULO_TIPO[r.tipo].toLowerCase()} · ${r.empresa} · card ${r.deal_id}`,
    `${quando} (horário de Brasília) · closer: ${r.closer}`,
    "Transcrição automática do bot de reuniões do Brain. Contém dado de cliente: não compartilhe fora da Planning.",
    "",
    ...linhas,
    "",
  ].join("\n");
}

/** Nome do arquivo exportado, sem acento nem espaço. */
export function nomeDoArquivo(r: Pick<Reuniao, "empresa" | "deal_id" | "data">): string {
  const base = semAcento(r.empresa)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const dia = r.data ? new Date(instante(r.data)).toISOString().slice(0, 10) : "sem-data";
  return `transcricao-${base || "reuniao"}-card-${r.deal_id}-${dia}.txt`;
}
