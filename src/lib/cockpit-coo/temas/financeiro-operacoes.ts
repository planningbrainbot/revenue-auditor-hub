// Ter · Financeiro e Operações: "O negócio se sustenta, para onde aponta o caixa e a entrega está
// andando?"
//
// Pedido do COO em 29/09/2026: "projeção da DRE e para onde está apontando o nosso caixa. O mais
// importante no financeiro é garantir a sustentabilidade do negócio e acompanhar a exposição de
// caixa."
//
// Arquivo PURO: sem I/O e só imports relativos com extensão (os testes rodam no Node removendo
// tipos). Quem lê é `financeiro-operacoes.server.ts`; os extratores dos payloads do Financial Brain
// ficam aqui para serem testados.
//
// Seis números, em duas famílias:
// - GRUPO (Financial Brain, cobertura "grupo", ignoram o filtro de unidade): saldo em caixa,
//   geração de caixa e fôlego, exposição em 30 dias, resultado da DRE no ano e projeção. Todas as
//   regras são das funções oficiais do Financeiro; aqui só se escolhe janela e se faz a conta do
//   fôlego e da projeção, que o Financeiro não tem. A porta é a do Cockpit do CEO (produto
//   Financeiro + todas as empresas); fechada, os quatro saem "sem acesso" com o motivo.
// - OPERAÇÃO (banco único, com a sessão da pessoa): repasse da rede no último mês fechado
//   (royalties + CSC, cobertura "rede") e onboarding parado há mais de 30 dias (todas as unidades).
import { MAX_NUMEROS } from "../contrato.ts";
import type {
  AlertaCoo,
  Destino,
  Estado,
  GraficoCoo,
  LeituraTema,
  NumeroCoo,
  Procedencia,
} from "../contrato.ts";
import { alerta, destino, grafico, inicioDoMes, mesAnterior, numeroOk, numeroSem, tabela } from "../montar.ts";
import type { BaseNumero } from "../montar.ts";
import { acharUnidade, chaveUnidade, unidadesDoFiltro, universo } from "../unidades.ts";
import type { FiltroUnidade, UnidadeCoo } from "../unidades.ts";
import { FASE_CHURN, FASE_CONCLUIDO } from "../../cockpit-ceo/operacao.ts";

const TEMA = "financeiro-operacoes" as const;

// ---------------------------------------------------------------------------------------------
// Limiares (as regras dos alertas; o texto de cada um vai para a gaveta e para o ClickUp)
// ---------------------------------------------------------------------------------------------

/** Fôlego abaixo disto (em meses de queima) vira alerta de atenção. */
export const FOLEGO_MINIMO_MESES = 6;
/** Meses fechados que entram no ritmo (queima do fôlego e projeção da DRE). */
export const MESES_RITMO = 3;
/** Janela da exposição: hoje e os 29 dias seguintes. */
export const JANELA_EXPOSICAO_DIAS = 30;
/** Fatura do repasse vencida há mais que isto, sem baixa, vira alerta. */
export const DIAS_NAO_RECEBIDO = 15;
/** Card de onboarding há mais que isto na mesma fase conta como parado. */
export const DIAS_PARADO = 30;
/** Meses de série no gráfico e nas tendências. */
export const MESES_SERIE = 12;

const DONO_FINANCEIRO = "Controladoria (Ana Carvalhais)";
const DONO_REPASSE = "Operações (Victor Eliezek)";
const DONO_ONBOARDING = "Operações (Victor Eliezek) com o CS";

// ---------------------------------------------------------------------------------------------
// Dados crus (o que o servidor entrega)
// ---------------------------------------------------------------------------------------------

export type Falha = { ok: false; estado: "fonte_indisponivel" | "acesso_insuficiente"; motivo: string };
export type Parte<T> = ({ ok: true } & T) | Falha;

/** Saldo bancário do grupo num mês (`fn_cockpit_caixa_livre` pedida só para aquele mês). */
export interface SaldoMes {
  /** AAAA-MM. */
  mes: string;
  /** null = nenhuma empresa com saldo no mês (não é zero). */
  valor: number | null;
  /** Foto de um dia no meio do mês, não fechamento. */
  mesEmCurso: boolean;
  /** Datas (AAAA-MM-DD) das fotos do mês em curso, sem repetição. */
  fotos: string[];
  empresasNoEscopo: number;
  empresasComSaldo: number;
  empresasSemSaldo: string[];
}

/** Um mês de uma série do Financeiro (fluxo realizado ou DRE). */
export interface MesValor {
  mes: string;
  /** null = mês sem lançamento na fonte. */
  valor: number | null;
  /** Mês que a fonte declara parcial (não comparável com mês fechado). */
  parcial: boolean;
  /** Empresas sem lançamento no mês, quando a fonte diz. */
  empresasSemDado?: string[];
}

export interface Exposicao {
  /** Competência do saldo usado (AAAA-MM). */
  competencia: string;
  vencDe: string;
  vencAte: string;
  saldo: number;
  saldoDisponivel: boolean;
  aReceber: number;
  aPagar: number;
  /** saldo + a receber − a pagar, como a fonte calcula (empresa sem saldo entra com zero). */
  previsto: number;
  empresas: number;
  empresasComSaldo: number;
  empresasSemSaldo: string[];
  vencidoAPagar: { valor: number; titulos: number; primeiro: string | null };
  vencidoAReceber: { valor: number; titulos: number; primeiro: string | null };
  depoisDaJanela: { valor: number; titulos: number; ultimo: string | null };
}

export interface ApuracaoLida {
  unidadeId: number;
  /** AAAA-MM. */
  mes: string;
  status: string;
  royalties: number | null;
  cscFixo: number | null;
  cscBaseAntiga: number | null;
  /** Total da fatura da apuração (royalties + CSC + CAC + mídia + outras). */
  total: number | null;
  atualizadoEm: string | null;
}

export interface FaturaLida {
  unidadeId: number;
  /** AAAA-MM. */
  competencia: string;
  status: string;
  valor: number;
  venceEm: string | null;
  /** O título na conta da Partners (Omie); null quando o sync não achou. */
  titulo: { status: string | null; vencimento: string | null; pagoEm: string | null } | null;
}

export interface CardLido {
  fase: string;
  /** Texto de unidade do card no Pipefy (pode não casar com o cadastro). */
  unidade: string | null;
  entrouNaFase: string | null;
  concluido: boolean;
}

export interface DadosFinanceiroOperacoes {
  lidoEm: string;
  /** Últimos 12 meses até o corrente, do mais antigo ao mais novo. */
  saldo: Parte<{ meses: SaldoMes[] }>;
  /** Fluxo realizado por mês (12 meses até o último mês antes do corrente). */
  fluxo: Parte<{ meses: MesValor[]; janela: { de: string; ate: string } }>;
  exposicao: Parte<{ dado: Exposicao }>;
  /** DRE por mês, de janeiro do ano (ou antes, para ter 3 meses de ritmo) ao mês anterior. */
  dre: Parte<{ meses: MesValor[]; recortesFora: string[] }>;
  repasse: Parte<{ apuracoes: ApuracaoLida[]; faturas: Parte<{ linhas: FaturaLida[] }> }>;
  onboarding: Parte<{ cards: CardLido[]; atualizadoEm: string | null }>;
}

// ---------------------------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------------------------

const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const cent = (v: number) => Math.round(v * 100);
const reais = (c: number) => c / 100;
const somaCent = (vs: (number | null | undefined)[]) => vs.reduce<number>((s, v) => s + cent(Number(v ?? 0)), 0);
const mesDe = (x: unknown): string | null =>
  typeof x === "string" && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null;
const diaDe = (x: unknown): string | null =>
  typeof x === "string" && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const NUM = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "R$ 1.952.251,58" / "-R$ 430.341,52" (sem espaço inseparável, para o texto ir limpo ao ClickUp). */
export function brl(v: number): string {
  return `${v < 0 ? "-" : ""}R$ ${NUM.format(Math.abs(v))}`;
}
const UMA_CASA = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const DUAS_CASAS = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** "R$ 1,95 mi" / "R$ 430 mil" / "-R$ 12,4 mi": para nota e título, onde cabe uma linha. */
export function brlCurto(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  if (a >= 1_000_000) return `${s}R$ ${(a >= 10_000_000 ? UMA_CASA : DUAS_CASAS).format(a / 1_000_000)} mi`;
  if (a >= 1_000) return `${s}R$ ${Math.round(a / 1_000)} mil`;
  return `${s}R$ ${NUM.format(a)}`;
}
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "ago/2026". */
export const mesBr = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(0, 4)}`;
/** "ago/26": rótulo de eixo. */
const mesCurto = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
/** "10/09/2026". */
export const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const lista = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

/** Último dia do mês (AAAA-MM → AAAA-MM-DD). */
export const fimDoMes = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
/** Data ISO + n dias. */
export function somarDias(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86_400_000);
/** Os n meses que terminam em `ate` (AAAA-MM), do mais antigo ao mais novo. */
export function mesesAte(ate: string, n: number): string[] {
  const out = [ate];
  while (out.length < n) out.unshift(mesAnterior(out[0]));
  return out;
}
/** Dia de um timestamp no fuso de São Paulo (UTC−3, sem horário de verão desde 2019). */
function diaSaoPaulo(ts: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts;
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Janelas que o servidor pede ao Financeiro. Ficam aqui para o teste e a homologação usarem as
 * mesmas datas: o fluxo e a DRE param no mês anterior ao corrente (o mês em curso é sempre parcial
 * e só pesaria a consulta); a DRE começa em janeiro ou antes, para ter 3 meses de ritmo mesmo no
 * começo do ano.
 */
export function janelasFinanceiro(hoje: string) {
  const corrente = hoje.slice(0, 7);
  const anterior = mesAnterior(corrente);
  const tresAntes = mesesAte(anterior, MESES_RITMO)[0];
  const janeiro = `${corrente.slice(0, 4)}-01`;
  return {
    saldoMeses: mesesAte(corrente, MESES_SERIE),
    fluxo: { de: `${mesesAte(anterior, MESES_SERIE)[0]}-01`, ate: `${anterior}-01` },
    dre: { de: `${tresAntes < janeiro ? tresAntes : janeiro}-01`, ate: fimDoMes(anterior) },
    exposicao: { competencia: inicioDoMes(hoje), de: hoje, ate: somarDias(hoje, JANELA_EXPOSICAO_DIAS - 1) },
  };
}

// ---------------------------------------------------------------------------------------------
// Extratores dos payloads do Financial Brain (lançam em formato inesperado; o servidor captura)
// ---------------------------------------------------------------------------------------------

function inesperado(fonte: string, onde: string): never {
  throw new Error(`${fonte} em formato inesperado (${onde})`);
}
const textos = (x: unknown): string[] => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : []);

/** `fn_cockpit_caixa_livre` pedida para um mês só. */
export function extrairCaixaLivre(mes: string, cru: unknown): SaldoMes {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || typeof j !== "object" || !j.cobertura) inesperado("Caixa livre", "cobertura");
  const semDado = j.sem_dado === true;
  const ref = mesDe(j.mes_referencia);
  // A função devolve o último mês COM saldo dentro da janela; pedida para um mês só, qualquer
  // outro mês seria erro de chamada, não dado.
  const valor = semDado || ref !== mes ? null : numero(j.valor);
  const fontes = textos(j.fontes);
  const fotos = [
    ...new Set(fontes.map((f) => /@(\d{4}-\d{2}-\d{2})/.exec(f)?.[1]).filter((d): d is string => !!d)),
  ].sort();
  return {
    mes,
    valor,
    mesEmCurso: valor !== null && j.mes_em_curso === true,
    fotos: valor === null ? [] : fotos,
    empresasNoEscopo: numero(j.cobertura.n_empresas_no_escopo) ?? 0,
    empresasComSaldo: valor === null ? 0 : (numero(j.cobertura.n_empresas_com_saldo) ?? 0),
    empresasSemSaldo: textos(j.cobertura.empresas_sem_saldo),
  };
}

/** `fn_dfc_matriz_calcular` (nível 1): `totais[mês].total_geral`, com os meses parciais da fonte. */
export function extrairFluxo(cru: unknown): MesValor[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  if (!j || typeof j !== "object" || !j.totais || !Array.isArray(j.periodos)) inesperado("Fluxo de caixa", "totais/periodos");
  const comDado = new Set(textos(j.cobertura?.meses_com_dado).map(mesDe));
  const parciais = new Set(textos(j.cobertura?.meses_parciais).map(mesDe));
  const semDado = new Map<string, string[]>();
  for (const x of Array.isArray(j.cobertura?.empresas_sem_dado_por_competencia)
    ? j.cobertura.empresas_sem_dado_por_competencia
    : []) {
    const m = mesDe(x?.competencia);
    if (m) semDado.set(m, textos(x?.empresas));
  }
  return j.periodos
    .map((p: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const x = p as any;
      const mes = mesDe(x?.id);
      if (!mes) inesperado("Fluxo de caixa", "periodos");
      const bruto = j.totais[x.id]?.total_geral;
      return {
        mes,
        // Mês fora de `meses_com_dado` é mês sem lançamento: um resto solto (dez/2025 tinha um
        // lançamento de abertura) não vira geração de caixa.
        valor: comDado.has(mes) ? numero(bruto) : null,
        parcial: x.parcial === true || x.parcial_dado === true || parciais.has(mes),
        empresasSemDado: semDado.get(mes) ?? [],
      };
    })
    .sort((a: MesValor, b: MesValor) => a.mes.localeCompare(b.mes));
}

/** `fn_dre_comp_caixa` (nível 1): `total_geral.valores` por mês e os recortes que ficaram fora. */
export function extrairDre(cru: unknown): { meses: MesValor[]; recortesFora: string[] } {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  const valores = j?.total_geral?.valores;
  if (!j || typeof j !== "object" || !valores || typeof valores !== "object") inesperado("DRE", "total_geral");
  const comDado = new Set(textos(j.cobertura?.meses_com_dado).map(mesDe));
  const parciais = new Set([
    ...textos(j.cobertura?.meses_parciais).map(mesDe),
    ...textos(j.cobertura?.parciais_na_resposta).map(mesDe),
  ]);
  const meses = Object.keys(valores)
    .map((k) => {
      const mes = mesDe(k);
      if (!mes) inesperado("DRE", "valores");
      return { mes, valor: comDado.size && !comDado.has(mes) ? null : numero(valores[k]), parcial: parciais.has(mes) };
    })
    .sort((a, b) => a.mes.localeCompare(b.mes));
  const recortesFora = (Array.isArray(j.escopo?.recortes_destacaveis) ? j.escopo.recortes_destacaveis : [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((r: any) => r?.estado === "excluido" && typeof r?.rotulo === "string")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((r: any) => r.rotulo as string);
  return { meses, recortesFora };
}

/** `fn_aprovacoes_caixa` com a janela de vencimento de hoje a hoje+29. */
export function extrairExposicao(cru: unknown): Exposicao {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const j = cru as any;
  const t = j?.totais;
  if (!j || typeof j !== "object" || !t) inesperado("Aprovações de caixa", "totais");
  const obrig = (x: unknown, onde: string) => numero(x) ?? inesperado("Aprovações de caixa", onde);
  const porEmpresa = Array.isArray(j.por_empresa) ? j.por_empresa : [];
  return {
    competencia: mesDe(j.competencia) ?? inesperado("Aprovações de caixa", "competencia"),
    vencDe: diaDe(j.venc_de) ?? inesperado("Aprovações de caixa", "venc_de"),
    vencAte: diaDe(j.venc_ate) ?? inesperado("Aprovações de caixa", "venc_ate"),
    saldo: obrig(t.saldo, "saldo"),
    saldoDisponivel: t.saldo_disponivel === true,
    aReceber: obrig(t.receita_prevista, "receita_prevista"),
    aPagar: obrig(t.total_a_pagar, "total_a_pagar"),
    previsto: obrig(t.saldo_final_previsto, "saldo_final_previsto"),
    empresas: numero(t.empresas) ?? porEmpresa.length,
    empresasComSaldo: numero(t.empresas_com_saldo) ?? 0,
    empresasSemSaldo: porEmpresa
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((e: any) => e?.saldo === null || e?.saldo === undefined)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => String(e.apelido)),
    vencidoAPagar: {
      valor: numero(j.antes_da_janela?.valor) ?? 0,
      titulos: numero(j.antes_da_janela?.titulos) ?? 0,
      primeiro: diaDe(j.antes_da_janela?.primeiro_vencimento),
    },
    vencidoAReceber: {
      valor: numero(j.receita_antes_da_janela?.valor) ?? 0,
      titulos: numero(j.receita_antes_da_janela?.titulos) ?? 0,
      primeiro: diaDe(j.receita_antes_da_janela?.primeiro_vencimento),
    },
    depoisDaJanela: {
      valor: numero(j.fora_da_janela?.valor) ?? 0,
      titulos: numero(j.fora_da_janela?.titulos) ?? 0,
      ultimo: diaDe(j.fora_da_janela?.ultimo_vencimento),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Casamento de unidade
// ---------------------------------------------------------------------------------------------

/**
 * `acharUnidade` e, na falta, o nome do cadastro seguido de complemento: o Pipefy grava "São
 * Bernardo do Campo" onde o cadastro diz "São Bernardo". Só casa quando há UMA unidade candidata.
 */
export function casarUnidade(unidades: UnidadeCoo[], texto: string | null | undefined): UnidadeCoo | null {
  const u = acharUnidade(unidades, texto);
  if (u) return u;
  const c = chaveUnidade(texto);
  if (!c) return null;
  const candidatas = unidades.filter((x) => x.chave && c.startsWith(`${x.chave} `));
  return candidatas.length === 1 ? candidatas[0] : null;
}

// ---------------------------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------------------------

const externo = (rota: string, rotulo: string, observacao: string): Destino => ({
  rota,
  search: {},
  externo: true,
  rotulo,
  mesmoRecorte: false,
  observacao,
});
const DESTINO_SALDO = externo(
  "/financeiro",
  "Abrir o Cockpit do Brain Financeiro",
  "O Financeiro mostra o caixa livre por empresa e grupo de apuração; o cockpit mostra só o consolidado.",
);
const DESTINO_FLUXO = externo(
  "/financeiro/fluxo-caixa",
  "Abrir Fluxo de caixa no Brain Financeiro",
  "O Fluxo abre no ano corrente e por empresa; o cockpit usa a média dos 3 últimos meses fechados.",
);
const DESTINO_EXPOSICAO = externo(
  "/financeiro/aprovacoes-caixa",
  "Abrir Aprovações de caixa no Brain Financeiro",
  "A tela abre no mês corrente; para o mesmo número, escolha o vencimento de hoje até 30 dias à frente.",
);
const DESTINO_DRE = externo(
  "/financeiro/dre-comp-caixa",
  "Abrir DRE Comp. Caixa no Brain Financeiro",
  "A DRE abre por mês e por empresa; a projeção do ano é do cockpit e não existe lá.",
);

// ---------------------------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------------------------

const APURADA = new Set(["confirmado", "faturado"]);
/** Royalties + CSC fixo + CSC da base antiga, em centavos: a soma de `roy_csc` da casa. */
const repasseCent = (a: ApuracaoLida) => somaCent([a.royalties, a.cscFixo, a.cscBaseAntiga]);
const FATURA_VALIDA = (s: string) => s !== "erro" && s !== "cancelada";

interface Ritmo {
  meses: MesValor[];
  mediaCent: number;
}
/** Os `n` últimos meses fechados (com valor, não parciais, antes do mês corrente). */
function ultimosFechados(meses: MesValor[], corrente: string, n: number): MesValor[] {
  return meses.filter((m) => m.mes < corrente && !m.parcial && m.valor !== null).slice(-n);
}
function ritmoDe(meses: MesValor[], corrente: string): Ritmo | null {
  const u = ultimosFechados(meses, corrente, MESES_RITMO);
  if (u.length < MESES_RITMO) return null;
  return { meses: u, mediaCent: Math.round(somaCent(u.map((m) => m.valor)) / u.length) };
}
const faixa = (ms: MesValor[]) =>
  ms.length ? (ms.length === 1 ? mesBr(ms[0].mes) : `${mesBr(ms[0].mes)} a ${mesBr(ms[ms.length - 1].mes)}`) : "";

export function montarFinanceiroOperacoes(
  dados: DadosFinanceiroOperacoes,
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
  hoje: string,
): LeituraTema {
  const corrente = hoje.slice(0, 7);
  const fechado = mesAnterior(corrente);
  const sel = unidadesDoFiltro(unidades, filtro);
  const idsSel = new Set(sel.map((u) => u.id));
  const filtrado = Boolean(filtro);
  const numeros: NumeroCoo[] = [];
  const alertas: AlertaCoo[] = [];
  const graficos: GraficoCoo[] = [];
  const fontes: Procedencia[] = [];
  const avisos: string[] = [];
  const grupoInteiro = "É do grupo Planning inteiro: não muda com o filtro de unidade.";

  // ── 1 · Saldo em caixa ──────────────────────────────────────────────────────────────────────
  const baseSaldo: BaseNumero = {
    id: "saldo-caixa",
    rotulo: "Saldo em caixa",
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Brain Financeiro · caixa livre",
    destino: DESTINO_SALDO,
    explicacao: {
      oQueDiz: "Quanto dinheiro o grupo tem no banco: a soma do saldo bancário de cada empresa do grupo.",
      comoCalcula:
        "Soma do saldo de cada empresa que entra no fechamento, no mês mais recente com saldo (fn_cockpit_caixa_livre). No mês em curso o saldo é a foto do dia em que foi carimbado, não o fechamento do mês. A tendência é o saldo de fim de mês dos últimos 12 meses.",
      atencao: grupoInteiro,
      dono: DONO_FINANCEIRO,
    },
  };
  let saldoAtual: SaldoMes | null = null;
  if (!dados.saldo.ok) numeros.push(numeroSem(baseSaldo, dados.saldo.estado, dados.saldo.motivo));
  else {
    const meses = dados.saldo.meses;
    saldoAtual = [...meses].reverse().find((m) => m.valor !== null) ?? null;
    if (!saldoAtual)
      numeros.push(numeroSem(baseSaldo, "nao_apurado", "nenhuma empresa tem saldo carimbado nos últimos 12 meses"));
    else {
      const s = saldoAtual;
      const faltam = s.empresasSemSaldo;
      const defasado = s.mes !== corrente;
      const fotoMaisAntiga = s.fotos[0] ?? null;
      const dataDado = fotoMaisAntiga ?? fimDoMes(s.mes);
      const atencao = [
        faltam.length
          ? `${plural(faltam.length, "empresa", "empresas")} de ${s.empresasNoEscopo} sem saldo em ${mesBr(s.mes)}: ${lista(faltam)}. O número é menor do que o caixa real por isso.`
          : null,
        s.fotos.length > 1
          ? `Cada empresa tem a foto de um dia: de ${dataBr(s.fotos[0])} a ${dataBr(s.fotos[s.fotos.length - 1])}.`
          : null,
        defasado ? `${mesBr(corrente)} ainda não tem saldo carimbado: o número é de ${mesBr(s.mes)}.` : null,
        grupoInteiro,
      ]
        .filter(Boolean)
        .join(" ");
      numeros.push(
        numeroOk({ ...baseSaldo, explicacao: { ...baseSaldo.explicacao, atencao } }, s.valor as number, {
          ...(faltam.length ? { estado: "parcial" as const, motivo: `sem saldo em ${mesBr(s.mes)}: ${lista(faltam)}` } : {}),
          nota: fotoMaisAntiga
            ? `Foto mais antiga: ${dataBr(fotoMaisAntiga)}`
            : `Saldo de fechamento de ${mesBr(s.mes)}`,
          dataDado,
          ...((s.valor as number) <= 0 ? { tom: "perigo" as const } : {}),
          tendencia: {
            valores: meses.map((m) => m.valor),
            rotulo: `saldo de fim de mês, ${mesBr(meses[0].mes)} a ${mesBr(meses[meses.length - 1].mes)}`,
          },
          dados: tabela(
            ["Mês", "Saldo", "Empresas com saldo", "Situação"],
            meses.map((m) => [
              mesBr(m.mes),
              m.valor,
              m.valor === null ? null : `${m.empresasComSaldo} de ${m.empresasNoEscopo}`,
              m.valor === null ? "sem saldo" : m.mesEmCurso ? "foto do mês em curso" : "fechamento",
            ]),
          ),
        }),
      );
      fontes.push({ fonte: "Brain Financeiro · caixa livre (saldo bancário por empresa)", atualizadoEm: dataDado });
    }
  }

  // ── 2 · Geração de caixa e fôlego ───────────────────────────────────────────────────────────
  const baseFluxo: BaseNumero = {
    id: "geracao-caixa",
    rotulo: "Geração de caixa por mês",
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Brain Financeiro · fluxo de caixa realizado",
    destino: DESTINO_FLUXO,
    explicacao: {
      oQueDiz:
        "Quanto o caixa do grupo cresce (positivo) ou queima (negativo) por mês, na média dos 3 últimos meses fechados, e quantos meses o saldo aguenta nesse ritmo.",
      comoCalcula:
        "Total geral do fluxo de caixa realizado (fn_dfc_matriz_calcular, nível 1): o dinheiro que entrou menos o que saiu, pela data em que caiu na conta, sem transferências entre contas. Média dos 3 últimos meses fechados. Fôlego = saldo em caixa ÷ queima média, só quando a média é negativa.",
      atencao: grupoInteiro,
      dono: DONO_FINANCEIRO,
    },
  };
  let folego: number | null = null;
  let queimaCent = 0;
  let ritmoFluxo: Ritmo | null = null;
  if (!dados.fluxo.ok) numeros.push(numeroSem(baseFluxo, dados.fluxo.estado, dados.fluxo.motivo));
  else {
    const meses = dados.fluxo.meses;
    ritmoFluxo = ritmoDe(meses, corrente);
    const janela = `Janela lida: ${mesBr(mesDe(dados.fluxo.janela.de) ?? "")} a ${mesBr(mesDe(dados.fluxo.janela.ate) ?? "")}.`;
    if (!ritmoFluxo)
      numeros.push(
        numeroSem(baseFluxo, "nao_apurado", `o fluxo tem menos de ${MESES_RITMO} meses fechados na janela lida`),
      );
    else {
      const r = ritmoFluxo;
      const media = reais(r.mediaCent);
      queimaCent = r.mediaCent < 0 ? -r.mediaCent : 0;
      let nota: string;
      if (!queimaCent) nota = `Sem queima nos ${MESES_RITMO} últimos meses`;
      else if (!saldoAtual || saldoAtual.valor === null) nota = "Fôlego sem saldo para calcular";
      else {
        folego = Math.max(0, saldoAtual.valor) / reais(queimaCent);
        nota = `Fôlego de ${UMA_CASA.format(folego)} meses no ritmo de ${faixa(r.meses)}`;
      }
      const semDado = [...new Set(r.meses.flatMap((m) => m.empresasSemDado ?? []))];
      const atencao = [
        janela,
        semDado.length ? `Empresas sem lançamento em algum dos meses da média: ${lista(semDado)}.` : null,
        "O saldo e o fluxo têm coberturas diferentes: o saldo soma só as empresas com foto no mês.",
        grupoInteiro,
      ]
        .filter(Boolean)
        .join(" ");
      const ultimo = r.meses[r.meses.length - 1].mes;
      numeros.push(
        numeroOk(
          {
            ...baseFluxo,
            explicacao: {
              ...baseFluxo.explicacao,
              comoCalcula: `${baseFluxo.explicacao.comoCalcula} Média de ${faixa(r.meses)}.`,
              atencao,
            },
          },
          media,
          {
            nota,
            dataDado: fimDoMes(ultimo),
            ...(folego !== null && folego < FOLEGO_MINIMO_MESES ? { tom: "atencao" as const } : {}),
            tendencia: {
              valores: meses.map((m) => (m.parcial ? null : m.valor)),
              rotulo: `geração de caixa por mês, ${mesBr(meses[0].mes)} a ${mesBr(meses[meses.length - 1].mes)}`,
            },
            dados: tabela(
              ["Mês", "Geração de caixa", "Situação"],
              meses.map((m) => [
                mesBr(m.mes),
                m.valor,
                m.valor === null ? "sem lançamento" : m.parcial ? "parcial" : r.meses.includes(m) ? "fechado · na média" : "fechado",
              ]),
            ),
          },
        ),
      );
      if (folego !== null && folego < FOLEGO_MINIMO_MESES) {
        const saldoCent = cent(Math.max(0, saldoAtual?.valor ?? 0));
        alertas.push(
          alerta(TEMA, "folego-caixa", "atencao", `Grupo · fôlego de caixa de ${UMA_CASA.format(folego)} meses`, {
            // Peso em reais: o caixa que falta para os 6 meses de fôlego.
            peso: reais(Math.max(0, queimaCent * FOLEGO_MINIMO_MESES - saldoCent)),
            destino: DESTINO_FLUXO,
            limiar: `saldo em caixa ÷ queima média dos ${MESES_RITMO} últimos meses fechados abaixo de ${FOLEGO_MINIMO_MESES} meses`,
            periodo: corrente,
          }),
        );
      }
      fontes.push({ fonte: "Brain Financeiro · fluxo de caixa realizado", atualizadoEm: fimDoMes(ultimo) });
    }
  }

  // ── 3 · Exposição em 30 dias ────────────────────────────────────────────────────────────────
  const baseExp: BaseNumero = {
    id: "exposicao-30d",
    rotulo: "Exposição de caixa em 30 dias",
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Brain Financeiro · aprovações de caixa",
    destino: DESTINO_EXPOSICAO,
    explicacao: {
      oQueDiz:
        "Onde o caixa do grupo chega em 30 dias se tudo que vence for pago e recebido: saldo de hoje + a receber − a pagar com vencimento nos próximos 30 dias.",
      comoCalcula:
        "fn_aprovacoes_caixa com vencimento de hoje até 29 dias à frente: saldo do mês + contas a receber em aberto − contas a pagar em aberto (títulos sem vencimento entram). Os vencidos ficam fora do número e aparecem na tabela. Régua provisionada: conta o que está em aberto, não o que já foi pago.",
      atencao: grupoInteiro,
      dono: DONO_FINANCEIRO,
    },
  };
  let exposicao: Exposicao | null = null;
  if (!dados.exposicao.ok) numeros.push(numeroSem(baseExp, dados.exposicao.estado, dados.exposicao.motivo));
  else if (!dados.exposicao.dado.saldoDisponivel)
    numeros.push(
      numeroSem(
        baseExp,
        "nao_apurado",
        `nenhuma empresa tem saldo carimbado em ${mesBr(dados.exposicao.dado.competencia)}: sem saldo, o número seria só "a receber − a pagar"`,
      ),
    );
  else {
    const e = dados.exposicao.dado;
    exposicao = e;
    const atencao = [
      "O a receber e o a pagar entre empresas do grupo não são eliminados (intercompany): os dois lados entram.",
      e.empresasSemSaldo.length
        ? `Entram sem saldo, só com o que pagam e recebem: ${lista(e.empresasSemSaldo)}.`
        : null,
      `Vencidos ficam fora: ${brl(e.vencidoAPagar.valor)} a pagar (há conta paga sem baixa no Omie) e ${brl(e.vencidoAReceber.valor)} a receber.`,
      e.depoisDaJanela.ultimo && e.depoisDaJanela.ultimo > "2100"
        ? `Há conta a pagar com vencimento em ${e.depoisDaJanela.ultimo.slice(0, 4)} (erro de cadastro), fora da janela.`
        : null,
      grupoInteiro,
    ]
      .filter(Boolean)
      .join(" ");
    numeros.push(
      numeroOk(
        {
          ...baseExp,
          explicacao: {
            ...baseExp.explicacao,
            comoCalcula: `${baseExp.explicacao.comoCalcula} Janela de ${dataBr(e.vencDe)} a ${dataBr(e.vencAte)}; saldo de ${mesBr(e.competencia)}.`,
            atencao,
          },
        },
        e.previsto,
        {
          ...(e.empresasSemSaldo.length
            ? {
                estado: "parcial" as const,
                motivo: `${plural(e.empresasSemSaldo.length, "empresa entra", "empresas entram")} sem saldo: ${lista(e.empresasSemSaldo)}`,
              }
            : {}),
          nota: `Até ${diaMes(e.vencAte)}: ${brlCurto(e.aReceber)} a receber contra ${brlCurto(e.aPagar)} a pagar`,
          dataDado: hoje,
          ...(e.previsto < 0 ? { tom: "perigo" as const } : {}),
          dados: tabela(
            ["Parte", "Valor", "Títulos", "Entra no número?"],
            [
              [`Saldo em caixa (${mesBr(e.competencia)})`, e.saldo, null, "sim"],
              [`A receber até ${dataBr(e.vencAte)}`, e.aReceber, null, "sim"],
              [`A pagar até ${dataBr(e.vencAte)}`, -e.aPagar, null, "sim"],
              ["Exposição em 30 dias", e.previsto, null, "é o número"],
              ["A pagar vencido", -e.vencidoAPagar.valor, e.vencidoAPagar.titulos, "não"],
              ["A receber vencido", e.vencidoAReceber.valor, e.vencidoAReceber.titulos, "não"],
              [`A pagar depois de ${dataBr(e.vencAte)}`, -e.depoisDaJanela.valor, e.depoisDaJanela.titulos, "não"],
            ],
          ),
        },
      ),
    );
    if (e.previsto < 0)
      alertas.push(
        alerta(TEMA, "exposicao-negativa", "critico", `Grupo · caixa negativo em 30 dias (${brlCurto(e.previsto)})`, {
          peso: Math.abs(e.previsto),
          destino: DESTINO_EXPOSICAO,
          limiar: "saldo + a receber − a pagar com vencimento nos próximos 30 dias abaixo de zero",
          periodo: corrente,
        }),
      );
    fontes.push({ fonte: "Brain Financeiro · aprovações de caixa (contas a pagar e a receber)", atualizadoEm: hoje });
  }

  // ── 4 · Resultado da DRE no ano e projeção ──────────────────────────────────────────────────
  const ano = corrente.slice(0, 4);
  const baseDre: BaseNumero = {
    id: "resultado-dre",
    rotulo: `Resultado da DRE em ${ano}`,
    unidade: "reais",
    cobertura: "grupo",
    fonte: "Brain Financeiro · DRE Comp. Caixa",
    destino: DESTINO_DRE,
    explicacao: {
      oQueDiz: `O resultado do grupo em ${ano} pela DRE gerencial nos meses fechados, e onde ele fecha dezembro se o ritmo dos 3 últimos meses se mantiver.`,
      comoCalcula:
        "Soma do Total Geral da DRE Comp. Caixa (fn_dre_comp_caixa, nível 1) nos meses fechados do ano: receita por emissão, despesa quando paga. Projeção = acumulado + média dos 3 últimos meses fechados × meses que faltam. É estimativa pelo ritmo, não orçamento.",
      atencao:
        "Não há orçado no Financeiro (a tabela de orçamento está vazia): a comparação com a meta é lacuna da Controladoria. " +
        grupoInteiro,
      dono: DONO_FINANCEIRO,
    },
  };
  if (!dados.dre.ok) numeros.push(numeroSem(baseDre, dados.dre.estado, dados.dre.motivo));
  else {
    const doAno = dados.dre.meses.filter((m) => m.mes.startsWith(ano) && m.mes < corrente);
    const fechadosAno = doAno.filter((m) => !m.parcial && m.valor !== null);
    const ritmo = ritmoDe(dados.dre.meses, corrente);
    if (!fechadosAno.length)
      numeros.push(numeroSem(baseDre, "nao_apurado", `nenhum mês de ${ano} fechado na DRE ainda`));
    else {
      const ultimo = fechadosAno[fechadosAno.length - 1].mes;
      // Mês do ano, até o último fechado, que não fechou (sem lançamento ou parcial): o acumulado
      // fica parcial e diz qual.
      const buracos = mesesAte(ultimo, Number(ultimo.slice(5, 7)))
        .filter((m) => !fechadosAno.some((f) => f.mes === m));
      const acumuladoCent = somaCent(fechadosAno.map((m) => m.valor));
      const restantes = 12 - Number(ultimo.slice(5, 7));
      const projecaoCent = ritmo ? acumuladoCent + ritmo.mediaCent * restantes : null;
      const recortes = dados.dre.recortesFora.length
        ? ` Recortes que a DRE deixa fora por padrão: ${lista(dados.dre.recortesFora)}.`
        : "";
      numeros.push(
        numeroOk(
          {
            ...baseDre,
            explicacao: {
              ...baseDre.explicacao,
              comoCalcula: `${baseDre.explicacao.comoCalcula} Acumulado de ${faixa(fechadosAno)}${ritmo ? `; ritmo de ${faixa(ritmo.meses)}` : ""}.${recortes}`,
            },
          },
          reais(acumuladoCent),
          {
            ...(buracos.length
              ? { estado: "parcial" as const, motivo: `sem mês fechado na DRE: ${lista(buracos.map(mesBr))}` }
              : {}),
            nota:
              projecaoCent === null
                ? `Sem ${MESES_RITMO} meses fechados para projetar o ano`
                : `Projeção de ${ano}: ${brlCurto(reais(projecaoCent))} (estimativa pelo ritmo)`,
            dataDado: fimDoMes(ultimo),
            ...(projecaoCent !== null && projecaoCent < 0 ? { tom: "perigo" as const } : {}),
            tendencia: {
              valores: doAno.map((m) => (m.parcial ? null : m.valor)),
              rotulo: `resultado por mês, ${faixa(doAno)}`,
            },
            dados: tabela(
              ["Mês", "Resultado", "Situação"],
              [
                ...doAno.map((m) => [
                  mesBr(m.mes),
                  m.valor,
                  m.valor === null ? "sem lançamento" : m.parcial ? "parcial" : "fechado",
                ]),
                ...(projecaoCent === null
                  ? []
                  : [[`Projeção de ${ano} (estimativa pelo ritmo)`, reais(projecaoCent), `${restantes} meses a projetar`]]),
              ],
            ),
          },
        ),
      );
      fontes.push({ fonte: "Brain Financeiro · DRE Comp. Caixa", atualizadoEm: fimDoMes(ultimo) });
    }
  }

  // ── 5 · Repasse da rede no último mês fechado ───────────────────────────────────────────────
  const redeSel = sel.filter((u) => u.grupo === "rede");
  const redeOp = redeSel.filter((u) => u.emOperacao);
  const destinoRepasse = destino(
    "/receita-overview",
    "Abrir Receita e Repasses",
    false,
    "A abertura de Receita e Repasses soma todas as unidades regionais, inclusive as em implantação, e o total da fatura (com CAC, mídia e outras).",
    { mes: fechado },
  );
  const destinoApuracao = destino(
    "/unidades/royalties",
    "Abrir Apuração de Royalties",
    true,
    "A apuração abre no mesmo mês, por unidade.",
    { mes: fechado },
  );
  const baseRepasse: BaseNumero = {
    id: "repasse-rede",
    rotulo: `Repasse da rede em ${mesBr(fechado)}`,
    unidade: "reais",
    cobertura: "rede",
    fonte: "Apuração de royalties",
    destino: destinoRepasse,
    explicacao: {
      oQueDiz: `Quanto as unidades da rede em operação devem à matriz por ${mesBr(fechado)}: royalties + CSC da apuração.`,
      comoCalcula: `Soma de royalties + CSC fixo + CSC da base antiga das apurações fechadas (confirmadas ou faturadas) de ${mesBr(fechado)} (ops.royalties_apuracao). CAC, mídia e outras receitas ficam fora, como no take rate.`,
      atencao:
        "É o que foi apurado, não o recebido: a cobrança sai no mês seguinte. Só existe na rede regional: a operação própria não paga royalties.",
      dono: DONO_REPASSE,
    },
  };
  const semRedeOp = !redeOp.length
    ? redeSel.length
      ? "unidade em implantação não entra em número de desempenho"
      : "só existe na rede regional"
    : null;
  let apuracoesMes: ApuracaoLida[] = [];
  if (semRedeOp) numeros.push(numeroSem(baseRepasse, "nao_apurado", semRedeOp));
  else if (!dados.repasse.ok) numeros.push(numeroSem(baseRepasse, dados.repasse.estado, dados.repasse.motivo));
  else {
    const idsOp = new Set(redeOp.map((u) => u.id));
    apuracoesMes = dados.repasse.apuracoes.filter((a) => a.mes === fechado);
    const fechadas = apuracoesMes.filter((a) => APURADA.has(a.status) && idsOp.has(a.unidadeId));
    // Royalties ausentes numa apuração fechada não viram R$ 0: a unidade fica fora da soma e o
    // número fica parcial (mesma regra da leitura "rede" do Cockpit do CEO).
    const semRoyalties = fechadas.filter((a) => a.royalties === null);
    const somadas = fechadas.filter((a) => a.royalties !== null);
    const nome = (id: number) => unidades.find((u) => u.id === id)?.nome ?? `Unidade ${id}`;
    const naoFecharam = redeOp.filter((u) => !fechadas.some((a) => a.unidadeId === u.id));
    const faturas = dados.repasse.faturas.ok ? dados.repasse.faturas.linhas : null;
    const faturadas = faturas
      ? fechadas.filter((a) =>
          faturas.some((f) => f.unidadeId === a.unidadeId && f.competencia === fechado && FATURA_VALIDA(f.status)),
        ).length
      : null;
    const repasseDe = repasseCent;
    const implantacao = dados.repasse.apuracoes.filter(
      (a) =>
        a.mes === fechado &&
        APURADA.has(a.status) &&
        redeSel.some((u) => u.id === a.unidadeId && !u.emOperacao),
    );
    const atencao = [
      baseRepasse.explicacao.atencao,
      implantacao.length
        ? `Unidades em implantação ficam fora: ${lista(implantacao.map((a) => nome(a.unidadeId)))} (${brl(reais(implantacao.reduce((s, a) => s + repasseDe(a), 0)))}).`
        : null,
      naoFecharam.length ? `Sem apuração fechada em ${mesBr(fechado)}: ${lista(naoFecharam.map((u) => u.nome))}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    if (!fechadas.length)
      numeros.push(
        numeroSem(
          { ...baseRepasse, explicacao: { ...baseRepasse.explicacao, atencao } },
          "nao_apurado",
          `nenhuma apuração de ${mesBr(fechado)} fechada ainda`,
        ),
      );
    else {
      const faltas = [
        ...naoFecharam.map((u) => u.nome),
        ...semRoyalties.map((a) => `${nome(a.unidadeId)} (sem royalties)`),
      ];
      numeros.push(
        numeroOk(
          { ...baseRepasse, explicacao: { ...baseRepasse.explicacao, atencao } },
          reais(somadas.reduce((s, a) => s + repasseDe(a), 0)),
          {
            ...(faltas.length ? { estado: "parcial" as const, motivo: `fora da soma: ${lista(faltas)}` } : {}),
            nota:
              faturadas === null
                ? `${fechadas.length} de ${redeOp.length} unidades em operação com apuração fechada`
                : `${fechadas.length} de ${redeOp.length} apurações fechadas, ${faturadas} faturadas`,
            dataDado: fimDoMes(fechado),
            dados: tabela(
              ["Unidade", "Royalties", "CSC", "Repasse", "Apuração"],
              redeOp.map((u) => {
                const a = apuracoesMes.find((x) => x.unidadeId === u.id);
                const fech = a && APURADA.has(a.status);
                return [
                  u.nome,
                  fech ? a.royalties : null,
                  fech ? reais(somaCent([a.cscFixo, a.cscBaseAntiga])) : null,
                  fech && a.royalties !== null ? reais(repasseDe(a)) : null,
                  a ? a.status : "sem apuração",
                ];
              }),
            ),
          },
        ),
      );
    }
    const atualizado = dados.repasse.apuracoes
      .map((a) => a.atualizadoEm)
      .filter((x): x is string => !!x)
      .sort()
      .at(-1);
    fontes.push({ fonte: "Apuração de royalties", atualizadoEm: atualizado ?? null });
  }

  // Alertas do repasse: por unidade da rede no filtro (inclusive em implantação: a cobrança é
  // operação, não desempenho, e a abertura de Receita e Repasses lista as mesmas).
  if (dados.repasse.ok && redeSel.length) {
    const idsRede = new Set(redeSel.map((u) => u.id));
    const nome = (id: number) => unidades.find((u) => u.id === id)?.nome ?? `Unidade ${id}`;
    if (dados.repasse.faturas.ok) {
      const faturas = dados.repasse.faturas.linhas;
      for (const a of dados.repasse.apuracoes) {
        if (a.mes !== fechado || !APURADA.has(a.status) || !idsRede.has(a.unidadeId)) continue;
        if (faturas.some((f) => f.unidadeId === a.unidadeId && f.competencia === fechado)) continue;
        alertas.push(
          alerta(TEMA, "apuracao-sem-fatura", "atencao", `${nome(a.unidadeId)} · apuração fechada sem fatura`, {
            unidade: nome(a.unidadeId),
            peso: a.total ?? 0,
            destino: destinoApuracao,
            limiar: `apuração de ${mesBr(fechado)} confirmada e nenhuma nota de débito emitida no Omie`,
            periodo: fechado,
          }),
        );
      }
      // Faturado e não recebido: a data que vale é o VENCIMENTO do título na Partners, não a
      // competência (data_competencia do Omie não é confiável).
      const limite = somarDias(hoje, -DIAS_NAO_RECEBIDO);
      const porUnidade = new Map<number, { valor: number; vencimento: string; competencia: string }>();
      for (const f of faturas) {
        if (!idsRede.has(f.unidadeId) || !FATURA_VALIDA(f.status)) continue;
        if (f.titulo?.status === "RECEBIDO") continue;
        const venc = f.titulo?.vencimento ?? f.venceEm;
        if (!venc || venc >= limite) continue;
        const x = porUnidade.get(f.unidadeId);
        porUnidade.set(f.unidadeId, {
          valor: (x?.valor ?? 0) + f.valor,
          vencimento: x && x.vencimento < venc ? x.vencimento : venc,
          competencia: x && x.competencia < f.competencia ? x.competencia : f.competencia,
        });
      }
      for (const [id, x] of porUnidade)
        alertas.push(
          alerta(
            TEMA,
            "faturado-nao-recebido",
            "atencao",
            `${nome(id)} · faturado e não recebido há ${diasEntre(x.vencimento, hoje)} dias`,
            {
              unidade: nome(id),
              peso: x.valor,
              destino: destino("/unidades/royalties", "Abrir Apuração de Royalties", false, "A apuração abre no mês da competência da fatura mais antiga.", { mes: x.competencia }),
              limiar: `nota de débito do repasse vencida há mais de ${DIAS_NAO_RECEBIDO} dias sem baixa no Omie (pela data de vencimento)`,
              periodo: x.competencia,
            },
          ),
        );
    } else avisos.push(`Faturas do repasse sem leitura: ${dados.repasse.faturas.motivo}. Os alertas de fatura ficam fora.`);
  }

  // ── 6 · Onboarding parado há mais de 30 dias ────────────────────────────────────────────────
  const destinoCs = destino(
    "/painel-cs",
    "Abrir Painel de CS (Onboarding)",
    false,
    "O Painel de CS destaca cards parados há 7 dias ou mais e não filtra por unidade.",
  );
  const baseOnb: BaseNumero = {
    id: "onboarding-parado",
    rotulo: "Onboarding parado há mais de 30 dias",
    unidade: "clientes",
    cobertura: "todas",
    fonte: "Pipefy · Onboarding",
    destino: destinoCs,
    explicacao: {
      oQueDiz: "Quantos clientes em onboarding estão há mais de 30 dias na mesma fase.",
      comoCalcula: `Cards em curso do pipe de Onboarding (fora de "${FASE_CONCLUIDO}" e "${FASE_CHURN}") com mais de ${DIAS_PARADO} dias desde a entrada na fase atual (ops.cs_onboarding_cards). A unidade é a do card.`,
      atencao:
        "Não existe SLA de onboarding decidido: 30 dias é faixa de leitura, não meta. O Painel de CS destaca cards parados há 7 dias ou mais, por isso o número de lá é maior.",
      dono: DONO_ONBOARDING,
    },
  };
  if (!dados.onboarding.ok) numeros.push(numeroSem(baseOnb, dados.onboarding.estado, dados.onboarding.motivo));
  else {
    const emCurso = dados.onboarding.cards.filter(
      (c) => !c.concluido && c.fase !== FASE_CONCLUIDO && c.fase !== FASE_CHURN,
    );
    const semUnidade = emCurso.filter((c) => !casarUnidade(unidades, c.unidade));
    // Filtro vazio = a fila inteira, inclusive o card sem unidade; com filtro, só o que casa.
    const noFiltro = filtrado
      ? emCurso.filter((c) => {
          const u = casarUnidade(unidades, c.unidade);
          return !!u && idsSel.has(u.id);
        })
      : emCurso;
    const idade = (c: CardLido) => {
      const d = c.entrouNaFase ? diaSaoPaulo(c.entrouNaFase) : null;
      return d ? diasEntre(d, hoje) : null;
    };
    const parados = noFiltro.filter((c) => (idade(c) ?? -1) > DIAS_PARADO);
    const semData = noFiltro.filter((c) => idade(c) === null).length;
    const porFase = new Map<string, { emCurso: number; parados: number }>();
    for (const c of noFiltro) {
      const f = porFase.get(c.fase) ?? { emCurso: 0, parados: 0 };
      f.emCurso += 1;
      if ((idade(c) ?? -1) > DIAS_PARADO) f.parados += 1;
      porFase.set(c.fase, f);
    }
    const fases = [...porFase].sort((a, b) => b[1].parados - a[1].parados || b[1].emCurso - a[1].emCurso || a[0].localeCompare(b[0]));
    const gargalo = fases[0] && fases[0][1].parados > 0 ? fases[0] : null;
    const atencao = [
      baseOnb.explicacao.atencao,
      semUnidade.length
        ? `${plural(semUnidade.length, "card em curso sem unidade que case com o cadastro entra", "cards em curso sem unidade que case com o cadastro entram")} só em "todas as unidades".`
        : null,
      semData ? `${plural(semData, "card sem data de entrada na fase fica fora", "cards sem data de entrada na fase ficam fora")}.` : null,
    ]
      .filter(Boolean)
      .join(" ");
    const dataDado = dados.onboarding.atualizadoEm ? diaSaoPaulo(dados.onboarding.atualizadoEm) : null;
    numeros.push(
      numeroOk({ ...baseOnb, explicacao: { ...baseOnb.explicacao, atencao } }, parados.length, {
        nota: gargalo
          ? `Gargalo: ${gargalo[0]} (${gargalo[1].parados})`
          : `${plural(noFiltro.length, "cliente em curso", "clientes em curso")}, nenhum parado`,
        dataDado,
        ...(parados.length ? { tom: "atencao" as const } : {}),
        dados: tabela(
          ["Fase", "Em curso", `Parados há mais de ${DIAS_PARADO} dias`],
          fases.map(([f, x]) => [f, x.emCurso, x.parados]),
        ),
      }),
    );
    if (gargalo)
      alertas.push(
        alerta(
          TEMA,
          "onboarding-gargalo",
          "atencao",
          `Onboarding · ${gargalo[0]} com ${plural(gargalo[1].parados, "cliente parado", "clientes parados")} há 30+ dias`,
          {
            // Contagem, não reais: fica atrás dos alertas de dinheiro na mesma gravidade.
            peso: gargalo[1].parados,
            destino: destinoCs,
            limiar: `fase com mais cards em curso parados há mais de ${DIAS_PARADO} dias na mesma fase`,
            periodo: corrente,
          },
        ),
      );
    if (semUnidade.length && !filtrado)
      avisos.push(`${plural(semUnidade.length, "card de onboarding sem unidade", "cards de onboarding sem unidade")} no Pipefy: entram só em "todas as unidades".`);
    fontes.push({ fonte: "Pipefy · Onboarding (sincronizado no Ops)", atualizadoEm: dados.onboarding.atualizadoEm });
  }

  // ── Gráfico: para onde o caixa está apontando? ──────────────────────────────────────────────
  const baseGrafCaixa = {
    id: "caixa-apontando",
    titulo: "Para onde o caixa está apontando?",
    tipo: "linhas" as const,
    series: [
      { chave: "saldo", rotulo: "Saldo de fim de mês" },
      { chave: "projetado", rotulo: "Projeção em 30 dias (exposição)" },
    ],
    unidade: "reais" as const,
    fonte: "Brain Financeiro · caixa livre e aprovações de caixa",
    destino: DESTINO_EXPOSICAO,
    explicacao: {
      oQueDiz:
        "O saldo bancário do grupo no fim de cada mês e, no último ponto, onde ele chega em 30 dias se tudo que vence for pago e recebido.",
      comoCalcula:
        "Saldo: fn_cockpit_caixa_livre mês a mês (no mês em curso, a foto do dia). Projeção: saldo + a receber − a pagar com vencimento nos próximos 30 dias (fn_aprovacoes_caixa).",
      atencao:
        "Mês com menos empresas com saldo não é comparável com os outros: a tabela do Saldo em caixa diz quantas havia em cada mês. " +
        grupoInteiro,
      dono: DONO_FINANCEIRO,
    },
  };
  let graficoCaixaDisponivel = false;
  if (!dados.saldo.ok) graficos.push(grafico(baseGrafCaixa, [], { estado: dados.saldo.estado, motivo: dados.saldo.motivo }));
  else {
    const meses = dados.saldo.meses;
    const pontos: GraficoCoo["pontos"] = meses.map((m) => ({
      rotulo: mesCurto(m.mes),
      saldo: m.valor,
      // A linha da projeção sai do último saldo, para as duas se tocarem.
      projetado: exposicao && saldoAtual && m.mes === saldoAtual.mes ? m.valor : null,
    }));
    if (exposicao) pontos.push({ rotulo: `até ${diaMes(exposicao.vencAte)}`, saldo: null, projetado: exposicao.previsto });
    const temPonto = pontos.some((p) => p.saldo !== null);
    const estado: Estado = !temPonto ? "nao_apurado" : exposicao ? "disponivel" : "parcial";
    graficoCaixaDisponivel = temPonto;
    graficos.push(
      grafico(baseGrafCaixa, temPonto ? pontos : [], {
        estado,
        motivo:
          estado === "parcial"
            ? `sem a projeção de 30 dias: ${dados.exposicao.ok ? "sem saldo carimbado no mês" : dados.exposicao.motivo}`
            : undefined,
        dataDado: saldoAtual ? (saldoAtual.fotos[0] ?? fimDoMes(saldoAtual.mes)) : null,
      }),
    );
  }

  // ── Gráfico de reserva: quanto a rede repassou por mês? (o COO vê mesmo sem o Financeiro) ───
  if (!graficoCaixaDisponivel) {
    const baseGrafRepasse = {
      id: "repasse-mensal",
      titulo: "Quanto a rede repassou por mês?",
      tipo: "barras" as const,
      series: [{ chave: "repasse", rotulo: "Royalties + CSC" }],
      unidade: "reais" as const,
      fonte: "Apuração de royalties",
      destino: destinoRepasse,
      explicacao: {
        oQueDiz: "Royalties + CSC que as unidades da rede em operação devem à matriz em cada um dos 12 últimos meses fechados.",
        comoCalcula:
          "Soma de royalties + CSC fixo + CSC da base antiga das apurações fechadas (confirmadas ou faturadas) de cada mês, só das unidades regionais em operação do filtro.",
        atencao:
          "Mês em que alguma unidade não fechou a apuração sai menor. Mês sem nenhuma apuração fechada fica vazio, não zero. Só existe na rede regional.",
        dono: DONO_REPASSE,
      },
    };
    if (semRedeOp) graficos.push(grafico(baseGrafRepasse, [], { estado: "nao_apurado", motivo: semRedeOp }));
    else if (!dados.repasse.ok)
      graficos.push(grafico(baseGrafRepasse, [], { estado: dados.repasse.estado, motivo: dados.repasse.motivo }));
    else {
      const idsOp = new Set(redeOp.map((u) => u.id));
      const pontos = mesesAte(fechado, MESES_SERIE).map((m) => {
        const fechadas = dados.repasse.ok
          ? dados.repasse.apuracoes.filter(
              (a) => a.mes === m && APURADA.has(a.status) && idsOp.has(a.unidadeId) && a.royalties !== null,
            )
          : [];
        return {
          rotulo: mesCurto(m),
          repasse: fechadas.length ? reais(fechadas.reduce((s, a) => s + repasseCent(a), 0)) : null,
        };
      });
      const temPonto = pontos.some((p) => p.repasse !== null);
      graficos.push(grafico(baseGrafRepasse, temPonto ? pontos : [], { dataDado: fimDoMes(fechado) }));
    }
  }

  if (numeros.length > MAX_NUMEROS) throw new Error(`Financeiro e Operações passou de ${MAX_NUMEROS} números`);
  return { tema: TEMA, universo: universo(unidades, filtro), numeros, alertas, graficos, fontes, avisos };
}
