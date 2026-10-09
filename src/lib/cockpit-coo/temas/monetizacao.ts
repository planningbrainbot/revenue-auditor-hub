// Qui · Monetização: "A Monetização está entregando o projetado, e quais unidades eu preciso cobrar?"
//
// Pedido do Pedro em 30/09/2026: "a informação mais relevante é o que está no módulo de
// monetização, sobretudo no projetado vs realizado". Os quatro primeiros números são a conta da
// antiga aba "Projetado × realizado" do módulo (`forecastComparison`; a aba saiu do menu em
// 09/10/2026 e o projetado ficou só aqui): o projetado é a planilha de forecast em uso e o
// realizado é o pipe de Monetização no CRM, no mês corrente.
//
// Pedido do COO em 29/09/2026, que continua: "Preciso saber quais são as unidades mais engajadas
// no projeto, assim como preciso ser alertado quando isso não acontecer para poder cobrá-los."
//
// Arquivo PURO: sem I/O e só imports relativos com extensão (os testes rodam no Node removendo
// tipos). Os dados chegam já agregados pelo adaptador `monetizacao.carga.ts`, que lê a mesma carga
// da tela da Monetização (`useMonetizacao()`), no navegador. Não há `.server.ts` neste tema.
//
// A régua de engajamento (pesquisa de 29/09, spec "Revisão de 29/09/2026"), nota de 0 a 100:
// - A · Base pronta (peso 25): elegíveis com contato ÷ elegíveis;
// - B · Aceite de reunião (35): leads maduros com reunião marcada ou realizada ÷ leads maduros;
//   50% vale 100;
// - C · Avanço (20): leads maduros validados ÷ leads maduros; 40% vale 100;
// - D · Ação da unidade (20): não existe registro. Enquanto não existir, nota = (25A+35B+20C) ÷ 80.
// Lead maduro: negócio do pipe cujo PRIMEIRO "trabalhado" caiu entre D-30 e D-7 (a coorte teve ao
// menos uma semana para marcar reunião). "Reunião" é reunião marcada ou realizada: a pesquisa mediu
// assim, e "aceite" é o lead aceitar a reunião, mesmo que ela ainda vá acontecer.
import type {
  AlertaCoo,
  Destino,
  Estado,
  GraficoCoo,
  LeituraTema,
  NumeroCoo,
  Procedencia,
  TabelaDados,
} from "../contrato.ts";
import { alerta, destino, grafico, inicioDoMes, numeroOk, numeroSem, tabela } from "../montar.ts";
import type { BaseNumero } from "../montar.ts";
import { unidadesDoFiltro, universo } from "../unidades.ts";
import type { FiltroUnidade, UnidadeCoo } from "../unidades.ts";

// ---------------------------------------------------------------------------------------------
// Dados crus (o que o adaptador entrega)
// ---------------------------------------------------------------------------------------------

export type FalhaParte = {
  ok: false;
  estado: "fonte_indisponivel" | "acesso_insuficiente" | "nao_apurado";
  motivo: string;
};

/**
 * Contas elegíveis agrupadas pelo conjunto de unidades da conta. Agrupar pelo conjunto (e não por
 * unidade) deixa somar um filtro sem contar duas vezes a conta que é de duas unidades.
 */
export interface GrupoBase {
  /** Unidades da conta (`ops.monetizacao_contas.unidade_ids`), em ordem; vazio = sem unidade. */
  unidade_ids: number[];
  /** Contas elegíveis a pelo menos um produto (Consultoria, Finance ou Cella). */
  elegiveis: number;
  /** Elegíveis com contato cadastrado na Base. */
  comContato: number;
  /** Elegíveis com negócio no pipe da Monetização; null quando os negócios não foram lidos. */
  trabalhadas: number | null;
}

/** Um negócio do pipe de Monetização, com as datas (AAAA-MM-DD, São Paulo) de cada evento. */
export interface NegocioRegua {
  id: number;
  /** Unidades da empresa do negócio; vazio = negócio sem unidade (lacuna, não conta para ninguém). */
  unidade_ids: number[];
  started: string[];
  scheduled: string[];
  meeting: string[];
  validated: string[];
  signed: string[];
}

/** Os degraus do funil que a planilha projeta, na ordem do cartão (o resultado primeiro). */
export type Degrau = "signed" | "validated" | "meeting" | "started";
export const DEGRAUS: { chave: Degrau; rotulo: string; linha: number }[] = [
  { chave: "signed", rotulo: "Contratos ganhos", linha: 41 },
  { chave: "validated", rotulo: "Oportunidades validadas", linha: 37 },
  { chave: "meeting", rotulo: "Reuniões realizadas", linha: 35 },
  { chave: "started", rotulo: "Leads trabalhados", linha: 29 },
];

/** Um mês da planilha contra o CRM (o que `forecastComparison` devolve, só com contagens). */
export interface MesForecast {
  mes: string;
  /** Último dia contado: o corte do CRM no mês corrente, senão o fim do mês. */
  ate: string;
  parcial: boolean;
  projetado: Record<Degrau, number | null>;
  /** null = mês sem realizado (futuro, ou antes da primeira carga). */
  realizado: Record<Degrau, number> | null;
  produtos: {
    produto: string;
    nome: string;
    projetadoLeads: number | null;
    projetadoContratos: number | null;
    leads: number | null;
    contratos: number | null;
  }[];
}

export interface DadosMonetizacao {
  forecast:
    | {
        ok: true;
        /** "v12 · Estimado". */
        versao: string;
        nota: string;
        /** Data da planilha. */
        fonteData: string;
        atualizadoEm: string | null;
        parada: string | null;
        meses: MesForecast[];
      }
    | FalhaParte;
  base:
    | {
        ok: true;
        grupos: GrupoBase[];
        atualizadoEm: string | null;
        /** Motivo quando o catálogo está parado (número vira "parcial"); null = em dia. */
        parada: string | null;
      }
    | FalhaParte;
  negocios:
    | {
        ok: true;
        lista: NegocioRegua[];
        atualizadoEm: string | null;
        parada: string | null;
      }
    | FalhaParte;
}

/** A carga inteira falhou, carrega ou foi negada: as duas partes com o mesmo estado. */
export function dadosSemCarga(estado: FalhaParte["estado"], motivo: string): DadosMonetizacao {
  const falha: FalhaParte = { ok: false, estado, motivo };
  return { forecast: falha, base: falha, negocios: falha };
}

// ---------------------------------------------------------------------------------------------
// A régua
// ---------------------------------------------------------------------------------------------

export const REGUA = {
  pesos: { A: 25, B: 35, C: 20, D: 20 },
  /** B: esta taxa de reunião vale 100. */
  alvoReuniao: 0.5,
  /** C: esta taxa de validação vale 100. */
  alvoValidacao: 0.4,
  /** Coorte menor que isto é "sem amostra". */
  amostraMinima: 5,
  engajada: 70,
  morna: 40,
  /** Coorte madura: primeiro trabalho entre `de` e `ate` dias antes da data de referência. */
  janela: { de: 30, ate: 7 },
  /** A nota de comparação é recalculada com a data de referência este número de dias atrás. */
  comparacaoDias: 7,
  /** Cobrar a matriz: unidade com pelo menos isto de elegíveis... */
  matrizElegiveis: 50,
  /** ...e menos que isto de leads maduros. */
  matrizLeads: 5,
  /** Cobrar a matriz: cobertura (elegíveis com negócio ÷ elegíveis), em %, abaixo disto. */
  coberturaMinima: 5,
} as const;

export type Faixa = "engajada" | "morna" | "parada" | "sem_amostra" | "sem_base";

export const ROTULO_FAIXA: Record<Faixa, string> = {
  engajada: "engajada",
  morna: "morna",
  parada: "parada",
  sem_amostra: "sem amostra",
  sem_base: "sem base",
};

const ORDEM_FAIXA: Partial<Record<Faixa, number>> = { parada: 1, morna: 2, engajada: 3 };

/** Data ISO `n` dias antes (sem fuso: a data já vem no fuso de São Paulo). */
export function menosDias(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** Janela da coorte madura para uma data de referência: primeiro trabalho entre D-30 e D-7. */
export function janelaDaCoorte(ref: string): { de: string; ate: string } {
  return { de: menosDias(ref, REGUA.janela.de), ate: menosDias(ref, REGUA.janela.ate) };
}

/**
 * A data mais antiga que o tema lê: a coorte da nota de 7 dias atrás ou o início do mês (ganhos e
 * validadas do mês), o que vier antes. Negócio sem nenhum evento desde então não muda nada aqui.
 */
export function inicioDaLeitura(hoje: string): string {
  const coorteAntiga = janelaDaCoorte(menosDias(hoje, REGUA.comparacaoDias)).de;
  const mes = inicioDoMes(hoje);
  return coorteAntiga < mes ? coorteAntiga : mes;
}

/** Primeira data de "trabalhado" do negócio; null se nunca foi trabalhado. */
export function primeiroTrabalho(n: NegocioRegua): string | null {
  let min: string | null = null;
  for (const d of n.started) if (d && (min === null || d < min)) min = d;
  return min;
}

export function naCoorte(n: NegocioRegua, ref: string): boolean {
  const p = primeiroTrabalho(n);
  if (!p) return false;
  const j = janelaDaCoorte(ref);
  return p >= j.de && p <= j.ate;
}

export interface Coorte {
  leads: number;
  comReuniao: number;
  validadas: number;
}

const ate = (datas: string[], ref: string) => datas.some((d) => d <= ref);

/**
 * Coorte madura de uma unidade na data de referência. `unidadeId` null = negócios sem unidade.
 * Reunião e validação contam se aconteceram até a data de referência.
 */
export function coorteDaUnidade(
  negocios: NegocioRegua[],
  unidadeId: number | null,
  ref: string,
): Coorte {
  const c: Coorte = { leads: 0, comReuniao: 0, validadas: 0 };
  for (const n of negocios) {
    const daUnidade =
      unidadeId === null ? n.unidade_ids.length === 0 : n.unidade_ids.includes(unidadeId);
    if (!daUnidade || !naCoorte(n, ref)) continue;
    c.leads++;
    if (ate(n.scheduled, ref) || ate(n.meeting, ref)) c.comReuniao++;
    if (ate(n.validated, ref)) c.validadas++;
  }
  return c;
}

export interface Nota {
  /** Base pronta, 0–100. */
  A: number;
  /** Aceite de reunião, 0–100. */
  B: number;
  /** Avanço, 0–100. */
  C: number;
  /** Nota final arredondada (0–100). A faixa sai dela, que é o número que o COO lê. */
  nota: number;
}

const teto = (v: number) => Math.max(0, Math.min(100, v));

/**
 * Nota de engajamento. null quando não há nota: unidade sem elegíveis (sem base) ou coorte com
 * menos de 5 leads maduros (sem amostra). A parte D não existe; a nota se reescala para 80.
 */
export function notaEngajamento(
  base: { elegiveis: number; comContato: number },
  coorte: Coorte,
): Nota | null {
  if (base.elegiveis <= 0 || coorte.leads < REGUA.amostraMinima) return null;
  const A = (100 * base.comContato) / base.elegiveis;
  const B = teto((100 * (coorte.comReuniao / coorte.leads)) / REGUA.alvoReuniao);
  const C = teto((100 * (coorte.validadas / coorte.leads)) / REGUA.alvoValidacao);
  const { pesos } = REGUA;
  const nota = (pesos.A * A + pesos.B * B + pesos.C * C) / (pesos.A + pesos.B + pesos.C);
  return { A, B, C, nota: Math.round(nota) };
}

/** Faixa de uma nota: 70+ engajada, 40–69 morna, abaixo de 40 parada. */
export function faixaDaNota(nota: number): "engajada" | "morna" | "parada" {
  return nota >= REGUA.engajada ? "engajada" : nota >= REGUA.morna ? "morna" : "parada";
}

/** Faixa da unidade: sem base vem antes de sem amostra; com nota, a faixa da nota. */
export function faixa(base: { elegiveis: number }, coorte: Coorte, nota: Nota | null): Faixa {
  if (base.elegiveis <= 0) return "sem_base";
  if (coorte.leads < REGUA.amostraMinima || !nota) return "sem_amostra";
  return faixaDaNota(nota.nota);
}

/** Caiu de faixa: as duas datas têm nota, e a faixa de hoje é menor que a de 7 dias atrás. */
export function caiuDeFaixa(agora: Faixa, antes: Faixa): boolean {
  const a = ORDEM_FAIXA[agora];
  const b = ORDEM_FAIXA[antes];
  return a !== undefined && b !== undefined && a < b;
}

/** Soma dos grupos que contêm a unidade (a base de uma unidade). */
export function baseDaUnidade(grupos: GrupoBase[], unidadeId: number) {
  return somarGrupos(grupos.filter((g) => g.unidade_ids.includes(unidadeId)));
}

/** Soma dos grupos de pelo menos uma das unidades: conta de duas unidades entra uma vez. */
export function baseDoFiltro(grupos: GrupoBase[], ids: Set<number>) {
  return somarGrupos(grupos.filter((g) => g.unidade_ids.some((u) => ids.has(u))));
}

function somarGrupos(grupos: GrupoBase[]) {
  let elegiveis = 0;
  let comContato = 0;
  let trabalhadas: number | null = 0;
  for (const g of grupos) {
    elegiveis += g.elegiveis;
    comContato += g.comContato;
    trabalhadas = trabalhadas === null || g.trabalhadas === null ? null : trabalhadas + g.trabalhadas;
  }
  return { elegiveis, comContato, trabalhadas };
}

/** Cobertura em % (uma casa); null quando não há elegível ou os negócios não foram lidos. */
export function cobertura(b: { elegiveis: number; trabalhadas: number | null }): number | null {
  if (b.elegiveis <= 0 || b.trabalhadas === null) return null;
  return Math.round((1000 * b.trabalhadas) / b.elegiveis) / 10;
}

export interface LinhaRegua {
  unidade: UnidadeCoo;
  elegiveis: number;
  comContato: number;
  trabalhadas: number | null;
  coorte: Coorte;
  nota: Nota | null;
  faixa: Faixa;
  /** A mesma régua com a data de referência 7 dias atrás (a base pronta é a de hoje). */
  antes: { coorte: Coorte; nota: Nota | null; faixa: Faixa };
}

/** A régua das unidades pedidas, na ordem de leitura: maior nota primeiro, sem nota no fim. */
export function reguaDasUnidades(
  grupos: GrupoBase[],
  negocios: NegocioRegua[],
  unidades: UnidadeCoo[],
  hoje: string,
): LinhaRegua[] {
  const ref7 = menosDias(hoje, REGUA.comparacaoDias);
  return unidades
    .map((u) => {
      const b = baseDaUnidade(grupos, u.id);
      const coorte = coorteDaUnidade(negocios, u.id, hoje);
      const nota = notaEngajamento(b, coorte);
      const coorte7 = coorteDaUnidade(negocios, u.id, ref7);
      const nota7 = notaEngajamento(b, coorte7);
      return {
        unidade: u,
        ...b,
        coorte,
        nota,
        faixa: faixa(b, coorte, nota),
        antes: { coorte: coorte7, nota: nota7, faixa: faixa(b, coorte7, nota7) },
      };
    })
    .sort(
      (a, b) =>
        (b.nota?.nota ?? -1) - (a.nota?.nota ?? -1) ||
        b.elegiveis - a.elegiveis ||
        a.unidade.nome.localeCompare(b.unidade.nome, "pt-BR"),
    );
}

// ---------------------------------------------------------------------------------------------
// Montagem do tema
// ---------------------------------------------------------------------------------------------

const DONO = "Receitas · Pedro Luca";
const FONTE_BASE = "Base de clientes (régua de oferta da Monetização)";
const FONTE_PIPE = "Pipe de Monetização no Pipedrive (espelho do CRM)";
const FONTE_REGUA = "Base de clientes e pipe de Monetização";

const inteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const umaCasa = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const n0 = (v: number) => inteiro.format(v);
const plural = (n: number, um: string, varios: string) => `${n0(n)} ${n === 1 ? um : varios}`;

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

const DESTINO_FUNIL: Destino = destino(
  "/monetizacao",
  "Abrir o Funil comercial (Monetização)",
  false,
  "O Funil comercial não separa por unidade e abre no mês corrente; a nota por unidade existe só no cockpit.",
  { aba: "funil" },
);
const DESTINO_OPERACAO: Destino = destino(
  "/monetizacao",
  "Abrir a Operação diária (Monetização)",
  false,
  "A Operação não separa por unidade e conta só os movimentos da pré-venda; o cockpit conta todos os negócios das empresas das unidades do filtro.",
  { aba: "operacao" },
);
// Capacidade e alocação e Projetado × realizado saíram do menu da Monetização em 09/10/2026: os alertas que
// levavam a elas abrem a Operação diária.
const DESTINO_CAPACIDADE: Destino = destino(
  "/monetizacao",
  "Abrir a Operação diária (Monetização)",
  false,
  "A Operação mostra a Base elegível aberta e o ritmo de abordagem da pré-venda, sem corte por unidade; a tela Capacidade e alocação saiu do menu em 09/10/2026.",
  { aba: "operacao" },
);

const DESTINO_FORECAST: Destino = destino(
  "/monetizacao",
  "Abrir a Operação diária (Monetização)",
  false,
  "A Operação mostra o realizado da pré-venda no mês, sem a planilha: o projetado fica só no cockpit desde que a aba Projetado × realizado saiu do menu, em 09/10/2026.",
  { aba: "operacao" },
);

/** Realizado ÷ projetado proporcional aos dias corridos: abaixo disto, crítico; abaixo do segundo, atenção. */
export const RITMO_FORECAST = { critico: 0.7, atencao: 0.9 } as const;
/** Sem ao menos isto de esperado até hoje, o ritmo é ruído (começo do mês, degrau pequeno). */
const ESPERADO_MINIMO = 2;
/** Produto sem nenhum contrato só vira alerta a partir desta fração do mês. */
const FRACAO_PRODUTO_ZERADO = 0.5;
// Desvio do projetado vem antes de cobrar a unidade na mesma gravidade (pedido do Pedro, 30/09).
const PESO_FORECAST = 10_000_000;

/** Fração do mês já contada (dia do corte ÷ dias do mês); 1 em mês fechado. */
export function fracaoDoMes(m: Pick<MesForecast, "mes" | "ate" | "parcial">): number {
  if (!m.parcial) return 1;
  const dias = new Date(Date.UTC(Number(m.mes.slice(0, 4)), Number(m.mes.slice(5, 7)), 0)).getUTCDate();
  return Math.min(1, Number(m.ate.slice(8, 10)) / dias);
}

const LIMIAR = {
  semReuniao: `Cobrar a unidade: ${REGUA.amostraMinima} ou mais leads maduros (primeiro trabalho entre ${REGUA.janela.de} e ${REGUA.janela.ate} dias atrás) e nenhuma reunião marcada ou realizada.`,
  parada: `Cobrar a unidade: nota de engajamento abaixo de ${REGUA.morna} (faixa parada), com ${REGUA.amostraMinima} ou mais leads maduros.`,
  caiu: `Cobrar a unidade: a faixa de hoje é menor que a de ${REGUA.comparacaoDias} dias atrás (engajada ${REGUA.engajada}+, morna ${REGUA.morna}–${REGUA.engajada - 1}, parada abaixo de ${REGUA.morna}).`,
  matrizSemTrabalho: `Cobrar a matriz: ${REGUA.matrizElegiveis} ou mais contas elegíveis e menos de ${REGUA.matrizLeads} leads maduros.`,
  matrizCobertura: `Cobrar a matriz: menos de ${REGUA.coberturaMinima}% das contas elegíveis com negócio no pipe da Monetização.`,
  degrau: `Realizado abaixo de ${RITMO_FORECAST.critico * 100}% (crítico) ou ${RITMO_FORECAST.atencao * 100}% (atenção) do projetado proporcional aos dias corridos do mês, com ao menos ${ESPERADO_MINIMO} esperados até hoje.`,
  produto: `Produto com 2 ou mais contratos projetados no mês e nenhum ganho, com metade do mês corrida.`,
};

// Cobrar a unidade vem antes de cobrar a matriz na mesma gravidade (o pedido do COO é sobre a
// unidade); dentro de cada tipo, a maior base elegível primeiro.
const PESO_UNIDADE = 1_000_000;

const COMO_CALCULA_NOTA =
  "Nota de 0 a 100 por unidade. A · base pronta (peso 25): elegíveis com contato ÷ elegíveis. " +
  "B · aceite de reunião (peso 35): leads maduros com reunião marcada ou realizada ÷ leads maduros; 50% vale 100. " +
  "C · avanço (peso 20): leads maduros validados ÷ leads maduros; 40% vale 100. " +
  "Lead maduro: negócio do pipe com o primeiro trabalho entre 30 e 7 dias atrás. " +
  "Faixas: 70 ou mais engajada, 40 a 69 morna, abaixo de 40 parada; menos de 5 leads maduros é sem amostra, e unidade sem elegíveis é sem base. " +
  "Negócio de empresa com duas unidades conta nas duas; negócio sem unidade não conta para nenhuma. " +
  "Elegível é a régua de oferta da Base de clientes (Consultoria, Finance ou Cella).";

const ATENCAO_D =
  "A parte D (ação da unidade, peso 20) não tem registro: todo negócio do pipe é criado e movido pela matriz. " +
  "Enquanto não existir, a nota é (25A + 35B + 20C) ÷ 80, e B e C medem a resposta da carteira da unidade, não a ação do sócio.";

/** Estado de um número que depende de partes lidas: parcial se alguma está parada. */
function estadoDasPartes(
  ...partes: ({ parada: string | null; atualizadoEm: string | null })[]
): { estado: Estado; motivo?: string; dataDado: string | null } {
  const paradas = partes.map((p) => p.parada).filter((p): p is string => !!p);
  const datas = partes.map((p) => p.atualizadoEm).filter((d): d is string => !!d).sort();
  return {
    estado: paradas.length ? "parcial" : "disponivel",
    motivo: paradas.length ? paradas.join(" ") : undefined,
    dataDado: datas[0] ?? null,
  };
}

function primeiraFalha(...partes: (FalhaParte | { ok: true })[]): FalhaParte | null {
  for (const p of partes) if (!p.ok) return p as FalhaParte;
  return null;
}

function tabelaDaRegua(linhas: LinhaRegua[]): TabelaDados {
  return tabela(
    [
      "Unidade",
      "Nota (0–100)",
      "Faixa",
      "Faixa há 7 dias",
      "Leads maduros",
      "Com reunião",
      "Validados",
      "Elegíveis",
      "Base pronta (%)",
    ],
    linhas.map((l) => [
      l.unidade.nome + (l.unidade.emOperacao ? "" : " (em implantação)"),
      l.nota?.nota ?? null,
      ROTULO_FAIXA[l.faixa],
      ROTULO_FAIXA[l.antes.faixa],
      l.coorte.leads,
      l.coorte.comReuniao,
      l.coorte.validadas,
      l.elegiveis,
      l.elegiveis > 0 ? Math.round((100 * l.comContato) / l.elegiveis) : null,
    ]),
  );
}

export function montarMonetizacao(
  dados: DadosMonetizacao,
  unidades: UnidadeCoo[],
  filtro: FiltroUnidade,
  hoje: string,
): LeituraTema {
  const sel = unidadesDoFiltro(unidades, filtro);
  const ids = new Set(sel.map((u) => u.id));
  const { base, negocios } = dados;
  const mes = hoje.slice(0, 7);
  const deMes = inicioDoMes(hoje);
  const nomeMes = MESES[Number(hoje.slice(5, 7)) - 1] ?? mes;

  const { forecast } = dados;
  const fonteForecast = forecast.ok ? `Forecast ${forecast.versao} (planilha) × pipe de Monetização (CRM)` : "Forecast da Monetização (planilha) × pipe de Monetização (CRM)";
  const fontes: Procedencia[] = [
    { fonte: fonteForecast, atualizadoEm: forecast.ok ? forecast.atualizadoEm : null },
    { fonte: FONTE_BASE, atualizadoEm: base.ok ? base.atualizadoEm : null },
    { fonte: FONTE_PIPE, atualizadoEm: negocios.ok ? negocios.atualizadoEm : null },
  ];
  const avisos = [
    "Projetado × realizado é da frente inteira de Monetização: a planilha de forecast não projeta por unidade.",
    "Parte D da régua (ação da unidade, peso 20) sem registro: a nota é (25A + 35B + 20C) ÷ 80 até existir.",
    "A nota de 7 dias atrás usa a base pronta de hoje: o contato da Base não tem histórico.",
  ];

  const regua =
    base.ok && negocios.ok ? reguaDasUnidades(base.grupos, negocios.lista, sel, hoje) : null;
  const falhaRegua = primeiraFalha(base, negocios);
  const estadoRegua = base.ok && negocios.ok ? estadoDasPartes(base, negocios) : null;
  // Unidade em implantação não entra em número de desempenho: fica na régua e no gráfico, sem
  // contar em engajadas e paradas, e sem alerta de cobrar a unidade.
  const desempenho = regua?.filter((l) => l.unidade.emOperacao) ?? [];
  const comAmostra = desempenho.filter((l) => l.nota !== null);
  const implantacao = sel.filter((u) => !u.emOperacao).length;
  const motivoSemDesempenho = !desempenho.length
    ? "só há unidades em implantação no filtro, e elas não entram em número de desempenho"
    : "nenhuma unidade em operação do filtro tem 5 ou mais leads maduros";

  const numeros: NumeroCoo[] = [];

  // 1 a 4 · Projetado × realizado do mês corrente (frente inteira: a planilha não projeta por unidade)
  const doMes = forecast.ok ? forecast.meses.find((m) => m.mes === mes) ?? null : null;
  const fracao = doMes ? fracaoDoMes(doMes) : 1;
  const pctCorrido = Math.round(fracao * 100);
  const comFiltro = !!filtro;
  const motivoForecast = !forecast.ok
    ? forecast.motivo
    : !doMes
      ? `a planilha em uso (${forecast.versao}) não tem ${nomeMes}: ela cobre ${forecast.meses[0]?.mes ?? "?"} a ${forecast.meses.at(-1)?.mes ?? "?"}`
      : "o CRM ainda não tem realizado para este mês";
  const estadoForecast = forecast.ok ? estadoDasPartes(forecast) : null;
  for (const d of DEGRAUS) {
    const b: BaseNumero = {
      id: `projetado-${d.chave}`,
      rotulo: `${d.rotulo} × projetado`,
      unidade: "negócios",
      cobertura: "grupo",
      fonte: fonteForecast,
      destino: DESTINO_FORECAST,
      explicacao: {
        oQueDiz: `${d.rotulo} no mês corrente no pipe de Monetização, contra o que a planilha de forecast projetou para o mês. É a conta da antiga aba "Projetado × realizado" do módulo, que saiu do menu em 09/10/2026.`,
        comoCalcula: `Realizado: negócios do pipe de Monetização com o evento (${d.chave}) entre ${deMes} e o corte do CRM, pela conta de forecastComparison. Projetado: linha ${d.linha} da planilha em uso${forecast.ok ? ` (${forecast.versao}, de ${forecast.fonteData.split("-").reverse().join("/")})` : ""}.`,
        atencao: `Mês em andamento compara com a meta do mês inteiro; o ritmo (alerta) usa o projetado proporcional aos dias corridos. A planilha não projeta por unidade: com filtro de unidade, o número continua sendo da frente inteira.${forecast.ok && forecast.nota ? ` ${forecast.nota}` : ""}`,
        dono: DONO,
      },
    };
    const plan = doMes?.projetado[d.chave] ?? null;
    const real = doMes?.realizado?.[d.chave] ?? null;
    if (!forecast.ok || !doMes || real === null || !estadoForecast) {
      numeros.push(
        numeroSem(b, forecast.ok ? "nao_apurado" : forecast.estado, motivoForecast, {
          nota: plan !== null ? `projetado ${n0(plan)} em ${nomeMes}` : undefined,
        }),
      );
      continue;
    }
    const pct = plan ? Math.round((100 * real) / plan) : null;
    const esperado = plan !== null ? plan * fracao : null;
    const ritmo = esperado ? real / esperado : null;
    const tom: NumeroCoo["tom"] =
      ritmo === null ? undefined : ritmo < RITMO_FORECAST.critico ? "perigo" : ritmo < RITMO_FORECAST.atencao ? "atencao" : ritmo >= 1 ? "sucesso" : undefined;
    const porProduto = d.chave === "signed" || d.chave === "started";
    numeros.push(
      numeroOk(b, real, {
        nota:
          pct === null
            ? "sem projetado na planilha para este mês"
            : `${pct}% do projetado${doMes.parcial ? ` com ${pctCorrido}% do mês corrido` : ` em ${nomeMes}`}${comFiltro ? " · frente inteira" : ""}`,
        meta: plan !== null ? { valor: plan, rotulo: `projetado em ${nomeMes}` } : undefined,
        tom,
        estado: estadoForecast.estado,
        motivo: estadoForecast.motivo,
        dataDado: estadoForecast.dataDado,
        dados: porProduto
          ? tabela(
              ["Produto", "Projetado", "Realizado", "Diferença"],
              doMes.produtos.map((p) => {
                const pl = d.chave === "signed" ? p.projetadoContratos : p.projetadoLeads;
                const r = d.chave === "signed" ? p.contratos : p.leads;
                return [p.nome, pl, r, pl !== null && r !== null ? r - pl : null];
              }),
            )
          : tabela(
              ["Mês", "Projetado", "Realizado"],
              forecast.meses
                .filter((m) => m.realizado || m.mes <= mes)
                .map((m) => [m.mes.split("-").reverse().join("/"), m.projetado[d.chave], m.realizado?.[d.chave] ?? null]),
            ),
      }),
    );
  }

  // 5 · Unidades engajadas
  {
    const b: BaseNumero = {
      id: "unidades-engajadas",
      rotulo: "Unidades engajadas",
      // Não há "unidades" em UnidadeContagem; o campo só formata o inteiro.
      unidade: "contas",
      cobertura: "todas",
      fonte: FONTE_REGUA,
      destino: DESTINO_FUNIL,
      explicacao: {
        oQueDiz:
          "Quantas unidades em operação do filtro, entre as que têm amostra, estão na faixa engajada (nota 70 ou mais) da régua de engajamento na Monetização.",
        comoCalcula: COMO_CALCULA_NOTA,
        atencao: `${ATENCAO_D} Unidade em implantação aparece no gráfico, mas não entra nesta contagem.`,
        dono: DONO,
      },
    };
    if (!regua || !estadoRegua) numeros.push(numeroSem(b, falhaRegua!.estado, falhaRegua!.motivo));
    else if (!comAmostra.length) numeros.push(numeroSem(b, "nao_apurado", motivoSemDesempenho));
    else {
      const engajadas = comAmostra.filter((l) => l.faixa === "engajada").length;
      numeros.push(
        numeroOk(b, engajadas, {
          nota: `de ${plural(comAmostra.length, "unidade com amostra", "unidades com amostra")}`,
          estado: estadoRegua.estado,
          motivo: estadoRegua.motivo,
          dataDado: estadoRegua.dataDado,
          dados: tabelaDaRegua(regua),
        }),
      );
    }
  }

  // 6 · Unidades paradas
  {
    const b: BaseNumero = {
      id: "unidades-paradas",
      rotulo: "Unidades paradas",
      unidade: "contas",
      cobertura: "todas",
      fonte: FONTE_REGUA,
      destino: DESTINO_FUNIL,
      explicacao: {
        oQueDiz:
          "Quantas unidades em operação do filtro estão na faixa parada (nota abaixo de 40): são as que o COO cobra primeiro.",
        comoCalcula: COMO_CALCULA_NOTA,
        atencao: ATENCAO_D,
        dono: DONO,
      },
    };
    if (!regua || !estadoRegua) numeros.push(numeroSem(b, falhaRegua!.estado, falhaRegua!.motivo));
    else if (!comAmostra.length) numeros.push(numeroSem(b, "nao_apurado", motivoSemDesempenho));
    else {
      const paradas = comAmostra.filter((l) => l.faixa === "parada");
      numeros.push(
        numeroOk(b, paradas.length, {
          nota:
            paradas.length && paradas.length <= 3
              ? paradas.map((l) => l.unidade.nome).join(", ")
              : `de ${plural(comAmostra.length, "unidade com amostra", "unidades com amostra")}`,
          tom: paradas.length ? "perigo" : "sucesso",
          estado: estadoRegua.estado,
          motivo: estadoRegua.motivo,
          dataDado: estadoRegua.dataDado,
          dados: tabelaDaRegua(comAmostra),
        }),
      );
    }
  }

  // Gráfico: nota por unidade, com a faixa
  const baseGrafico = {
    id: "engajamento-por-unidade",
    titulo: "Quais unidades estão mais engajadas no projeto?",
    tipo: "barras-h" as const,
    series: [{ chave: "nota", rotulo: "Nota de engajamento (0 a 100)" }],
    unidade: "contas" as const,
    fonte: FONTE_REGUA,
    destino: DESTINO_FUNIL,
    explicacao: {
      oQueDiz:
        "Nota de engajamento de cada unidade do filtro na Monetização, com a faixa (engajada, morna, parada). Sem nota: sem amostra (menos de 5 leads maduros) ou sem base (nenhuma conta elegível).",
      comoCalcula: COMO_CALCULA_NOTA,
      atencao: ATENCAO_D,
      dono: DONO,
    },
  };
  const explicacaoForecast = {
    oQueDiz:
      "O realizado do mês no pipe de Monetização contra o projetado da planilha de forecast, com a conta da antiga aba Projetado × realizado do módulo (saiu do menu em 09/10/2026).",
    comoCalcula: `Mesma conta dos cartões (forecastComparison): realizado até o corte do CRM, projetado do mês inteiro${forecast.ok ? ` (planilha ${forecast.versao})` : ""}.`,
    atencao: "Mês em andamento compara com a meta do mês inteiro. A planilha não projeta por unidade: o gráfico é da frente inteira.",
    dono: DONO,
  };
  const semForecast = { estado: (forecast.ok ? "nao_apurado" : forecast.estado) as Estado, motivo: motivoForecast };
  const graficoDegraus = grafico(
    {
      id: "projetado-degraus",
      titulo: "Em que degrau o mês descolou do plano?",
      tipo: "barras-h",
      series: [
        { chave: "realizado", rotulo: "Realizado · CRM" },
        { chave: "projetado", rotulo: forecast.ok ? `Projetado · planilha ${forecast.versao}` : "Projetado · planilha" },
      ],
      unidade: "negócios",
      fonte: fonteForecast,
      destino: DESTINO_FORECAST,
      explicacao: explicacaoForecast,
    },
    doMes?.realizado && estadoForecast
      ? DEGRAUS.map((d) => ({ rotulo: d.rotulo, realizado: doMes.realizado![d.chave], projetado: doMes.projetado[d.chave] }))
      : [],
    doMes?.realizado && estadoForecast
      ? { estado: estadoForecast.estado, motivo: estadoForecast.motivo, dataDado: estadoForecast.dataDado }
      : semForecast,
  );
  const graficoProdutos = grafico(
    {
      id: "projetado-produtos",
      titulo: "Qual produto está abaixo do projetado?",
      tipo: "barras-h",
      series: [
        { chave: "contratos", rotulo: "Contratos ganhos" },
        { chave: "projetados", rotulo: "Contratos projetados" },
      ],
      unidade: "negócios",
      fonte: fonteForecast,
      destino: DESTINO_FORECAST,
      explicacao: { ...explicacaoForecast, oQueDiz: "Contratos ganhos no mês por produto (Cella, Consultoria, Finance) contra os contratos que a planilha projetou para cada um." },
    },
    doMes?.realizado && estadoForecast
      ? doMes.produtos.map((p) => ({ rotulo: p.nome, contratos: p.contratos, projetados: p.projetadoContratos }))
      : [],
    doMes?.realizado && estadoForecast
      ? { estado: estadoForecast.estado, motivo: estadoForecast.motivo, dataDado: estadoForecast.dataDado }
      : semForecast,
  );
  const graficos: GraficoCoo[] = [
    graficoDegraus,
    graficoProdutos,
    regua && estadoRegua
      ? grafico(
          baseGrafico,
          regua.map((l) => ({
            rotulo: l.unidade.nome,
            nota: l.nota?.nota ?? null,
            faixa: ROTULO_FAIXA[l.faixa] + (l.unidade.emOperacao ? "" : " · em implantação"),
          })),
          {
            estado: estadoRegua.estado,
            motivo: estadoRegua.motivo,
            dataDado: estadoRegua.dataDado,
          },
        )
      : grafico(baseGrafico, [], { estado: falhaRegua!.estado, motivo: falhaRegua!.motivo }),
  ];

  // Alertas: no máximo um "cobrar a unidade" e um "cobrar a matriz" por unidade, a regra mais
  // específica primeiro, para o mesmo problema não virar duas tarefas no ClickUp.
  const alertas: AlertaCoo[] = [];
  if (doMes?.realizado && estadoForecast) {
    for (const d of DEGRAUS) {
      const plan = doMes.projetado[d.chave];
      const real = doMes.realizado[d.chave];
      if (plan === null || !plan) continue;
      const esperado = plan * fracao;
      if (esperado < ESPERADO_MINIMO) continue;
      const ritmo = real / esperado;
      if (ritmo >= RITMO_FORECAST.atencao) continue;
      alertas.push(
        alerta(
          "monetizacao",
          `projetado-${d.chave}`,
          ritmo < RITMO_FORECAST.critico ? "critico" : "atencao",
          `Monetização · ${d.rotulo.toLowerCase()} em ${Math.round((100 * real) / plan)}% do projetado de ${nomeMes} (${n0(real)} de ${n0(plan)})`,
          {
            peso: PESO_FORECAST + Math.round((1 - ritmo) * 1000),
            destino: DESTINO_FORECAST,
            limiar: LIMIAR.degrau,
            periodo: mes,
          },
        ),
      );
    }
    if (fracao >= FRACAO_PRODUTO_ZERADO)
      for (const p of doMes.produtos)
        if ((p.projetadoContratos ?? 0) >= 2 && p.contratos === 0)
          alertas.push(
            alerta(
              "monetizacao",
              `produto-sem-contrato-${p.produto}`,
              "atencao",
              `${p.nome} · nenhum contrato ganho de ${n0(p.projetadoContratos!)} projetados em ${nomeMes}`,
              {
                peso: PESO_FORECAST + p.projetadoContratos!,
                destino: DESTINO_FORECAST,
                limiar: LIMIAR.produto,
                periodo: mes,
              },
            ),
          );
  }
  for (const l of regua ?? []) {
    const u = l.unidade;
    if (u.emOperacao) {
      const caiu = caiuDeFaixa(l.faixa, l.antes.faixa);
      if (l.coorte.leads >= REGUA.amostraMinima && l.coorte.comReuniao === 0)
        alertas.push(
          alerta("monetizacao", "unidade-sem-reuniao", "critico", `${u.nome} · ${n0(l.coorte.leads)} leads maduros e nenhuma reunião`, {
            unidade: u.nome,
            peso: PESO_UNIDADE + l.elegiveis,
            destino: DESTINO_FUNIL,
            limiar: LIMIAR.semReuniao,
            periodo: mes,
          }),
        );
      else if (l.faixa === "parada" && l.nota)
        alertas.push(
          alerta(
            "monetizacao",
            "unidade-parada",
            "critico",
            `${u.nome} · unidade parada: nota ${l.nota.nota}` +
              (caiu && l.antes.nota ? ` (era ${l.antes.nota.nota} há ${REGUA.comparacaoDias} dias)` : ""),
            {
              unidade: u.nome,
              peso: PESO_UNIDADE + l.elegiveis,
              destino: DESTINO_FUNIL,
              limiar: LIMIAR.parada,
              periodo: mes,
            },
          ),
        );
      else if (caiu && l.nota && l.antes.nota)
        alertas.push(
          alerta(
            "monetizacao",
            "unidade-caiu-de-faixa",
            "atencao",
            `${u.nome} · caiu de ${ROTULO_FAIXA[l.antes.faixa]} para ${ROTULO_FAIXA[l.faixa]}: nota ${l.nota.nota} (era ${l.antes.nota.nota})`,
            {
              unidade: u.nome,
              peso: PESO_UNIDADE + l.elegiveis,
              destino: DESTINO_FUNIL,
              limiar: LIMIAR.caiu,
              periodo: mes,
            },
          ),
        );
    }
    const pct = cobertura(l);
    const ociosas = l.elegiveis - (l.trabalhadas ?? 0);
    if (l.elegiveis >= REGUA.matrizElegiveis && l.coorte.leads < REGUA.matrizLeads)
      alertas.push(
        alerta(
          "monetizacao",
          "matriz-sem-trabalho",
          "atencao",
          `${u.nome} · matriz sem trabalho: ${n0(l.elegiveis)} elegíveis, ${
            l.coorte.leads === 0 ? "nenhum lead maduro" : plural(l.coorte.leads, "lead maduro", "leads maduros")
          }`,
          {
            unidade: u.nome,
            peso: ociosas,
            destino: DESTINO_CAPACIDADE,
            limiar: LIMIAR.matrizSemTrabalho,
            periodo: mes,
          },
        ),
      );
    else if (pct !== null && pct < REGUA.coberturaMinima)
      alertas.push(
        alerta(
          "monetizacao",
          "matriz-cobertura-baixa",
          "atencao",
          `${u.nome} · matriz com cobertura baixa: ${umaCasa.format(pct)}% dos ${n0(l.elegiveis)} elegíveis com negócio`,
          {
            unidade: u.nome,
            peso: ociosas,
            destino: DESTINO_CAPACIDADE,
            limiar: LIMIAR.matrizCobertura,
            periodo: mes,
          },
        ),
      );
  }

  if (implantacao && regua)
    avisos.push(
      `${plural(implantacao, "unidade em implantação aparece", "unidades em implantação aparecem")} no gráfico, fora da contagem de engajadas e paradas.`,
    );

  return {
    tema: "monetizacao",
    universo: universo(unidades, filtro),
    numeros,
    alertas,
    graficos,
    fontes,
    avisos,
  };
}
