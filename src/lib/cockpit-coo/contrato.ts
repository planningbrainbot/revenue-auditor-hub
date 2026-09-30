// Contrato do Cockpit do COO · Expansão (spec docs/superpowers/specs/2026-09-29-cockpit-coo-expansao-design.md).
//
// O cockpit é a pauta das cinco reuniões da semana do COO. Cada tema é um item da lateral
// (`/cockpit-coo?tema=`), e a chave da URL é o TEMA, não o dia: se a rotina mudar de dia, muda só
// `dia` aqui e nenhum link quebra.
//
// Arquivo puro (sem I/O): importado pelo servidor, pelos testes e pela tela.
import type { Destino, Estado, UnidadeContagem } from "../cockpit-ceo/contrato.ts";

export type { Destino, Estado, UnidadeContagem };

export type Tema = "growth" | "financeiro-operacoes" | "cs-rh" | "monetizacao" | "estrategico";

export interface DefinicaoTema {
  /** Dia da semana da reunião (1 = segunda … 5 = sexta), como `Date.getDay()`. */
  dia: 1 | 2 | 3 | 4 | 5;
  diaRotulo: string;
  titulo: string;
  /** Rótulo do item da lateral e do `<h1>` (N1): "Seg · Growth". */
  menu: string;
  pergunta: string;
  /**
   * Departamentos do quadro de OKRs da Expansão Nacional (ClickUp) que o tema acompanha. Casados
   * pelo começo do nome da pasta, antes do " · Pessoa": renomear o dono não quebra o vínculo.
   */
  departamentos: string[];
}

// Rotina confirmada pelo COO em 29/09/2026. Os departamentos vêm do quadro de OKRs; o mapa tema →
// departamento foi aprovado pelo COO no mesmo dia ("A semana e os departamentos: Aprovo").
export const TEMAS: Record<Tema, DefinicaoTema> = {
  growth: {
    dia: 1,
    diaRotulo: "Segunda",
    titulo: "Growth",
    menu: "Seg · Growth",
    pergunta:
      "A matriz está gerando e convertendo demanda para as unidades no ritmo do trimestre?",
    departamentos: ["Marketing", "Comercial", "Performance & Tech"],
  },
  "financeiro-operacoes": {
    dia: 2,
    diaRotulo: "Terça",
    titulo: "Financeiro e Operações",
    menu: "Ter · Financeiro e Operações",
    pergunta: "O negócio se sustenta, para onde aponta o caixa e a entrega está andando?",
    departamentos: ["Operações", "Auditoria & Qualidade"],
  },
  "cs-rh": {
    dia: 3,
    diaRotulo: "Quarta",
    titulo: "CS e RH",
    menu: "Qua · CS e RH",
    pergunta: "Os clientes e as equipes das unidades estão saudáveis, e as vagas andam?",
    departamentos: ["Relacionamento & CS"],
  },
  monetizacao: {
    dia: 4,
    diaRotulo: "Quinta",
    titulo: "Monetização",
    menu: "Qui · Monetização",
    pergunta: "A Monetização está entregando o projetado, e quais unidades eu preciso cobrar?",
    departamentos: ["Receitas"],
  },
  estrategico: {
    dia: 5,
    diaRotulo: "Sexta",
    titulo: "Estratégico",
    menu: "Sex · Estratégico",
    pergunta: "A rede está no pacto e o que eu levo para a próxima semana?",
    departamentos: ["CEO", "Novos Sócios"],
  },
};

export const ORDEM_TEMAS = Object.keys(TEMAS) as Tema[];

export function ehTema(x: unknown): x is Tema {
  return typeof x === "string" && x in TEMAS;
}

/** Dia da semana de uma data ISO (YYYY-MM-DD), sem fuso: a data já vem no fuso de São Paulo. */
export function diaDaSemana(hojeIso: string): number {
  return new Date(`${hojeIso}T12:00:00Z`).getUTCDay();
}

/**
 * O tema que o cockpit abre sem `?tema=`: o da reunião de hoje. Sábado e domingo abrem a sexta
 * (revisão da semana), que é o que faz sentido reler antes da segunda.
 */
export function temaDoDia(hojeIso: string): Tema {
  const d = diaDaSemana(hojeIso);
  return ORDEM_TEMAS.find((t) => TEMAS[t].dia === d) ?? "estrategico";
}

/** O nome da pasta sem o dono: "Operações · Victor" → "Operações"; "Novos Sócios . Paulo" → "Novos Sócios". */
export function departamentoBase(nomePasta: string): string {
  return nomePasta.split(/\s+[·.]\s+/)[0].trim();
}

/** Tema(s) que acompanham um departamento do quadro de OKRs. */
export function temasDoDepartamento(nomePasta: string): Tema[] {
  const base = departamentoBase(nomePasta).toLocaleLowerCase("pt-BR");
  return ORDEM_TEMAS.filter((t) =>
    TEMAS[t].departamentos.some((d) => d.toLocaleLowerCase("pt-BR") === base),
  );
}

// ---------------------------------------------------------------------------------------------
// O que cada tema entrega à tela
// ---------------------------------------------------------------------------------------------

/** Que parte das unidades o número cobre. Royalties e IDU só existem na rede regional. */
export type Cobertura = "todas" | "rede" | "grupo";

export const COBERTURAS: Record<Cobertura, string> = {
  todas: "todas as unidades do filtro",
  rede: "só rede regional (a operação própria não paga royalties)",
  grupo: "a empresa inteira: não se separa por unidade (Financeiro, OKRs da Expansão, forecast da Monetização)",
};

export interface Explicacao {
  oQueDiz: string;
  comoCalcula: string;
  atencao?: string;
  dono: string;
}

/** Os dados do número ou do gráfico em tabela: a vista acessível da gaveta. */
export interface TabelaDados {
  colunas: string[];
  linhas: (string | number | null)[][];
}

export interface NumeroCoo {
  id: string;
  rotulo: string;
  valor: number | null;
  unidade: UnidadeContagem;
  estado: Estado;
  /** Uma informação só (feedback de 23/09: nota de 3 a 4 linhas foi reprovada). */
  nota?: string;
  meta?: { valor: number; rotulo: string };
  /** Variação PERCENTUAL contra a referência do rótulo (o cartão escreve "%"). */
  delta?: { valor: number; rotulo: string; sentido: "maior-melhor" | "menor-melhor" };
  tendencia?: { valores: (number | null)[]; rotulo: string };
  tom?: "sucesso" | "atencao" | "perigo";
  cobertura: Cobertura;
  fonte: string;
  dataDado: string | null;
  destino: Destino | null;
  explicacao: Explicacao;
  dados?: TabelaDados;
  /** Motivo quando o estado não é "disponivel". */
  motivo?: string;
}

export type Gravidade = "critico" | "atencao";

export interface AlertaCoo {
  /**
   * Chave estável da exceção (tema:regra:unidade:período). Vai no campo Origem da tarefa do
   * ClickUp, e é ela que impede o "Virar compromisso" de criar a mesma tarefa duas vezes.
   */
  chave: string;
  regra: string;
  gravidade: Gravidade;
  /** Uma linha: "Belém · apuração fechada sem fatura". */
  titulo: string;
  unidade: string | null;
  /** Para ordenar: o maior impacto primeiro dentro da mesma gravidade. */
  peso: number;
  destino: Destino | null;
  /** O limiar, em texto: vai para a gaveta e para a descrição da tarefa. */
  limiar: string;
}

export interface SerieGrafico {
  chave: string;
  rotulo: string;
}

export interface GraficoCoo {
  id: string;
  /** Título em forma de pergunta, uma linha. */
  titulo: string;
  tipo: "barras-h" | "barras" | "linhas";
  series: SerieGrafico[];
  /** Uma linha por categoria (unidade ou mês); `rotulo` é o eixo. */
  pontos: ({ rotulo: string } & Record<string, number | string | null>)[];
  unidade: UnidadeContagem;
  estado: Estado;
  motivo?: string;
  fonte: string;
  dataDado: string | null;
  destino: Destino | null;
  explicacao: Explicacao;
}

export interface Procedencia {
  fonte: string;
  atualizadoEm: string | null;
}

/** A parte do tema que vem da fonte de negócio (sem ClickUp): números, alertas e gráficos. */
export interface LeituraTema {
  tema: Tema;
  universo: string;
  numeros: NumeroCoo[];
  alertas: AlertaCoo[];
  graficos: GraficoCoo[];
  fontes: Procedencia[];
  avisos: string[];
}

/** Ordem de leitura dos alertas: crítico antes de atenção; dentro da gravidade, o maior peso. */
export function ordenarAlertas(alertas: AlertaCoo[]): AlertaCoo[] {
  const g = (a: AlertaCoo) => (a.gravidade === "critico" ? 0 : 1);
  return [...alertas].sort((a, b) => g(a) - g(b) || b.peso - a.peso || a.titulo.localeCompare(b.titulo));
}

/** No máximo 6 números na primeira dobra (N12). Estourar é erro de programação, não de dado. */
export const MAX_NUMEROS = 6;
export const MAX_ALERTAS_NA_TELA = 3;
