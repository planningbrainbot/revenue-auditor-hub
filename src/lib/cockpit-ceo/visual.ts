// Modelos dos gráficos do Cockpit do CEO (revisão visual de 28/09/2026).
//
// Funções puras sobre o `Cockpit` já montado e sobre as leituras novas (`RespostaVisual`): nenhuma
// regra de negócio nova além das réguas escritas aqui, e cada réguas diz o que conta. O componente
// só desenha o que sai daqui, então a homologação confere estes números sem abrir navegador.
//
// Regras que atravessam o arquivo:
// - ausência nunca vira 0: mês sem dado, fonte fora e sem acesso saem como `estado`, e o gráfico
//   desenha hachura ou vazio com rótulo;
// - nada é fixo no código além da meta (R$ 1 bi/ano em 2030) e da referência de 2,34% do mapa de
//   investidores: média, ritmo, degraus, distância e taxas são calculados sobre a fonte.
import type { Destino, Estado } from "./contrato.ts";
import type { Cockpit, Decisao } from "./indicadores.ts";
import type { PonteMes } from "./financeiro.ts";
import type { Falha } from "./operacao.ts";
import { FASE_CHURN, FASE_CONCLUIDO } from "./operacao.ts";
import { ANO_ALVO, MEDIA_MENSAL_NECESSARIA, mesBr } from "./receita.ts";

// ── Leituras novas (visual.functions.ts) ─────────────────────────────────────

export type ParteVisual<T> =
  | ({ estado: "ok" } & T)
  | Falha
  | { estado: "nao_apurado"; motivo: string };

/** Uma taxa mensal de saída: `saidas / base`, com a base contada no começo do mês. */
export interface MesTaxa {
  mes: string;
  base: number;
  saidas: number;
  /** `null` quando a base é zero: sem base não existe taxa (não é 0%). */
  taxa: number | null;
}

export interface MesFranqueadora {
  mes: string;
  /** Títulos não cancelados com vencimento no mês. */
  faturado: number;
  recebido: number;
  /** Atrasado + a vencer + vence hoje. */
  emAberto: number;
  titulos: number;
}

export interface CategoriaReceita {
  categoria: string;
  receita: number;
  /** Como o de/para da controladoria marca a categoria; `null` quando a fonte não diz. */
  recorrente: boolean | null;
  clientes: number;
}

export interface RespostaVisual {
  lidoEm: string;
  /** Receita por categoria de serviço, meses fechados do ano (Financeiro). */
  categorias: ParteVisual<{ de: string; ate: string; itens: CategoriaReceita[] }>;
  /** Saída de faturamento só em Honorários Contábeis, por mês fechado (Financeiro). */
  honorarios: ParteVisual<{ meses: MesTaxa[] }>;
  /** Contratos de serviço do Omie das unidades: MRR ativo por base e encerramentos por mês. */
  omie: ParteVisual<{
    sincronizadoEm: string | null;
    unidades: { unidade: string; mrr: number; contratos: number }[];
    /** Contratos fora do ativo (situação ≠ 10), contados à parte. */
    foraDoAtivo: { situacao: string; contratos: number; mrr: number }[];
    porContrato: MesTaxa[];
    /** Mesma base, ponderada pelo valor mensal (base e saídas em reais). */
    porValor: MesTaxa[];
  }>;
  /** Churn datado da Central de Tratativas sobre contratos Inside Sales ganhos e não perdidos. */
  tratativas: ParteVisual<{ meses: MesTaxa[]; comData: number; ultimaData: string | null }>;
  /** Títulos da franqueadora (Omie da Partners) por mês de vencimento. */
  franqueadora: ParteVisual<{ meses: MesFranqueadora[]; ultimaCarga: string | null }>;
}

// ── Agregações usadas pelo servidor (e pela homologação) ─────────────────────

const cent = (v: number) => Math.round(v * 100);
const primeiro = (m: string) => `${m}-01`;
export const mesAnterior = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
export const proximoMes = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 7);

/** Os `n` meses fechados até o mês anterior a `hoje`, do mais antigo ao mais novo. */
export function mesesFechados(hoje: string, n = 12): string[] {
  const out: string[] = [];
  let m = mesAnterior(hoje.slice(0, 7));
  while (out.length < n) {
    out.unshift(m);
    m = mesAnterior(m);
  }
  return out;
}

const taxa = (saidas: number, base: number): number | null => (base > 0 ? saidas / base : null);

export interface ContratoOmie {
  unidade: string;
  situacao: string;
  valorMensal: number | null;
  vigenciaInicial: string | null;
  vigenciaFinal: string | null;
}

/**
 * Contratos do Omie das unidades. Ativo = situação 10 com valor mensal > 0 (mesma régua da
 * definição "Contrato de serviço ativo no Omie" da frente Clientes). Encerramento = situação 99,
 * datado pela vigência final; ativo no começo do mês = vigência inicial antes do mês e não encerrado
 * antes dele (régua F1/F2 da investigação de 24/09).
 */
export function agregarOmie(contratos: ContratoOmie[], hoje: string) {
  const porUnidade = new Map<string, { c: number; contratos: number }>();
  const fora = new Map<string, { c: number; contratos: number }>();
  for (const k of contratos) {
    const v = k.valorMensal ?? 0;
    if (k.situacao === "10" && v > 0) {
      const x = porUnidade.get(k.unidade) ?? { c: 0, contratos: 0 };
      x.c += cent(v);
      x.contratos += 1;
      porUnidade.set(k.unidade, x);
    } else {
      const x = fora.get(k.situacao) ?? { c: 0, contratos: 0 };
      x.c += cent(v);
      x.contratos += 1;
      fora.set(k.situacao, x);
    }
  }
  const porContrato: MesTaxa[] = [];
  const porValor: MesTaxa[] = [];
  for (const mes of mesesFechados(hoje)) {
    const ini = primeiro(mes);
    let base = 0;
    let saidas = 0;
    let baseC = 0;
    let saidasC = 0;
    for (const k of contratos) {
      const v = cent(k.valorMensal ?? 0);
      const ativo =
        !!k.vigenciaInicial &&
        k.vigenciaInicial < ini &&
        (k.situacao !== "99" || (!!k.vigenciaFinal && k.vigenciaFinal >= ini));
      if (ativo) {
        base += 1;
        baseC += v;
      }
      if (k.situacao === "99" && k.vigenciaFinal?.slice(0, 7) === mes) {
        saidas += 1;
        saidasC += v;
      }
    }
    porContrato.push({ mes, base, saidas, taxa: taxa(saidas, base) });
    porValor.push({ mes, base: baseC / 100, saidas: saidasC / 100, taxa: taxa(saidasC, baseC) });
  }
  return {
    unidades: [...porUnidade]
      .map(([unidade, x]) => ({ unidade, mrr: x.c / 100, contratos: x.contratos }))
      .sort((a, b) => b.mrr - a.mrr),
    foraDoAtivo: [...fora]
      .map(([situacao, x]) => ({ situacao, contratos: x.contratos, mrr: x.c / 100 }))
      .sort((a, b) => a.situacao.localeCompare(b.situacao)),
    porContrato,
    porValor,
  };
}

/**
 * Churn datado da Central de Tratativas (F3 da investigação de 24/09): saídas do mês ÷ (contratos
 * Inside Sales ganhos antes do mês − churns datados antes do mês).
 */
export function agregarTratativas(
  datasChurn: string[],
  ganhosInsideSales: string[],
  hoje: string,
): MesTaxa[] {
  return mesesFechados(hoje).map((mes) => {
    const ini = primeiro(mes);
    const ganhos = ganhosInsideSales.filter((g) => g < ini).length;
    const antes = datasChurn.filter((d) => d.slice(0, 7) < mes).length;
    const saidas = datasChurn.filter((d) => d.slice(0, 7) === mes).length;
    const base = ganhos - antes;
    return { mes, base, saidas, taxa: taxa(saidas, base) };
  });
}

export interface TituloFranqueadora {
  vencimento: string;
  status: string;
  valor: number;
}

const ABERTO = new Set(["ATRASADO", "A VENCER", "VENCE HOJE"]);

/** Títulos da franqueadora por mês de vencimento; mês sem título fica fora (não é zero). */
export function agregarFranqueadora(titulos: TituloFranqueadora[]): MesFranqueadora[] {
  const porMes = new Map<string, { f: number; r: number; a: number; n: number }>();
  for (const t of titulos) {
    const status = t.status.toUpperCase();
    if (status === "CANCELADO") continue;
    const mes = t.vencimento.slice(0, 7);
    const x = porMes.get(mes) ?? { f: 0, r: 0, a: 0, n: 0 };
    x.f += cent(t.valor);
    x.n += 1;
    if (status === "RECEBIDO") x.r += cent(t.valor);
    else if (ABERTO.has(status)) x.a += cent(t.valor);
    porMes.set(mes, x);
  }
  return [...porMes]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, x]) => ({
      mes,
      faturado: x.f / 100,
      recebido: x.r / 100,
      emAberto: x.a / 100,
      titulos: x.n,
    }));
}

/**
 * Saída de faturamento a partir da ponte (F4; F5 quando a ponte é só de Honorários): clientes que
 * faturaram no mês anterior e nada no mês ÷ clientes que faturaram no mês anterior.
 */
export function taxasDaPonte(meses: PonteMes[]): MesTaxa[] {
  return meses.map((m) => {
    const base =
      m.expansao.clientes + m.contracao.clientes + m.estaveis + m.semFaturamento.clientes;
    return {
      mes: m.mes,
      base,
      saidas: m.semFaturamento.clientes,
      taxa: taxa(m.semFaturamento.clientes, base),
    };
  });
}

// ── Modelos dos gráficos ─────────────────────────────────────────────────────

/** Estado de um bloco sem número: o gráfico desenha o rótulo, nunca zero. */
export interface SemDado {
  estado: Exclude<Estado, "disponivel">;
  motivo: string;
}

const semDado = (
  p: Falha | { estado: "nao_apurado"; motivo: string } | undefined,
  padrao: string,
): SemDado =>
  p
    ? { estado: p.estado, motivo: p.motivo }
    : { estado: "fonte_indisponivel", motivo: padrao };

export interface PontoTrajetoria {
  mes: string;
  valor: number;
  parcial: boolean;
}

export interface Trajetoria {
  ano: number;
  pontos: PontoTrajetoria[];
  /** Média dos meses fechados do ano. */
  media: number;
  mesesNaMedia: number;
  ateMes: string;
  /** Multiplicador anual que leva a média do ano à meta em `ANO_ALVO`. */
  ritmo: number;
  degraus: { ano: number; media: number }[];
  meta: number;
  distancia: number;
  ritmoPct: number;
  fonte: string;
  estado: Estado;
}

/**
 * Trajetória rumo ao bilhão: média mensal dos meses fechados do ano × ritmo^n, com
 * ritmo = (meta mensal ÷ média)^(1/anos até o alvo). O mês em curso entra na linha como parcial e
 * fica fora da média.
 */
export function modeloTrajetoria(c: Cockpit): Trajetoria | SemDado {
  const grupo = c.trajetoria?.find((t) => t.id === "grupo");
  if (!grupo)
    return { estado: "fonte_indisponivel", motivo: c.trajetoriaAviso ?? "Faturamento não lido." };
  if (grupo.estado === "acesso_insuficiente" || grupo.estado === "fonte_indisponivel")
    return { estado: grupo.estado, motivo: grupo.notas[0] ?? "Faturamento do grupo não lido." };
  const ano = Number(c.hoje.slice(0, 4));
  const doAno = grupo.serie.filter((s) => s.mes >= `${ano}-01`);
  const fechados = doAno.filter((s) => !s.parcial);
  if (!fechados.length)
    return { estado: "nao_apurado", motivo: `Nenhum mês de ${ano} fechado na fonte.` };
  const media = fechados.reduce((s, x) => s + cent(x.valor), 0) / 100 / fechados.length;
  const anos = ANO_ALVO - ano;
  const ritmo = anos > 0 ? Math.pow(MEDIA_MENSAL_NECESSARIA / media, 1 / anos) : 1;
  const degraus = Array.from({ length: anos + 1 }, (_, n) => ({
    ano: ano + n,
    media: n === anos ? MEDIA_MENSAL_NECESSARIA : media * Math.pow(ritmo, n),
  }));
  return {
    ano,
    pontos: doAno.map((s) => ({ mes: s.mes, valor: s.valor, parcial: s.parcial })),
    media,
    mesesNaMedia: fechados.length,
    ateMes: fechados.at(-1)!.mes,
    ritmo,
    degraus,
    meta: MEDIA_MENSAL_NECESSARIA,
    distancia: MEDIA_MENSAL_NECESSARIA / media,
    ritmoPct: ritmo - 1,
    fonte: grupo.fonte,
    estado: grupo.estado,
  };
}

export interface DegrauPonte {
  id: string;
  rotulo: string;
  tipo: "nivel" | "entrada" | "saida";
  /** Para nível, o valor; para movimento, o sinal já aplicado. */
  valor: number;
  de: number;
  ate: number;
  clientes: number | null;
}

export interface CascataPonte {
  mes: string;
  anterior: number;
  atual: number;
  degraus: DegrauPonte[];
  /** Piso do eixo: o eixo é cortado, e a tela escreve isso. */
  piso: number;
}

/** Cascata do último mês fechado: níveis como traço, movimentos como barra flutuante. */
export function modeloPonte(c: Cockpit): CascataPonte | SemDado {
  const u = c.empresa.ponte?.ultimo;
  if (!u)
    return {
      estado: "fonte_indisponivel",
      motivo: c.empresa.ponteAviso ?? "Ponte do faturamento não lida.",
    };
  if (!u.fecha)
    return {
      estado: "parcial",
      motivo: "A ponte não fecha com a fonte neste mês; o número não é mostrado.",
    };
  const movimentos: { id: string; rotulo: string; valor: number; clientes: number | null }[] = [
    {
      id: "novos",
      rotulo: "Novos e retornos",
      valor: u.novos.valor + u.retornos.valor,
      clientes: u.novos.clientes + u.retornos.clientes,
    },
    { id: "expansao", rotulo: "Expansão", valor: u.expansao.valor, clientes: u.expansao.clientes },
    {
      id: "contracao",
      rotulo: "Contração",
      valor: u.contracao.valor,
      clientes: u.contracao.clientes,
    },
    {
      id: "saida",
      rotulo: "Saída",
      valor: u.semFaturamento.valor,
      clientes: u.semFaturamento.clientes,
    },
  ];
  if (cent(u.semCliente) !== 0)
    movimentos.push({ id: "sem-cliente", rotulo: "Sem cliente", valor: u.semCliente, clientes: null });
  const degraus: DegrauPonte[] = [
    {
      id: "anterior",
      rotulo: mesBr(mesAnterior(u.mes)),
      tipo: "nivel",
      valor: u.anterior,
      de: u.anterior,
      ate: u.anterior,
      clientes: null,
    },
  ];
  let corrente = cent(u.anterior);
  for (const m of movimentos) {
    const de = corrente;
    corrente += cent(m.valor);
    degraus.push({
      id: m.id,
      rotulo: m.rotulo,
      tipo: m.valor >= 0 ? "entrada" : "saida",
      valor: m.valor,
      de: de / 100,
      ate: corrente / 100,
      clientes: m.clientes,
    });
  }
  degraus.push({
    id: "atual",
    rotulo: mesBr(u.mes),
    tipo: "nivel",
    valor: u.atual,
    de: u.atual,
    ate: u.atual,
    clientes: null,
  });
  const menor = Math.min(...degraus.flatMap((d) => [d.de, d.ate]));
  // Piso redondo abaixo do menor ponto: o eixo cortado mostra o movimento, e a tela avisa o corte.
  const passo = menor > 5_000_000 ? 1_000_000 : 500_000;
  return {
    mes: u.mes,
    anterior: u.anterior,
    atual: u.atual,
    degraus,
    piso: Math.max(0, Math.floor((menor * 0.9) / passo) * passo),
  };
}

export interface Composicao {
  de: string;
  ate: string;
  total: number;
  itens: (CategoriaReceita & { participacao: number })[];
  recorrente: number;
  naoRecorrente: number;
  semClassificacao: number;
}

export function modeloComposicao(v: RespostaVisual | null): Composicao | SemDado {
  const p = v?.categorias;
  if (!p || p.estado !== "ok") return semDado(p, "Receita por categoria não lida.");
  const itens = p.itens.filter((i) => cent(i.receita) !== 0);
  if (!itens.length)
    return { estado: "nao_apurado", motivo: "A fonte não devolveu receita por categoria." };
  const totalC = itens.reduce((s, i) => s + cent(i.receita), 0);
  const soma = (f: (i: CategoriaReceita) => boolean) =>
    itens.filter(f).reduce((s, i) => s + cent(i.receita), 0) / 100;
  return {
    de: p.de,
    ate: p.ate,
    total: totalC / 100,
    itens: itens
      .map((i) => ({ ...i, participacao: totalC ? cent(i.receita) / totalC : 0 }))
      .sort((a, b) => b.receita - a.receita),
    recorrente: soma((i) => i.recorrente === true),
    naoRecorrente: soma((i) => i.recorrente === false),
    semClassificacao: soma((i) => i.recorrente === null),
  };
}

/** Referência do mapa de investidores (não reproduzida por nenhuma fórmula em 24/09). */
export const CHURN_REFERENCIA = 0.0234;

export interface FormulaChurn {
  id: string;
  rotulo: string;
  regua: string;
  estado: Estado;
  motivo: string | null;
  media: number | null;
  min: { mes: string; taxa: number } | null;
  max: { mes: string; taxa: number } | null;
  meses: MesTaxa[];
  fonte: string;
}

function formula(
  id: string,
  rotulo: string,
  regua: string,
  fonte: string,
  meses: MesTaxa[] | null,
  falha: SemDado | null,
): FormulaChurn {
  const comTaxa = (meses ?? []).filter((m): m is MesTaxa & { taxa: number } => m.taxa !== null);
  if (!meses || !comTaxa.length)
    return {
      id,
      rotulo,
      regua,
      fonte,
      estado: falha?.estado ?? "nao_apurado",
      motivo: falha?.motivo ?? "Sem mês com base para calcular a taxa.",
      media: null,
      min: null,
      max: null,
      meses: meses ?? [],
    };
  const ord = [...comTaxa].sort((a, b) => a.taxa - b.taxa);
  return {
    id,
    rotulo,
    regua,
    fonte,
    estado: comTaxa.length < (meses?.length ?? 0) ? "parcial" : "disponivel",
    motivo: null,
    media: comTaxa.reduce((s, m) => s + m.taxa, 0) / comTaxa.length,
    min: { mes: ord[0].mes, taxa: ord[0].taxa },
    max: { mes: ord.at(-1)!.mes, taxa: ord.at(-1)!.taxa },
    meses,
  };
}

const partes = <T>(p: ParteVisual<T> | undefined) =>
  p && p.estado === "ok" ? { ok: p, falha: null } : { ok: null, falha: semDado(p, "Não lido.") };

/** As fórmulas de churn que existem hoje, cada uma na sua régua; nenhuma é escolhida. */
export function modeloChurn(c: Cockpit, v: RespostaVisual | null): FormulaChurn[] {
  const omie = partes(v?.omie);
  const trat = partes(v?.tratativas);
  const hon = partes(v?.honorarios);
  const ponte = c.empresa.ponte?.dado.meses ?? null;
  return [
    formula(
      "omie-contratos",
      "Contratos Omie · por contrato",
      "Contratos das unidades encerrados no mês ÷ ativos no começo do mês",
      "Omie das unidades",
      omie.ok?.porContrato ?? null,
      omie.falha,
    ),
    formula(
      "omie-valor",
      "Contratos Omie · por valor",
      "Valor mensal dos contratos encerrados no mês ÷ valor mensal ativo no começo do mês",
      "Omie das unidades",
      omie.ok?.porValor ?? null,
      omie.falha,
    ),
    formula(
      "tratativas",
      "Central de Tratativas",
      "Churns datados no mês ÷ contratos Inside Sales ganhos e não perdidos até o mês",
      "Central de Tratativas e contratos do CRM",
      trat.ok?.meses ?? null,
      trat.falha,
    ),
    formula(
      "saida-faturamento",
      "Saída de faturamento",
      "Clientes com faturamento no mês anterior e nenhum no mês ÷ clientes com faturamento no mês anterior",
      "Financeiro (emissão)",
      ponte ? taxasDaPonte(ponte) : null,
      ponte
        ? null
        : {
            estado: "fonte_indisponivel",
            motivo: c.empresa.ponteAviso ?? "Ponte do faturamento não lida.",
          },
    ),
    formula(
      "saida-honorarios",
      "Saída · só honorários",
      "A mesma régua, só com a categoria recorrente Honorários Contábeis",
      "Financeiro (emissão)",
      hon.ok?.meses ?? null,
      hon.falha,
    ),
  ];
}

export interface Rede {
  unidades: { unidade: string; mrr: number; contratos: number; participacao: number }[];
  total: number;
  maior: { unidade: string; participacao: number } | null;
  sincronizadoEm: string | null;
}

export function modeloRedeMrr(v: RespostaVisual | null): Rede | SemDado {
  const p = v?.omie;
  if (!p || p.estado !== "ok") return semDado(p, "Contratos do Omie não lidos.");
  const totalC = p.unidades.reduce((s, u) => s + cent(u.mrr), 0);
  if (!totalC) return { estado: "nao_apurado", motivo: "Nenhum contrato ativo com valor mensal." };
  const unidades = p.unidades.map((u) => ({ ...u, participacao: cent(u.mrr) / totalC }));
  return {
    unidades,
    total: totalC / 100,
    maior: unidades[0] ? { unidade: unidades[0].unidade, participacao: unidades[0].participacao } : null,
    sincronizadoEm: p.sincronizadoEm,
  };
}

/** Acima disto o valor em aberto do mês é escrito na coluna. */
export const LIMIAR_ABERTO = 100_000;

export type MesFranqueadoraModelo =
  | (MesFranqueadora & {
      /** Mês ainda não vencido por inteiro: o em aberto inclui título a vencer. */
      parcial: boolean;
      semTitulo: false;
    })
  | { mes: string; parcial: boolean; semTitulo: true };

export function modeloFranqueadora(
  v: RespostaVisual | null,
  hoje: string,
): { meses: MesFranqueadoraModelo[]; ultimaCarga: string | null } | SemDado {
  const p = v?.franqueadora;
  if (!p || p.estado !== "ok") return semDado(p, "Títulos da franqueadora não lidos.");
  const mesAtual = hoje.slice(0, 7);
  const janela = [...mesesFechados(hoje, 11), mesAtual];
  const porMes = new Map(p.meses.map((m) => [m.mes, m]));
  return {
    ultimaCarga: p.ultimaCarga,
    meses: janela.map((mes) => {
      const m = porMes.get(mes);
      return m
        ? { ...m, parcial: mes === mesAtual, semTitulo: false as const }
        : { mes, parcial: mes === mesAtual, semTitulo: true as const };
    }),
  };
}

export interface Entrega {
  fases: { fase: string; cards: number; acima30: number; acima60: number }[];
  gargalo: string | null;
  emCurso: number;
  atualizadoEm: string | null;
}

/** Onboarding por fase em curso; gargalo = fase com mais clientes há mais de 30 dias. */
export function modeloEntrega(c: Cockpit): Entrega | SemDado {
  const o = c.empresa.onboarding;
  if (!o)
    return {
      estado: "fonte_indisponivel",
      motivo: c.empresa.onboardingAviso ?? "Fila de onboarding não lida.",
    };
  const fases = o.fases
    .filter((f) => f.fase !== FASE_CONCLUIDO && f.fase !== FASE_CHURN)
    .map((f) => ({ fase: f.fase, cards: f.cards, acima30: f.acima30, acima60: f.acima60 }));
  const ord = [...fases].sort((a, b) => b.acima30 - a.acima30 || b.cards - a.cards);
  return {
    fases,
    gargalo: ord[0] && ord[0].cards > 0 ? ord[0].fase : null,
    emCurso: o.emCurso,
    atualizadoEm: c.indicadores.find((i) => i.id === "onboarding-parado")?.dataDado ?? null,
  };
}

export interface FonteParada {
  fonte: string;
  dias: number | null;
  atualizadoEm: string | null;
}

/** Dias desde a última carga de cada fonte fora da cadência; sem data fica como estado. */
export function modeloFontes(
  linhas: { fonte: string; atualizadoEm: string | null; estado: string }[],
  agora: string,
): { paradas: FonteParada[]; total: number } {
  const paradas = linhas
    .filter((l) => l.estado !== "em_dia")
    .map((l) => ({
      fonte: l.fonte,
      atualizadoEm: l.atualizadoEm,
      dias: l.atualizadoEm
        ? Math.floor((Date.parse(agora) - Date.parse(l.atualizadoEm)) / 86_400_000)
        : null,
    }))
    .sort((a, b) => (b.dias ?? Infinity) - (a.dias ?? Infinity));
  return { paradas, total: linhas.length };
}

/** A decisão que vem antes de todas: o que "o bilhão" quer dizer (weekly de 25/09). */
export const DECISAO_BILHAO: Decisao = {
  id: "d0-bilhao",
  titulo: "O que é o bilhão: faturamento anual, valuation ou unicórnio",
  porque:
    "O cockpit mede faturamento anual (R$ 1 bi/ano = R$ 83,3 mi/mês), mas o bilhão também aparece como valuation e como unicórnio. Enquanto não houver decisão, a meta desenhada é a de faturamento.",
  responsavel: "CEO",
  destino: null,
};

export type { Destino };
