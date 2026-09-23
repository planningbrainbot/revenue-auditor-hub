// Contrato de todo número do Cockpit do CEO.
//
// Um indicador não é só um valor: é a pergunta que ele responde, a unidade de contagem, o recorte,
// a fonte, a versão da regra, a data do dado e o estado de disponibilidade. Sem isso o número vira
// afirmação solta, e o cockpit existe justamente para o CEO conseguir conferir o que lê.
//
// Estados distintos, e nenhum deles vira zero (PRD, "Contrato de cada indicador"): ausência de
// apuração, fonte fora do ar e falta de permissão têm respostas diferentes de "nenhum registro".

export type Frente = "receita" | "clientes" | "comercial" | "rede" | "retencao" | "capital";

export const FRENTES: Record<Frente, { titulo: string; pergunta: string }> = {
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

export type UnidadeContagem = "contas" | "negócios" | "eventos" | "reais" | "percentual";

/** Os indicadores da primeira fatia. Ids estáveis: a URL e o catálogo de perguntas apontam para eles. */
export const IDS_INDICADORES = [
  "meta-bilhao",
  "contratos-ganhos",
  "oportunidades-validadas",
  "leads-trabalhados",
  "receita-prevista-aberta",
  "contas-prontas",
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
