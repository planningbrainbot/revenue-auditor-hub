/* eslint-disable @typescript-eslint/no-explicit-any -- JSON do Pipedrive e do banco chega sem tipo. */
// O que foi ofertado em cada reunião da Monetização: em que minuto o trecho aparece, com que confiança, e o que vai para
// o campo "Caixa · Produtos ofertados" do pipe 39. Spec: docs/superpowers/specs/2026-10-02-monetizacao-gravacoes-tela.md.
// Sem API do Deno: roda na Edge Function, na tela (src/lib/monetizacao/gravacoes.ts) e nos testes do Node.
//
// Confiança, a partir do formato de avaliacao.ts (apurar() só deixa "sim" com trecho conferido por confere()):
// - "alta": o trecho inteiro (normalizado) está dentro de uma fala da transcrição;
// - "media": só uma janela de 12 palavras seguidas do trecho está numa fala (o modelo copiou parte, parafraseou o resto);
// - nula: o produto não foi apresentado, ou o trecho não foi achado em fala nenhuma.
// Limiar para gravar no campo do pipe: "alta". O campo só soma e nunca desfaz, então a dúvida fica de fora.
import { normal, type Fala } from "./avaliacao.ts";

export const PRODUTOS_OFERTADOS = ["cella", "consultoria", "finance"] as const;
export type ProdutoOfertado = (typeof PRODUTOS_OFERTADOS)[number];

/** "Caixa · Produtos ofertados" no pipe 39 (frente 01, 01/10/2026): campo de várias opções. */
export const CAMPO_OFERTADOS = "3298fa5361fa4a37c1b614518d6dc43b38645f8b";
export const OPCAO_DO_PRODUTO: Record<ProdutoOfertado, number> = {
  cella: 1150,
  consultoria: 1151,
  finance: 1152,
};
const PRODUTO_DA_OPCAO = new Map<number, ProdutoOfertado>(
  Object.entries(OPCAO_DO_PRODUTO).map(([p, o]) => [o, p as ProdutoOfertado]),
);

export type Confianca = "alta" | "media";
/** O mínimo para o produto ir ao campo do pipe. */
export const LIMIAR_GRAVAR: Confianca = "alta";

const JANELA = 12;
/** O mesmo piso de confere(): trecho com menos de 30 caracteres normalizados não prova nada. */
const MIN_CARACTERES = 30;

export type Localizacao = { confianca: Confianca; inicio_s: number; ordem: number };

/** Em que fala o trecho está: a fala que o contém inteiro (alta) ou a primeira com 12 palavras seguidas dele (média). */
export function localizarTrecho(
  trecho: string | null | undefined,
  falas: Fala[],
): Localizacao | null {
  const e = normal(trecho || "");
  if (e.length < MIN_CARACTERES || !falas.length) return null;
  const ordenadas = [...falas]
    .sort((a, b) => a.ordem - b.ordem)
    .map((f) => ({ f, n: normal(f.texto) }));
  const achou = (x: { f: Fala }, confianca: Confianca): Localizacao => ({
    confianca,
    inicio_s: Number(x.f.inicio_s) || 0,
    ordem: x.f.ordem,
  });
  const inteira = ordenadas.find((x) => x.n.includes(e));
  if (inteira) return achou(inteira, "alta");
  const pal = e.split(" ");
  if (pal.length < JANELA) return null;
  for (let i = 0; i + JANELA <= pal.length; i++) {
    const janela = pal.slice(i, i + JANELA).join(" ");
    const x = ordenadas.find((y) => y.n.includes(janela));
    if (x) return achou(x, "media");
  }
  return null;
}

export type ItemOfertado = {
  apresentado: "sim" | "nao";
  evidencia: string;
  confianca: Confianca | null;
  inicio_s: number | null;
};
export type OfertadoDetalhado = Record<ProdutoOfertado, ItemOfertado>;

/** O ofertado de apurar() com o minuto e a confiança de cada trecho. Produto ausente vira "nao". */
export function detalharOfertado(ofertado: any, falas: Fala[]): OfertadoDetalhado {
  const saida = {} as OfertadoDetalhado;
  for (const p of PRODUTOS_OFERTADOS) {
    const o = (ofertado && typeof ofertado === "object" ? ofertado[p] : null) || {};
    const sim = o.apresentado === "sim";
    const lugar = sim ? localizarTrecho(o.evidencia, falas) : null;
    saida[p] = {
      apresentado: sim ? "sim" : "nao",
      evidencia: sim ? String(o.evidencia || "") : "",
      confianca: lugar?.confianca ?? null,
      inicio_s: lugar?.inicio_s ?? null,
    };
  }
  return saida;
}

/** Produtos que passam do limiar. Sem confiança gravada (avaliação antiga), nada passa. */
export function produtosParaGravar(ofertado: any): ProdutoOfertado[] {
  if (!ofertado || typeof ofertado !== "object") return [];
  return PRODUTOS_OFERTADOS.filter(
    (p) => ofertado[p]?.apresentado === "sim" && ofertado[p]?.confianca === LIMIAR_GRAVAR,
  );
}

/** O valor do campo de várias opções na API v1: "1150,1152", número, lista ou nulo → ids conhecidos, sem repetição. */
export function lerOpcoes(valor: unknown): number[] {
  const brutos = Array.isArray(valor)
    ? valor
    : valor === null || valor === undefined
      ? []
      : String(valor).split(",");
  const ids = brutos
    .map((x) => Number(typeof x === "object" && x ? ((x as any).id ?? (x as any).value) : x))
    .filter((n) => PRODUTO_DA_OPCAO.has(n));
  return [...new Set(ids)].sort((a, b) => a - b);
}

export const produtosDasOpcoes = (ids: number[]) =>
  ids.map((i) => PRODUTO_DA_OPCAO.get(i)).filter((p): p is ProdutoOfertado => !!p);

/** União: o que já estava marcado continua; nada sai. */
export function uniaoDeOpcoes(atual: number[], somar: number[]): number[] {
  return [...new Set([...atual, ...somar])].sort((a, b) => a - b);
}

export type SituacaoGravacaoCampo =
  "desligado" | "ja_gravado" | "nada_a_somar" | "ja_marcado" | "gravaria" | "gravado";

export type ResultadoGravacaoCampo = {
  situacao: SituacaoGravacaoCampo;
  /** O que esta reunião somou (ou somaria, no ensaio) ao campo. */
  somados: ProdutoOfertado[];
  antes: number[] | null;
  depois: number[] | null;
};

type Pd = (
  path: string,
  params?: Record<string, string>,
  payload?: unknown,
  method?: string,
) => Promise<any>;

/**
 * Grava no card o que a reunião ofertou, se a chave estiver ligada. Idempotente: a reunião que já tem
 * `ofertados_gravados_em` não é relida, e a união com o que está no card não muda nada na segunda vez.
 * - desligado: nenhuma chamada;
 * - nenhum produto passa do limiar: nenhuma chamada ao Pipedrive (registra "nada a somar");
 * - tudo já marcado: só a leitura do card, sem PUT;
 * - senão: PUT com a união, e registra o que somou e quando.
 */
export async function gravarOfertados(o: {
  ligado: boolean;
  dry?: boolean;
  reuniao: { deal_id: number; ofertado: unknown; ofertados_gravados_em?: string | null };
  pd: Pd;
  registrar: (patch: {
    ofertados_gravados: ProdutoOfertado[];
    ofertados_gravados_em: string;
  }) => Promise<void>;
  agora?: () => Date;
}): Promise<ResultadoGravacaoCampo> {
  const vazio = { somados: [] as ProdutoOfertado[], antes: null, depois: null };
  if (!o.ligado) return { situacao: "desligado", ...vazio };
  if (o.reuniao.ofertados_gravados_em) return { situacao: "ja_gravado", ...vazio };
  const quando = () => (o.agora ? o.agora() : new Date()).toISOString();
  const produtos = produtosParaGravar(o.reuniao.ofertado);
  if (!produtos.length) {
    if (!o.dry) await o.registrar({ ofertados_gravados: [], ofertados_gravados_em: quando() });
    return { situacao: "nada_a_somar", ...vazio };
  }
  const deal = (await o.pd(`deals/${Number(o.reuniao.deal_id)}`))?.data;
  if (!deal) throw new Error(`card ${o.reuniao.deal_id} não encontrado no Pipedrive`);
  const antes = lerOpcoes(deal[CAMPO_OFERTADOS]);
  const somar = produtos.map((p) => OPCAO_DO_PRODUTO[p]).filter((id) => !antes.includes(id));
  if (!somar.length) {
    if (!o.dry) await o.registrar({ ofertados_gravados: [], ofertados_gravados_em: quando() });
    return { situacao: "ja_marcado", somados: [], antes, depois: antes };
  }
  const depois = uniaoDeOpcoes(antes, somar);
  const somados = produtosDasOpcoes(somar);
  if (o.dry) return { situacao: "gravaria", somados, antes, depois };
  await o.pd(
    `deals/${Number(o.reuniao.deal_id)}`,
    {},
    { [CAMPO_OFERTADOS]: depois.join(",") },
    "PUT",
  );
  await o.registrar({ ofertados_gravados: somados, ofertados_gravados_em: quando() });
  return { situacao: "gravado", somados, antes, depois };
}
