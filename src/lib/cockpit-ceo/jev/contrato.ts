// Contrato do Jev (TypeSafe) via OpenRouter Decisions, conferido nas fontes oficiais em 22/09/2026:
// POST https://openrouter.ai/api/alpha/decisions, modelo typesafe/jev-1.13, corpo {model, state,
// questions}; primitivas choice (critérios em mapa), score (lista ordenada) e noul (critérios
// "true"/"false"), todas com `instructions` e `criteria` obrigatórios no schema do OpenRouter.
// Detalhes em docs/dev_notes/cockpit-ceo-piloto/ambiente.md.
//
// Papel do Jev no cockpit: SUGERIR, em julgamentos pequenos sobre texto. Ele não calcula número,
// não decide elegibilidade, não escolhe fonte cadastral e não autoriza ação. `confidence` resume o
// formato da distribuição; não é a probabilidade de a resposta estar certa.
//
// Arquivo puro (sem Node): é importado pelo servidor, pelos testes e pela tela, que só usa os
// rótulos. Quem fala com a rede é `adaptador.server.ts`.
// Taxonomia congelada nas seis frentes da avaliação rotulada de 22/09 (95%): ampliar as frentes
// do cockpit não pode mudar, sem nova avaliação, o que o Jev recebe como opções.
export const FRENTES_JEV = {
  receita: {
    titulo: "Receita e crescimento",
    pergunta: "Quanto faturamos, quanto falta para a meta e de onde vem o próximo incremento?",
  },
  clientes: {
    titulo: "Clientes e produtos",
    pergunta: "Quantos clientes temos de verdade, quem consome cada vertical e onde há oferta?",
  },
  comercial: {
    titulo: "Execução comercial",
    pergunta: "A demanda está sendo trabalhada? Qual produto e unidade convertem?",
  },
  rede: {
    titulo: "Saúde da rede",
    pergunta: "Quais unidades crescem com margem? O sócio da unidade está satisfeito?",
  },
  retencao: {
    titulo: "Retenção e entrega",
    pergunta: "Quem permanece, expande ou sai? A entrega comporta crescer?",
  },
  capital: {
    titulo: "Capital e evidências",
    pergunta: "O que podemos consolidar e o que conseguimos demonstrar a investidores?",
  },
} as const;
export type FrenteJev = keyof typeof FRENTES_JEV;

export const JEV_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
export const JEV_MODELO = "typesafe/jev-1.13";
export const LIMITES_PILOTO = { tentativas: 10, custoUsd: 0.1 } as const;
export const KEYCHAIN = {
  servico: "planning-openrouter-cockpit-piloto",
  conta: "planning",
} as const;

export type PerguntaJev =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "noul"; instructions: string; criteria: { true: string; false: string } };

export interface PedidoJev {
  model: string;
  state: Record<string, string>;
  questions: Record<string, PerguntaJev>;
}

export type RespostaJev =
  | {
      type: "choice";
      choice: string;
      confidence: number | null;
      probabilities: Record<string, number> | null;
    }
  | {
      type: "score";
      score: number;
      confidence: number | null;
      probabilities: Record<string, number> | null;
    }
  | { type: "noul"; noul: number };

export class ErroJev extends Error {
  codigo: string;
  constructor(codigo: string, mensagem: string) {
    super(mensagem);
    this.codigo = codigo;
  }
}

// ── Texto fictício do teste real (missão do piloto) ──────────────────────
export const TAXONOMIA_EMAIL = "piloto-email-v1";
export const EMAIL_FICTICIO =
  "Olá! Na Empresa Exemplo Alfa precisamos entender se a revisão tributária se aplica ao nosso caso. Já temos contador e gostaria de conversar com um especialista antes de decidir. Vocês conseguem explicar o serviço?";

export function payloadTesteEmail(): PedidoJev {
  return {
    model: JEV_MODELO,
    state: { mensagem: EMAIL_FICTICIO },
    questions: {
      intencao: {
        type: "choice",
        instructions: "Qual é a intenção principal expressa na mensagem em `mensagem`?",
        criteria: {
          conhecer: "Quer entender o serviço antes de avaliar a compra.",
          proposta: "Pede proposta comercial para avaliar a contratação.",
          suporte: "Pede ajuda com problema em produto ou serviço já contratado.",
          outro: "Expressa outra intenção.",
          insuficiente: "Não há informação suficiente para identificar a intenção.",
        },
      },
      interesse: {
        type: "score",
        instructions:
          "Qual a força da intenção comercial explicitamente demonstrada na mensagem em `mensagem`? Não estime chance de fechamento nem aderência tributária.",
        criteria: [
          "Não expressa interesse em comprar.",
          "Interesse exploratório em conhecer o serviço.",
          "Pedido concreto de proposta ou contratação.",
        ],
      },
      pessoa: {
        type: "noul",
        instructions:
          "A mensagem em `mensagem` pede explicitamente conversa ou contato com uma pessoa?",
        criteria: {
          true: "Pede conversa, reunião, ligação ou contato com alguém.",
          false: "Não pede contato com uma pessoa.",
        },
      },
    },
  };
}

// ── Encaminhamento de pergunta do CEO (preview) ──────────────────────────
// Só perguntas fictícias fixas: a ponte não aceita texto livre, então nada privado sai daqui.
export const TAXONOMIA_ROTEAMENTO = "cockpit-ceo-roteamento-v1";
export const PERGUNTAS_CEO_FICTICIAS = {
  "ritmo-contratos":
    "Por que os contratos ganhos deste mês estão abaixo da meta, e qual produto está puxando para baixo?",
  "clientes-reais": "Quantos clientes de verdade usam Consultoria e Finance ao mesmo tempo?",
  bilhao: "Quanto falta para o bilhão e de onde vem o próximo incremento de faturamento?",
  "investidor-retencao":
    "Que evidência mostramos a um investidor sobre quem continua com a gente depois de um ano?",
  "fora-escopo": "Qual restaurante vocês recomendam para o almoço com o conselho?",
} as const;
export type IdPerguntaCeo = keyof typeof PERGUNTAS_CEO_FICTICIAS;
export const IDS_PERGUNTAS_CEO = Object.keys(PERGUNTAS_CEO_FICTICIAS) as IdPerguntaCeo[];

export const OPCOES_ROTEAMENTO: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(FRENTES_JEV).map(([k, f]) => [k, `${f.titulo}: ${f.pergunta}`]),
  ),
  fora_de_escopo:
    "A pergunta não trata de receita, clientes, execução comercial, rede, retenção ou capital da empresa.",
  insuficiente: "A pergunta é vaga demais para escolher uma frente.",
};

export function payloadRoteamento(id: string): PedidoJev {
  if (!(id in PERGUNTAS_CEO_FICTICIAS))
    throw new Error("Pergunta fora da lista fictícia do piloto.");
  return pedidoRoteamento(PERGUNTAS_CEO_FICTICIAS[id as IdPerguntaCeo]);
}

/**
 * O pedido de encaminhamento para um texto. Só a avaliação rotulada (casos fictícios fixos) e o
 * preview (lista fixa acima) chamam isto; nenhuma tela passa texto livre.
 */
export function pedidoRoteamento(texto: string): PedidoJev {
  return {
    model: JEV_MODELO,
    state: { pergunta: texto },
    questions: {
      frente: {
        type: "choice",
        instructions:
          "Qual frente do Cockpit do CEO tem os dados que seriam consultados primeiro para responder à pergunta em `pergunta`?",
        criteria: OPCOES_ROTEAMENTO,
      },
      pede_dado: {
        type: "noul",
        instructions:
          "A pergunta em `pergunta` pede um número ou uma evidência verificável, e não uma opinião ou uma decisão?",
        criteria: {
          true: "Pede quantidade, valor, comparação ou evidência que se confere em dados.",
          false: "Pede opinião, recomendação ou decisão, sem dado a conferir.",
        },
      },
    },
  };
}

// A conversa do cockpit (24/09) tem taxonomia própria: domínio + ambiguidade.
export const TAXONOMIA_CONVERSA = "cockpit-ceo-conversa-v1";
export const taxonomiaDo = (p: PedidoJev) =>
  "dominio" in p.questions
    ? TAXONOMIA_CONVERSA
    : "pergunta" in p.state
      ? TAXONOMIA_ROTEAMENTO
      : TAXONOMIA_EMAIL;

// ── Validação do pedido (antes de sair) ──────────────────────────────────
const textoCheio = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export function validarPedido(p: PedidoJev): void {
  if (p.model !== JEV_MODELO) throw new Error("Modelo fora do piloto.");
  if (!p.state || typeof p.state !== "object") throw new Error("state ausente.");
  const nomes = Object.keys(p.questions ?? {});
  if (!nomes.length || nomes.length > 20) throw new Error("questions vazio ou grande demais.");
  for (const nome of nomes) {
    const q = p.questions[nome];
    if (!textoCheio(q.instructions)) throw new Error(`${nome}: instructions obrigatório.`);
    if (q.type === "choice") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (!c || Object.keys(c).length < 2 || !Object.values(c).every(textoCheio))
        throw new Error(`${nome}: criteria da choice precisa de ao menos duas opções.`);
    } else if (q.type === "score") {
      if (!Array.isArray(q.criteria) || !q.criteria.length || !q.criteria.every(textoCheio))
        throw new Error(`${nome}: criteria do score precisa de ao menos um nível.`);
    } else if (q.type === "noul") {
      const c = q.criteria as Record<string, unknown> | undefined;
      if (!c || !textoCheio(c.true) || !textoCheio(c.false) || Object.keys(c).length !== 2)
        throw new Error(`${nome}: criteria do noul exige "true" e "false".`);
    } else throw new Error(`${nome}: tipo de pergunta desconhecido.`);
  }
}

// ── Validação da resposta ────────────────────────────────────────────────
const noIntervalo = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= min - 1e-9 && v <= max + 1e-9;
const invalida = (motivo: string) => new ErroJev("resposta_invalida", motivo);

function distribuicao(v: unknown, chaves: string[]): Record<string, number> | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object") throw invalida("probabilities não é objeto.");
  const saida: Record<string, number> = {};
  for (const [k, p] of Object.entries(v as Record<string, unknown>)) {
    if (!chaves.includes(k) || !noIntervalo(p, 0, 1))
      throw invalida("probabilities fora da taxonomia.");
    saida[k] = p;
  }
  return saida;
}
const confianca = (v: unknown) => {
  if (v === undefined || v === null) return null;
  if (!noIntervalo(v, 0, 1)) throw invalida("confidence fora de 0..1.");
  return v;
};

export interface RespostaValidada {
  modelo: string;
  provedor: string | null;
  idFornecedor: string | null;
  respostas: Record<string, RespostaJev>;
  custoUsd: number | null;
  tokens: { entrada: number | null; saida: number | null };
}

export function validarResposta(
  raw: unknown,
  perguntas: Record<string, PerguntaJev>,
): RespostaValidada {
  if (!raw || typeof raw !== "object") throw invalida("Corpo não é objeto.");
  const r = raw as Record<string, unknown>;
  if (typeof r.model !== "string" || !r.model.startsWith("typesafe/jev-"))
    throw invalida("Modelo retornado não é Jev.");
  if (r.provider !== undefined && r.provider !== null && typeof r.provider !== "string")
    throw invalida("provider inválido.");
  const answers = r.answers as Record<string, Record<string, unknown>> | undefined;
  if (!answers || typeof answers !== "object") throw invalida("answers ausente.");
  const respostas: Record<string, RespostaJev> = {};
  for (const [nome, q] of Object.entries(perguntas)) {
    const a = answers[nome];
    // A referência documenta `type` em cada resposta; se ele faltar, vale o tipo da pergunta. Se
    // vier diferente, a resposta não é desta pergunta.
    if (!a || typeof a !== "object" || (a.type !== undefined && a.type !== q.type))
      throw invalida(`${nome}: resposta ausente ou de outro tipo.`);
    if (q.type === "choice") {
      const opcoes = Object.keys(q.criteria);
      if (typeof a.choice !== "string" || !opcoes.includes(a.choice))
        throw invalida(`${nome}: escolha fora da taxonomia.`);
      respostas[nome] = {
        type: "choice",
        choice: a.choice,
        confidence: confianca(a.confidence),
        probabilities: distribuicao(a.probabilities, opcoes),
      };
    } else if (q.type === "score") {
      const n = q.criteria.length;
      if (!noIntervalo(a.score, 0, n - 1)) throw invalida(`${nome}: score fora de 0..${n - 1}.`);
      respostas[nome] = {
        type: "score",
        score: a.score,
        confidence: confianca(a.confidence),
        probabilities: distribuicao(
          a.probabilities,
          q.criteria.map((_, i) => String(i)),
        ),
      };
    } else {
      if (!noIntervalo(a.noul, 0, 1)) throw invalida(`${nome}: noul fora de 0..1.`);
      respostas[nome] = { type: "noul", noul: a.noul };
    }
  }
  const usage = (r.usage ?? {}) as Record<string, unknown>;
  const inteiro = (v: unknown) =>
    Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null;
  return {
    modelo: r.model,
    provedor: (r.provider as string | undefined) ?? null,
    idFornecedor: typeof r.id === "string" ? r.id : null,
    respostas,
    custoUsd: extrairCusto(raw),
    tokens: { entrada: inteiro(usage.input_tokens), saida: inteiro(usage.output_tokens) },
  };
}

/** Custo informado em `usage.cost`. Ausente, negativo ou não numérico é "não informado", nunca zero. */
export function extrairCusto(raw: unknown): number | null {
  const usage = (raw as { usage?: { cost?: unknown } } | null)?.usage;
  return noIntervalo(usage?.cost, 0, Number.MAX_VALUE) ? (usage!.cost as number) : null;
}

/**
 * O formato de uma resposta, sem nenhum valor: chaves e tipos, até três níveis. Serve para ajustar
 * a validação se o fornecedor mudar o contrato, sem gravar texto nem escolha no ledger.
 */
export function formatoDaResposta(v: unknown, nivel = 0): unknown {
  if (v === null) return "null";
  if (Array.isArray(v)) return nivel >= 3 ? "array" : [formatoDaResposta(v[0], nivel + 1)];
  if (typeof v === "object")
    return nivel >= 3
      ? "object"
      : Object.fromEntries(
          Object.entries(v as Record<string, unknown>)
            .slice(0, 30)
            .map(([k, x]) => [k.slice(0, 40), formatoDaResposta(x, nivel + 1)]),
        );
  return typeof v;
}

// ── Orçamento do piloto ──────────────────────────────────────────────────
export interface RegistroChamada {
  id: string;
  em: string;
  exemplo: string;
  taxonomia: string;
  estado: "reservada" | "ok" | "falha";
  codigo?: string | null;
  modelo?: string | null;
  provedor?: string | null;
  idFornecedor?: string | null;
  latenciaMs?: number | null;
  custoUsd?: number | null;
  /** O desfecho não trouxe custo e a inferência pode ter ocorrido. */
  custoDesconhecido?: boolean;
  tokens?: { entrada: number | null; saida: number | null };
  respostas?: Record<string, RespostaJev>;
  /** Só quando a resposta veio fora do contrato: chaves e tipos, sem valores. */
  formato?: unknown;
}

export interface ResumoOrcamento {
  tentativas: number;
  restantes: number;
  custoConhecidoUsd: number;
  custoDesconhecido: boolean;
  bloqueado: boolean;
  motivo: string | null;
}

export function resumirOrcamento(
  registros: RegistroChamada[],
  limites: { tentativas: number; custoUsd: number } = LIMITES_PILOTO,
): ResumoOrcamento {
  const reservas = registros.filter((r) => r.estado === "reservada");
  const desfechos = new Map(
    registros.filter((r) => r.estado !== "reservada").map((r) => [r.id, r]),
  );
  const custoConhecidoUsd = [...desfechos.values()].reduce(
    (s, d) => s + (typeof d.custoUsd === "number" ? d.custoUsd : 0),
    0,
  );
  const custoDesconhecido =
    reservas.some((r) => !desfechos.has(r.id)) ||
    [...desfechos.values()].some((d) => d.custoDesconhecido === true);
  const motivo =
    reservas.length >= limites.tentativas
      ? `Limite de ${limites.tentativas} requisições do piloto atingido.`
      : custoConhecidoUsd >= limites.custoUsd
        ? `Custo informado chegou a US$ ${limites.custoUsd.toFixed(2)}.`
        : custoDesconhecido
          ? "Uma chamada terminou sem custo informado; novas chamadas ficam bloqueadas no piloto."
          : null;
  return {
    tentativas: reservas.length,
    restantes: Math.max(0, limites.tentativas - reservas.length),
    custoConhecidoUsd,
    custoDesconhecido,
    bloqueado: motivo !== null,
    motivo,
  };
}

/** Jev só liga no piloto autorizado e nunca em produção. */
export function pilotoJevAtivo(env: Record<string, string | undefined>): boolean {
  return env.COCKPIT_JEV_PILOTO === "1" && env.NODE_ENV !== "production";
}

export const MENSAGENS_FALHA: Record<string, string> = {
  tempo_esgotado: "O fornecedor não respondeu no tempo limite. Nenhuma nova tentativa automática.",
  conexao_falhou: "A conexão com o OpenRouter falhou. Nenhuma nova tentativa automática.",
  resposta_invalida: "A resposta veio fora do contrato esperado e foi descartada.",
  openrouter_http_400: "O OpenRouter recusou o pedido como inválido (400).",
  openrouter_http_401: "A chave foi recusada (401).",
  openrouter_http_402: "A chave está sem crédito (402).",
  openrouter_http_403: "A chave não tem permissão para esta operação (403).",
  openrouter_http_429: "Limite de requisições do fornecedor (429).",
  pedido_invalido: "O pedido não seguiu o contrato e não foi enviado.",
};
