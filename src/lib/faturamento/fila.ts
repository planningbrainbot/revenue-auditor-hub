// A Fila da tesouraria (`/faturamento/tesouraria`, contrato `docs/design/contratos/faturamento-tesouraria.md`):
// os filtros na URL (N7), a empresa padrão, o agrupamento por dia de chegada e as colunas "Documento",
// "Onde parou" e "Próxima ação" em português. A ordem de trabalho (dia, depois erro, cancelamento, em
// conferência, OS criada, simulado, na fila) é a do banco (`ops.fat_fila_tesouraria`, API.md §1.5); a tela
// não reordena.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-fila.test.mjs.
import type {
  FichaPedido,
  FilaTesouraria,
  FiltroFila,
  HigieneFila,
  ItemFila,
  SituacaoFila,
} from "./tipos.ts";
import { diaEHora, diaMes, diaSP, horaSP, primeiroNome } from "./formato.ts";
import { eventoLegivel } from "./eventos.ts";

export type BuscaFila = {
  /** Apelido da empresa ou `todas`. */
  emissora?: string;
  situacao?: SituacaoFila;
  higiene?: HigieneFila;
  /** `AAAA-MM-DD` ou `hoje`. */
  dia?: string;
  busca?: string;
  /** Id do pedido aberto no `Sheet` (o link do `Sheet` se compartilha). */
  pedido?: string;
  /**
   * Com `situacao=para_faturar`, mostra também um grupo "Em conferência": é o "Para faturar" de Meu
   * faturamento, que conta OS criada, Simulado e Em conferência (o total bate com o número clicado).
   */
  incluir?: "em_conferencia";
};

export const SITUACOES_FILA: { valor: SituacaoFila; rotulo: string }[] = [
  { valor: "para_faturar", rotulo: "Para faturar (OS criada ou simulado)" },
  { valor: "em_conferencia", rotulo: "Em conferência" },
  { valor: "erro_omie", rotulo: "Erro no Omie" },
  { valor: "na_fila_omie", rotulo: "Na fila do Omie" },
  { valor: "cancelamento_pedido", rotulo: "Cancelamento pedido" },
  { valor: "faturado", rotulo: "Faturados" },
];

export const HIGIENES: { valor: HigieneFila; rotulo: string }[] = [
  { valor: "erro", rotulo: "Erro no Omie" },
  { valor: "vence_3d", rotulo: "Vence em até 3 dias sem nota" },
  { valor: "parado_1du", rotulo: "Parado há mais de 1 dia útil" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APELIDO = /^[A-Z0-9][A-Z0-9 _-]{0,23}$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : undefined);

/** `validateSearch` da fila. Valor fora do formato sai. */
export function lerBuscaFila(raw: Record<string, unknown>): BuscaFila {
  const out: BuscaFila = {};
  const emissora = texto(raw.emissora)?.toUpperCase();
  if (emissora === "TODAS") out.emissora = "todas";
  else if (emissora && APELIDO.test(emissora)) out.emissora = emissora;
  const situacao = texto(raw.situacao);
  if (SITUACOES_FILA.some((s) => s.valor === situacao)) out.situacao = situacao as SituacaoFila;
  const higiene = texto(raw.higiene);
  if (HIGIENES.some((h) => h.valor === higiene)) out.higiene = higiene as HigieneFila;
  const dia = texto(raw.dia);
  if (dia === "hoje" || (dia && DIA.test(dia))) out.dia = dia;
  // Número vindo de link compartilhado ("?busca=2026") chega como número: vale também.
  const busca = (typeof raw.busca === "number" ? String(raw.busca) : texto(raw.busca))?.slice(
    0,
    120,
  );
  if (busca) out.busca = busca;
  if (raw.incluir === "em_conferencia" && out.situacao === "para_faturar")
    out.incluir = "em_conferencia";
  const pedido = texto(raw.pedido);
  if (pedido && UUID.test(pedido)) out.pedido = pedido.toLowerCase();
  return out;
}

/** A busca da URL → `p_filtro` de `fat_fila_tesouraria` (a empresa vai à parte, em `p_emissora`). */
export function filtroDaFila(busca: BuscaFila): FiltroFila {
  const f: FiltroFila = {};
  if (busca.situacao) f.situacao = busca.situacao;
  if (busca.higiene) f.higiene = busca.higiene;
  if (busca.dia) f.dia = busca.dia;
  if (busca.busca) f.busca = busca.busca;
  return f;
}

/**
 * A empresa que a fila abre sem `?emissora=` (contrato, Filtros na URL): a com mais trabalho; `todas` quando
 * a pessoa tem uma só ou quando nenhuma tem trabalho.
 */
export function emissoraPadrao(emissoras: { apelido: string; trabalho: number }[]): string {
  if (emissoras.length <= 1) return "todas";
  let melhor: { apelido: string; trabalho: number } | null = null;
  for (const e of emissoras)
    if (e.trabalho > 0 && (!melhor || e.trabalho > melhor.trabalho)) melhor = e;
  return melhor ? melhor.apelido : "todas";
}

export interface GrupoDia {
  dia: string;
  rotulo: string;
  itens: ItemFila[];
}

/** "Hoje · 22/10", "Ontem · 21/10", "20/10/2026". */
export function rotuloDoDia(dia: string, hoje: string): string {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  const ontem = d.toISOString().slice(0, 10);
  if (dia === hoje) return `Hoje · ${diaMes(dia)}`;
  if (dia === ontem) return `Ontem · ${diaMes(dia)}`;
  const [a, m, x] = dia.split("-");
  return `${x}/${m}/${a}`;
}

/** Os itens agrupados por dia de chegada, na ordem que o banco mandou (o mais antigo em cima). */
export function gruposPorDia(itens: ItemFila[], hoje: string): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  for (const item of itens) {
    const dia = item.dia || (diaSP(item.chegou_em) as string);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.dia === dia) ultimo.itens.push(item);
    else grupos.push({ dia, rotulo: rotuloDoDia(dia, hoje), itens: [item] });
  }
  return grupos;
}

const DOCUMENTO: Record<string, string> = { nf: "Nota", recibo: "Recibo", nd: "ND" };

/** "Nota · 3x", "Recibo · à vista", "ND · 2x". */
export function textoDocumento(item: Pick<ItemFila, "documento" | "forma" | "parcelas">): string {
  const doc = item.documento ? (DOCUMENTO[item.documento] ?? item.documento) : "—";
  const forma =
    item.forma === "avulso" || item.parcelas === 1
      ? "à vista"
      : item.parcelas
        ? `${item.parcelas}x`
        : null;
  return forma ? `${doc} · ${forma}` : doc;
}

function quando(momento: string | null | undefined, hoje: string): string {
  if (!momento) return "";
  return diaSP(momento) === hoje ? `às ${horaSP(momento)}` : `em ${diaEHora(momento)}`;
}

/** O último fato, legível (contrato, coluna "Onde parou"). */
export function textoOndeParou(item: ItemFila, hoje: string): string {
  if (item.status === "erro_omie" && item.erro_legivel)
    return `Omie recusou: '${item.erro_legivel}'`;
  if (item.status === "em_conferencia" && item.conferido_por)
    return `Em conferência por ${primeiroNome(item.conferido_por.nome)}`;
  const o = item.onde_parou;
  if (!o) return "—";
  const legivel = eventoLegivel({
    id: 0,
    evento: o.evento,
    de: null,
    para: null,
    diff: o.motivo ? { motivo: o.motivo } : null,
    autor: o.autor,
    em: o.em,
  });
  return `${legivel.texto} ${quando(o.em, hoje)}`.trim();
}

const UM_DIA = 24 * 60 * 60 * 1000;

function vence(data: string | null, hoje: string): string | null {
  const d = diaMes(data);
  if (!d || !data) return null;
  return data < hoje ? `venceu ${d}` : `vence ${d}`;
}

/**
 * A próxima ação, verbo e data (contrato, coluna "Próxima ação"): "Conferir · vence 24/10", "Faturar · vence
 * 24/10", "Reenviar · erro desde 22/10 às 10:12", "O Omie tenta às 14:20". Erro há mais de 24 h diz isso
 * (RNF-05).
 */
export function textoProximaAcao(item: ItemFila, hoje: string, agora: Date): string {
  const a = item.proxima_acao;
  if (item.faturando)
    return a?.tentar_em ? `Faturando: o Omie tenta ${quando(a.tentar_em, hoje)}` : "Faturando…";
  switch (a?.acao) {
    case "conferir":
      return ["Conferir", vence(a.data, hoje)].filter(Boolean).join(" · ");
    case "faturar":
      return ["Faturar", vence(a.data, hoje)].filter(Boolean).join(" · ");
    case "reenviar": {
      const desde = a.desde ? diaEHora(a.desde) : null;
      const velho =
        a.desde && agora.getTime() - Date.parse(a.desde) > UM_DIA ? " · há mais de 24 h" : "";
      return `Reenviar${desde ? ` · erro desde ${desde}` : ""}${velho}`;
    }
    case "aguardar_omie":
      return a.tentar_em ? `O Omie tenta ${quando(a.tentar_em, hoje)}` : "Na fila do Omie";
    case "confirmar_cancelamento":
      return `Confirmar cancelamento${a.desde ? ` · pedido em ${diaMes(a.desde)}` : ""}`;
    default:
      if (item.pipefy_erro) return "Reenviar o card do Pipefy";
      return item.status === "faturado" ? "Faturado" : "—";
  }
}

export type BotaoFila =
  "conferir" | "faturar" | "reenviar" | "confirmar_cancelamento" | "reenviar_pipefy";

/**
 * O botão da linha: Conferir, Faturar, Reenviar ou Confirmar cancelamento. Na fila do Omie não tem botão. Sem
 * nenhum desses e com o card do Pipefy em erro, "Reenviar o card" (o `Sheet` também o oferece, na linha do
 * Pipefy, quando a linha já tem outro botão).
 */
export function botaoDaLinha(item: ItemFila): BotaoFila | null {
  if (item.faturando) return null;
  switch (item.status) {
    case "os_criada":
    case "simulado":
      return "conferir";
    case "em_conferencia":
      return "faturar";
    case "erro_omie":
      return "reenviar";
    case "cancelamento_pedido":
      return "confirmar_cancelamento";
    default:
      return item.pipefy_erro ? "reenviar_pipefy" : null;
  }
}

export const ROTULO_BOTAO: Record<BotaoFila, string> = {
  conferir: "Conferir",
  faturar: "Faturar",
  reenviar: "Reenviar",
  confirmar_cancelamento: "Confirmar cancelamento",
  reenviar_pipefy: "Reenviar o card",
};

/** Há filtro de tabela (fora a empresa e o pedido aberto)? */
export function temFiltroFila(b: BuscaFila): boolean {
  return !!(b.situacao || b.higiene || b.dia || b.busca);
}

/** "/faturamento/tesouraria?emissora=DOC&higiene=erro", sem o pedido aberto: é o `volta` da Ficha. */
export function hrefFila(b: BuscaFila): string {
  const params = new URLSearchParams();
  for (const k of ["emissora", "situacao", "incluir", "higiene", "dia", "busca"] as const) {
    const v = b[k];
    if (v) params.set(k, v);
  }
  const q = params.toString();
  return q ? `/faturamento/tesouraria?${q}` : "/faturamento/tesouraria";
}

// ------------------------------------------------------------------ releitura enquanto há algo em curso

/** A fila tem pedido faturando ou esperando o Omie? Então a tela relê sozinha (o Omie responde sem ninguém agir). */
export function filaEmCurso(f: Pick<FilaTesouraria, "itens"> | undefined): boolean {
  return !!f?.itens.some((i) => i.faturando || i.status === "na_fila_omie");
}

/** A ficha espera o Omie (na fila, faturando ou com leitura de situação pedida)? */
export function fichaEmCurso(f: Pick<FichaPedido, "pedido" | "omie"> | undefined): boolean {
  if (!f) return false;
  if (f.pedido.status === "na_fila_omie") return true;
  if (f.omie.leitura_pendente) return true;
  return (f.omie.envios ?? []).some((e) => e.status === "pendente" || e.status === "processando");
}
