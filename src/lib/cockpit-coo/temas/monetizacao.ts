// Qui · Monetização: "Quais unidades estão engajadas no projeto, e quem eu preciso cobrar?"
//
// Pedido do COO em 29/09/2026: "Preciso saber quais são as unidades mais engajadas no projeto,
// assim como preciso ser alertado quando isso não acontecer para poder cobrá-los."
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

export interface DadosMonetizacao {
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
  return { base: falha, negocios: falha };
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
  "A Operação não separa por unidade e conta só os movimentos do farmer padrão; o cockpit conta todos os negócios das empresas das unidades do filtro.",
  { aba: "operacao" },
);
const DESTINO_CAPACIDADE: Destino = destino(
  "/monetizacao",
  "Abrir Capacidade e alocação (Monetização)",
  false,
  "A Capacidade mostra a base elegível e o trabalho da frente inteira, sem corte por unidade.",
  { aba: "capacidade" },
);

const LIMIAR = {
  semReuniao: `Cobrar a unidade: ${REGUA.amostraMinima} ou mais leads maduros (primeiro trabalho entre ${REGUA.janela.de} e ${REGUA.janela.ate} dias atrás) e nenhuma reunião marcada ou realizada.`,
  parada: `Cobrar a unidade: nota de engajamento abaixo de ${REGUA.morna} (faixa parada), com ${REGUA.amostraMinima} ou mais leads maduros.`,
  caiu: `Cobrar a unidade: a faixa de hoje é menor que a de ${REGUA.comparacaoDias} dias atrás (engajada ${REGUA.engajada}+, morna ${REGUA.morna}–${REGUA.engajada - 1}, parada abaixo de ${REGUA.morna}).`,
  matrizSemTrabalho: `Cobrar a matriz: ${REGUA.matrizElegiveis} ou mais contas elegíveis e menos de ${REGUA.matrizLeads} leads maduros.`,
  matrizCobertura: `Cobrar a matriz: menos de ${REGUA.coberturaMinima}% das contas elegíveis com negócio no pipe da Monetização.`,
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

  const fontes: Procedencia[] = [
    { fonte: FONTE_BASE, atualizadoEm: base.ok ? base.atualizadoEm : null },
    { fonte: FONTE_PIPE, atualizadoEm: negocios.ok ? negocios.atualizadoEm : null },
  ];
  const avisos = [
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

  // 1 · Unidades engajadas
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

  // 2 · Unidades paradas
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

  // 3 e 4 · Eventos do mês (ganhos e validadas) nas empresas das unidades do filtro
  const eventoDoMes = (
    id: string,
    rotulo: string,
    evento: "signed" | "validated",
    oQueDiz: string,
    atencao: string,
  ) => {
    const b: BaseNumero = {
      id,
      rotulo,
      unidade: "negócios",
      cobertura: "todas",
      fonte: FONTE_PIPE,
      destino: DESTINO_OPERACAO,
      explicacao: {
        oQueDiz,
        comoCalcula: `Negócios do pipe de Monetização com o evento (${evento}) entre ${deMes} e ${hoje}, no fuso de São Paulo, cuja empresa é de uma unidade do filtro. A unidade vem da Base: organização do Pipedrive → conta → unidades. Negócio de empresa com duas unidades conta uma vez no total.`,
        atencao,
        dono: DONO,
      },
    };
    if (!negocios.ok) return numeroSem(b, negocios.estado, negocios.motivo);
    const noMes = negocios.lista.filter((n) => n[evento].some((d) => d >= deMes && d <= hoje));
    const doFiltro = noMes.filter((n) => n.unidade_ids.some((u) => ids.has(u)));
    const semUnidade = noMes.filter((n) => n.unidade_ids.length === 0).length;
    const e = estadoDasPartes(negocios);
    return numeroOk(b, doFiltro.length, {
      nota: semUnidade
        ? `${plural(semUnidade, "negócio sem unidade ficou", "negócios sem unidade ficaram")} de fora`
        : `em ${nomeMes}`,
      estado: e.estado,
      motivo: e.motivo,
      dataDado: e.dataDado,
      dados: tabela(
        ["Unidade", rotulo],
        sel.map((u) => [u.nome, doFiltro.filter((n) => n.unidade_ids.includes(u.id)).length]),
      ),
    });
  };
  numeros.push(
    eventoDoMes(
      "contratos-ganhos-mes",
      "Contratos ganhos no mês",
      "signed",
      "Contratos de produto (Consultoria, Finance, Cella) ganhos no pipe da Monetização no mês corrente, em empresas das unidades do filtro.",
      "Ganho no CRM não é contrato assinado nem receita. Inclui unidades em implantação: é resultado da Monetização na carteira, não desempenho da unidade.",
    ),
    eventoDoMes(
      "oportunidades-validadas-mes",
      "Oportunidades validadas no mês",
      "validated",
      "Negócios que entraram pela primeira vez em Negociação ou etapa superior no mês corrente, em empresas das unidades do filtro.",
      "Reciclado não valida. Inclui unidades em implantação: é resultado da Monetização na carteira, não desempenho da unidade.",
    ),
  );

  // 5 · Cobertura da base
  {
    const b: BaseNumero = {
      id: "cobertura-base",
      rotulo: "Cobertura da base elegível",
      unidade: "percentual",
      cobertura: "todas",
      fonte: FONTE_REGUA,
      destino: DESTINO_CAPACIDADE,
      explicacao: {
        oQueDiz:
          "Parte das contas elegíveis das unidades do filtro que já tem negócio no pipe de Monetização: quanto da base a matriz já está trabalhando.",
        comoCalcula:
          "Contas elegíveis (régua de oferta da Base de clientes: Consultoria, Finance ou Cella) cuja organização do Pipedrive está em algum negócio do pipe, dividido pelas contas elegíveis. Conta de duas unidades entra uma vez.",
        atencao: `Unidade com cobertura abaixo de ${REGUA.coberturaMinima}% vira alerta para cobrar a matriz.`,
        dono: DONO,
      },
    };
    const falha = primeiraFalha(base, negocios);
    if (falha || !base.ok || !negocios.ok) numeros.push(numeroSem(b, falha!.estado, falha!.motivo));
    else {
      const t = baseDoFiltro(base.grupos, ids);
      const pct = cobertura(t);
      if (pct === null)
        numeros.push(
          numeroSem(b, "nao_apurado", "nenhuma conta elegível nas unidades do filtro"),
        );
      else {
        const e = estadoDasPartes(base, negocios);
        numeros.push(
          numeroOk(b, pct, {
            nota: `${n0(t.trabalhadas ?? 0)} de ${n0(t.elegiveis)} elegíveis com negócio`,
            tom: pct < REGUA.coberturaMinima ? "atencao" : undefined,
            estado: e.estado,
            motivo: e.motivo,
            dataDado: e.dataDado,
            dados: tabela(
              ["Unidade", "Elegíveis", "Com negócio", "Cobertura (%)"],
              sel.map((u) => {
                const x = baseDaUnidade(base.grupos, u.id);
                return [u.nome, x.elegiveis, x.trabalhadas, cobertura(x)];
              }),
            ),
          }),
        );
      }
    }
  }

  // 6 · Lacuna: leads maduros sem unidade
  {
    const b: BaseNumero = {
      id: "leads-sem-unidade",
      rotulo: "Leads maduros sem unidade",
      unidade: "negócios",
      cobertura: "todas",
      fonte: FONTE_PIPE,
      destino: DESTINO_OPERACAO,
      explicacao: {
        oQueDiz:
          "Leads maduros do pipe cuja empresa não tem unidade na Base: a régua não os atribui a nenhuma unidade.",
        comoCalcula:
          "Negócios com o primeiro trabalho entre 30 e 7 dias atrás cuja organização do Pipedrive não casa com nenhuma conta com unidade na Base de clientes.",
        atencao:
          "Não segue o filtro de unidade: são justamente os negócios sem unidade. Corrigir é vincular a empresa a uma unidade na Base de clientes.",
        dono: DONO,
      },
    };
    if (!negocios.ok) numeros.push(numeroSem(b, negocios.estado, negocios.motivo));
    else {
      const maduros = negocios.lista.filter((n) => naCoorte(n, hoje));
      const sem = maduros.filter((n) => n.unidade_ids.length === 0).length;
      const e = estadoDasPartes(negocios);
      numeros.push(
        numeroOk(b, sem, {
          nota: `de ${plural(maduros.length, "lead maduro", "leads maduros")} no pipe`,
          tom: sem ? "atencao" : undefined,
          estado: e.estado,
          motivo: e.motivo,
          dataDado: e.dataDado,
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
  const graficos: GraficoCoo[] = [
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
