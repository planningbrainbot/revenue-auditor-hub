// Recorrente do Portal de Faturamento (E2, 29/10/2026): Contratos do mês (`/faturamento/contratos`, contrato
// `docs/design/contratos/faturamento-contratos.md`) e Lista do corte (`/faturamento/corte`, contrato
// `faturamento-corte.md`). Tipos do que `ops.fat_contratos_mes`, `ops.fat_contrato_detalhe` e `ops.fat_corte`
// devolvem, rótulos e tons (um rótulo, um tom), filtros na URL (N7), números e agrupamento. A situação, o valor a
// faturar e a instrução vêm prontos do banco (receita.fat_comp_linhas): a tela só filtra, conta e agrupa.
//
// Módulo puro (sem React, sem `@/`), testado em tests/faturamento-recorrente.test.mjs.
import { dataCompleta, dinheiro, diaMes, diaSP, documento, horaSP } from "./formato.ts";

// ------------------------------------------------------------------ tipos (API)

/** Os tons do `StatusBadge` (components/planning/status-badge.tsx). */
export type TomStatus = "sucesso" | "atencao" | "perigo" | "info" | "neutro";

export type Motivo = "novo" | "valor" | "vence" | "sumiu" | "encerrado_omie";
export type SituacaoContrato =
  | "precisa_resposta"
  | "fatura_sozinho"
  | "confirmado"
  | "ajustado"
  | "nao_fatura"
  | "encerrado"
  | "sem_resposta"
  | "automacao_omie";
export type PosCorte = "faturado" | "faturado_diferente" | "faturado_fora" | "falta_faturar";
export type Instrucao = "como_esta" | "outro_valor" | "nao_faturar";
export type AcaoContrato = "renovar" | "encerrar" | "mudar_valor";
export type TipoResposta =
  "confirmar" | "ajustar" | "nao_faturar" | "renovar" | "encerrar" | "faturar_mes" | "cliente_saiu";

export type Pessoa = { id: string; nome: string | null };

export type LinhaContrato = {
  id: string;
  emissora: { id: string; apelido: string };
  codigo_contrato: number;
  numero_contrato: string | null;
  documento: string | null;
  cliente_nome: string | null;
  projeto: string | null;
  servico: string | null;
  dia_faturamento: number | null;
  data_faturamento: string;
  data_corte: string;
  responder_ate: string;
  vigencia_inicial: string | null;
  vigencia_final: string | null;
  valor_contrato: number | null;
  valor_mes_anterior: number | null;
  motivos: Motivo[];
  situacao: SituacaoContrato;
  valor_faturar: number | null;
  instrucao: Instrucao;
  acao_contrato: AcaoContrato | null;
  pos_corte: PosCorte | null;
  notas_valor: number | null;
  notas_numeros: string | null;
  aberta: boolean;
  pode_responder: boolean;
  resposta: {
    tipo: TipoResposta;
    valor: number | null;
    permanente: boolean;
    vigencia: string | null;
    motivo: string | null;
    em: string;
    por: Pessoa | null;
  } | null;
  feito_omie: { em: string; por: Pessoa | null } | null;
  repassado_para: Pessoa | null;
};

export type ProcedenciaRecorrente = {
  contratos_lidos_em: string | null;
  notas_lidas_em: string | null;
  empresas_sem_leitura_hoje: string[];
};

export type ContratosMes = {
  competencia: string;
  competencias: string[];
  inicio_portal: string;
  empresas: { id: string; apelido: string; precisa_resposta: number; contratos: number }[];
  linhas: LinhaContrato[];
  responde_por_alguma: boolean;
  ve_tudo: boolean;
  procedencia: ProcedenciaRecorrente;
};

export type DetalheContrato = LinhaContrato & {
  itens: {
    servico: string | null;
    codigo_servico: string | null;
    quantidade: number | null;
    valor_unitario: number | null;
    valor_total: number | null;
  }[];
  dia_vencimento: number | null;
  notas: {
    tipo: "nfse" | "recibo";
    numero: string | null;
    emitida_em: string;
    valor: number;
    cancelada: boolean;
  }[];
  historico: {
    evento: string;
    de: string | null;
    para: string | null;
    diff: Record<string, string | number | boolean | null>;
    em: string;
    autor: Pessoa | null;
  }[];
};

export type LinhaCorte = LinhaContrato & { motivo_nao_faturar: string | null };

export type ListaCorte = {
  dia: string | null;
  lista_aberta: boolean;
  fecha_em: string | null;
  dias: { dia: string; contratos: number }[];
  empresas: { id: string; apelido: string; contratos: number }[];
  linhas: LinhaCorte[];
  pode_marcar: boolean;
  procedencia: ProcedenciaRecorrente;
};

// ------------------------------------------------------------------ rótulos e tons

export const SITUACAO: Record<SituacaoContrato, { rotulo: string; tom: TomStatus }> = {
  precisa_resposta: { rotulo: "Precisa de resposta", tom: "atencao" },
  fatura_sozinho: { rotulo: "Fatura sozinho", tom: "neutro" },
  confirmado: { rotulo: "Confirmado", tom: "sucesso" },
  ajustado: { rotulo: "Valor ajustado", tom: "info" },
  nao_fatura: { rotulo: "Não fatura este mês", tom: "neutro" },
  encerrado: { rotulo: "Encerrado", tom: "neutro" },
  sem_resposta: { rotulo: "Sem resposta: não fatura", tom: "perigo" },
  automacao_omie: { rotulo: "Automação do Omie", tom: "neutro" },
};

export const POS_CORTE: Record<PosCorte, { rotulo: string; tom: TomStatus }> = {
  faturado: { rotulo: "Faturado", tom: "sucesso" },
  faturado_diferente: { rotulo: "Faturado diferente", tom: "perigo" },
  faturado_fora: { rotulo: "Faturado sem estar na lista", tom: "perigo" },
  falta_faturar: { rotulo: "Falta faturar", tom: "atencao" },
};

/** O selo da linha: depois do corte manda o que aconteceu no Omie; antes, a situação da resposta. */
export function seloDaLinha(l: Pick<LinhaContrato, "situacao" | "pos_corte">) {
  return l.pos_corte ? POS_CORTE[l.pos_corte] : SITUACAO[l.situacao];
}

/** Selos de "O que mudou" (contrato, tabela "O que mudou"). */
export function selosDoMotivo(
  l: LinhaContrato,
  competencia: string,
): { texto: string; tom: TomStatus }[] {
  const mesAnterior = mesAnteriorCurto(competencia);
  const out: { texto: string; tom: TomStatus }[] = [];
  for (const m of l.motivos) {
    // "novo" junta o contrato que começou agora e o antigo que não teve nota no mês anterior: só o primeiro é novo.
    if (m === "novo")
      out.push(
        l.vigencia_inicial && l.vigencia_inicial >= inicioDoMesAnterior(competencia)
          ? { texto: "Contrato novo", tom: "info" }
          : { texto: `Sem nota em ${mesAnterior}`, tom: "info" },
      );
    if (m === "valor")
      out.push({
        texto: `Era ${dinheiro(l.valor_mes_anterior)} em ${mesAnterior}`,
        tom: "atencao",
      });
    if (m === "vence")
      out.push({ texto: `Vence em ${diaMes(l.vigencia_final) ?? "—"}`, tom: "atencao" });
    if (m === "sumiu")
      out.push({ texto: `Faturou em ${mesAnterior}, sem contrato`, tom: "perigo" });
    if (m === "encerrado_omie") out.push({ texto: "Encerrado no Omie", tom: "neutro" });
  }
  return out;
}

/** "2026-11-01" → "2026-10-01". */
export function inicioDoMesAnterior(competencia: string): string {
  const [a, m] = competencia.split("-").map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, "0")}-01`;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-11-01" → "nov/2026". */
export function rotuloCompetencia(c: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(c ?? "");
  return m ? `${MESES[Number(m[2]) - 1]}/${m[1]}` : "—";
}
/** "2026-11-01" → "out" (o mês anterior, como o selo fala). */
export function mesAnteriorCurto(c: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})/.exec(c ?? "");
  if (!m) return "o mês anterior";
  return MESES[(Number(m[2]) + 10) % 12];
}

// ------------------------------------------------------------------ calendário (prazo em dias úteis)

/** Feriados nacionais (os mesmos de receita.fat_feriados). */
export const FERIADOS = new Set([
  "2026-01-01",
  "2026-04-03",
  "2026-04-21",
  "2026-05-01",
  "2026-09-07",
  "2026-10-12",
  "2026-11-02",
  "2026-11-15",
  "2026-11-20",
  "2026-12-25",
  "2027-01-01",
  "2027-03-26",
  "2027-04-21",
  "2027-05-01",
  "2027-09-07",
  "2027-10-12",
  "2027-11-02",
  "2027-11-15",
  "2027-11-20",
  "2027-12-25",
]);

function somarDia(d: string, n: number): string {
  const [a, m, x] = d.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, x + n));
  return t.toISOString().slice(0, 10);
}
const util = (d: string) => {
  const [a, m, x] = d.split("-").map(Number);
  const dow = new Date(Date.UTC(a, m - 1, x)).getUTCDay();
  return dow !== 0 && dow !== 6 && !FERIADOS.has(d);
};

/** Dias úteis de `de` (exclusive) até `ate` (inclusive); 0 quando `ate` não passa de `de`. */
export function diasUteisEntre(de: string, ate: string): number {
  let n = 0;
  for (let d = somarDia(de, 1); d <= ate; d = somarDia(d, 1)) if (util(d)) n++;
  return n;
}

/** O prazo cai em até 2 dias úteis a partir de hoje (higiene "Fecha em até 2 dias úteis"). */
export function fechaLogo(
  l: Pick<LinhaContrato, "responder_ate" | "situacao">,
  agora: Date,
): boolean {
  if (l.situacao !== "precisa_resposta") return false;
  const hoje = diaSP(agora) as string;
  const prazo = diaSP(l.responder_ate);
  return !!prazo && prazo >= hoje && diasUteisEntre(hoje, prazo) <= 2;
}

/** "12/11 23:59". */
export function textoPrazo(iso: string | null | undefined): string {
  return iso ? `${diaMes(iso) ?? "—"} ${horaSP(iso) ?? ""}`.trim() : "—";
}

// ------------------------------------------------------------------ Contratos do mês: busca na URL

export type FiltroSituacaoMes =
  "precisa_resposta" | "fatura_sozinho" | "respondidos" | "sem_resposta" | "automacao_omie";
export type HigieneMes = "prazo" | "vence" | "sumiu";

export type BuscaContratos = {
  /** `AAAA-MM`. */
  mes?: string;
  /** Apelido da empresa ou `todas`. */
  empresa?: string;
  projeto?: string;
  motivo?: Motivo;
  situacao?: FiltroSituacaoMes;
  higiene?: HigieneMes;
  /** Dia de faturamento (1 a 31). */
  dia?: number;
  busca?: string;
  /** Id da linha aberta no `Sheet`. */
  contrato?: string;
};

export const SITUACOES_MES: { valor: FiltroSituacaoMes; rotulo: string }[] = [
  { valor: "precisa_resposta", rotulo: "Precisam de resposta" },
  { valor: "fatura_sozinho", rotulo: "Faturam sozinhos" },
  { valor: "respondidos", rotulo: "Respondidos" },
  { valor: "sem_resposta", rotulo: "Sem resposta: não faturam" },
  { valor: "automacao_omie", rotulo: "Automação do Omie" },
];
export const MOTIVOS: { valor: Motivo; rotulo: string }[] = [
  { valor: "novo", rotulo: "Contrato novo" },
  { valor: "valor", rotulo: "Valor diferente" },
  { valor: "vence", rotulo: "Vence neste mês" },
  { valor: "sumiu", rotulo: "Faturou e sumiu" },
  { valor: "encerrado_omie", rotulo: "Encerrado no Omie" },
];
export const HIGIENES_MES: { valor: HigieneMes; rotulo: string }[] = [
  { valor: "prazo", rotulo: "Fecha em até 2 dias úteis" },
  { valor: "vence", rotulo: "Vence neste mês" },
  { valor: "sumiu", rotulo: "Faturou e sumiu" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APELIDO = /^[A-Z0-9][A-Z0-9 _-]{0,23}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v: unknown) =>
  typeof v === "string" ? v.trim() || undefined : typeof v === "number" ? String(v) : undefined;

/** `validateSearch` de Contratos do mês. Valor fora do formato sai. */
export function lerBuscaContratos(raw: Record<string, unknown>): BuscaContratos {
  const out: BuscaContratos = {};
  const mes = texto(raw.mes);
  if (mes && MES.test(mes)) out.mes = mes;
  const empresa = texto(raw.empresa)?.toUpperCase();
  if (empresa === "TODAS") out.empresa = "todas";
  else if (empresa && APELIDO.test(empresa)) out.empresa = empresa;
  const projeto = texto(raw.projeto)?.slice(0, 200);
  if (projeto) out.projeto = projeto;
  const motivo = texto(raw.motivo);
  if (MOTIVOS.some((m) => m.valor === motivo)) out.motivo = motivo as Motivo;
  const situacao = texto(raw.situacao);
  if (SITUACOES_MES.some((s) => s.valor === situacao)) out.situacao = situacao as FiltroSituacaoMes;
  const higiene = texto(raw.higiene);
  if (HIGIENES_MES.some((h) => h.valor === higiene)) out.higiene = higiene as HigieneMes;
  const dia = Number(texto(raw.dia));
  if (Number.isInteger(dia) && dia >= 1 && dia <= 31) out.dia = dia;
  const busca = texto(raw.busca)?.slice(0, 120);
  if (busca) out.busca = busca;
  const contrato = texto(raw.contrato);
  if (contrato && UUID.test(contrato)) out.contrato = contrato.toLowerCase();
  return out;
}

export function temFiltroContratos(b: BuscaContratos): boolean {
  return !!(b.projeto || b.motivo || b.situacao || b.higiene || b.dia || b.busca);
}

const RESPONDIDOS: ReadonlySet<SituacaoContrato> = new Set([
  "confirmado",
  "ajustado",
  "nao_fatura",
  "encerrado",
]);

const normal = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca livre: cliente, CNPJ (com ou sem máscara) ou número do contrato. */
export function casaBusca(l: LinhaContrato, busca: string): boolean {
  const b = normal(busca.trim());
  if (!b) return true;
  const digitos = b.replace(/[^0-9a-z]/g, "");
  return (
    normal(l.cliente_nome ?? "").includes(b) ||
    normal(l.numero_contrato ?? "").includes(b) ||
    normal(l.projeto ?? "").includes(b) ||
    (!!digitos && digitos.length >= 3 && (l.documento ?? "").toLowerCase().includes(digitos))
  );
}

/** As linhas da tabela com os filtros da URL (a empresa já veio recortada). */
export function filtrarContratos(
  linhas: LinhaContrato[],
  b: BuscaContratos,
  agora: Date,
): LinhaContrato[] {
  return linhas.filter((l) => {
    if (b.projeto && (l.projeto ?? "Sem projeto") !== b.projeto) return false;
    if (b.motivo && !l.motivos.includes(b.motivo)) return false;
    if (b.dia && l.dia_faturamento !== b.dia) return false;
    if (
      b.situacao === "respondidos"
        ? !RESPONDIDOS.has(l.situacao)
        : b.situacao && l.situacao !== b.situacao
    )
      return false;
    if (b.higiene === "prazo" && !fechaLogo(l, agora)) return false;
    if (b.higiene === "vence" && !l.motivos.includes("vence")) return false;
    if (b.higiene === "sumiu" && !l.motivos.includes("sumiu")) return false;
    if (b.busca && !casaBusca(l, b.busca)) return false;
    return true;
  });
}

const soma = (ls: LinhaContrato[], f: (l: LinhaContrato) => number | null) =>
  Math.round(ls.reduce((s, l) => s + (f(l) ?? 0), 0) * 100) / 100;

/** Os três números (Ritmo) e a higiene, sobre as linhas da empresa escolhida, sem os outros filtros. */
export function numerosDoMes(linhas: LinhaContrato[], agora: Date) {
  const precisa = linhas.filter((l) => l.situacao === "precisa_resposta");
  const sozinhos = linhas.filter((l) => l.situacao === "fatura_sozinho");
  const respondidos = linhas.filter((l) => RESPONDIDOS.has(l.situacao));
  return {
    precisa_resposta: { quantidade: precisa.length, valor: soma(precisa, (l) => l.valor_contrato) },
    fatura_sozinho: { quantidade: sozinhos.length, valor: soma(sozinhos, (l) => l.valor_contrato) },
    respondidos: {
      quantidade: respondidos.length,
      valor: soma(respondidos, (l) => l.valor_faturar),
    },
    higiene: {
      prazo: linhas.filter((l) => fechaLogo(l, agora)).length,
      vence: linhas.filter((l) => l.motivos.includes("vence")).length,
      sumiu: linhas.filter((l) => l.motivos.includes("sumiu")).length,
    },
  };
}

export type GrupoProjeto = {
  projeto: string;
  linhas: LinhaContrato[];
  mes_anterior: number;
  este_mes: number;
  precisa: number;
};

const ORDEM_TRABALHO = (l: LinhaContrato) =>
  l.situacao === "precisa_resposta" ? 0 : l.situacao === "sem_resposta" ? 1 : 2;

/**
 * Agrupa por projeto (o "grupo" do cliente no Omie). Grupos com resposta pendente primeiro; dentro do grupo,
 * o que precisa de resposta com o prazo mais curto antes, depois o resto por valor (contrato, Anatomia 6). A
 * automação do Omie vai num grupo à parte, recolhido.
 */
export function gruposPorProjeto(linhas: LinhaContrato[]): {
  grupos: GrupoProjeto[];
  automacao: LinhaContrato[];
} {
  const automacao = linhas.filter((l) => l.situacao === "automacao_omie");
  const mapa = new Map<string, LinhaContrato[]>();
  for (const l of linhas) {
    if (l.situacao === "automacao_omie") continue;
    const k = l.projeto ?? "Sem projeto";
    mapa.set(k, [...(mapa.get(k) ?? []), l]);
  }
  const grupos = [...mapa.entries()].map(([projeto, ls]) => ({
    projeto,
    linhas: [...ls].sort(
      (a, b) =>
        ORDEM_TRABALHO(a) - ORDEM_TRABALHO(b) ||
        (ORDEM_TRABALHO(a) === 0 ? a.responder_ate.localeCompare(b.responder_ate) : 0) ||
        (b.valor_contrato ?? 0) - (a.valor_contrato ?? 0),
    ),
    mes_anterior: soma(ls, (l) => l.valor_mes_anterior),
    este_mes: soma(ls, (l) => l.valor_faturar ?? l.valor_contrato),
    precisa: ls.filter((l) => l.situacao === "precisa_resposta").length,
  }));
  grupos.sort(
    (a, b) =>
      (b.precisa > 0 ? 1 : 0) - (a.precisa > 0 ? 1 : 0) ||
      (a.projeto === "Sem projeto" ? 1 : 0) - (b.projeto === "Sem projeto" ? 1 : 0) ||
      a.projeto.localeCompare(b.projeto, "pt-BR"),
  );
  return { grupos, automacao };
}

/** Diferença deste mês contra o anterior, em R$ e %; nula quando não há o que comparar ou não mudou. */
export function diferenca(l: LinhaContrato): { valor: number; pct: number | null } | null {
  const agora = l.valor_faturar ?? l.valor_contrato;
  const antes = l.valor_mes_anterior;
  if (agora === null || antes === null || Math.abs(agora - antes) <= 0.01) return null;
  return {
    valor: Math.round((agora - antes) * 100) / 100,
    pct: antes > 0 ? (agora - antes) / antes : null,
  };
}

export function textoDiferenca(d: { valor: number; pct: number | null } | null): string {
  if (!d) return "—";
  const sinal = d.valor > 0 ? "+" : "−";
  const pct = d.pct === null ? "" : ` (${sinal}${Math.abs(Math.round(d.pct * 100))}%)`;
  return `${sinal}${dinheiro(Math.abs(d.valor))}${pct}`;
}

/** Respostas que o `Sheet` oferece para a linha (contrato, `Sheet` do contrato). */
export function respostasDaLinha(l: Pick<LinhaContrato, "motivos">): TipoResposta[] {
  const sumiu = l.motivos.includes("sumiu");
  const vence = l.motivos.includes("vence");
  const out: TipoResposta[] = [];
  if (sumiu) out.push("faturar_mes", "renovar", "cliente_saiu");
  else {
    out.push("confirmar", "ajustar", "nao_faturar");
    if (vence) out.push("renovar", "encerrar");
  }
  if (!sumiu && !out.includes("cliente_saiu")) out.push("cliente_saiu");
  return out;
}

export const ROTULO_RESPOSTA: Record<TipoResposta, string> = {
  confirmar: "Confirmar",
  ajustar: "Ajustar o valor deste mês",
  nao_faturar: "Não faturar este mês",
  renovar: "Renovado até",
  encerrar: "Encerrar o contrato depois deste mês",
  faturar_mes: "Faturar este mês",
  cliente_saiu: "Cliente saiu",
};

/** O que a resposta pede antes de salvar (o banco confere de novo). */
export function faltaNaResposta(
  tipo: TipoResposta,
  campos: { valor?: string; motivo?: string; vigencia?: string },
  dataFaturamento: string,
): string | null {
  const valor = Number((campos.valor ?? "").replace(/\./g, "").replace(",", "."));
  const motivo = (campos.motivo ?? "").trim();
  if ((tipo === "ajustar" || tipo === "faturar_mes") && !(valor > 0))
    return "Informe o valor deste mês.";
  if ((tipo === "ajustar" || tipo === "nao_faturar" || tipo === "faturar_mes") && !motivo)
    return "Escreva o motivo.";
  if (tipo === "renovar") {
    const v = campos.vigencia ?? "";
    if (!DIA.test(v)) return "Informe a nova vigência final.";
    if (v < dataFaturamento) return "A nova vigência precisa ir além deste faturamento.";
  }
  return null;
}

/** "1.234,56" ou "1234.56" → número; nulo quando não é valor. */
export function valorDigitado(v: string | undefined): number | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

// ------------------------------------------------------------------ Lista do corte

export type FiltroInstrucao = Instrucao | "contrato";

export type BuscaCorte = {
  dia?: string;
  empresa?: string;
  instrucao?: FiltroInstrucao;
  situacao?: PosCorte;
  busca?: string;
  contrato?: string;
};

export const INSTRUCOES: { valor: FiltroInstrucao; rotulo: string }[] = [
  { valor: "como_esta", rotulo: "Faturar como está" },
  { valor: "outro_valor", rotulo: "Faturar com outro valor" },
  { valor: "nao_faturar", rotulo: "Não faturar" },
  { valor: "contrato", rotulo: "Atualizar o contrato no Omie" },
];
export const HIGIENES_CORTE: { valor: Exclude<PosCorte, "faturado">; rotulo: string }[] = [
  { valor: "falta_faturar", rotulo: "Falta faturar" },
  { valor: "faturado_diferente", rotulo: "Faturado diferente" },
  { valor: "faturado_fora", rotulo: "Faturado sem estar na lista" },
];

export function lerBuscaCorte(raw: Record<string, unknown>): BuscaCorte {
  const out: BuscaCorte = {};
  const dia = texto(raw.dia);
  if (dia && DIA.test(dia)) out.dia = dia;
  const empresa = texto(raw.empresa)?.toUpperCase();
  if (empresa === "TODAS") out.empresa = "todas";
  else if (empresa && APELIDO.test(empresa)) out.empresa = empresa;
  const instrucao = texto(raw.instrucao);
  if (INSTRUCOES.some((i) => i.valor === instrucao)) out.instrucao = instrucao as FiltroInstrucao;
  const situacao = texto(raw.situacao);
  if (HIGIENES_CORTE.some((h) => h.valor === situacao)) out.situacao = situacao as PosCorte;
  const busca = texto(raw.busca)?.slice(0, 120);
  if (busca) out.busca = busca;
  const contrato = texto(raw.contrato);
  if (contrato && UUID.test(contrato)) out.contrato = contrato.toLowerCase();
  return out;
}

export function temFiltroCorte(b: BuscaCorte): boolean {
  return !!(b.instrucao || b.situacao || b.busca);
}

export function filtrarCorte(linhas: LinhaCorte[], b: BuscaCorte): LinhaCorte[] {
  return linhas.filter((l) => {
    if (b.instrucao === "contrato" ? !l.acao_contrato : b.instrucao && l.instrucao !== b.instrucao)
      return false;
    if (b.situacao && l.pos_corte !== b.situacao) return false;
    if (b.busca && !casaBusca(l, b.busca)) return false;
    return true;
  });
}

export function numerosDoCorte(linhas: LinhaCorte[]) {
  const de = (i: Instrucao) => linhas.filter((l) => l.instrucao === i);
  const como = de("como_esta");
  const outro = de("outro_valor");
  return {
    como_esta: { quantidade: como.length, valor: soma(como, (l) => l.valor_faturar) },
    outro_valor: { quantidade: outro.length, valor: soma(outro, (l) => l.valor_faturar) },
    // Enquanto o dono pode responder, a linha não está decidida: fica fora do "Não faturar" e conta à parte.
    nao_faturar: {
      quantidade: de("nao_faturar").filter((l) => l.situacao !== "precisa_resposta").length,
      aguardando: linhas.filter((l) => l.situacao === "precisa_resposta").length,
    },
    higiene: {
      falta_faturar: linhas.filter((l) => l.pos_corte === "falta_faturar").length,
      faturado_diferente: linhas.filter((l) => l.pos_corte === "faturado_diferente").length,
      faturado_fora: linhas.filter((l) => l.pos_corte === "faturado_fora").length,
    },
  };
}

/** Grupos por empresa, na ordem da RPC (não faturar, outro valor, instrução de contrato, como está). */
export function gruposPorEmpresa(
  linhas: LinhaCorte[],
): { apelido: string; linhas: LinhaCorte[] }[] {
  const mapa = new Map<string, LinhaCorte[]>();
  for (const l of linhas)
    mapa.set(l.emissora.apelido, [...(mapa.get(l.emissora.apelido) ?? []), l]);
  return [...mapa.entries()].map(([apelido, ls]) => ({ apelido, linhas: ls }));
}

/** A instrução em português (contrato, "Instrução da linha"). */
export function textoInstrucao(l: LinhaCorte): string {
  const quem = l.resposta?.por?.nome ? ` · ${l.resposta.por.nome}` : "";
  if (l.situacao === "precisa_resposta")
    return `Aguardando o dono · responde até ${textoPrazo(l.responder_ate)}`;
  if (l.instrucao === "nao_faturar")
    return `Não faturar · ${l.motivo_nao_faturar ?? "sem motivo"}${l.situacao === "sem_resposta" ? "" : quem}`;
  if (l.instrucao === "outro_valor")
    return `Faturar ${dinheiro(l.valor_faturar)} (contrato: ${dinheiro(l.valor_contrato)})${l.resposta?.motivo ? ` · ${l.resposta.motivo}` : ""}`;
  return `Faturar como está · ${dinheiro(l.valor_faturar)}`;
}

export function textoAcaoContrato(l: LinhaContrato): string | null {
  if (l.acao_contrato === "renovar")
    return `Mudar a vigência para ${dataCompleta(l.resposta?.vigencia) ?? "—"}`;
  if (l.acao_contrato === "encerrar") return "Encerrar o contrato no Omie";
  if (l.acao_contrato === "mudar_valor")
    return `Mudar o valor do contrato para ${dinheiro(l.resposta?.valor ?? null)}`;
  return null;
}

/** Quem respondeu, para a coluna da lista do corte. */
export function textoQuemRespondeu(l: LinhaContrato): string {
  if (l.resposta)
    return `${l.resposta.por?.nome ?? "—"} · ${diaMes(l.resposta.em) ?? ""} ${horaSP(l.resposta.em) ?? ""}`.trim();
  if (l.situacao === "fatura_sozinho") return "Sem mudança";
  if (l.situacao === "sem_resposta") return "Ninguém respondeu";
  return "—";
}

/** O que aconteceu depois do corte, em palavras ("Faturado (NF 4321)"). */
export function textoPosCorte(l: LinhaContrato, listaAberta: boolean): string {
  if (!l.pos_corte) return listaAberta ? "Na lista" : "Na lista · aguardando nota";
  const r = POS_CORTE[l.pos_corte].rotulo;
  if (l.pos_corte === "faturado") return `${r} (${l.notas_numeros ?? "nota"})`;
  if (l.pos_corte === "faturado_diferente")
    return `${r}: ${dinheiro(l.notas_valor)} em vez de ${dinheiro(l.valor_faturar)}`;
  if (l.pos_corte === "faturado_fora") return `${r}: ${dinheiro(l.notas_valor)}`;
  return r;
}

/** CSV de uma empresa para trabalhar ao lado do Omie (contrato, "Baixar a lista"). Separador `;` (Excel pt-BR). */
export function csvDoCorte(linhas: LinhaCorte[]): string {
  const cel = (v: unknown) => {
    const s = String(v ?? "");
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const num = (v: number | null) => (v === null ? "" : v.toFixed(2).replace(".", ","));
  const cab = [
    "Empresa",
    "Contrato",
    "Cliente",
    "CNPJ/CPF",
    "Valor do contrato",
    "Faturar",
    "Instrução",
    "Contrato no Omie",
  ];
  const linhasCsv = linhas.map((l) =>
    [
      l.emissora.apelido,
      l.numero_contrato ?? l.codigo_contrato,
      l.cliente_nome,
      documento(l.documento),
      num(l.valor_contrato),
      num(l.valor_faturar),
      textoInstrucao(l),
      textoAcaoContrato(l) ?? "",
    ]
      .map(cel)
      .join(";"),
  );
  return [cab.join(";"), ...linhasCsv].join("\n");
}

/** Procedência da página: quando os contratos e as notas foram lidos, e quem ficou sem leitura hoje. */
export function procedenciaRecorrente(p: ProcedenciaRecorrente | undefined): string {
  if (!p) return "Portal de Faturamento · contratos e notas do Omie";
  const partes = [
    p.contratos_lidos_em
      ? `Contratos lidos do Omie em ${diaMes(p.contratos_lidos_em)} às ${horaSP(p.contratos_lidos_em)}`
      : "Contratos ainda não lidos do Omie",
    p.notas_lidas_em
      ? `notas lidas em ${diaMes(p.notas_lidas_em)} às ${horaSP(p.notas_lidas_em)}`
      : "notas ainda não lidas",
  ];
  return `Portal de Faturamento · ${partes.join(" · ")}`;
}
