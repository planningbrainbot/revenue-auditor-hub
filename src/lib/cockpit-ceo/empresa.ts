// A visão da empresa inteira no Cockpit do CEO: os números da primeira dobra que não são de
// Monetização, a ponte do faturamento, os motores do crescimento, o frescor de cada fonte e as
// ameaças e decisões que saem deles.
//
// Nada aqui lê banco. Recebe as leituras já agregadas no servidor (receita.functions,
// caixa.functions, aquisicao.functions, operacao.functions) e as organiza no contrato de indicador
// (contrato.ts). Cada número declara período, universo, fonte, data do dado, estado e o que falta;
// nenhuma ausência vira zero, e nenhum número de uma régua é somado ao de outra.
import type { Destino, Estado, Indicador, LinhaComposicao } from "./contrato.ts";
import type { Periodo } from "./periodo.ts";
import type {
  Ponte,
  PonteMes,
  RespostaCaixa,
  Frescor,
  IndicadoresFinanceiros,
  EmitidoRecebido,
  Inadimplencia,
} from "./financeiro.ts";
import { idadeEmDias } from "./financeiro.ts";
import type { Aquisicao, MesAquisicao, RespostaAquisicao } from "./aquisicao.ts";
import { trimestreDe } from "./aquisicao.ts";
import type { Onboarding, RespostaOperacao } from "./operacao.ts";
import { FAIXAS_IDADE } from "./operacao.ts";
import type { Cadeia } from "./cadeia.ts";
import type { ResumoLeitura } from "./receita.ts";
import { mesBr } from "./receita.ts";
import { PERGUNTAS } from "./perguntas.ts";

export const VERSAO_REGRA_EMPRESA = "2026-09-23";
/** Acima disso a fonte passa da cadência diária declarada e a tela avisa. */
export const DIAS_FONTE_PARADA = 2;

type Carga<T> = { estado: "ok" | "erro" | "carregando"; erro: string | null; resposta: T | null };

export interface FonteEmpresa {
  sintetico: boolean;
  hoje: string;
  agora: string;
  ponte: Ponte | null;
  frescorFinanceiro: Frescor | null;
  /** Estado da leitura do grupo (a ponte só existe quando ela respondeu). */
  estadoGrupo: Estado | null;
  notaGrupo: string | null;
  caixa?: Carga<RespostaCaixa>;
  aquisicao?: Carga<RespostaAquisicao>;
  operacao?: Carga<RespostaOperacao>;
}

export interface Motor {
  id: string;
  titulo: string;
  realizado: string;
  referencia: string | null;
  estado: Estado;
  nota: string;
  frente: "comercial" | "retencao" | "rede" | "portfolio" | "capital" | "receita";
}

export interface LinhaFrescor {
  fonte: string;
  atualizadoEm: string | null;
  cobreAte: string | null;
  estado: "em_dia" | "parada" | "desconhecido";
  nota: string;
}

export interface AmeacaEmpresa {
  id: string;
  titulo: string;
  detalhe: string;
  gravidade: "alta" | "media";
  indicador?: string;
}

export interface DecisaoEmpresa {
  id: string;
  titulo: string;
  porque: string;
  responsavel: string;
  destino: Destino | null;
}

export interface Empresa {
  indicadores: Indicador[];
  ponte: { dado: Ponte; ultimo: PonteMes | null } | null;
  ponteAviso: string | null;
  caixa: {
    emitidoRecebido: EmitidoRecebido | null;
    inadimplencia: Inadimplencia | null;
    indicadores: IndicadoresFinanceiros | null;
    janela: { de: string; ate: string };
    avisos: string[];
  } | null;
  caixaAviso: string | null;
  aquisicao: Aquisicao | null;
  aquisicaoAviso: string | null;
  unidadesLidas: boolean;
  onboarding: Onboarding | null;
  onboardingAviso: string | null;
  cadeia: Cadeia | null;
  cadeiaAviso: string | null;
  cadeiaFaturamentoAviso: string | null;
  motores: Motor[];
  frescor: LinhaFrescor[];
  ameacas: AmeacaEmpresa[];
  decisoes: DecisaoEmpresa[];
}

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});
const brl = (v: number) => BRL.format(v).replace(/\u00a0/g, " ");
const mil = (v: number) =>
  Math.abs(v) >= 1_000_000
    ? `R$ ${(v / 1_000_000).toFixed(2).replace(".", ",")} mi`
    : `R$ ${Math.round(v / 1000).toLocaleString("pt-BR")} mil`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const pergunta = (id: string) => PERGUNTAS.find((p) => p.id === id)?.texto ?? "";
const fimDoMes = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);
const mesAnterior = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

const DESTINO_FINANCEIRO: Destino = {
  rota: "/financeiro",
  search: {},
  externo: true,
  rotulo: "Abrir Faturamento no Brain Financeiro",
  mesmoRecorte: false,
  observacao:
    "O Financeiro abre por empresa, cliente e categoria; o cockpit mostra o consolidado e a ponte por cliente sem nomes.",
};
const DESTINO_PAINEL_CS: Destino = {
  rota: "/painel-cs",
  search: {},
  rotulo: "Abrir Painel de CS (Onboarding)",
  mesmoRecorte: false,
  observacao: "O Painel de CS lista os cards por fase; o cockpit mostra só contagens e idades.",
};
const frente = (f: string): Destino => ({
  rota: "/cockpit-ceo",
  search: { frente: f },
  rotulo: "Abrir a frente",
  mesmoRecorte: true,
  observacao: "A frente mostra o painel inteiro com a mesma fonte.",
});

/** Linhas da ponte de um mês como composição que soma o mês. */
export function composicaoDaPonte(m: PonteMes): LinhaComposicao[] {
  const linha = (
    chave: string,
    rotulo: string,
    valor: number,
    clientes: number | null,
  ): LinhaComposicao => ({
    chave,
    rotulo,
    valor,
    soma: true,
    observacao: clientes === null ? undefined : plural(clientes, "cliente", "clientes"),
  });
  return [
    linha("anterior", `Faturamento de ${mesBr(mesAnterior(m.mes))}`, m.anterior, null),
    linha(
      "novos",
      "Clientes novos (sem faturamento antes na janela)",
      m.novos.valor,
      m.novos.clientes,
    ),
    linha("retornos", "Clientes que voltaram a faturar", m.retornos.valor, m.retornos.clientes),
    linha("expansao", "Base que faturou mais", m.expansao.valor, m.expansao.clientes),
    linha("contracao", "Base que faturou menos", m.contracao.valor, m.contracao.clientes),
    linha(
      "sem_faturamento",
      "Clientes sem faturamento no mês",
      m.semFaturamento.valor,
      m.semFaturamento.clientes,
    ),
    linha("sem_cliente", "Variação da receita sem cliente identificado", m.semCliente, null),
  ];
}

function linhaFrescor(
  fonte: string,
  atualizadoEm: string | null,
  cobreAte: string | null,
  agora: string,
  cadenciaNota: string,
): LinhaFrescor {
  const idade = idadeEmDias(atualizadoEm, agora);
  return {
    fonte,
    atualizadoEm,
    cobreAte,
    estado: idade === null ? "desconhecido" : idade > DIAS_FONTE_PARADA ? "parada" : "em_dia",
    nota:
      idade === null
        ? "A fonte não declarou a data da última carga."
        : idade > DIAS_FONTE_PARADA
          ? `Sem carga há ${plural(idade, "dia", "dias")} (${cadenciaNota}).`
          : cadenciaNota,
  };
}

function mesesDoPeriodo(p: Periodo): string[] {
  const out: string[] = [];
  let m = p.de.slice(0, 7);
  const fim = p.ate.slice(0, 7);
  while (m <= fim) {
    out.push(m);
    m = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1))
      .toISOString()
      .slice(0, 7);
  }
  return out;
}

export function montarEmpresa(
  f: FonteEmpresa,
  ctx: {
    periodo: Periodo;
    grupo: ResumoLeitura | null;
    /** Contratos ganhos na Monetização (indicador existente), para o motor. */
    monetizacao: { valor: number | null; estado: Estado; plano: number | null };
  },
): Empresa {
  const comum = {
    versaoRegra: VERSAO_REGRA_EMPRESA,
    perimetro: "Empresas do grupo no Financeiro · rede inteira",
    filtros: [] as string[],
    dataApuracao: f.agora,
    sintetico: f.sintetico,
  };

  // ── Frescor ────────────────────────────────────────────────────────────
  const aq = f.aquisicao?.resposta?.estado === "ok" ? f.aquisicao.resposta : null;
  const opResp = f.operacao?.resposta ?? null;
  const onb = opResp?.onboarding.estado === "ok" ? opResp.onboarding : null;
  const frescor: LinhaFrescor[] = [
    linhaFrescor(
      "Financeiro (Financial Brain)",
      f.frescorFinanceiro?.carregadoEm ?? null,
      f.frescorFinanceiro?.cobreAte ?? null,
      f.agora,
      "carga diária da API do Omie",
    ),
    linhaFrescor(
      "Growth (CRM e mídia paga)",
      aq?.atualizadoEm ?? null,
      null,
      f.agora,
      "sync do Growth várias vezes ao dia",
    ),
    linhaFrescor(
      "Onboarding (Pipefy)",
      onb?.atualizadoEm ?? null,
      null,
      f.agora,
      "sync do Ops a cada 15 minutos",
    ),
  ];
  const finParado = frescor[0].estado === "parada";

  // ── Ponte e faturamento do mês ─────────────────────────────────────────
  const ponte = f.ponte;
  const ultimo = ponte?.meses.at(-1) ?? null;
  const ponteAviso =
    f.estadoGrupo === "acesso_insuficiente" || f.estadoGrupo === "fonte_indisponivel"
      ? f.notaGrupo
      : f.estadoGrupo && !ponte
        ? "A ponte não pôde ser montada com o payload do Financeiro."
        : !ultimo && ponte
          ? "Não há dois meses fechados seguidos para montar a ponte."
          : null;
  const estadoFin = (base: Estado | null): Estado =>
    base === "disponivel" && finParado ? "parcial" : (base ?? "fonte_indisponivel");
  const notaParado = finParado
    ? `Financeiro sem carga desde ${f.frescorFinanceiro?.carregadoEm ? dataBr(f.frescorFinanceiro.carregadoEm) : "data desconhecida"}: meses fechados não mudam, o mês corrente está parado.`
    : null;
  const grupoLacuna = (estado: Estado) =>
    estado === "acesso_insuficiente"
      ? {
          oQueFalta: "Acesso ao Brain Financeiro com escopo de todas as empresas.",
          responsavel: "Administração do Financeiro",
          acao: "Conceder o produto Financeiro com todas as empresas, se couber ao papel.",
        }
      : null;

  const serieGrupo = ctx.grupo?.serie ?? [];
  const valorDoMes = (m: string) => serieGrupo.find((s) => s.mes === m)?.valor ?? null;
  const estadoFat: Estado = ultimo
    ? ultimo.fecha
      ? estadoFin("disponivel")
      : "fonte_indisponivel"
    : f.estadoGrupo === "acesso_insuficiente"
      ? "acesso_insuficiente"
      : f.estadoGrupo === null
        ? "nao_apurado"
        : "fonte_indisponivel";
  const faturamentoMes: Indicador = {
    ...comum,
    id: "faturamento-mes",
    frente: "receita",
    pergunta: pergunta("R6"),
    titulo: ultimo ? `Faturamento de ${mesBr(ultimo.mes)}` : "Faturamento do último mês fechado",
    definicao:
      "Receita bruta de vendas (DRE 1.1) das empresas do grupo pela emissão, como a tela de Faturamento do Brain Financeiro mostra: sem nota cancelada, sem as exclusões da controladoria, com Finance e Negócios Estruturados fora por padrão. Último mês que a fonte marca como fechado.",
    unidade: "reais",
    periodo: ultimo ? { de: `${ultimo.mes}-01`, ate: fimDoMes(ultimo.mes) } : null,
    fonte: "Financial Brain · fn_faturamento_mensal (a mesma função da tela de Faturamento)",
    dataDado: f.frescorFinanceiro?.carregadoEm ?? null,
    estado: estadoFat,
    valor: ultimo && ultimo.fecha ? ultimo.atual : null,
    comparacoes: ultimo
      ? [
          {
            rotulo: `Mês anterior (${mesBr(mesAnterior(ultimo.mes))})`,
            referencia: ultimo.anterior,
            estado: "disponivel",
            nota: "Mesmo perímetro e mesma régua.",
          },
          ...(ctx.grupo?.fechados
            ? [
                {
                  rotulo: `Média dos meses fechados (${mesBr(ctx.grupo.fechados.de)} a ${mesBr(ctx.grupo.fechados.ate)})`,
                  referencia: ctx.grupo.fechados.media,
                  estado: "disponivel" as Estado,
                  nota: `${ctx.grupo.fechados.meses} meses fechados contíguos.`,
                },
              ]
            : []),
        ]
      : [],
    composicao: ultimo ? composicaoDaPonte(ultimo) : [],
    notaComposicao: [
      "Ponte por cliente: cada cliente cai em um só movimento, e a soma reconstrói o mês em centavos.",
      ultimo && !ultimo.fecha
        ? `A soma das linhas por cliente não bate com a série da fonte (diferença de ${brl(ultimo.diferencaFonte)}): o número não é mostrado.`
        : null,
      ponte?.historicoDesde
        ? `"Novo" quer dizer sem faturamento desde ${mesBr(ponte.historicoDesde)}, o começo do histórico do Financeiro.`
        : null,
      "Unidade nova, monetização e aquisições não têm vínculo de receita por cliente: não aparecem como linha própria.",
      notaParado,
    ]
      .filter(Boolean)
      .join(" "),
    destino: DESTINO_FINANCEIRO,
    lacuna: grupoLacuna(estadoFat),
  };

  const saiu = ultimo ? -(ultimo.semFaturamento.valor + ultimo.contracao.valor) : null;
  const faturamentoSaiu: Indicador = {
    ...comum,
    id: "faturamento-saiu",
    frente: "retencao",
    pergunta: pergunta("T1"),
    titulo: "Faturamento que saiu da base",
    definicao:
      "Quanto a base que já faturava deixou de faturar no último mês fechado: clientes sem faturamento no mês mais a redução dos que faturaram menos. Régua de emissão: cliente sem nota no mês não é churn confirmado.",
    unidade: "reais",
    periodo: faturamentoMes.periodo,
    fonte: faturamentoMes.fonte,
    dataDado: faturamentoMes.dataDado,
    estado: ultimo?.fecha ? estadoFin("disponivel") : estadoFat,
    valor: ultimo?.fecha ? saiu : null,
    comparacoes: ultimo
      ? [
          {
            rotulo: "Entrou no mesmo mês (novos, retornos e expansão)",
            referencia: ultimo.novos.valor + ultimo.retornos.valor + ultimo.expansao.valor,
            estado: "disponivel",
            nota: "Mesma ponte, mesmo mês.",
          },
        ]
      : [],
    composicao: ultimo
      ? [
          {
            chave: "sem_faturamento",
            rotulo: "Clientes sem faturamento no mês",
            valor: -ultimo.semFaturamento.valor,
            soma: true,
            observacao: plural(ultimo.semFaturamento.clientes, "cliente", "clientes"),
          },
          {
            chave: "contracao",
            rotulo: "Base que faturou menos",
            valor: -ultimo.contracao.valor,
            soma: true,
            observacao: plural(ultimo.contracao.clientes, "cliente", "clientes"),
          },
        ]
      : [],
    notaComposicao: [
      "Para churn contratual, use a Central de Tratativas (coortes em Retenção e expansão).",
      notaParado,
    ]
      .filter(Boolean)
      .join(" "),
    destino: frente("retencao"),
    lacuna: grupoLacuna(estadoFat),
  };

  // ── Aquisição ──────────────────────────────────────────────────────────
  const aquisicao = aq?.dado ?? null;
  const aqFalha =
    f.aquisicao?.resposta && f.aquisicao.resposta.estado !== "ok" ? f.aquisicao.resposta : null;
  const aquisicaoAviso = !f.aquisicao
    ? null
    : f.aquisicao.estado === "carregando"
      ? "Dados de aquisição em carga."
      : f.aquisicao.estado === "erro"
        ? (f.aquisicao.erro ?? "A carga do Growth falhou.")
        : aqFalha
          ? aqFalha.motivo
          : null;
  const meses = mesesDoPeriodo(ctx.periodo);
  const doPeriodo: MesAquisicao[] = (aquisicao?.meses ?? []).filter((m) => meses.includes(m.mes));
  const somaMrr = doPeriodo.reduce((s, m) => s + (m.mrrNovo ?? 0), 0);
  const planoCompleto =
    doPeriodo.length > 0 && doPeriodo.every((m) => m.plano?.mrrNovo != null)
      ? doPeriodo.reduce((s, m) => s + (m.plano!.mrrNovo ?? 0), 0)
      : null;
  const emAndamento = doPeriodo.some((m) => m.emAndamento);
  const estadoAq: Estado = aquisicao
    ? doPeriodo.length
      ? "disponivel"
      : "nao_apurado"
    : aqFalha?.estado === "acesso_insuficiente"
      ? "acesso_insuficiente"
      : f.aquisicao?.estado === "carregando"
        ? "nao_apurado"
        : "fonte_indisponivel";
  const fc = aquisicao?.forecast;
  const mrrVendido: Indicador = {
    ...comum,
    id: "mrr-vendido",
    frente: "comercial",
    pergunta: pergunta("A2"),
    titulo: "MRR novo vendido (Inside Sales)",
    definicao:
      "MRR dos contratos ganhos no pipe Inside Sales no período, pela série do Growth. É valor mensal contratado no CRM: não é faturamento nem recebimento, e não entra na ponte.",
    unidade: "reais",
    periodo: { de: ctx.periodo.de, ate: ctx.periodo.ate },
    perimetro: "Pipe Inside Sales, todas as unidades",
    fonte: "Growth · growth.serie_mensal (plano: growth.metas; forecast: growth.mes_corrente)",
    dataDado: aq?.atualizadoEm ?? null,
    estado: estadoAq,
    valor: aquisicao && doPeriodo.length ? somaMrr : null,
    comparacoes: aquisicao
      ? [
          {
            rotulo: "Plano do Growth para os mesmos meses",
            referencia: planoCompleto,
            estado: planoCompleto === null ? "nao_apurado" : "disponivel",
            nota:
              planoCompleto === null
                ? "Algum mês do período não tem plano de MRR novo cadastrado (o plano existe desde jun/2026)."
                : emAndamento
                  ? "Plano do mês inteiro; o mês corrente ainda está em andamento."
                  : "Soma do plano mensal de MRR novo.",
          },
          ...(emAndamento && fc
            ? [
                {
                  rotulo: "Forecast do mês pelo ritmo (modelo do Growth)",
                  referencia: fc.porRitmo,
                  estado: (fc.porRitmo === null ? "nao_apurado" : "disponivel") as Estado,
                  nota: "Projeção do Growth para o mês corrente pelo ritmo de dias úteis. O cockpit não recalcula.",
                },
                {
                  rotulo: "Forecast do mês pelo pipeline (modelo do Growth)",
                  referencia: fc.porPipeline,
                  estado: (fc.porPipeline === null ? "nao_apurado" : "disponivel") as Estado,
                  nota: "Realizado + pipeline × win rate histórico, pelo modelo do Growth.",
                },
              ]
            : []),
        ]
      : [],
    composicao: doPeriodo.map((m) => ({
      chave: "mes:" + m.mes,
      rotulo: `${mesBr(m.mes)}${m.emAndamento ? " (em andamento)" : ""}`,
      valor: m.mrrNovo,
      soma: true,
      observacao: m.vendas !== null ? plural(m.vendas, "venda", "vendas") : undefined,
    })),
    notaComposicao: [
      "Sócios, Monetização e Broker são motores separados, em outras réguas: não entram nesta soma.",
      meses.length > doPeriodo.length && aquisicao
        ? "A série é mensal: meses do período sem dado na série ficaram de fora."
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    destino: frente("comercial"),
    lacuna:
      estadoAq === "acesso_insuficiente"
        ? {
            oQueFalta: "Ser membro do Growth (a RLS do schema growth só abre para membros).",
            responsavel: "Diretoria de Growth",
            acao: "Incluir a pessoa como membro do Growth, se couber.",
          }
        : null,
  };

  // ── Caixa ──────────────────────────────────────────────────────────────
  const cx = f.caixa?.resposta ?? null;
  const ina = cx?.inadimplencia.estado === "ok" ? cx.inadimplencia.dado : null;
  const er = cx?.emitidoRecebido.estado === "ok" ? cx.emitidoRecebido.dado : null;
  const ind = cx?.indicadores.estado === "ok" ? cx.indicadores.dado : null;
  const caixaAviso = !f.caixa
    ? null
    : f.caixa.estado === "carregando"
      ? "Caixa e margem em carga."
      : f.caixa.estado === "erro"
        ? (f.caixa.erro ?? "A carga de caixa e margem falhou.")
        : null;
  const caixaAvisos = cx
    ? [cx.emitidoRecebido, cx.inadimplencia, cx.indicadores]
        .filter((x) => x.estado !== "ok")
        .map((x) => (x as { motivo: string }).motivo)
    : [];
  const inaIdade = idadeEmDias(ina?.sincronizadoEm ?? null, f.agora);
  const estadoVencido: Estado = ina
    ? inaIdade !== null && inaIdade > DIAS_FONTE_PARADA
      ? "parcial"
      : "disponivel"
    : cx && cx.inadimplencia.estado !== "ok"
      ? cx.inadimplencia.estado
      : "nao_apurado";
  const vencido: Indicador = {
    ...comum,
    id: "vencido-em-aberto",
    frente: "caixa",
    pergunta: pergunta("R2"),
    titulo: "Vencido e não recebido",
    definicao:
      'Títulos a receber em aberto com previsão de pagamento já passada, no Omie ao vivo — a mesma régua de "Valores Atrasados (Previsão)" do Financeiro. Não é a foto do fechamento.',
    unidade: "reais",
    periodo: null,
    fonte: "Financial Brain · fn_inadimplencia_live (Omie ao vivo)",
    dataDado: ina?.sincronizadoEm ?? null,
    estado: estadoVencido,
    valor: ina ? ina.atrasado : null,
    comparacoes: ina
      ? [
          {
            rotulo: "Total em aberto (vencido e a vencer)",
            referencia: ina.emAberto,
            estado: "disponivel",
            nota: plural(ina.titulosAtrasados, "título vencido", "títulos vencidos"),
          },
        ]
      : [],
    composicao: (ina?.faixas ?? []).map((x) => ({
      chave: "faixa:" + x.faixa,
      rotulo: x.faixa,
      valor: x.valor,
      soma: true,
      observacao: plural(x.titulos, "título", "títulos"),
    })),
    notaComposicao: [
      "Fotografia de agora: o período filtrado não se aplica.",
      ina?.empresasSemSync.length
        ? `Empresas sem sincronização de títulos: ${ina.empresasSemSync.join(", ")} (fora do número).`
        : null,
      inaIdade !== null && inaIdade > DIAS_FONTE_PARADA
        ? `Títulos sincronizados pela última vez em ${dataBr(ina!.sincronizadoEm!)}.`
        : null,
    ]
      .filter(Boolean)
      .join(" "),
    destino: DESTINO_FINANCEIRO,
    lacuna:
      estadoVencido === "acesso_insuficiente"
        ? {
            oQueFalta: "Acesso ao Brain Financeiro com escopo de todas as empresas.",
            responsavel: "Administração do Financeiro",
            acao: "Conceder o produto Financeiro com todas as empresas, se couber ao papel.",
          }
        : null,
  };

  // ── Operação ───────────────────────────────────────────────────────────
  const onboarding = onb?.dado ?? null;
  const onbFalha = opResp && opResp.onboarding.estado !== "ok" ? opResp.onboarding : null;
  const onboardingAviso = !f.operacao
    ? null
    : f.operacao.estado === "carregando"
      ? "Fila de onboarding em carga."
      : f.operacao.estado === "erro"
        ? (f.operacao.erro ?? "A carga da operação falhou.")
        : onbFalha
          ? onbFalha.motivo
          : null;
  const estadoOnb: Estado = onboarding
    ? "disponivel"
    : onbFalha?.estado === "acesso_insuficiente"
      ? "acesso_insuficiente"
      : f.operacao?.estado === "carregando"
        ? "nao_apurado"
        : "fonte_indisponivel";
  const parado: Indicador = {
    ...comum,
    id: "onboarding-parado",
    frente: "operacao",
    pergunta: pergunta("O1"),
    titulo: `Onboardings há mais de ${FAIXAS_IDADE[0]} dias na mesma fase`,
    definicao: `Clientes em onboarding (fora de "Concluído" e "Churn no Onboarding") que estão há mais de ${FAIXAS_IDADE[0]} dias na fase atual do pipe de Onboarding. Faixa de leitura: não existe SLA de onboarding decidido.`,
    unidade: "clientes",
    periodo: null,
    perimetro: "Pipe de Onboarding, todas as unidades",
    fonte: "Ops · cs_onboarding_cards (Pipefy espelhado)",
    dataDado: onb?.atualizadoEm ?? null,
    estado: estadoOnb,
    valor: onboarding ? onboarding.parados30 : null,
    comparacoes: onboarding
      ? [
          {
            rotulo: "Em onboarding agora",
            referencia: onboarding.emCurso,
            estado: "disponivel",
            nota: `Pipe sincronizado desde ${onboarding.desde ? dataBr(onboarding.desde) : "—"}.`,
          },
          {
            rotulo: `Há mais de ${FAIXAS_IDADE[1]} dias`,
            referencia: onboarding.parados60,
            estado: "disponivel",
            nota: "Mesma régua de idade na fase.",
          },
        ]
      : [],
    composicao: (onboarding?.fases ?? [])
      .filter((x) => x.acima30 > 0 && x.fase !== "Concluído" && x.fase !== "Churn no Onboarding")
      .map((x) => ({
        chave: "fase:" + x.fase,
        rotulo: x.fase,
        valor: x.acima30,
        soma: true,
        observacao:
          x.idadeMediana !== null
            ? `mediana de ${Math.round(x.idadeMediana)} dias na fase`
            : undefined,
      })),
    notaComposicao:
      "Fotografia de agora. Horas, retrabalho e capacidade da equipe não têm fonte: a fila é o único sinal de capacidade de entrega.",
    destino: DESTINO_PAINEL_CS,
    lacuna:
      estadoOnb === "acesso_insuficiente"
        ? {
            oQueFalta: "Leitura do Painel de CS (view.painel_cs) com todas as unidades.",
            responsavel: "Administração do Brain",
            acao: "Conceder a chave, se couber ao papel.",
          }
        : null,
  };

  // ── Cadeia ─────────────────────────────────────────────────────────────
  const cad = opResp?.cadeia.estado === "ok" ? opResp.cadeia : null;
  const cadeiaAviso =
    opResp && opResp.cadeia.estado !== "ok" ? opResp.cadeia.motivo : onboardingAviso;
  const cadeiaFaturamentoAviso = cad?.faturamento?.motivo ?? null;

  // ── Motores ────────────────────────────────────────────────────────────
  const ultimoFechadoAq =
    [...(aquisicao?.meses ?? [])].reverse().find((m) => !m.emAndamento) ?? null;
  const tri = trimestreDe(f.hoje);
  const unidadesTri = (aquisicao?.unidades ?? []).filter((u) => u.trimestre === tri);
  const somaTri = (k: "meta" | "vendido") => unidadesTri.reduce((s, u) => s + u[k], 0);
  const motores: Motor[] = [
    {
      id: "inside-sales",
      titulo: "Aquisição · Inside Sales",
      realizado:
        ultimoFechadoAq?.mrrNovo != null
          ? `${mil(ultimoFechadoAq.mrrNovo)} de MRR novo em ${mesBr(ultimoFechadoAq.mes)}`
          : "—",
      referencia:
        ultimoFechadoAq?.plano?.mrrNovo != null
          ? `plano ${mil(ultimoFechadoAq.plano.mrrNovo)}`
          : null,
      estado: aquisicao ? "disponivel" : estadoAq,
      nota:
        fc && fc.porRitmo !== null
          ? `${mesBr(fc.mes)} em andamento: ${mil(fc.realizado ?? 0)} vendidos, ritmo do Growth projeta ${mil(fc.porRitmo)}${fc.meta !== null ? ` contra meta de ${mil(fc.meta)}` : ""}.`
          : (aquisicaoAviso ?? "MRR contratado no CRM, não faturamento."),
      frente: "comercial",
    },
    {
      id: "base",
      titulo: "Base existente",
      realizado: ultimo?.fecha
        ? `${ultimo.expansao.valor + ultimo.contracao.valor + ultimo.semFaturamento.valor >= 0 ? "+" : "−"}${mil(Math.abs(ultimo.expansao.valor + ultimo.contracao.valor + ultimo.semFaturamento.valor))} em ${mesBr(ultimo.mes)}`
        : "—",
      referencia: null,
      estado: ultimo?.fecha ? estadoFin("disponivel") : estadoFat,
      nota: ultimo?.fecha
        ? `Expansão ${mil(ultimo.expansao.valor)}, contração ${mil(-ultimo.contracao.valor)}, sem faturamento ${mil(-ultimo.semFaturamento.valor)} (régua de emissão).`
        : (ponteAviso ?? "Depende da ponte do Financeiro."),
      frente: "retencao",
    },
    {
      id: "novos-faturados",
      titulo: "Clientes novos faturados",
      realizado: ultimo?.fecha
        ? `${mil(ultimo.novos.valor + ultimo.retornos.valor)} em ${mesBr(ultimo.mes)}`
        : "—",
      referencia: null,
      estado: ultimo?.fecha ? estadoFin("disponivel") : estadoFat,
      nota: ultimo?.fecha
        ? `${plural(ultimo.novos.clientes, "cliente novo", "clientes novos")} e ${plural(ultimo.retornos.clientes, "retorno", "retornos")} faturando no mês.`
        : (ponteAviso ?? "Depende da ponte do Financeiro."),
      frente: "receita",
    },
    {
      id: "unidades",
      titulo: "Unidades · venda no trimestre",
      realizado: unidadesTri.length
        ? `${mil(somaTri("vendido"))} vendidos em ${tri.replace("-T", " T")}`
        : "—",
      referencia: unidadesTri.length ? `meta ${mil(somaTri("meta"))}` : null,
      estado: unidadesTri.length
        ? "disponivel"
        : aquisicao && !aq?.unidadesLidas
          ? "acesso_insuficiente"
          : "nao_apurado",
      nota: unidadesTri.length
        ? `${plural(unidadesTri.length, "unidade", "unidades")} com meta no trimestre (growth.dist_metas).`
        : aquisicao && !aq?.unidadesLidas
          ? "A meta por unidade tem leitura restrita à diretoria comercial."
          : "Sem meta por unidade para o trimestre.",
      frente: "rede",
    },
    {
      id: "monetizacao",
      titulo: "Monetização · contratos ganhos",
      realizado:
        ctx.monetizacao.valor !== null
          ? plural(ctx.monetizacao.valor, "contrato", "contratos") + " no período"
          : "—",
      referencia: ctx.monetizacao.plano !== null ? `plano ${ctx.monetizacao.plano}` : null,
      estado: ctx.monetizacao.estado,
      nota: "Ganho no CRM; receita realizada por vertical ainda não é separável no Financeiro.",
      frente: "portfolio",
    },
    {
      id: "socios",
      titulo: "Sócios · venda das unidades",
      realizado: "—",
      referencia: null,
      estado: "nao_apurado",
      nota: "Os contratos do pipe Sócios foram importados em lotes (15/06, 10/08 e 10/09): a data de ganho não marca a venda, então não há série.",
      frente: "rede",
    },
    {
      id: "aquisicoes",
      titulo: "Aquisições (consolidação)",
      realizado: "—",
      referencia: null,
      estado: "nao_apurado",
      nota: "Sem mandato, alvo nem capital registrados: a ponte não modela aquisições.",
      frente: "capital",
    },
  ];

  // ── Ameaças ────────────────────────────────────────────────────────────
  const ameacas: AmeacaEmpresa[] = [];
  if (finParado)
    ameacas.push({
      id: "financeiro-parado",
      titulo: "Financeiro sem carga nova",
      detalhe: `${frescor[0].nota} Em 23/09 a causa medida era a cobrança das GitHub Actions da conta que roda os crons; quem resolve é o dono da conta.`,
      gravidade: "alta",
      indicador: "faturamento-mes",
    });
  if (
    ultimoFechadoAq?.plano?.mrrNovo != null &&
    (ultimoFechadoAq.mrrNovo ?? 0) < ultimoFechadoAq.plano.mrrNovo
  )
    ameacas.push({
      id: "aquisicao-abaixo-plano",
      titulo: `MRR novo de ${mesBr(ultimoFechadoAq.mes)} abaixo do plano do Growth`,
      detalhe: `${mil(ultimoFechadoAq.mrrNovo ?? 0)} vendidos contra ${mil(ultimoFechadoAq.plano.mrrNovo)} de plano.`,
      gravidade: "alta",
      indicador: "mrr-vendido",
    });
  if (fc && fc.porRitmo !== null && fc.meta !== null && fc.porRitmo < fc.meta)
    ameacas.push({
      id: "ritmo-aquisicao",
      titulo: "Ritmo do mês abaixo da meta de MRR novo",
      detalhe: `O ritmo do Growth projeta ${mil(fc.porRitmo)} para ${mesBr(fc.mes)}, contra meta de ${mil(fc.meta)}.`,
      gravidade: "media",
      indicador: "mrr-vendido",
    });
  if (onboarding && onboarding.parados60 > 0)
    ameacas.push({
      id: "onboarding-parado",
      titulo: "Clientes vendidos parados no onboarding",
      detalhe: `${plural(onboarding.parados60, "cliente está", "clientes estão")} há mais de ${FAIXAS_IDADE[1]} dias na mesma fase (${onboarding.parados30} há mais de ${FAIXAS_IDADE[0]}).`,
      gravidade: "alta",
      indicador: "onboarding-parado",
    });
  if (ultimo?.fecha) {
    const liquidoBase =
      ultimo.expansao.valor + ultimo.contracao.valor + ultimo.semFaturamento.valor;
    if (liquidoBase < 0)
      ameacas.push({
        id: "base-encolheu",
        titulo: `A base existente faturou menos em ${mesBr(ultimo.mes)}`,
        detalhe: `Expansão menos contração e saídas deu ${mil(liquidoBase)}; o crescimento do mês dependeu de clientes novos.`,
        gravidade: "media",
        indicador: "faturamento-saiu",
      });
  }
  if (ina && ina.atrasado > 0)
    ameacas.push({
      id: "vencido",
      titulo: "Títulos vencidos e não recebidos",
      detalhe: `${mil(ina.atrasado)} em ${plural(ina.titulosAtrasados, "título", "títulos")}, de ${mil(ina.emAberto)} em aberto.`,
      gravidade: "media",
      indicador: "vencido-em-aberto",
    });

  // ── Decisões (a primeira, perímetro, continua vindo do cálculo da Monetização) ──
  const decisoes: DecisaoEmpresa[] = [];
  if (onboarding && onboarding.parados30 > 0)
    decisoes.push({
      id: "sla-onboarding",
      titulo: "Definir o prazo de onboarding e quem destrava a fila",
      porque: `${plural(onboarding.parados30, "cliente vendido está", "clientes vendidos estão")} há mais de ${FAIXAS_IDADE[0]} dias na mesma fase, e não existe prazo decidido para comparar.`,
      responsavel: "Operações (propõe) + CEO (aprova)",
      destino: DESTINO_PAINEL_CS,
    });

  return {
    indicadores: [faturamentoMes, faturamentoSaiu, mrrVendido, vencido, parado],
    ponte: ponte ? { dado: ponte, ultimo } : null,
    ponteAviso,
    caixa: cx
      ? {
          emitidoRecebido: er,
          inadimplencia: ina,
          indicadores: ind,
          janela: cx.janela,
          avisos: caixaAvisos,
        }
      : null,
    caixaAviso,
    aquisicao,
    aquisicaoAviso,
    unidadesLidas: aq?.unidadesLidas ?? false,
    onboarding,
    onboardingAviso,
    cadeia: cad?.dado ?? null,
    cadeiaAviso: cad ? null : cadeiaAviso,
    cadeiaFaturamentoAviso,
    motores,
    frescor,
    ameacas,
    decisoes,
  };
}
