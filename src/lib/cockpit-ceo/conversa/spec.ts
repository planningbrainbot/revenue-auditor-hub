// Especificação da visão: o que o modelo pode propor e o que o servidor guarda e executa.
//
// O modelo propõe blocos de um catálogo pequeno e aponta cada um para um resultado da rodada
// ("r1", "r2"…). Ele não escreve número, HTML nem código: o schema é estrito e recusa campo a mais.
// O servidor troca cada referência pela consulta que gerou o resultado (nome + argumentos já
// validados). É essa definição que se salva: ao reabrir, as consultas rodam de novo com a permissão
// vigente, e nenhum número fica guardado como se fosse atual.
import { z } from "zod";
import { CONSULTAS, NOMES_CONSULTAS } from "./metricas.ts";
import type { NomeConsulta } from "./metricas.ts";
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
  .object({ nome: z.enum(NOMES_CONSULTAS as [NomeConsulta, ...NomeConsulta[]]), args: z.record(z.unknown()) })
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

/** Proposta do modelo → definição executável, com as consultas autorizadas desta rodada. */
export function definicaoDaProposta(
  proposta: unknown,
  registro: Map<string, Resultado>,
): VisaoDefinicao {
  const p = PropostaVisaoSchema.safeParse(proposta);
  if (!p.success)
    throw new EspecificacaoRecusada(
      `Especificação fora do schema: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}.`,
    );
  const blocos = p.data.blocos.map((b, i) => {
    const r = registro.get(b.resultado);
    if (!r) throw new EspecificacaoRecusada(`O bloco ${i + 1} aponta para ${b.resultado}, que não existe nesta conversa.`);
    if (!FORMAS_DO_BLOCO[b.tipo].includes(r.dados.forma))
      throw new EspecificacaoRecusada(`O bloco ${i + 1} (${b.tipo}) não desenha um resultado de forma ${r.dados.forma}.`);
    return {
      id: `b${i + 1}`,
      tipo: b.tipo,
      ...(b.titulo ? { titulo: b.titulo } : {}),
      consulta: { nome: r.consulta as NomeConsulta, args: r.args },
    };
  });
  if (!blocos.length) throw new EspecificacaoRecusada("A especificação não tem bloco.");
  return { versao: VERSAO_SPEC, titulo: p.data.titulo, filtros: p.data.filtros ?? {}, blocos };
}

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
