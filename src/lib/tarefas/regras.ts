// Regras da área Tarefas que não dependem de banco nem de tela (contrato
// docs/design/contratos/tarefas.md). Ficam aqui para o teste importar sem o app.
//
// Dia é sempre o de São Paulo: tarefa que vence hoje não está atrasada, e "esta
// semana" vai de hoje até domingo. A régua é a mesma do Cockpit do COO (DECISIONS 29/09).

export type Prioridade = "alta" | "media" | "baixa";
export const PRIORIDADES: Prioridade[] = ["alta", "media", "baixa"];
export const ROTULO_PRIORIDADE: Record<Prioridade, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

export type SituacaoPrazo = "atrasada" | "semana" | "futura" | "sem";
export type FiltroPrazo = "atrasadas" | "semana" | "sem";
export type FiltroStatus = "abertas" | "concluidas" | "todas";

/** O mínimo de uma tarefa para as contas desta página. */
export type TarefaBase = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null; // AAAA-MM-DD
  prioridade: Prioridade;
  concluida: boolean; // está numa coluna marcada como concluída
  responsavelId: string | null;
  projetoId: string | null;
  departamentoId: string | null;
  quadroId: string;
};

/** Hoje em São Paulo, AAAA-MM-DD. */
export function hojeSaoPaulo(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(agora);
}

/** O domingo da semana de `hoje` (o próprio dia, se for domingo). */
export function domingoDaSemana(hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  const falta = (7 - d.getUTCDay()) % 7;
  d.setUTCDate(d.getUTCDate() + falta);
  return d.toISOString().slice(0, 10);
}

export function situacaoDoPrazo(prazo: string | null, hoje: string): SituacaoPrazo {
  if (!prazo) return "sem";
  if (prazo < hoje) return "atrasada";
  if (prazo <= domingoDaSemana(hoje)) return "semana";
  return "futura";
}

export type Contagem = { abertas: number; atrasadas: number; semana: number; semPrazo: number };

/** Os quatro cartões do topo. Só tarefa aberta entra em qualquer um deles. */
export function contar(tarefas: TarefaBase[], hoje: string): Contagem {
  const c: Contagem = { abertas: 0, atrasadas: 0, semana: 0, semPrazo: 0 };
  for (const t of tarefas) {
    if (t.concluida) continue;
    c.abertas++;
    const s = situacaoDoPrazo(t.prazo, hoje);
    if (s === "atrasada") c.atrasadas++;
    else if (s === "semana") c.semana++;
    else if (s === "sem") c.semPrazo++;
  }
  return c;
}

const PESO_PRIORIDADE: Record<Prioridade, number> = { alta: 0, media: 1, baixa: 2 };

/** Minhas tarefas: prazo mais cedo primeiro (atrasada já vem antes), sem prazo por último; empate por prioridade. */
export function ordenarPorPrazo<T extends TarefaBase>(tarefas: T[]): T[] {
  return [...tarefas].sort((a, b) => {
    if (a.concluida !== b.concluida) return a.concluida ? 1 : -1;
    if (a.prazo !== b.prazo) {
      if (!a.prazo) return 1;
      if (!b.prazo) return -1;
      return a.prazo < b.prazo ? -1 : 1;
    }
    const p = PESO_PRIORIDADE[a.prioridade] - PESO_PRIORIDADE[b.prioridade];
    return p !== 0 ? p : a.titulo.localeCompare(b.titulo, "pt-BR");
  });
}

/** Ordem de um cartão solto entre dois vizinhos da coluna. */
export function ordemEntre(antes: number | null, depois: number | null): number {
  if (antes == null && depois == null) return 1000;
  if (antes == null) return (depois as number) - 1000;
  if (depois == null) return antes + 1000;
  return (antes + depois) / 2;
}

// ------------------------------------------------------------ filtros (N7)

export type BuscaTarefas = {
  quadro?: string;
  responsavel?: string; // user id, "eu" ou "ninguem"
  prioridade?: Prioridade;
  projeto?: string;
  departamento?: string;
  prazo?: FiltroPrazo;
  status?: FiltroStatus;
  busca?: string;
  tarefa?: string;
};

const ID_RE = /^[0-9a-f-]{36}$/i;

export function lerBuscaTarefas(s: Record<string, unknown>): BuscaTarefas {
  const id = (v: unknown) => (typeof v === "string" && ID_RE.test(v) ? v : undefined);
  const texto = (v: unknown) =>
    typeof v === "string" && v.trim() && v.length <= 120 ? v : undefined;
  return {
    quadro: id(s.quadro),
    responsavel:
      s.responsavel === "eu" || s.responsavel === "ninguem" ? s.responsavel : id(s.responsavel),
    prioridade: PRIORIDADES.includes(s.prioridade as Prioridade)
      ? (s.prioridade as Prioridade)
      : undefined,
    projeto: id(s.projeto),
    departamento: id(s.departamento),
    prazo:
      s.prazo === "atrasadas" || s.prazo === "semana" || s.prazo === "sem" ? s.prazo : undefined,
    status: s.status === "concluidas" || s.status === "todas" ? s.status : undefined,
    busca: texto(s.busca),
    tarefa: id(s.tarefa),
  };
}

export function temFiltro(b: BuscaTarefas): boolean {
  return Boolean(
    b.quadro ||
    b.responsavel ||
    b.prioridade ||
    b.projeto ||
    b.departamento ||
    b.prazo ||
    b.status ||
    b.busca,
  );
}

/**
 * Aplica os filtros da URL. `status` só vale quando `usarStatus` (Minhas tarefas); no
 * quadro as colunas já mostram aberta e concluída lado a lado. Filtro de prazo olha só as
 * abertas, porque é isso que os cartões contam e o número tem que bater com a lista.
 */
export function filtrar<T extends TarefaBase>(
  tarefas: T[],
  b: BuscaTarefas,
  ctx: { hoje: string; eu: string; usarStatus: boolean },
): T[] {
  const termo = b.busca?.trim().toLocaleLowerCase("pt-BR");
  return tarefas.filter((t) => {
    if (ctx.usarStatus) {
      const status = b.status ?? "abertas";
      if (status === "abertas" && t.concluida) return false;
      if (status === "concluidas" && !t.concluida) return false;
    }
    if (b.quadro && t.quadroId !== b.quadro) return false;
    if (b.responsavel === "eu" && t.responsavelId !== ctx.eu) return false;
    if (b.responsavel === "ninguem" && t.responsavelId) return false;
    if (
      b.responsavel &&
      b.responsavel !== "eu" &&
      b.responsavel !== "ninguem" &&
      t.responsavelId !== b.responsavel
    )
      return false;
    if (b.prioridade && t.prioridade !== b.prioridade) return false;
    if (b.projeto && t.projetoId !== b.projeto) return false;
    if (b.departamento && t.departamentoId !== b.departamento) return false;
    if (b.prazo) {
      if (t.concluida) return false;
      const s = situacaoDoPrazo(t.prazo, ctx.hoje);
      if (b.prazo === "atrasadas" && s !== "atrasada") return false;
      if (b.prazo === "semana" && s !== "semana") return false;
      if (b.prazo === "sem" && s !== "sem") return false;
    }
    if (termo) {
      const alvo = `${t.titulo} ${t.descricao ?? ""}`.toLocaleLowerCase("pt-BR");
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });
}

/** "22/10" no ano corrente, "22/10/2027" fora dele. */
export function formatarPrazo(prazo: string, hoje: string): string {
  const [a, m, d] = prazo.split("-");
  return a === hoje.slice(0, 4) ? `${d}/${m}` : `${d}/${m}/${a}`;
}

// ------------------------------------------------------------------ anexos

export const BUCKET_ANEXOS = "tarefas-anexos";
/** 25 MB, o mesmo limite do bucket (migration 20261022200000). */
export const LIMITE_ANEXO = 25 * 1024 * 1024;

/**
 * Caminho do arquivo no bucket: <quadro>/<tarefa>/<id>-<nome>. A primeira pasta é o quadro
 * (é o que a policy do Storage confere). O nome perde acento e o que o Storage recusa; o
 * nome original fica na linha de ops.tarefas_anexos.
 */
export function caminhoDoAnexo(
  quadroId: string,
  tarefaId: string,
  id: string,
  nome: string,
): string {
  const limpo =
    nome
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(-120) || "arquivo";
  return `${quadroId}/${tarefaId}/${id}-${limpo}`;
}

export function formatarTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(".", ",")} MB`;
}
