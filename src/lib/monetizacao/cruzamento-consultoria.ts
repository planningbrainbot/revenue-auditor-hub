// Régua da tela Cruzamento Consultoria (`/monetizacao?aba=cruzamento-consultoria`).
// Contrato: docs/design/contratos/monetizacao-cruzamento-consultoria.md. Pura: recebe o payload do RPC
// `ops.cruzamento_consultoria_painel()` e devolve tudo o que a tela mostra, para a tela, os testes
// (tests/monetizacao-cruzamento-consultoria.test.mjs) e a conferência (scripts/monetizacao/conferir-cruzamento-consultoria.mjs).
//
// Cada número que o Pedro Siqueira (Consultoria) e o CEO deram na call de 05/10/2026 vira um cartão "dito × medido":
// a fala literal com quem e quando, a mesma grandeza contada agora nos dados da plataforma, e a diferença.

// ─── O que chega do RPC ──────────────────────────────────────────────────────────────────────────

export interface ProjetoApi {
  produto: string | null;
  linha_produto: string | null;
  etapa: string | null;
  etapa_descricao: string | null;
  cadastrado_em: string | null;
  na_etapa_desde: string | null;
  entregue_em: string | null;
  encerrado: boolean | null;
  encerrado_em: string | null;
  valor_identificado: number | string | null;
}

export interface ClienteApi {
  id: string | number;
  cnpj: string | null;
  cnpj_raiz: string | null;
  razao_social: string | null;
  nome_fantasia: string | null;
  grupo_economico: string | null;
  regime_tributario: string | null;
  porte: string | null;
  parceiro: string | null;
  cadastrado_em: string | null;
  valor_identificado: number | string | null;
  credito_recuperado: number | string | null;
  projetos: ProjetoApi[] | null;
}

export interface PropostaApi {
  id: string;
  empresa: string | null;
  cnpj: string | null;
  produto: string | null;
  status: string | null;
  percentual_exito: number | string | null;
  valor_total: number | string | null;
  data_envio: string | null;
  canal_venda: string | null;
  parceiro: string | null;
}

export interface NegocioBruto {
  deal: string;
  titulo: string | null;
  ganho_em: string;
  origem_pipeline: string | null;
  unidade: string | null;
  closer: string | null;
  regime_tributario: string | null;
  cnpj: string | null;
  cnpj_fonte: string | null;
  organizacao: string | null;
  onboarding: boolean;
}

export interface PatBruto {
  cnpj: string;
  mes: string;
  faturado: number | string | null;
  recebido: number | string | null;
}

export interface CruzamentoBruto {
  lido_em: string;
  porta_financeiro: { aberta: boolean; motivo: string | null };
  frescor: {
    consultoria: string | null;
    negocios: string | null;
    financeiro_carregado_em: string | null;
  };
  clientes: ClienteApi[];
  propostas: PropostaApi[];
  negocios: NegocioBruto[];
  pat: PatBruto[] | null;
}

// ─── Normalização ────────────────────────────────────────────────────────────────────────────────

export type Regime = "real" | "presumido" | "simples" | "sem";
export const REGIMES: { id: Regime; rotulo: string }[] = [
  { id: "real", rotulo: "Lucro Real" },
  { id: "presumido", rotulo: "Lucro Presumido" },
  { id: "simples", rotulo: "Simples" },
  { id: "sem", rotulo: "Sem regime" },
];
export function regimeDe(t: string | null | undefined): Regime {
  const s = (t ?? "").toLowerCase();
  if (/real/.test(s)) return "real";
  if (/presumido/.test(s)) return "presumido";
  if (/simples|mei/.test(s)) return "simples";
  return "sem";
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const so = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
/** Etapas em que o projeto ainda não foi trabalhado: esperando processar ou esperando documento. */
export const ETAPAS_ANTES_DO_TRABALHO = new Set(["fila_processamento", "fluxo_documentos"]);

export interface Projeto {
  chave: string;
  cliente: Cliente;
  produto: string | null;
  linha: string | null;
  etapa: string | null;
  etapaDescricao: string | null;
  cadastrado: string | null;
  naEtapaDesde: string | null;
  entregue: string | null;
  encerrado: boolean;
  valor: number;
}

export interface Cliente {
  id: string;
  cnpj: string | null;
  raiz: string | null;
  nome: string;
  regime: Regime;
  regimeTexto: string | null;
  parceiro: string | null;
  cadastrado: string | null;
  projetos: Projeto[];
  /** Soma do valor identificado dos projetos. */
  valor: number;
  /** Algum projeto passou de Fila de Processamento e Fluxo de Documentos, ou foi entregue. */
  trabalhado: boolean;
  /** Algum projeto em Pós-entrega com valor identificado: diagnóstico entregue, esperando negociação. */
  posEntregaComValor: boolean;
}

export interface Proposta {
  id: string;
  empresa: string;
  cnpj: string | null;
  produto: string | null;
  status: string | null;
  exito: number | null;
  valorTotal: number | null;
  envio: string | null;
}

export interface Negocio {
  deal: string;
  titulo: string;
  ganho: string;
  mes: string;
  origem: string | null;
  /** Ganho no Inside Sales: a máquina de vendas (CEO, 05/10, 00:02:35). O pipe Sócios fica fora. */
  maquina: boolean;
  unidade: string | null;
  closer: string | null;
  regime: Regime;
  regimeTexto: string | null;
  cnpj: string | null;
  cnpjFonte: string | null;
  organizacao: string | null;
  onboarding: boolean;
  cliente: Cliente | null;
  naPlataforma: boolean;
  trabalhado: boolean;
  /** A PAT faturou ou recebeu do CNPJ do mês do ganho em diante. `null` sem a porta do Financeiro. */
  faturou: boolean | null;
  faturado: number | null;
}

// ─── O que foi dito na call de 05/10/2026 ────────────────────────────────────────────────────────

export type Formato = "inteiro" | "brl" | "pct";
export type Grupo = "oportunidade" | "vazao" | "perfil" | "maquina";
export const GRUPOS: { id: Grupo; titulo: string; pergunta: string }[] = [
  {
    id: "oportunidade",
    titulo: "Oportunidade e preço",
    pergunta: "Quanto a Consultoria já achou e quanto cobra",
  },
  { id: "vazao", titulo: "Fila e vazão", pergunta: "Quanto entra, quanto sai e o que está parado" },
  { id: "perfil", titulo: "Perfil da carteira", pergunta: "Quem são os clientes que chegam" },
  { id: "maquina", titulo: "Máquina de vendas", pergunta: "O que o CEO disse sobre a aquisição" },
];

export interface Citacao {
  id: string;
  grupo: Grupo;
  tema: string;
  quem: "Pedro Siqueira" | "Pedro Araújo (CEO)" | "Pedro Siqueira e Pedro Luca";
  /** Tempo na gravação de 05/10 (11h06). Depois de 23:08 a transcrição não tem marcação de tempo. */
  quando: string;
  fala: string;
  dito: number;
  formato: Formato;
  /** Sufixo do número ("por semana", "por mês", "empresas"). */
  unidade?: string;
}

const DEPOIS = "depois de 23:08";
export const CITACOES: Citacao[] = [
  {
    id: "oportunidades",
    grupo: "oportunidade",
    tema: "Oportunidades apresentadas",
    quem: "Pedro Siqueira",
    quando: "00:19:09",
    fala: "Aqui, a gente tem 760, 760.000 milhões, na verdade, de oportunidades apresentadas.",
    dito: 760_000_000,
    formato: "brl",
  },
  {
    id: "honorario",
    grupo: "oportunidade",
    tema: "Honorário médio",
    quem: "Pedro Siqueira",
    quando: "00:19:09",
    fala: "Isso gera 20% de honorário. A média é 20% de honorário.",
    dito: 0.2,
    formato: "pct",
  },
  {
    id: "diagnostico-valor",
    grupo: "oportunidade",
    tema: "Diagnóstico entregue com valor",
    quem: "Pedro Siqueira",
    quando: "00:19:09",
    fala: "Hoje a gente tem 305 empresas diagnóstico entregue com valor, então dependendo de negociação.",
    dito: 305,
    formato: "inteiro",
    unidade: "empresas",
  },
  {
    id: "entram-semana",
    grupo: "vazao",
    tema: "Entram por semana",
    quem: "Pedro Siqueira",
    quando: DEPOIS,
    fala: "A gente está recebendo 16 e saindo 6 por semana.",
    dito: 16,
    formato: "inteiro",
    unidade: "projetos",
  },
  {
    id: "saem-semana",
    grupo: "vazao",
    tema: "Saem por semana",
    quem: "Pedro Siqueira",
    quando: DEPOIS,
    fala: "A gente está recebendo 16 e saindo 6 por semana.",
    dito: 6,
    formato: "inteiro",
    unidade: "projetos",
  },
  {
    id: "entregues-mes",
    grupo: "vazao",
    tema: "Entregues por mês",
    quem: "Pedro Siqueira",
    quando: DEPOIS,
    fala: "a minha Equipe era entrega cerca de 22 projetos por mês. Um para cada dia útil.",
    dito: 22,
    formato: "inteiro",
    unidade: "projetos",
  },
  {
    id: "fluxo-documentos",
    grupo: "vazao",
    tema: "Parados em Fluxo de Documentos",
    quem: "Pedro Siqueira",
    quando: "00:14:41",
    fala: "Fluxo de documentos. Só que aí aqui mora o gargalo que o que o Daniel e que a gente fala 44 clientes",
    dito: 44,
    formato: "inteiro",
    unidade: "projetos",
  },
  {
    id: "lucro-real",
    grupo: "perfil",
    tema: "Lucro real com oportunidade",
    quem: "Pedro Siqueira",
    quando: DEPOIS,
    fala: "Ele tem 361 por empresa do lucro real.",
    dito: 361,
    formato: "inteiro",
    unidade: "empresas",
  },
  {
    id: "lucro-real-projetos",
    grupo: "perfil",
    tema: "Projetos de lucro real",
    quem: "Pedro Siqueira",
    quando: DEPOIS,
    fala: "52% dos projetos são.",
    dito: 0.52,
    formato: "pct",
  },
  {
    id: "media-lucro-real",
    grupo: "perfil",
    tema: "Oportunidade média no lucro real",
    quem: "Pedro Siqueira e Pedro Luca",
    quando: DEPOIS,
    fala: "Para 624000000 dividido para 361 a gente acha 1.700 cada oportunidade é que dá 20% de honorário, 345 por empresa.",
    dito: 1_700_000,
    formato: "brl",
  },
  {
    id: "chegaram-3-meses",
    grupo: "perfil",
    tema: "Chegaram em três meses",
    quem: "Pedro Siqueira",
    quando: "00:08:54",
    fala: "como o sistema foi criado em junho, eu filtrei de julho [...] foram 124 clientes que chegaram",
    dito: 124,
    formato: "inteiro",
  },
  {
    id: "maquina-setembro",
    grupo: "maquina",
    tema: "Máquina de vendas em setembro",
    quem: "Pedro Araújo (CEO)",
    quando: "00:11:02",
    fala: "Esse mês, esse mês foi 80, só em setembro foi 80.",
    dito: 80,
    formato: "inteiro",
    unidade: "clientes",
  },
];

/** "os 85 grupos que caiu mês passado, os 60 grupos caiu no outro mês, os 40 grupos caiu no outro mês, os 30" (CEO, 00:10:45). */
export const MAQUINA_DITA: Record<string, number> = {
  "2026-06": 30,
  "2026-07": 40,
  "2026-08": 60,
  "2026-09": 85,
};
export const FALA_MAQUINA =
  "os 85 grupos que caiu mês passado, os 60 grupos caiu no outro mês, os 40 grupos caiu no outro mês, os 30";

// ─── Comparação ──────────────────────────────────────────────────────────────────────────────────

export type Status = "bate" | "perto" | "diverge" | "outra-conta";
export const STATUS: { id: Status; rotulo: string; regra: string }[] = [
  { id: "bate", rotulo: "Batem", regra: "diferença de até 10%" },
  { id: "perto", rotulo: "Perto", regra: "diferença de 10% a 25%" },
  { id: "diverge", rotulo: "Divergem", regra: "diferença acima de 25%" },
  {
    id: "outra-conta",
    rotulo: "Outra conta",
    regra: "o número dito vem de um filtro que a API não reproduz",
  },
];
export function statusDa(dito: number, medido: number | null): Status {
  if (medido === null || !dito) return "outra-conta";
  const d = Math.abs(medido - dito) / Math.abs(dito);
  // Folga de 1e-9: 18% contra 20% dá 0,1000…01 em ponto flutuante e é "bate" (diferença de 10%).
  return d <= 0.1 + 1e-9 ? "bate" : d <= 0.25 + 1e-9 ? "perto" : "diverge";
}

export type Registros =
  | { tipo: "projetos"; itens: Projeto[] }
  | { tipo: "clientes"; itens: Cliente[] }
  | { tipo: "propostas"; itens: Proposta[] }
  | { tipo: "negocios"; itens: Negocio[] };

export interface Cartao extends Citacao {
  medido: number | null;
  status: Status;
  /** (medido − dito) ÷ dito; nulo sem medida. */
  diferenca: number | null;
  como: string;
  porque?: string;
  registros: Registros;
}

// ─── Datas ───────────────────────────────────────────────────────────────────────────────────────

const dia = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);
const ms = (d: string) => Date.parse(`${d}T12:00:00Z`);
const somaDias = (d: string, n: number) => new Date(ms(d) + n * 864e5).toISOString().slice(0, 10);
/** Segunda-feira da semana de `d`. */
export function semanaDe(d: string) {
  const w = new Date(ms(d)).getUTCDay();
  return somaDias(d, -((w + 6) % 7));
}
const entre = (d: string | null, de: string, ate: string) => !!d && d >= de && d <= ate;
export function mesesDe(de: string, ate: string) {
  const out: string[] = [];
  let [a, m] = [Number(de.slice(0, 4)), Number(de.slice(5, 7))];
  while (`${a}-${String(m).padStart(2, "0")}` <= ate.slice(0, 7)) {
    out.push(`${a}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) [a, m] = [a + 1, 1];
  }
  return out;
}

// ─── O painel ────────────────────────────────────────────────────────────────────────────────────

export interface Semana {
  semana: string;
  parcial: boolean;
  entraram: Projeto[];
  sairam: Projeto[];
}
export interface MesMaquina {
  mes: string;
  ganhos: Negocio[];
  dito: number | null;
}
export type EtapaCoorte = "ganhos" | "cnpj" | "plataforma" | "trabalhados" | "faturou";
export const ETAPAS_COORTE: { id: EtapaCoorte; rotulo: string }[] = [
  { id: "ganhos", rotulo: "Ganhos" },
  { id: "cnpj", rotulo: "Com CNPJ" },
  { id: "plataforma", rotulo: "Na plataforma" },
  { id: "trabalhados", rotulo: "Trabalhados" },
  { id: "faturou", rotulo: "Faturou na PAT" },
];
export interface LinhaCoorte {
  mes: string;
  etapas: Record<EtapaCoorte, Negocio[] | null>;
}

export interface Cruzamento {
  hoje: string;
  lidoEm: string;
  porta: CruzamentoBruto["porta_financeiro"];
  frescor: CruzamentoBruto["frescor"];
  clientes: Cliente[];
  projetos: Projeto[];
  propostas: Proposta[];
  negocios: Negocio[];
  cartoes: Cartao[];
  contagem: Record<Status, number>;
  /** Janela de 28 dias da vazão: entraram e saíram. */
  janela: { de: string; ate: string; entraram: Projeto[]; sairam: Projeto[] };
  semanas: Semana[];
  maquinaPorMes: MesMaquina[];
  coorte: LinhaCoorte[];
  maquinaSemCnpj: Negocio[];
}

export function montarCruzamento(
  bruto: CruzamentoBruto,
  hoje: string,
  filtro: { regime?: Regime } = {},
): Cruzamento {
  // Clientes e projetos da plataforma.
  const clientes: Cliente[] = (bruto.clientes ?? []).map((c) => {
    const cliente: Cliente = {
      id: String(c.id),
      cnpj: so(c.cnpj) || null,
      raiz: so(c.cnpj_raiz) || (so(c.cnpj).length === 14 ? so(c.cnpj).slice(0, 8) : null),
      nome: (c.nome_fantasia || c.razao_social || so(c.cnpj) || "Sem nome").trim(),
      regime: regimeDe(c.regime_tributario),
      regimeTexto: c.regime_tributario,
      parceiro: c.parceiro,
      cadastrado: dia(c.cadastrado_em),
      projetos: [],
      valor: 0,
      trabalhado: false,
      posEntregaComValor: false,
    };
    cliente.projetos = (c.projetos ?? []).map((p, i) => ({
      chave: `${cliente.id}:${i}`,
      cliente,
      produto: p.produto,
      linha: p.linha_produto,
      etapa: p.etapa,
      etapaDescricao: p.etapa_descricao,
      cadastrado: dia(p.cadastrado_em),
      naEtapaDesde: dia(p.na_etapa_desde),
      entregue: dia(p.entregue_em),
      encerrado: !!p.encerrado,
      valor: num(p.valor_identificado),
    }));
    cliente.valor = cliente.projetos.reduce((s, p) => s + p.valor, 0);
    cliente.trabalhado = cliente.projetos.some(
      (p) => !!p.entregue || (!!p.etapa && !ETAPAS_ANTES_DO_TRABALHO.has(p.etapa)),
    );
    cliente.posEntregaComValor = cliente.projetos.some(
      (p) => p.etapa === "pos_entrega" && p.valor > 0,
    );
    return cliente;
  });
  const projetos = clientes.flatMap((c) => c.projetos);
  const porCnpj = new Map<string, Cliente>();
  const porRaiz = new Map<string, Cliente>();
  for (const c of clientes) {
    if (c.cnpj && !porCnpj.has(c.cnpj)) porCnpj.set(c.cnpj, c);
    if (c.raiz && !porRaiz.has(c.raiz)) porRaiz.set(c.raiz, c);
  }
  const clienteDo = (cnpj: string | null) =>
    !cnpj
      ? null
      : (porCnpj.get(cnpj) ??
        (cnpj.length === 14 ? (porRaiz.get(cnpj.slice(0, 8)) ?? null) : null));

  const propostas: Proposta[] = (bruto.propostas ?? []).map((p) => ({
    id: String(p.id),
    empresa: (p.empresa ?? "Sem nome").trim(),
    cnpj: so(p.cnpj) || null,
    produto: p.produto,
    status: p.status,
    exito:
      p.percentual_exito === null || p.percentual_exito === undefined
        ? null
        : num(p.percentual_exito),
    valorTotal: p.valor_total === null ? null : num(p.valor_total),
    envio: dia(p.data_envio),
  }));

  // PAT por CNPJ (exato; sem ele, a raiz), como no Handoff Consultoria.
  const pat = bruto.porta_financeiro.aberta ? (bruto.pat ?? []) : null;
  const patPor = new Map<string, PatBruto[]>();
  for (const x of pat ?? []) patPor.set(x.cnpj, [...(patPor.get(x.cnpj) ?? []), x]);
  const patDo = (cnpj: string | null) => {
    if (!cnpj || !pat) return [];
    if (patPor.has(cnpj)) return patPor.get(cnpj) ?? [];
    if (cnpj.length !== 14) return [];
    return pat.filter((x) => x.cnpj.slice(0, 8) === cnpj.slice(0, 8));
  };

  const negocios: Negocio[] = (bruto.negocios ?? []).map((n) => {
    const cnpj = so(n.cnpj) || null;
    const cliente = clienteDo(cnpj);
    const ganho = dia(n.ganho_em) ?? n.ganho_em;
    const receita = patDo(cnpj).filter(
      (x) => x.mes.slice(0, 7) >= ganho.slice(0, 7) && (num(x.faturado) > 0 || num(x.recebido) > 0),
    );
    return {
      deal: String(n.deal),
      titulo: (n.titulo || n.organizacao || `Negócio ${n.deal}`).trim(),
      ganho,
      mes: ganho.slice(0, 7),
      origem: n.origem_pipeline,
      maquina: n.origem_pipeline === "inside_sales",
      unidade: n.unidade,
      closer: n.closer,
      regime: regimeDe(n.regime_tributario),
      regimeTexto: n.regime_tributario,
      cnpj,
      cnpjFonte: n.cnpj_fonte,
      organizacao: n.organizacao,
      onboarding: !!n.onboarding,
      cliente,
      naPlataforma: !!cliente,
      trabalhado: !!cliente?.trabalhado,
      faturou: pat ? receita.length > 0 : null,
      faturado: pat ? receita.reduce((s, x) => s + num(x.faturado), 0) : null,
    };
  });
  const maquina = negocios.filter((n) => n.maquina);

  // Janela de 28 dias para a vazão (quatro semanas cheias até hoje).
  const de28 = somaDias(hoje, -27);
  const entraram = projetos.filter((p) => entre(p.cadastrado, de28, hoje));
  const sairam = projetos.filter((p) => entre(p.entregue, de28, hoje));
  const de30 = somaDias(hoje, -29);

  // Cartões.
  const comValor = projetos.filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const comExito = propostas.filter((p) => p.exito !== null);
  const fluxo = projetos.filter(
    (p) => p.etapa === "fluxo_documentos" && !p.encerrado && !p.entregue,
  );
  const posEntrega = clientes.filter((c) => c.posEntregaComValor).sort((a, b) => b.valor - a.valor);
  const lrComValor = clientes.filter((c) => c.regime === "real" && c.valor > 0);
  const projetosLR = projetos.filter((p) => p.cliente.regime === "real");
  const julSet = projetos.filter((p) => entre(p.cadastrado, "2026-07-01", "2026-09-30"));
  const setembro = maquina.filter((n) => n.mes === "2026-09");
  const medidas: Record<string, Omit<Cartao, keyof Citacao | "status" | "diferenca">> = {
    oportunidades: {
      medido: comValor.reduce((s, p) => s + p.valor, 0),
      como: "Soma do valor identificado de todos os projetos que a API da plataforma manda, de todas as etapas.",
      porque:
        "A API manda o valor identificado do projeto. O número da tela do Siqueira pode somar só as oportunidades apresentadas (pós-entrega).",
      registros: { tipo: "projetos", itens: comValor },
    },
    honorario: {
      medido: comExito.length
        ? comExito.reduce((s, p) => s + (p.exito ?? 0), 0) / comExito.length / 100
        : null,
      como: `Média do percentual de êxito das propostas da plataforma que têm o percentual preenchido (${comExito.length} de ${propostas.length}).`,
      porque: "Média simples por proposta, não ponderada pelo valor.",
      registros: { tipo: "propostas", itens: comExito },
    },
    "diagnostico-valor": {
      medido: posEntrega.length,
      como: "Clientes (CNPJ) com algum projeto em Pós-entrega e valor identificado maior que zero.",
      porque: `A plataforma pode contar empresas do grupo ou oportunidades, não CNPJs. Com valor em qualquer etapa são ${clientes.filter((c) => c.valor > 0).length} clientes.`,
      registros: { tipo: "clientes", itens: posEntrega },
    },
    "entram-semana": {
      medido: Math.round(entraram.length / 4),
      como: `Projetos cadastrados na plataforma nos últimos 28 dias (${entraram.length}) ÷ 4 semanas, arredondado: contagem é sempre inteira.`,
      registros: { tipo: "projetos", itens: entraram },
    },
    "saem-semana": {
      medido: Math.round(sairam.length / 4),
      como: `Projetos com data de entrega nos últimos 28 dias (${sairam.length}) ÷ 4 semanas, arredondado: contagem é sempre inteira.`,
      registros: { tipo: "projetos", itens: sairam },
    },
    "entregues-mes": {
      medido: projetos.filter((p) => entre(p.entregue, de30, hoje)).length,
      como: "Projetos com data de entrega nos últimos 30 dias.",
      registros: { tipo: "projetos", itens: projetos.filter((p) => entre(p.entregue, de30, hoje)) },
    },
    "fluxo-documentos": {
      medido: fluxo.length,
      como: "Projetos abertos (não entregues, não encerrados) na etapa Fluxo de Documentos agora.",
      registros: { tipo: "projetos", itens: fluxo },
    },
    "lucro-real": {
      medido: lrComValor.length,
      como: "Clientes de Lucro Real (regime da plataforma) com valor identificado maior que zero.",
      porque: `A conta da call parece contar todas as empresas de lucro real com projeto. Clientes de Lucro Real na plataforma: ${clientes.filter((c) => c.regime === "real").length}.`,
      registros: { tipo: "clientes", itens: lrComValor },
    },
    "lucro-real-projetos": {
      medido: projetos.length ? projetosLR.length / projetos.length : null,
      como: `Projetos de clientes de Lucro Real (${projetosLR.length}) ÷ todos os projetos (${projetos.length}).`,
      registros: { tipo: "projetos", itens: projetosLR },
    },
    "media-lucro-real": {
      medido: lrComValor.length
        ? lrComValor.reduce((s, c) => s + c.valor, 0) / lrComValor.length
        : null,
      como: "Valor identificado dos clientes de Lucro Real ÷ clientes de Lucro Real com valor.",
      porque:
        "Na call foi conta de bolso: supôs 80% das oportunidades no lucro real e dividiu por 361 empresas.",
      registros: { tipo: "clientes", itens: [...lrComValor].sort((a, b) => b.valor - a.valor) },
    },
    "chegaram-3-meses": {
      medido: julSet.length,
      como: "Projetos cadastrados na plataforma de 01/07 a 30/09/2026, sem filtro.",
      porque:
        "O 124 sai do painel Esteira da plataforma, que conta projetos pela data de entrada com o filtro que estava na tela durante a call. O filtro não foi dito e a API não o reproduz.",
      registros: { tipo: "projetos", itens: julSet },
    },
    "maquina-setembro": {
      medido: setembro.length,
      como: "Negócios ganhos no pipeline Inside Sales do Pipedrive em setembro/26 (a máquina). O pipe Sócios fica fora.",
      porque: `No mesmo mês o pipe Sócios fechou ${negocios.filter((n) => !n.maquina && n.mes === "2026-09").length}.`,
      registros: { tipo: "negocios", itens: setembro },
    },
  };
  const cartoes: Cartao[] = CITACOES.map((c) => {
    const m = medidas[c.id];
    const status = c.id === "chegaram-3-meses" ? "outra-conta" : statusDa(c.dito, m.medido);
    return {
      ...c,
      ...m,
      status,
      diferenca: m.medido === null ? null : (m.medido - c.dito) / c.dito,
    };
  });
  const contagem = Object.fromEntries(
    STATUS.map((s) => [s.id, cartoes.filter((c) => c.status === s.id).length]),
  ) as Record<Status, number>;

  // Entram × saem por semana: 12 semanas, a última até hoje (parcial).
  const ultima = semanaDe(hoje);
  const semanas: Semana[] = Array.from({ length: 12 }, (_, i) => {
    const s = somaDias(ultima, -7 * (11 - i));
    const fim = somaDias(s, 6);
    return {
      semana: s,
      parcial: fim > hoje,
      entraram: projetos.filter((p) => entre(p.cadastrado, s, fim)),
      sairam: projetos.filter((p) => entre(p.entregue, s, fim)),
    };
  });

  // Máquina por mês (ganhos no Inside Sales) e o que o CEO disse.
  const meses = mesesDe("2026-01-01", hoje);
  const maquinaPorMes = meses.map((m) => ({
    mes: m,
    ganhos: maquina.filter((n) => n.mes === m),
    dito: MAQUINA_DITA[m] ?? null,
  }));

  // Teste do CEO: a coorte de cada mês de ganho, cumulativa (cada etapa é parte da de cima).
  const noRegime = (n: Negocio) => !filtro.regime || n.regime === filtro.regime;
  const coorte: LinhaCoorte[] = mesesDe("2026-06-01", hoje).map((m) => {
    const ganhos = maquina.filter((n) => n.mes === m && noRegime(n));
    const cnpj = ganhos.filter((n) => n.cnpj);
    const plataforma = cnpj.filter((n) => n.naPlataforma);
    const trabalhados = plataforma.filter((n) => n.trabalhado);
    return {
      mes: m,
      etapas: {
        ganhos,
        cnpj,
        plataforma,
        trabalhados,
        faturou: pat ? trabalhados.filter((n) => n.faturou) : null,
      },
    };
  });

  return {
    hoje,
    lidoEm: bruto.lido_em,
    porta: bruto.porta_financeiro,
    frescor: bruto.frescor,
    clientes,
    projetos,
    propostas,
    negocios,
    cartoes,
    contagem,
    janela: { de: de28, ate: hoje, entraram, sairam },
    semanas,
    maquinaPorMes,
    coorte,
    maquinaSemCnpj: maquina.filter((n) => !n.cnpj),
  };
}
