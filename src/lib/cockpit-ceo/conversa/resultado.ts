// O que uma consulta devolve: dado agregado em uma forma conhecida, com procedência. É o único lugar
// de onde a tela da conversa tira números — nem o Jev nem o modelo escrevem valor em bloco visual.
import type { Destino, Estado, UnidadeContagem } from "../contrato.ts";

export type Forma =
  "kpi" | "serie" | "categorias" | "funil" | "ponte" | "tabela" | "coorte" | "acoes";

export interface Destaque {
  rotulo: string;
  valor: number | null;
  unidade: UnidadeContagem;
}

export type DadosResultado =
  | {
      forma: "kpi";
      valor: number | null;
      comparacoes: { rotulo: string; valor: number | null; unidade?: UnidadeContagem }[];
      composicao: { rotulo: string; valor: number | null; observacao?: string }[];
    }
  | {
      forma: "serie";
      /** "AAAA-MM" ou "AAAA-MM-DD". */
      pontos: { x: string; valores: Record<string, number | null> }[];
      series: { chave: string; rotulo: string; tipo?: "realizado" | "meta" }[];
    }
  | {
      forma: "categorias";
      itens: { rotulo: string; valor: number | null; meta?: number | null; detalhe?: string }[];
      total: number | null;
      /** A soma dos itens reconstrói o total (N2): o renderizador mostra o total ao lado. */
      somaFecha: boolean;
    }
  | { forma: "funil"; etapas: { rotulo: string; valor: number | null }[] }
  | {
      forma: "ponte";
      inicio: { rotulo: string; valor: number };
      passos: { rotulo: string; valor: number; clientes: number | null }[];
      fim: { rotulo: string; valor: number };
    }
  | {
      forma: "tabela";
      colunas: { chave: string; rotulo: string; unidade?: UnidadeContagem }[];
      linhas: Record<string, string | number | null>[];
    }
  | {
      forma: "coorte";
      colunas: string[];
      linhas: { coorte: string; base: number; valores: (number | null)[] }[];
    }
  | {
      forma: "acoes";
      itens: {
        titulo: string;
        detalhe: string;
        gravidade: "alta" | "media" | "decisao";
        responsavel: string;
        destino: Destino | null;
        alternativas?: string[];
      }[];
    };

export interface Resultado {
  /** Id da rodada ("r1", "r2"…). O modelo só referencia resultados por este id. */
  id: string;
  consulta: string;
  /** Argumentos validados: com eles a mesma consulta é refeita ao reabrir uma visão. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON validado pelo schema da consulta
  args: Record<string, any>;
  versaoRegra: string;
  titulo: string;
  unidade: UnidadeContagem;
  estado: Estado;
  fonte: string;
  atualizadoEm: string | null;
  filtrosAplicados: string[];
  avisos: string[];
  destino: Destino | null;
  /** Números derivados por regra (variação, soma, participação) que o texto pode citar. */
  destaques: Destaque[];
  dados: DadosResultado;
}

/** Todos os números de um resultado, para conferir o texto da conclusão. */
export function numerosDoResultado(r: Resultado): number[] {
  const out: number[] = [];
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  };
  r.destaques.forEach((d) => add(d.valor));
  const d = r.dados;
  switch (d.forma) {
    case "kpi":
      add(d.valor);
      d.comparacoes.forEach((c) => add(c.valor));
      d.composicao.forEach((c) => add(c.valor));
      break;
    case "serie":
      d.pontos.forEach((p) => Object.values(p.valores).forEach(add));
      break;
    case "categorias":
      add(d.total);
      d.itens.forEach((i) => (add(i.valor), add(i.meta)));
      break;
    case "funil":
      d.etapas.forEach((e) => add(e.valor));
      break;
    case "ponte":
      add(d.inicio.valor);
      add(d.fim.valor);
      d.passos.forEach((p) => (add(p.valor), add(p.clientes)));
      break;
    case "tabela":
      d.linhas.forEach((l) => Object.values(l).forEach(add));
      break;
    case "coorte":
      d.linhas.forEach((l) => (add(l.base), l.valores.forEach(add)));
      break;
    case "acoes":
      break;
  }
  return out;
}
