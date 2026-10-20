// Base nova da Monetização: pipe 40 (Onboarding | Diagnóstico de Oportunidades), 16/10/2026. A régua de cada número das
// três telas (seção "Base nova") mora aqui, sem React e sem banco: o teste do Node (tests/monetizacao-diagnostico-
// tela.test.mjs) importa este arquivo. O dado chega de ops.monetizacao_diagnostico_painel(), gravado pela Edge Function
// monetizacao-diagnostico (o mesmo formato de montarCard em supabase/functions/monetizacao-diagnostico/logica.ts).
// PRD https://claude.ai/artifact/9SapRMdQ3ydy8srToQ7NSn; contrato docs/design/contratos/monetizacao-base-nova.md.

export const ETAPA_DIAG = {
  novo: 293,
  elegivel: 294,
  coleta: 296,
  execucao: 297,
  concluido: 298,
  agendada: 299,
  apresentado: 300,
  negociacao: 301,
} as const;
/** Ordem das etapas no desenho do processo (01 a 08); a do Pipedrive pode mudar, a do processo não. */
export const ORDEM_DIAG: readonly number[] = [293, 294, 296, 297, 298, 299, 300, 301];
export const NUMERO_DIAG: Readonly<Record<number, string>> = {
  293: "01",
  294: "02",
  296: "03",
  297: "04",
  298: "05",
  299: "06",
  300: "07",
  301: "08",
};
/** Nome curto da etapa (o do Pipedrive vem do retrato; este é a reserva quando a etapa sumiu do pipe). */
export const NOME_DIAG: Readonly<Record<number, string>> = {
  293: "Novo Cliente",
  294: "Cliente Elegível",
  296: "Coleta de Documentos",
  297: "Diagnóstico em Execução",
  298: "Diagnóstico Concluído",
  299: "Apresentação Agendada",
  300: "Diagnóstico Apresentado",
  301: "Negociação",
};
/** Probabilidade e estagnação do processo (E0); o retrato traz as do Pipedrive, estas são a reserva. */
export const PROB_DIAG: Readonly<Record<number, number>> = {
  293: 10,
  294: 10,
  296: 10,
  297: 15,
  298: 25,
  299: 35,
  300: 50,
  301: 70,
};
export const PRAZO_CLIENTE_DIAG = { real: 30, presumido: 60 } as const;
export const PRAZO_INTERNO_DIAG = { real: 20, presumido: 45 } as const;
/** Gestor do pipe 40 e a sócia que apresenta (decisões do Pedro, 16/10/2026). */
export const PESSOAS_DIAG: readonly (readonly [number, string])[] = [
  [28381245, "Matheus Carvalho"],
  [24067177, "Jordana Vieira"],
];
export const NOME_PESSOA_DIAG = new Map(PESSOAS_DIAG.map(([id, nome]) => [id, nome]));
export const FONTE_DIAGNOSTICO =
  "Pipedrive, pipeline 40 (Onboarding | Diagnóstico de Oportunidades): cards, etapas, produtos e atividades · vendas ganhas do pipeline 2 (Inside Sales)";
export const URL_PIPEDRIVE = "https://grupoplanning.pipedrive.com/deal/";

export type Area = "consultoria" | "finance" | "teses";
export const AREAS: readonly Area[] = ["consultoria", "finance", "teses"];
export const NOME_AREA: Readonly<Record<Area, string>> = {
  consultoria: "Consultoria",
  finance: "Finance",
  teses: "Teses Jurídicas",
};
export type StatusArea = "pendente" | "entregue" | "sem_oportunidade";

export type EtapaDiag = {
  id: number;
  name: string;
  order: number;
  probabilidade: number;
  estagnacao: number | null;
};
export type AtividadeDiag = {
  id: number;
  subject: string;
  type: string | null;
  user_id: number | null;
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  add_time: string | null;
};
export type CardDiag = {
  id: number;
  title: string;
  org: string | null;
  org_id: number | null;
  person: string | null;
  owner_id: number | null;
  owner: string | null;
  status: string;
  stage_id: number;
  stage_since: string | null;
  add_time: string | null;
  won_time: string | null;
  lost_time: string | null;
  lost_reason: string | null;
  value: number;
  regime: "real" | "presumido" | "simples" | null;
  regime_rotulo: string | null;
  faixa: string | null;
  origem: string | null;
  sub_origem: string | null;
  unidade: string | null;
  unidade_ids: number[];
  fat_conferido: number | null;
  link_pasta: string | null;
  d0: string | null;
  prazo: string | null;
  areas: Record<Area, StatusArea | null>;
  nao_vendido: string | null;
  produtos: {
    product_id: number;
    produto: Area | null;
    nome: string;
    preco: number;
    quantidade: number;
    total: number;
  }[];
  moves: { stage_id: number; at: string; actor_id: number | null }[];
  atividades: AtividadeDiag[];
  url: string;
};
export type TarefaDiag = {
  deal_id: number;
  etapa: string;
  chave: string;
  user_id: number | null;
  assunto: string | null;
  due_date: string | null;
  activity_id: number | null;
  status: "aberta" | "feita" | "apagada";
  criado_em: string | null;
  encerrado_em: string | null;
};
export type PreviaEntrada = {
  venda_id: number;
  empresa: string;
  ganho_em: string | null;
  regime: string | null;
  faixa: string | null;
  unidade: string | null;
};
export type PainelDiag = {
  sync: {
    status: string | null;
    measured_at: string | null;
    error: string | null;
    count: number | null;
    stages: EtapaDiag[];
    previa: {
      gerada_em: string | null;
      entradas: PreviaEntrada[];
      tarefas: { deal_id: number; empresa: string; assunto?: string; due_date?: string }[];
    };
    resumo: {
      entrada?: { ligada?: boolean; desde?: string; fora_da_regra?: Record<string, number> };
      tarefas?: { ligada?: boolean };
    };
  } | null;
  cards: CardDiag[];
  tarefas: TarefaDiag[];
};

// ---------------------------------------------------------------------------- normalização

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON da RPC chega sem tipo. */
const n = (v: any): number | null => {
  const x = Number(v);
  return v == null || v === "" || !Number.isFinite(x) ? null : x;
};
const s = (v: any): string | null => (v == null || v === "" ? null : String(v));
const statusArea = (v: any): StatusArea | null =>
  v === "pendente" || v === "entregue" || v === "sem_oportunidade" ? v : null;
const areaDoProduto = (v: any): Area | null =>
  v === "consultoria" || v === "finance" || v === "teses" ? v : null;

export function normalizarPainelDiagnostico(raw: any): PainelDiag {
  const sync = raw?.sync ?? null;
  const cards: CardDiag[] = (Array.isArray(raw?.cards) ? raw.cards : []).map((c: any) => ({
    id: Number(c.id),
    title: String(c.title ?? ""),
    org: s(c.org),
    org_id: n(c.org_id),
    person: s(c.person),
    owner_id: n(c.owner_id),
    owner: s(c.owner),
    status: String(c.status ?? "open"),
    stage_id: Number(c.stage_id),
    stage_since: s(c.stage_since),
    add_time: s(c.add_time),
    won_time: s(c.won_time),
    lost_time: s(c.lost_time),
    lost_reason: s(c.lost_reason),
    value: n(c.value) ?? 0,
    regime:
      c.regime === "real" || c.regime === "presumido" || c.regime === "simples" ? c.regime : null,
    regime_rotulo: s(c.regime_rotulo),
    faixa: s(c.faixa),
    origem: s(c.origem),
    sub_origem: s(c.sub_origem),
    unidade: s(c.unidade),
    unidade_ids: Array.isArray(c.unidade_ids)
      ? c.unidade_ids.map(Number).filter(Number.isFinite)
      : [],
    fat_conferido: n(c.fat_conferido),
    link_pasta: s(c.link_pasta),
    d0: s(c.d0),
    prazo: s(c.prazo),
    areas: {
      consultoria: statusArea(c.areas?.consultoria),
      finance: statusArea(c.areas?.finance),
      teses: statusArea(c.areas?.teses),
    },
    nao_vendido: s(c.nao_vendido),
    produtos: (Array.isArray(c.produtos) ? c.produtos : []).map((p: any) => ({
      product_id: Number(p.product_id),
      produto: areaDoProduto(p.produto),
      nome: String(p.nome ?? ""),
      preco: n(p.preco) ?? 0,
      quantidade: n(p.quantidade) ?? 1,
      total: n(p.total) ?? 0,
    })),
    moves: (Array.isArray(c.moves) ? c.moves : [])
      .filter((m: any) => m && Number.isFinite(Number(m.stage_id)))
      .map((m: any) => ({
        stage_id: Number(m.stage_id),
        at: String(m.at ?? ""),
        actor_id: n(m.actor_id),
      })),
    atividades: (Array.isArray(c.atividades) ? c.atividades : []).map((a: any) => ({
      id: Number(a.id),
      subject: String(a.subject ?? ""),
      type: s(a.type),
      user_id: n(a.user_id),
      due_date: s(a.due_date),
      done: a.done === true,
      done_at: s(a.done_at),
      add_time: s(a.add_time),
    })),
    url: s(c.url) ?? `${URL_PIPEDRIVE}${c.id}`,
  }));
  const tarefas: TarefaDiag[] = (Array.isArray(raw?.tarefas) ? raw.tarefas : []).map((t: any) => ({
    deal_id: Number(t.deal_id),
    etapa: String(t.etapa ?? ""),
    chave: String(t.chave ?? ""),
    user_id: n(t.user_id),
    assunto: s(t.assunto),
    due_date: s(t.due_date),
    activity_id: n(t.activity_id),
    status: t.status === "feita" || t.status === "apagada" ? t.status : "aberta",
    criado_em: s(t.criado_em),
    encerrado_em: s(t.encerrado_em),
  }));
  return {
    sync: sync
      ? {
          status: s(sync.status),
          measured_at: s(sync.measured_at),
          error: s(sync.error),
          count: n(sync.count),
          stages: (Array.isArray(sync.stages) ? sync.stages : []).map((e: any) => ({
            id: Number(e.id),
            name: String(e.name ?? NOME_DIAG[Number(e.id)] ?? e.id),
            order: Number(e.order ?? 0),
            probabilidade: n(e.probabilidade) ?? PROB_DIAG[Number(e.id)] ?? 0,
            estagnacao: n(e.estagnacao),
          })),
          previa: {
            gerada_em: s(sync.previa?.gerada_em),
            entradas: Array.isArray(sync.previa?.entradas) ? sync.previa.entradas : [],
            tarefas: Array.isArray(sync.previa?.tarefas) ? sync.previa.tarefas : [],
          },
          resumo: sync.resumo ?? {},
        }
      : null,
    cards,
    tarefas,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------- datas (São Paulo)

const FUSO = "America/Sao_Paulo";
const fmtSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
/** Instante do Pipedrive ("AAAA-MM-DD HH:MM:SS" em UTC, ou ISO). */
export function instanteDiag(v: string | null | undefined): Date | null {
  if (!v) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/.exec(v.trim());
  const t = m ? Date.parse(`${m[1]}T${m[2]}Z`) : Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t);
}
/** Data de São Paulo de um instante do Pipedrive; data pura (aaaa-mm-dd) passa como está. */
export function diaSP(v: string | null | undefined): string | null {
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = instanteDiag(v);
  return t ? fmtSP.format(t) : null;
}
export const somarDiasDiag = (dia: string, k: number) =>
  new Date(Date.parse(`${dia}T12:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
export const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
const noPeriodo = (dia: string | null, de: string, ate: string) => !!dia && dia >= de && dia <= ate;

// ---------------------------------------------------------------------------- régua comum

const regimeDe = (c: Pick<CardDiag, "regime">): "real" | "presumido" =>
  c.regime === "presumido" ? "presumido" : "real";
const ordem = (stage: number) => {
  const i = ORDEM_DIAG.indexOf(stage);
  return i < 0 ? -1 : i;
};
/** Etapa mais adiantada a que o card chegou (pelo histórico e pela etapa atual), na ordem do processo. */
export function etapaAlcancada(c: Pick<CardDiag, "moves" | "stage_id">): number {
  return Math.max(ordem(c.stage_id), ...c.moves.map((m) => ordem(m.stage_id)));
}
/** D0 e prazo prometido do card: os campos do card; sem D0 ainda, nada (o relógio só começa na pasta completa). */
export function relogioDoCard(c: CardDiag): {
  d0: string | null;
  prazo: string | null;
  interno: string | null;
} {
  const d0 = c.d0;
  if (!d0) return { d0: null, prazo: c.prazo, interno: null };
  const r = regimeDe(c);
  return {
    d0,
    prazo: c.prazo ?? somarDiasDiag(d0, PRAZO_CLIENTE_DIAG[r]),
    interno: somarDiasDiag(d0, PRAZO_INTERNO_DIAG[r]),
  };
}
export const valorDoCard = (c: CardDiag) =>
  c.produtos.length ? c.produtos.reduce((t, p) => t + p.total, 0) : c.value;
export const nomeDoCard = (c: Pick<CardDiag, "org" | "title">) => c.org || c.title;

export type FiltroDiag = {
  de: string;
  ate: string;
  unidades?: number[];
  regime?: "real" | "presumido";
  pessoa?: number;
};
export function filtrarCards(
  cards: CardDiag[],
  f: Pick<FiltroDiag, "unidades" | "regime">,
): CardDiag[] {
  return cards.filter(
    (c) =>
      (!f.unidades?.length || c.unidade_ids.some((u) => f.unidades!.includes(u))) &&
      (!f.regime || regimeDe(c) === f.regime),
  );
}

// ---------------------------------------------------------------------------- Operação diária

export type LinhaFunilDiag = {
  chave: string;
  rotulo: string;
  cards: CardDiag[];
  hoje: CardDiag[];
  taxa: number | null;
};
/**
 * Funil cumulativo da coorte: cards que entraram no pipe 40 no período (data de criação em São Paulo), cada um contado
 * até a etapa mais adiantada a que chegou. As contagens só descem; a taxa é a etapa ÷ a de cima. "Hoje" = o pipe
 * inteiro agora, fora da taxa. A última linha é o Ganho.
 */
export function funilDiagnostico(
  todos: CardDiag[],
  f: FiltroDiag,
  etapas: EtapaDiag[],
): {
  linhas: LinhaFunilDiag[];
  coorte: CardDiag[];
  perdidos: CardDiag[];
} {
  const coorte = todos.filter((c) => noPeriodo(diaSP(c.add_time), f.de, f.ate));
  const nome = (id: number) => etapas.find((e) => e.id === id)?.name ?? NOME_DIAG[id];
  const linhas: LinhaFunilDiag[] = ORDEM_DIAG.map((id, i) => ({
    chave: String(id),
    rotulo: `${NUMERO_DIAG[id]} · ${nome(id)}`,
    cards: coorte.filter((c) => etapaAlcancada(c) >= i || c.status === "won"),
    hoje: todos.filter((c) => c.status === "open" && c.stage_id === id),
    taxa: null,
  }));
  linhas.push({
    chave: "ganho",
    rotulo: "Ganho",
    cards: coorte.filter((c) => c.status === "won"),
    hoje: [],
    taxa: null,
  });
  for (let i = 1; i < linhas.length; i++) {
    const cima = linhas[i - 1].cards.length;
    linhas[i].taxa = cima ? linhas[i].cards.length / cima : null;
  }
  return { linhas, coorte, perdidos: coorte.filter((c) => c.status === "lost") };
}

export type SituacaoRelogio = "no_prazo" | "em_risco" | "atrasado" | "apresentado";
export type PontoRelogio = {
  card: CardDiag;
  d0: string;
  prazo: string;
  /** Dias corridos desde o D0. */
  dias: number;
  /** Dias até o prazo prometido (negativo: passou). */
  faltam: number;
  total: number;
  situacao: SituacaoRelogio;
};
/** O relógio: cada card aberto com D0, pelos dias desde a pasta completa contra o prazo prometido ao cliente. */
export function relogioDiagnostico(
  cards: CardDiag[],
  hoje: string,
): { pontos: PontoRelogio[]; antesDoD0: CardDiag[] } {
  const abertos = cards.filter((c) => c.status === "open");
  const pontos: PontoRelogio[] = [];
  const antesDoD0: CardDiag[] = [];
  for (const c of abertos) {
    const r = relogioDoCard(c);
    if (!r.d0 || !r.prazo) {
      if (ordem(c.stage_id) <= ordem(ETAPA_DIAG.coleta)) antesDoD0.push(c);
      continue;
    }
    const faltam = diasEntre(hoje, r.prazo);
    const apresentado = etapaAlcancada(c) >= ordem(ETAPA_DIAG.apresentado);
    pontos.push({
      card: c,
      d0: r.d0,
      prazo: r.prazo,
      dias: diasEntre(r.d0, hoje),
      faltam,
      total: diasEntre(r.d0, r.prazo),
      situacao: apresentado
        ? "apresentado"
        : faltam < 0
          ? "atrasado"
          : faltam <= 5
            ? "em_risco"
            : "no_prazo",
    });
  }
  pontos.sort((a, b) => a.faltam - b.faltam);
  return { pontos, antesDoD0 };
}

export type LinhaArea = {
  area: Area;
  entregue: CardDiag[];
  semOportunidade: CardDiag[];
  pendente: CardDiag[];
  atrasada: CardDiag[];
};
/** As três áreas nos cards que já chegaram ao Diagnóstico em Execução e seguem abertos ou ganhos. */
export function areasDiagnostico(cards: CardDiag[], hoje: string): LinhaArea[] {
  const emJogo = cards.filter(
    (c) => c.status !== "lost" && etapaAlcancada(c) >= ordem(ETAPA_DIAG.execucao),
  );
  return AREAS.map((area) => {
    const linha: LinhaArea = {
      area,
      entregue: [],
      semOportunidade: [],
      pendente: [],
      atrasada: [],
    };
    for (const c of emJogo) {
      const st = c.areas[area];
      if (st === "entregue") linha.entregue.push(c);
      else if (st === "sem_oportunidade") linha.semOportunidade.push(c);
      else {
        linha.pendente.push(c);
        const interno = relogioDoCard(c).interno;
        if (interno && hoje > interno) linha.atrasada.push(c);
      }
    }
    return linha;
  });
}

export type FaltaCadastro = { chave: string; rotulo: string; cards: CardDiag[] };
/** O que o desenho exige que já exista no card, conferido na etapa em que o card está. */
export function cadastroDiagnostico(cards: CardDiag[]): FaltaCadastro[] {
  const abertos = cards.filter((c) => c.status === "open");
  const a = (o: number) => abertos.filter((c) => ordem(c.stage_id) >= o);
  return [
    {
      chave: "faturamento",
      rotulo: "Sem faturamento conferido (da etapa 02 em diante)",
      cards: a(1).filter((c) => c.fat_conferido == null),
    },
    {
      chave: "pasta",
      rotulo: "Sem link da pasta (da etapa 04 em diante)",
      cards: a(3).filter((c) => !c.link_pasta),
    },
    {
      chave: "d0",
      rotulo: "Sem D0 ou sem prazo prometido (da etapa 04 em diante)",
      cards: a(3).filter((c) => !c.d0 || !c.prazo),
    },
    {
      chave: "areas",
      rotulo: "Área sem entrega registrada (da etapa 05 em diante)",
      cards: a(4).filter((c) =>
        AREAS.some((x) => c.areas[x] !== "entregue" && c.areas[x] !== "sem_oportunidade"),
      ),
    },
    {
      chave: "produtos",
      rotulo: "Sem produto com honorário (da etapa 06 em diante)",
      cards: a(5).filter((c) => !c.produtos.length || c.produtos.some((p) => !(p.total > 0))),
    },
    {
      chave: "motivo",
      rotulo: "Perdido sem motivo",
      cards: cards.filter((c) => c.status === "lost" && !c.lost_reason),
    },
  ];
}

export const SEM_UNIDADE_DIAG = "Sem unidade";
export type FunilDaUnidadeDiag = { unidade: string; funil: ReturnType<typeof funilDiagnostico> };
/**
 * O funil da Operação por unidade de origem da venda (20/10/2026, o mesmo desenho do funil por unidade do pipe 39): a
 * mesma coorte e a mesma régua de `funilDiagnostico`, uma linha por unidade. Cada card numa unidade só, então as linhas
 * somam o funil inteiro. Sem unidade no card vai para "Sem unidade", por último. Fica de fora a unidade sem card na
 * coorte.
 */
export function funisPorUnidadeDiag(
  todos: CardDiag[],
  f: FiltroDiag,
  etapas: EtapaDiag[],
): FunilDaUnidadeDiag[] {
  const grupos = new Map<string, CardDiag[]>();
  for (const c of todos) {
    const u = c.unidade ?? SEM_UNIDADE_DIAG;
    grupos.set(u, [...(grupos.get(u) ?? []), c]);
  }
  return [...grupos.entries()]
    .map(([unidade, cs]) => ({ unidade, funil: funilDiagnostico(cs, f, etapas) }))
    .filter((u) => u.funil.coorte.length > 0)
    .sort(
      (x, y) =>
        Number(x.unidade === SEM_UNIDADE_DIAG) - Number(y.unidade === SEM_UNIDADE_DIAG) ||
        y.funil.coorte.length - x.funil.coorte.length ||
        x.unidade.localeCompare(y.unidade, "pt-BR"),
    );
}
export type QuadroDiag = {
  chave: string;
  rotulo: string;
  valor: number;
  nota: string;
  cards: CardDiag[];
  moeda?: boolean;
};
/** Os quadros do topo da Operação: coorte do período e o que está em jogo agora. */
export function quadrosDiagnostico(
  todos: CardDiag[],
  f: FiltroDiag,
  etapas: EtapaDiag[],
): QuadroDiag[] {
  const coorte = todos.filter((c) => noPeriodo(diaSP(c.add_time), f.de, f.ate));
  const emExecucao = todos.filter((c) => c.status === "open" && c.stage_id === ETAPA_DIAG.execucao);
  const apresentados = todos.filter((c) =>
    c.moves.some(
      (m) => m.stage_id === ETAPA_DIAG.apresentado && noPeriodo(diaSP(m.at), f.de, f.ate),
    ),
  );
  const ganhos = todos.filter(
    (c) => c.status === "won" && noPeriodo(diaSP(c.won_time), f.de, f.ate),
  );
  const emJogo = forecastDiagnostico(todos, etapas, f.ate).ponderado;
  const comProduto = todos.filter((c) => c.status === "open" && c.produtos.length > 0);
  return [
    {
      chave: "entraram",
      rotulo: "Entraram no diagnóstico",
      valor: coorte.length,
      nota: "vendas ganhas que viraram card no período",
      cards: coorte,
    },
    {
      chave: "execucao",
      rotulo: "Em execução agora",
      valor: emExecucao.length,
      nota: "pasta completa, áreas analisando",
      cards: emExecucao,
    },
    {
      chave: "apresentados",
      rotulo: "Apresentados no período",
      valor: apresentados.length,
      nota: "entraram em Diagnóstico Apresentado",
      cards: apresentados,
    },
    {
      chave: "ganhos",
      rotulo: "Ganhos no período",
      valor: ganhos.length,
      nota: "venda total ou parcial",
      cards: ganhos,
    },
    {
      chave: "jogo",
      rotulo: "Receita em jogo",
      valor: Math.round(emJogo),
      nota: "honorário esperado × probabilidade da etapa",
      cards: comProduto,
      moeda: true,
    },
  ];
}

// ---------------------------------------------------------------------------- Pré-venda (Hoje, Ritmo, Aderência)

export type ItemHoje = { card: CardDiag; atividade?: AtividadeDiag; motivo: string };
export type HojePessoa = {
  pessoa: number;
  nome: string;
  hoje: ItemHoje[];
  vencidas: ItemHoje[];
  parados: ItemHoje[];
  prazo: ItemHoje[];
  semProximo: ItemHoje[];
};
const ehDaRegua = (a: Pick<AtividadeDiag, "subject">) => a.subject.startsWith("Diagnóstico ·");
/** O que cada um faz hoje: tarefas do dia e vencidas, cards parados além da estagnação e prazos que vencem em 5 dias. */
export function hojeDiagnostico(
  cards: CardDiag[],
  etapas: EtapaDiag[],
  hoje: string,
): HojePessoa[] {
  const abertos = cards.filter((c) => c.status === "open");
  const estagnacao = (id: number) => etapas.find((e) => e.id === id)?.estagnacao ?? null;
  return PESSOAS_DIAG.map(([pessoa, nome]) => {
    const minhas = (c: CardDiag) => c.atividades.filter((a) => a.user_id === pessoa && !a.done);
    // Etapas 01 a 04 são do Matheus (gestor, cobra as áreas); 05 a 08, da Jordana (desenho do processo).
    const doCard = (c: CardDiag) =>
      pessoa === PESSOAS_DIAG[0][0]
        ? ordem(c.stage_id) <= ordem(ETAPA_DIAG.execucao)
        : ordem(c.stage_id) >= ordem(ETAPA_DIAG.concluido);
    const item: HojePessoa = {
      pessoa,
      nome,
      hoje: [],
      vencidas: [],
      parados: [],
      prazo: [],
      semProximo: [],
    };
    for (const c of cards) {
      for (const a of minhas(c)) {
        if (a.due_date === hoje) item.hoje.push({ card: c, atividade: a, motivo: a.subject });
        else if (a.due_date && a.due_date < hoje)
          item.vencidas.push({ card: c, atividade: a, motivo: a.subject });
      }
    }
    for (const c of abertos.filter(doCard)) {
      const desde = diaSP(c.stage_since);
      const limite = estagnacao(c.stage_id);
      if (desde && limite != null && diasEntre(desde, hoje) > limite)
        item.parados.push({
          card: c,
          motivo: `${diasEntre(desde, hoje)} dias em ${NUMERO_DIAG[c.stage_id]} (limite ${limite})`,
        });
      const r = relogioDoCard(c);
      if (r.prazo && etapaAlcancada(c) < ordem(ETAPA_DIAG.apresentado)) {
        const faltam = diasEntre(hoje, r.prazo);
        if (faltam <= 5)
          item.prazo.push({
            card: c,
            motivo:
              faltam < 0
                ? `prazo passou há ${-faltam} dias`
                : faltam === 0
                  ? "prazo vence hoje"
                  : `faltam ${faltam} dias`,
          });
      }
      if (!c.atividades.some((a) => !a.done))
        item.semProximo.push({ card: c, motivo: "sem tarefa aberta no card" });
    }
    item.vencidas.sort((x, y) =>
      String(x.atividade?.due_date).localeCompare(String(y.atividade?.due_date)),
    );
    return item;
  });
}

export type DiaRitmo = {
  dia: string;
  previstas: number;
  feitas: number;
  vencidas: number;
  avancos: number;
};
export type RitmoPessoa = {
  pessoa: number;
  nome: string;
  dias: DiaRitmo[];
  previstas: number;
  feitas: number;
  vencidas: number;
  avancos: number;
  regua: number;
};
/** Tarefas previstas (vencimento no dia), feitas (marcadas no dia), vencidas (do dia e não feitas) e etapas avançadas. */
export function ritmoDiagnostico(cards: CardDiag[], f: FiltroDiag, hoje: string): RitmoPessoa[] {
  const dias: string[] = [];
  for (let d = f.de; d <= f.ate && dias.length < 400; d = somarDiasDiag(d, 1)) dias.push(d);
  return PESSOAS_DIAG.filter(([p]) => !f.pessoa || f.pessoa === p).map(([pessoa, nome]) => {
    const linhas = dias.map((dia) => ({ dia, previstas: 0, feitas: 0, vencidas: 0, avancos: 0 }));
    const porDia = new Map(linhas.map((l) => [l.dia, l]));
    let regua = 0;
    for (const c of cards) {
      for (const a of c.atividades.filter((x) => x.user_id === pessoa)) {
        const prevista = a.due_date ? porDia.get(a.due_date) : undefined;
        if (prevista) {
          prevista.previstas++;
          if (!a.done && a.due_date! < hoje) prevista.vencidas++;
          if (ehDaRegua(a)) regua++;
        }
        const feita = a.done ? porDia.get(diaSP(a.done_at) ?? "") : undefined;
        if (feita) feita.feitas++;
      }
      for (let i = 1; i < c.moves.length; i++) {
        const m = c.moves[i];
        if (m.actor_id !== pessoa || ordem(m.stage_id) <= ordem(c.moves[i - 1].stage_id)) continue;
        const dia = porDia.get(diaSP(m.at) ?? "");
        if (dia) dia.avancos++;
      }
    }
    const soma = (k: keyof Omit<DiaRitmo, "dia">) => linhas.reduce((t, l) => t + l[k], 0);
    return {
      pessoa,
      nome,
      dias: linhas,
      previstas: soma("previstas"),
      feitas: soma("feitas"),
      vencidas: soma("vencidas"),
      avancos: soma("avancos"),
      regua,
    };
  });
}

export type ChecagemDiag = { chave: string; rotulo: string; dono: "Matheus" | "Jordana" };
export const CHECAGENS_DIAG: readonly ChecagemDiag[] = [
  { chave: "01", rotulo: "Saiu da 01 com o faturamento conferido", dono: "Matheus" },
  { chave: "02", rotulo: "Saiu da 02 com as três tarefas feitas", dono: "Matheus" },
  { chave: "03", rotulo: "Saiu da 03 com o link da pasta no card", dono: "Matheus" },
  { chave: "04", rotulo: "Saiu da 04 com as três áreas resolvidas", dono: "Matheus" },
  { chave: "05", rotulo: "Saiu da 05 com produtos e honorário", dono: "Jordana" },
  { chave: "06", rotulo: "Apresentou dentro do prazo prometido", dono: "Jordana" },
  { chave: "07", rotulo: "Saiu da 07 com as propostas enviadas", dono: "Jordana" },
  { chave: "perda", rotulo: "Perdido com motivo", dono: "Matheus" },
];
export type Passagem = {
  card: CardDiag;
  chave: string;
  dia: string;
  actor_id: number | null;
  ok: boolean | null;
  porque: string;
};
const tarefasFeitas = (c: CardDiag, etapa: string, tarefas: TarefaDiag[]) => {
  const daEtapa = tarefas.filter(
    (t) => t.deal_id === c.id && t.etapa === etapa && t.status !== "apagada",
  );
  if (daEtapa.length) return daEtapa.every((t) => t.status === "feita");
  const atividades = c.atividades.filter((a) =>
    a.subject.startsWith(`Diagnóstico · ${NUMERO_DIAG[Number(etapa)]} ·`),
  );
  return atividades.length ? atividades.every((a) => a.done) : null;
};
/**
 * Aderência ao processo: cada passagem de etapa no período confere o "para avançar" do desenho na etapa que o card
 * deixou. O dado do card é o de agora (o Pipedrive não guarda o campo no instante da passagem). `ok: null` = não dá
 * para conferir (régua desligada, sem tarefa da etapa).
 */
export function aderenciaDiagnostico(
  cards: CardDiag[],
  tarefas: TarefaDiag[],
  f: FiltroDiag,
): Passagem[] {
  const out: Passagem[] = [];
  for (const c of cards) {
    for (let i = 1; i < c.moves.length; i++) {
      const de = c.moves[i - 1].stage_id,
        para = c.moves[i];
      const dia = diaSP(para.at);
      if (!dia || !noPeriodo(dia, f.de, f.ate) || ordem(para.stage_id) <= ordem(de)) continue;
      const base = { card: c, chave: NUMERO_DIAG[de] ?? String(de), dia, actor_id: para.actor_id };
      if (de === ETAPA_DIAG.novo)
        out.push({
          ...base,
          ok: c.fat_conferido != null,
          porque: c.fat_conferido != null ? "faturamento conferido" : "sem faturamento conferido",
        });
      else if (de === ETAPA_DIAG.elegivel) {
        const ok = tarefasFeitas(c, String(de), tarefas);
        out.push({
          ...base,
          ok,
          porque:
            ok == null
              ? "sem tarefa da régua para conferir"
              : ok
                ? "três tarefas feitas"
                : "tarefa da etapa 02 em aberto",
        });
      } else if (de === ETAPA_DIAG.coleta)
        out.push({
          ...base,
          ok: !!c.link_pasta,
          porque: c.link_pasta ? "link da pasta no card" : "sem link da pasta",
        });
      else if (de === ETAPA_DIAG.execucao) {
        const faltam = AREAS.filter(
          (x) => c.areas[x] !== "entregue" && c.areas[x] !== "sem_oportunidade",
        );
        out.push({
          ...base,
          ok: !faltam.length,
          porque: faltam.length
            ? `sem entrega: ${faltam.map((x) => NOME_AREA[x]).join(", ")}`
            : "três áreas resolvidas",
        });
      } else if (de === ETAPA_DIAG.concluido) {
        const ok = c.produtos.length > 0 && c.produtos.every((p) => p.total > 0);
        out.push({
          ...base,
          ok,
          porque: ok ? "produtos com honorário" : "sem produto com honorário",
        });
      } else if (de === ETAPA_DIAG.agendada) {
        const prazo = relogioDoCard(c).prazo;
        out.push({
          ...base,
          ok: prazo ? dia <= prazo : null,
          porque: prazo
            ? dia <= prazo
              ? "dentro do prazo"
              : `${diasEntre(prazo, dia)} dias depois do prazo`
            : "sem prazo prometido",
        });
      } else if (de === ETAPA_DIAG.apresentado) {
        const ok = tarefasFeitas(c, String(de), tarefas);
        out.push({
          ...base,
          ok,
          porque:
            ok == null
              ? "sem tarefa da régua para conferir"
              : ok
                ? "propostas enviadas"
                : "envio das propostas em aberto",
        });
      }
    }
    const perdeu = diaSP(c.lost_time);
    if (c.status === "lost" && perdeu && noPeriodo(perdeu, f.de, f.ate))
      out.push({
        card: c,
        chave: "perda",
        dia: perdeu,
        actor_id: c.owner_id,
        ok: !!c.lost_reason,
        porque: c.lost_reason ? `motivo: ${c.lost_reason}` : "sem motivo",
      });
  }
  return out.sort((a, b) => b.dia.localeCompare(a.dia));
}

// ---------------------------------------------------------------------------- Forecast

export type HorizonteDiag = "passou" | "este_mes" | "proximo_mes" | "depois" | "sem_prazo";
export const ROTULO_HORIZONTE: Readonly<Record<HorizonteDiag, string>> = {
  passou: "Data passou",
  este_mes: "Este mês",
  proximo_mes: "Próximo mês",
  depois: "Depois",
  sem_prazo: "Sem prazo (antes do D0)",
};
/** Fechamento esperado: o prazo prometido ao cliente (apresentação) mais os 7 dias da Negociação. */
export const fechamentoEsperado = (c: CardDiag) => {
  const p = relogioDoCard(c).prazo;
  return p ? somarDiasDiag(p, 7) : null;
};
export function horizonteDe(dia: string | null, hoje: string): HorizonteDiag {
  if (!dia) return "sem_prazo";
  if (dia < hoje) return "passou";
  const mes = hoje.slice(0, 7);
  const proximo = somarDiasDiag(`${mes}-28`, 7).slice(0, 7);
  if (dia.slice(0, 7) === mes) return "este_mes";
  if (dia.slice(0, 7) === proximo) return "proximo_mes";
  return "depois";
}
export function forecastDiagnostico(todos: CardDiag[], etapas: EtapaDiag[], hoje: string) {
  const prob = (id: number) =>
    (etapas.find((e) => e.id === id)?.probabilidade ?? PROB_DIAG[id] ?? 0) / 100;
  const abertos = todos.filter((c) => c.status === "open");
  const porEtapa = ORDEM_DIAG.map((id) => {
    const cs = abertos.filter((c) => c.stage_id === id);
    const valor = cs.reduce((t, c) => t + (c.produtos.length ? valorDoCard(c) : 0), 0);
    return {
      id,
      rotulo: `${NUMERO_DIAG[id]} · ${etapas.find((e) => e.id === id)?.name ?? NOME_DIAG[id]}`,
      cards: cs,
      comProduto: cs.filter((c) => c.produtos.length > 0),
      valor,
      ponderado: valor * prob(id),
      probabilidade: prob(id),
    };
  });
  const horizontes = (Object.keys(ROTULO_HORIZONTE) as HorizonteDiag[]).map((h) => {
    const cs = abertos.filter((c) => horizonteDe(fechamentoEsperado(c), hoje) === h);
    return {
      horizonte: h,
      cards: cs,
      valor: cs.reduce(
        (t, c) => t + (c.produtos.length ? valorDoCard(c) * prob(c.stage_id) : 0),
        0,
      ),
    };
  });
  const apresentadoOuAlem = (c: CardDiag) =>
    c.status === "won" || etapaAlcancada(c) >= ordem(ETAPA_DIAG.apresentado);
  const produtos = AREAS.map((area) => {
    // Apresentado = chegou à 07 (ou foi ganho) com o produto no card. Venda parcial tira o produto não vendido do card
    // (regra do processo), então ele sai também daqui; o motivo fica no campo "Produto não vendido e motivo".
    const comArea = todos.filter(
      (c) => apresentadoOuAlem(c) && c.produtos.some((p) => p.produto === area),
    );
    const vendidos = todos.filter(
      (c) => c.status === "won" && c.produtos.some((p) => p.produto === area),
    );
    const honorarios = vendidos
      .flatMap((c) => c.produtos.filter((p) => p.produto === area).map((p) => p.total))
      .filter((v) => v > 0);
    const emJogo = abertos.filter((c) => c.produtos.some((p) => p.produto === area));
    return {
      area,
      apresentados: comArea,
      vendidos,
      conversao: comArea.length ? vendidos.length / comArea.length : null,
      honorarioMedio: honorarios.length
        ? honorarios.reduce((t, v) => t + v, 0) / honorarios.length
        : null,
      emJogo,
      ponderado: emJogo.reduce(
        (t, c) =>
          t +
          c.produtos.filter((p) => p.produto === area).reduce((x, p) => x + p.total, 0) *
            prob(c.stage_id),
        0,
      ),
    };
  });
  const mes = hoje.slice(0, 7);
  const ganhosMes = todos.filter(
    (c) => c.status === "won" && (diaSP(c.won_time) ?? "").startsWith(mes),
  );
  const perdasMes = todos.filter(
    (c) => c.status === "lost" && (diaSP(c.lost_time) ?? "").startsWith(mes),
  );
  return {
    porEtapa,
    horizontes,
    produtos,
    ganhosMes,
    parciais: ganhosMes.filter((c) => !!c.nao_vendido),
    perdasMes,
    ponderado: porEtapa.reduce((t, e) => t + e.ponderado, 0),
    valor: porEtapa.reduce((t, e) => t + e.valor, 0),
  };
}
