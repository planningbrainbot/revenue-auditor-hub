// Contrato de todo número do Cockpit do CEO.
//
// Um indicador não é só um valor: é a pergunta que ele responde, a unidade de contagem, o recorte,
// a fonte, a versão da regra, a data do dado e o estado de disponibilidade. Sem isso o número vira
// afirmação solta, e o cockpit existe justamente para o CEO conseguir conferir o que lê.
//
// Estados distintos, e nenhum deles vira zero (PRD, "Contrato de cada indicador"): ausência de
// apuração, fonte fora do ar e falta de permissão têm respostas diferentes de "nenhum registro".

// As chaves antigas (`receita` … `capital`) ficam: são URLs em uso. Em 23/09 o escopo passou da
// Monetização para a empresa inteira, e três frentes entraram (operação, portfólio, caixa); os
// títulos das antigas mudaram para o assunto que cada uma passou a cobrir.
export type Frente =
  | "receita"
  | "comercial"
  | "clientes"
  | "retencao"
  | "operacao"
  | "rede"
  | "portfolio"
  | "caixa"
  | "capital";

export const FRENTES: Record<Frente, { titulo: string; pergunta: string }> = {
  receita: {
    titulo: "Receita e trajetória",
    pergunta: "Quanto faturamos, de onde veio a variação e quanto falta para o bilhão?",
  },
  comercial: {
    titulo: "Aquisição e conversão",
    pergunta: "Quanta demanda geramos, quanto ela converte e a aquisição cumpre o plano?",
  },
  clientes: {
    titulo: "Clientes",
    pergunta: "Quantos clientes temos de verdade, e por qual régua?",
  },
  retencao: {
    titulo: "Retenção e expansão",
    pergunta: "Quem permanece, quem expande, quem encolhe e quem sai?",
  },
  operacao: {
    titulo: "Operação e capacidade",
    pergunta: "Conseguimos ativar o que vendemos, e onde a entrega trava?",
  },
  rede: {
    titulo: "Unidades",
    pergunta: "Quais unidades crescem, cumprem a meta e contribuem para a matriz?",
  },
  portfolio: {
    titulo: "Portfólio e monetização",
    pergunta: "Quanto cada vertical acrescenta, e quanto do potencial já virou contrato?",
  },
  caixa: {
    titulo: "Caixa e margem",
    pergunta: "O faturamento vira caixa, e com que margem?",
  },
  capital: {
    titulo: "Evidências e capital",
    pergunta: "O que conseguimos demonstrar a investidores, e o que falta para a consolidação?",
  },
};
export const ORDEM_FRENTES = Object.keys(FRENTES) as Frente[];

export type Estado =
  "disponivel" | "parcial" | "nao_apurado" | "fonte_indisponivel" | "acesso_insuficiente";

export const ESTADOS: Record<Estado, string> = {
  disponivel: "Disponível",
  parcial: "Dado parcial",
  nao_apurado: "Não apurado",
  fonte_indisponivel: "Fonte indisponível",
  acesso_insuficiente: "Acesso insuficiente",
};

export type UnidadeContagem =
  "contas" | "negócios" | "eventos" | "reais" | "percentual" | "clientes" | "dias";

/**
 * Ids estáveis: a URL e o catálogo de perguntas apontam para eles. Os seis primeiros são os da
 * primeira fatia (Monetização e Base); os demais entraram com o escopo da empresa inteira (23/09).
 */
export const IDS_INDICADORES = [
  "meta-bilhao",
  "contratos-ganhos",
  "oportunidades-validadas",
  "leads-trabalhados",
  "receita-prevista-aberta",
  "contas-prontas",
  "faturamento-mes",
  "mrr-vendido",
  "vencido-em-aberto",
  "onboarding-parado",
  "faturamento-saiu",
] as const;
export type IdIndicador = (typeof IDS_INDICADORES)[number];

export interface LinhaComposicao {
  chave: string;
  rotulo: string;
  valor: number | null;
  /** A linha entra na soma que reconstrói o número principal. */
  soma?: boolean;
  /** Quando a linha conta outra coisa que o indicador (ex.: negócios dentro de uma soma em reais). */
  unidade?: UnidadeContagem;
  observacao?: string;
}

export interface Comparacao {
  rotulo: string;
  referencia: number | null;
  estado: Estado;
  nota: string;
}

export interface Destino {
  /** Caminho interno (rota do app) ou endereço de outro produto do Brain. */
  rota: string;
  search: Record<string, string>;
  rotulo: string;
  externo?: boolean;
  /** O destino aceita o mesmo período e perímetro? Se não, os totais podem diferir. */
  mesmoRecorte: boolean;
  observacao: string;
}

export interface Lacuna {
  oQueFalta: string;
  responsavel: string;
  acao: string;
}

export interface Indicador {
  id: string;
  versaoRegra: string;
  frente: Frente;
  pergunta: string;
  titulo: string;
  definicao: string;
  unidade: UnidadeContagem;
  numerador?: string;
  denominador?: string;
  /** null = fotografia do momento: o período filtrado não se aplica, e a tela diz isso. */
  periodo: { de: string; ate: string } | null;
  perimetro: string;
  filtros: string[];
  fonte: string;
  dataDado: string | null;
  dataApuracao: string;
  estado: Estado;
  valor: number | null;
  comparacoes: Comparacao[];
  composicao: LinhaComposicao[];
  notaComposicao?: string;
  destino: Destino | null;
  lacuna: Lacuna | null;
  sintetico: boolean;
}

// Contagens são inteiras; o decimal só aparece em referência calculada (ritmo esperado da meta).
const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const reais = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Nunca devolve "0" para ausência: `null` é "—", e o estado explica o porquê. */
export function formatarNumero(valor: number | null, unidade: UnidadeContagem): string {
  if (valor === null || !Number.isFinite(valor)) return "—";
  if (unidade === "reais") return reais.format(valor).replace(/\u00a0/g, " ");
  if (unidade === "percentual") return `${decimal.format(valor)}%`;
  return inteiro.format(valor);
}

export function formatarValor(i: Pick<Indicador, "valor" | "unidade">): string {
  return formatarNumero(i.valor, i.unidade);
}

/**
 * Soma das linhas marcadas; `null` se alguma parcela for desconhecida. Em centavos inteiros, como
 * `receitaSomada()`: somar reais em ponto flutuante dava 600,5999… contra um total de 600,60.
 */
export function somaDaComposicao(i: Pick<Indicador, "composicao">): number | null {
  let centavos = 0;
  for (const l of i.composicao) {
    if (!l.soma) continue;
    if (l.valor === null) return null;
    centavos += Math.round(l.valor * 100);
  }
  return centavos / 100;
}
