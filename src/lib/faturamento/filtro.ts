// Filtros do Portal de Faturamento na URL (N7) e a ida e volta entre a URL e o `p_filtro` do banco.
//
// - `lerBuscaPedidos` / `lerBuscaMeuFaturamento`: o `validateSearch` das rotas. Valor fora do formato sai;
//   o padrão não fica na URL, para o link limpo continuar sendo o da tela sem filtro.
// - `filtroDaBusca`: a URL de Pedidos vira o `p_filtro` de `ops.fat_pedidos` (apelido da empresa → id).
// - `buscaDoFiltro`: o `filtro` que `fat_contexto` e `fat_resumo` devolvem vira a URL de Pedidos. É o
//   drill-down de cada número de Meu faturamento: o filtro vai inteiro, e a soma de lá bate (N2).
//
// Na URL as listas vão separadas por vírgula (`?situacao=aguardando_ok,simulado`, `?emissora=DOC,PIS`),
// como o contrato pede. Módulo puro (sem React, sem `@/`), testado em tests/faturamento-filtro.test.mjs.
import type {
  EmissoraRef,
  FiltroPedidos,
  OrdemPedidos,
  Pendencia,
  Regua,
  ReguaMes,
  SituacaoFiltro,
} from "./tipos.ts";
import { ehSituacao } from "./tipos.ts";
import { PENDENCIA, rotuloSituacaoFiltro } from "./rotulos.ts";
import { rotuloMes } from "./formato.ts";

// As buscas são `type`, e não `interface`: a rota recebe a busca como `Record<string, unknown>`
// (SearchSchemaInput), e só o tipo literal tem a assinatura de índice implícita que isso pede.

/** A busca da tela Pedidos (`/faturamento/pedidos`), contrato §3 "Filtros na URL". */
export type BuscaPedidos = {
  /** Situações separadas por vírgula; `a_faturar` vale pelo grupo do card. */
  situacao?: string;
  pendencia?: Pendencia;
  /** Apelidos separados por vírgula. */
  emissora?: string;
  /** Id da pessoa dona. */
  dono?: string;
  /** `AAAA-MM`, sempre com uma régua de mês. */
  mes?: string;
  regua?: Regua;
  simulacao?: "sim" | "nao";
  busca?: string;
  ordem?: OrdemTela;
  pagina?: number;
};

/** A busca de Meu faturamento (`/faturamento`), contrato §2. */
export type BuscaMeuFaturamento = {
  mes?: string;
  emissora?: string;
};

/** As ordens que a tela oferece (contrato §3). O banco aceita também `numero`. */
export type OrdemTela = Extract<OrdemPedidos, "atualizado" | "valor" | "vencimento">;
export const ORDENS: { valor: OrdemTela; rotulo: string }[] = [
  { valor: "atualizado", rotulo: "Mais recentes" },
  { valor: "valor", rotulo: "Maior valor" },
  { valor: "vencimento", rotulo: "Vencimento mais próximo" },
];

export const POR_PAGINA = 50;

const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APELIDO = /^[A-Z0-9_-]{1,24}$/;
const REGUAS_MES: ReguaMes[] = ["competencia", "nota", "pagamento"];

function texto(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

/** Lista da URL: aceita "a,b" e ["a","b"]; tira vazio e repetido. */
function lista(v: unknown): string[] {
  const bruto = Array.isArray(v)
    ? v
        .map(texto)
        .filter((x): x is string => !!x)
        .join(",")
    : texto(v);
  if (!bruto) return [];
  const itens = bruto
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(itens)];
}

function situacoesValidas(v: unknown): SituacaoFiltro[] {
  return lista(v).filter((s): s is SituacaoFiltro => s === "a_faturar" || ehSituacao(s));
}

function apelidosValidos(v: unknown): string[] {
  return [...new Set(lista(v).map((s) => s.toUpperCase()))].filter((s) => APELIDO.test(s));
}

function pendenciaValida(v: unknown): Pendencia | undefined {
  const s = texto(v);
  return s && s in PENDENCIA ? (s as Pendencia) : undefined;
}

function reguaValida(v: unknown): Regua | undefined {
  const s = texto(v);
  return s === "atraso" || REGUAS_MES.includes(s as ReguaMes) ? (s as Regua) : undefined;
}

/**
 * `validateSearch` de `/faturamento/pedidos`. Regras do par mês e régua (API.md §1.3): `atraso` não leva
 * mês; mês sem régua vale por competência; régua de mês sem mês sai.
 */
export function lerBuscaPedidos(raw: Record<string, unknown>): BuscaPedidos {
  const out: BuscaPedidos = {};

  const situacao = situacoesValidas(raw.situacao);
  if (situacao.length) out.situacao = situacao.join(",");

  const pendencia = pendenciaValida(raw.pendencia);
  if (pendencia) out.pendencia = pendencia;

  const emissora = apelidosValidos(raw.emissora);
  if (emissora.length) out.emissora = emissora.join(",");

  const dono = texto(raw.dono);
  if (dono && UUID.test(dono)) out.dono = dono.toLowerCase();

  const mes = texto(raw.mes);
  const regua = reguaValida(raw.regua);
  if (regua === "atraso") out.regua = "atraso";
  else if (mes && MES.test(mes)) {
    out.mes = mes;
    out.regua = regua ?? "competencia";
  }

  const sim = texto(raw.simulacao);
  if (sim === "sim" || sim === "true") out.simulacao = "sim";
  else if (sim === "nao" || sim === "false") out.simulacao = "nao";

  const busca = texto(raw.busca)?.trim().slice(0, 120);
  if (busca) out.busca = busca;

  const ordem = texto(raw.ordem);
  if (ordem === "valor" || ordem === "vencimento") out.ordem = ordem;

  const pagina = Number(texto(raw.pagina));
  if (Number.isInteger(pagina) && pagina > 1 && pagina <= 100_000) out.pagina = pagina;

  return out;
}

/** `validateSearch` de `/faturamento` (Meu faturamento). O mês padrão (o corrente) não fica na URL. */
export function lerBuscaMeuFaturamento(raw: Record<string, unknown>): BuscaMeuFaturamento {
  const out: BuscaMeuFaturamento = {};
  const mes = texto(raw.mes);
  if (mes && MES.test(mes)) out.mes = mes;
  const emissora = apelidosValidos(raw.emissora);
  if (emissora.length) out.emissora = emissora.join(",");
  return out;
}

/**
 * Apelidos da URL → ids do recorte. `desconhecidas` são apelidos que não estão no recorte de quem abre:
 * a tela não os troca por "todas" (o que mostraria pedido de empresa que a pessoa não pediu para ver).
 */
export function idsDasEmissoras(
  apelidos: string | undefined,
  emissoras: EmissoraRef[],
): { ids: string[]; desconhecidas: string[] } {
  const pedidos = apelidosValidos(apelidos);
  const porApelido = new Map(emissoras.map((e) => [e.apelido.toUpperCase(), e.id]));
  const ids: string[] = [];
  const desconhecidas: string[] = [];
  for (const a of pedidos) {
    const id = porApelido.get(a);
    if (id) ids.push(id);
    else desconhecidas.push(a);
  }
  return { ids, desconhecidas };
}

/**
 * A URL de Pedidos → `p_filtro` de `ops.fat_pedidos`. Só põe as chaves que têm valor (o banco recusa
 * chave desconhecida e aplica o padrão às ausentes).
 */
export function filtroDaBusca(
  busca: BuscaPedidos,
  emissoras: EmissoraRef[],
  porPagina: number = POR_PAGINA,
): { filtro: FiltroPedidos; desconhecidas: string[] } {
  const filtro: FiltroPedidos = {};
  const situacao = situacoesValidas(busca.situacao);
  if (situacao.length) filtro.situacao = situacao;
  if (busca.pendencia) filtro.pendencia = busca.pendencia;

  const { ids, desconhecidas } = idsDasEmissoras(busca.emissora, emissoras);
  if (ids.length) filtro.emissoras = ids;

  if (busca.dono) filtro.dono = busca.dono;
  if (busca.regua === "atraso") filtro.regua = "atraso";
  else if (busca.mes) {
    filtro.mes = busca.mes;
    filtro.regua = busca.regua ?? "competencia";
  }
  if (busca.simulacao) filtro.simulacao = busca.simulacao === "sim";
  if (busca.busca) filtro.busca = busca.busca;
  if (busca.ordem) filtro.ordem = busca.ordem;
  filtro.pagina = busca.pagina ?? 1;
  filtro.por_pagina = porPagina;
  return { filtro, desconhecidas };
}

/**
 * O `filtro` de um número (de `fat_resumo` ou `fat_contexto`) → a URL de Pedidos. `extra.emissora` é o
 * recorte de empresa da tela de origem, que vai junto quando o próprio filtro não traz empresa (sem ele o
 * destino somaria todas as empresas e não bateria com o card).
 */
export function buscaDoFiltro(
  filtro: FiltroPedidos,
  emissoras: EmissoraRef[],
  extra: { emissora?: string } = {},
): BuscaPedidos {
  const bruto: Record<string, unknown> = {};
  if (filtro.situacao?.length) bruto.situacao = filtro.situacao.join(",");
  if (filtro.pendencia) bruto.pendencia = filtro.pendencia;
  if (filtro.emissoras?.length) {
    const porId = new Map(emissoras.map((e) => [e.id, e.apelido]));
    const apelidos = filtro.emissoras.map((id) => porId.get(id)).filter((a): a is string => !!a);
    if (apelidos.length) bruto.emissora = apelidos.join(",");
  } else if (extra.emissora) {
    bruto.emissora = extra.emissora;
  }
  if (filtro.dono) bruto.dono = filtro.dono;
  if (filtro.mes) bruto.mes = filtro.mes;
  if (filtro.regua) bruto.regua = filtro.regua;
  if (typeof filtro.simulacao === "boolean") bruto.simulacao = filtro.simulacao ? "sim" : "nao";
  if (filtro.busca) bruto.busca = filtro.busca;
  if (filtro.ordem) bruto.ordem = filtro.ordem;
  return lerBuscaPedidos(bruto);
}

/** "/faturamento/pedidos?situacao=a_faturar&emissora=DOC", para `KpiCard.abrir.href` e links. */
export function hrefPedidos(busca: BuscaPedidos): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(busca)) {
    if (v === undefined || v === null || v === "") continue;
    params.set(k, String(v));
  }
  const q = params.toString();
  return q ? `/faturamento/pedidos?${q}` : "/faturamento/pedidos";
}

// ------------------------------------------------------------------ leitura dos filtros

/** O período da busca, com a régua dita (o chip e a `descricao` dizem qual data conta). */
export function frasePeriodo(busca: Pick<BuscaPedidos, "mes" | "regua">): string | null {
  if (busca.regua === "atraso") return "Parcela em atraso hoje";
  if (!busca.mes) return null;
  const mes = rotuloMes(busca.mes);
  switch (busca.regua) {
    case "nota":
      return `Nota emitida em ${mes}`;
    case "pagamento":
      return `Pago em ${mes}`;
    default:
      return `Competência ${mes}`;
  }
}

export type ChaveChip =
  "situacao" | "pendencia" | "emissora" | "dono" | "periodo" | "simulacao" | "busca";

export interface Chip {
  chave: ChaveChip;
  rotulo: string;
  valor: string;
  /** Chaves da URL que o "×" do chip tira. */
  remove: (keyof BuscaPedidos)[];
}

/** Os chips removíveis dos filtros ativos (contrato §3, `BarraFiltros`). */
export function chipsDaBusca(
  busca: BuscaPedidos,
  nomeDoDono?: (id: string) => string | null,
): Chip[] {
  const chips: Chip[] = [];
  const situacao = situacoesValidas(busca.situacao);
  if (situacao.length)
    chips.push({
      chave: "situacao",
      rotulo: "Situação",
      valor: situacao.map(rotuloSituacaoFiltro).join(", "),
      remove: ["situacao"],
    });
  if (busca.pendencia)
    chips.push({
      chave: "pendencia",
      rotulo: "Pendência",
      valor: PENDENCIA[busca.pendencia],
      remove: ["pendencia"],
    });
  if (busca.emissora)
    chips.push({
      chave: "emissora",
      rotulo: "Empresa",
      valor: lista(busca.emissora).join(", "),
      remove: ["emissora"],
    });
  if (busca.dono)
    chips.push({
      chave: "dono",
      rotulo: "Dono",
      valor: nomeDoDono?.(busca.dono) ?? "pessoa escolhida",
      remove: ["dono"],
    });
  const periodo = frasePeriodo(busca);
  if (periodo)
    chips.push({ chave: "periodo", rotulo: "Período", valor: periodo, remove: ["mes", "regua"] });
  if (busca.simulacao)
    chips.push({
      chave: "simulacao",
      rotulo: "Simulação",
      valor: busca.simulacao === "sim" ? "só simulados" : "sem simulados",
      remove: ["simulacao"],
    });
  if (busca.busca)
    chips.push({ chave: "busca", rotulo: "Busca", valor: busca.busca, remove: ["busca"] });
  return chips;
}

/** A coluna de parcelas que a régua acende: "Pago no mês" ou "Em atraso" (contrato §3, Colunas). */
export function colunaParcelas(
  busca: Pick<BuscaPedidos, "regua">,
): "pago_no_mes" | "em_atraso" | null {
  if (busca.regua === "pagamento") return "pago_no_mes";
  if (busca.regua === "atraso") return "em_atraso";
  return null;
}

/** Há algum filtro de recorte (fora ordem e página)? */
export function temFiltro(busca: BuscaPedidos): boolean {
  return chipsDaBusca(busca).length > 0;
}

// ------------------------------------------------------------------ navegação entre as telas

/**
 * O `volta` da Ficha (`/faturamento/pedido/$id?volta=`): o caminho e os filtros da tela de origem. Só vale
 * caminho da própria área, para o link de volta nunca levar para fora (nada de `//outro-site` nem URL
 * absoluta).
 */
export function lerVolta(v: unknown): string | undefined {
  if (typeof v !== "string" || v.length > 2000) return undefined;
  if (!/^\/faturamento(\/|\?|$)/.test(v) || v.startsWith("//") || v.includes("\\"))
    return undefined;
  return v;
}

/** Os parâmetros do formulário (`/faturamento/novo`): o pedido (rascunho ou devolvido) e a empresa. */
export function lerBuscaNovo(raw: Record<string, unknown>): { pedido?: string; emissora?: string } {
  const out: { pedido?: string; emissora?: string } = {};
  const pedido = texto(raw.pedido);
  if (pedido && UUID.test(pedido)) out.pedido = pedido.toLowerCase();
  const [emissora] = apelidosValidos(raw.emissora);
  if (emissora) out.emissora = emissora;
  return out;
}
