// Especificação da visão: o que o modelo pode propor e o que o servidor guarda e executa.
//
// O modelo propõe blocos de um catálogo pequeno e aponta cada um para um resultado da rodada
// ("r1", "r2"…). Ele não escreve número, HTML nem código: o schema é estrito e recusa campo a mais.
// O servidor troca cada referência pela consulta que gerou o resultado (nome + argumentos já
// validados). É essa definição que se salva: ao reabrir, as consultas rodam de novo com a permissão
// vigente, e nenhum número fica guardado como se fosse atual.
import { z } from "zod";
import { CONSULTAS, NOMES_CONSULTAS, executarConsulta } from "./metricas.ts";
import type { EntradaConsulta, NomeConsulta } from "./metricas.ts";
import { FiltrosSchema } from "./filtros.ts";
import type { Filtros } from "./filtros.ts";
import type { Forma, Resultado } from "./resultado.ts";

export const VERSAO_SPEC = 1;

export const TIPOS_BLOCO = [
  "kpi",
  "serie",
  "barras",
  "ranking",
  "funil",
  "ponte",
  "tabela",
  "coorte",
  "acoes",
] as const;
export type TipoBloco = (typeof TIPOS_BLOCO)[number];

/** Forma de resultado que cada bloco sabe desenhar. Tabela desenha qualquer uma. */
export const FORMAS_DO_BLOCO: Record<TipoBloco, Forma[]> = {
  kpi: ["kpi"],
  serie: ["serie"],
  barras: ["categorias", "serie", "funil"],
  ranking: ["categorias"],
  funil: ["funil", "categorias"],
  ponte: ["ponte"],
  tabela: ["kpi", "serie", "categorias", "funil", "ponte", "tabela", "coorte"],
  coorte: ["coorte"],
  acoes: ["acoes"],
};

const ID_RESULTADO = /^r\d{1,3}$/;

export const PropostaVisaoSchema = z
  .object({
    titulo: z.string().min(1).max(90),
    /** Uma a três frases. Todo número aqui é conferido contra os resultados. */
    conclusao: z.string().min(1).max(700),
    blocos: z
      .array(
        z
          .object({
            tipo: z.enum(TIPOS_BLOCO),
            resultado: z.string().regex(ID_RESULTADO),
            titulo: z.string().max(90).optional(),
          })
          .strict(),
      )
      .max(6),
    /** Próximas explorações sugeridas, como pergunta curta. */
    proximas: z.array(z.string().min(3).max(140)).max(3).optional(),
    filtros: FiltrosSchema.optional(),
  })
  .strict();
export type PropostaVisao = z.infer<typeof PropostaVisaoSchema>;

export const ConsultaSchema = z
  .object({
    nome: z.enum(NOMES_CONSULTAS as [NomeConsulta, ...NomeConsulta[]]),
    args: z.record(z.any()),
  })
  .strict();

export const VisaoDefinicaoSchema = z
  .object({
    versao: z.literal(VERSAO_SPEC),
    titulo: z.string().min(1).max(90),
    filtros: FiltrosSchema,
    blocos: z
      .array(
        z
          .object({
            id: z.string().regex(/^b\d{1,2}$/),
            tipo: z.enum(TIPOS_BLOCO),
            titulo: z.string().max(90).optional(),
            consulta: ConsultaSchema,
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
export type VisaoDefinicao = z.infer<typeof VisaoDefinicaoSchema>;

export class EspecificacaoRecusada extends Error {}

/** Tipo que desenha a forma quando o pedido não desenha: a mesma informação, sem inventar layout. */
const TIPO_PARA_FORMA: Record<Forma, TipoBloco> = {
  kpi: "kpi",
  serie: "serie",
  categorias: "barras",
  funil: "funil",
  ponte: "ponte",
  tabela: "tabela",
  coorte: "coorte",
  acoes: "acoes",
};

/**
 * Proposta do modelo → definição executável, com as consultas autorizadas desta rodada.
 * Bloco com tipo que não desenha o resultado é ajustado para o tipo da forma; bloco que aponta
 * para resultado inexistente cai sozinho. Cada ajuste ou descarte volta em `ajustes`. Sem nenhum
 * bloco válido, a proposta é recusada.
 */
export function definicaoDaProposta(
  proposta: unknown,
  registro: Map<string, Resultado>,
  ajustes: string[] = [],
): VisaoDefinicao {
  const p = PropostaVisaoSchema.safeParse(proposta);
  if (!p.success)
    throw new EspecificacaoRecusada(
      `Especificação fora do schema: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.`,
    );
  const blocos: VisaoDefinicao["blocos"] = [];
  p.data.blocos.forEach((b, i) => {
    const r = registro.get(b.resultado);
    if (!r) {
      ajustes.push(`bloco ${i + 1} descartado: ${b.resultado} não existe nesta rodada`);
      return;
    }
    let tipo = b.tipo;
    if (!FORMAS_DO_BLOCO[tipo].includes(r.dados.forma)) {
      tipo = TIPO_PARA_FORMA[r.dados.forma];
      ajustes.push(`bloco ${i + 1}: ${b.tipo} não desenha ${r.dados.forma}; mostrado como ${tipo}`);
    }
    blocos.push({
      id: `b${blocos.length + 1}`,
      tipo,
      ...(b.titulo ? { titulo: b.titulo } : {}),
      consulta: { nome: r.consulta as NomeConsulta, args: r.args },
      // Índice da proposta original, para quem precisa casar bloco e resultado.
    });
    origem.set(blocos[blocos.length - 1], b.resultado);
  });
  if (!blocos.length) throw new EspecificacaoRecusada("A especificação não tem bloco válido.");
  return { versao: VERSAO_SPEC, titulo: p.data.titulo, filtros: p.data.filtros ?? {}, blocos };
}

/** Resultado de onde cada bloco da última definição veio (para resolver sem recalcular). */
const origem = new WeakMap<object, string>();
export const resultadoDoBloco = (bloco: object) => origem.get(bloco);

/** Chaves de filtro que a consulta aceita, lidas do próprio schema dela. */
export function chavesDeFiltro(nome: NomeConsulta): (keyof Filtros)[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const campo = (CONSULTAS[nome].args as any).shape?.filtros;
  if (!campo) return [];
  const obj = campo._def?.innerType ?? campo;
  return Object.keys(obj.shape ?? {}) as (keyof Filtros)[];
}

/**
 * Aplica os controles da tela sobre uma definição: cada consulta recebe só os filtros que aceita.
 * `undefined` num campo do controle remove o filtro. O resultado continua validado pelo schema.
 */
export function aplicarFiltros(d: VisaoDefinicao, controles: Filtros): VisaoDefinicao {
  const filtros = FiltrosSchema.parse({ ...d.filtros, ...controles });
  const blocos = d.blocos.map((b) => {
    const aceitas = chavesDeFiltro(b.consulta.nome);
    if (!aceitas.length) return b;
    const atuais = { ...((b.consulta.args.filtros as Filtros | undefined) ?? {}) };
    for (const k of aceitas)
      if (k in controles) {
        const v = controles[k];
        if (v === undefined) delete atuais[k];
        else (atuais as Record<string, unknown>)[k] = v;
      }
    return { ...b, consulta: { ...b.consulta, args: { ...b.consulta.args, filtros: atuais } } };
  });
  return VisaoDefinicaoSchema.parse({ ...d, filtros, blocos });
}

/**
 * Filtros que valem na visão: os declarados pelo modelo e, no que faltar, os que as consultas
 * realmente usaram. É o que os controles editáveis da tela mostram.
 */
export function filtrosEfetivos(d: VisaoDefinicao): Filtros {
  const out: Filtros = { ...d.filtros };
  for (const b of d.blocos) {
    const f = (b.consulta.args.filtros as Filtros | undefined) ?? {};
    for (const [k, v] of Object.entries(f))
      if (v !== undefined && !(k in out)) (out as Record<string, unknown>)[k] = v;
  }
  return FiltrosSchema.parse(out);
}

export interface BlocoResolvido {
  id: string;
  tipo: TipoBloco;
  titulo?: string;
  resultado: Resultado;
}

/**
 * Executa uma definição (salva, do histórico ou com controles alterados) sobre a carga da pessoa.
 * Cada bloco roda de novo a consulta; nada vem de número guardado.
 */
export function executarVisao(
  entrada: EntradaConsulta,
  definicao: unknown,
  controles?: Filtros,
): { definicao: VisaoDefinicao; blocos: BlocoResolvido[]; filtros: Filtros } {
  const lida = VisaoDefinicaoSchema.safeParse(definicao);
  if (!lida.success) throw new EspecificacaoRecusada("Definição de visão inválida.");
  const d = controles ? aplicarFiltros(lida.data, controles) : lida.data;
  const blocos = d.blocos.map((b) => {
    const resultado = executarConsulta(entrada, b.consulta.nome, b.consulta.args, b.id);
    return { id: b.id, tipo: b.tipo, ...(b.titulo ? { titulo: b.titulo } : {}), resultado };
  });
  return { definicao: d, blocos, filtros: filtrosEfetivos(d) };
}
