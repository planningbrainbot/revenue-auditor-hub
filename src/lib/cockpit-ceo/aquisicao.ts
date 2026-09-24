// Aquisição (Growth) para o Cockpit do CEO: funil mensal plano × realizado, forecast do mês e
// pipeline aberto do Inside Sales, e meta trimestral × vendido por unidade.
//
// Nenhuma régua nova. Realizado = `growth.serie_mensal` (a série que o Growth mostra); plano =
// `growth.metas` papel "funil"; forecast do mês = `growth.mes_corrente` porte "consolidado" (ritmo
// e pipeline, modelo do Growth); unidades = `growth.dist_metas`. O cockpit só junta, rotula e diz
// onde falta. "Custo de mídia por venda" é o que a série chama de CAC: investimento em mídia paga
// sobre vendas do mês, sem salário, ferramenta nem comissão — não é o CAC completo.
//
// Pipeline aberto é soma NÃO ponderada: nenhuma fonte tem probabilidade por etapa, e o cockpit não
// inventa uma. Negócio sem data de fechamento esperada é contado à parte.

const numero = (x: unknown): number | null => {
  if (x === null || x === undefined || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const mesDe = (x: unknown): string | null =>
  typeof x === "string" && /^\d{4}-\d{2}/.test(x) ? x.slice(0, 7) : null;

export interface PlanoAquisicao {
  investimento: number | null;
  mql: number | null;
  vendas: number | null;
  mrrNovo: number | null;
}

export interface MesAquisicao {
  mes: string;
  investimento: number | null;
  leads: number | null;
  mql: number | null;
  vendas: number | null;
  mrrNovo: number | null;
  custoMidiaPorVenda: number | null;
  /** `null` = o Growth não cadastrou plano para o mês (não é 0% de atingimento). */
  plano: PlanoAquisicao | null;
  /** O mês corrente: realizado até hoje, não comparável a mês inteiro. */
  emAndamento: boolean;
}

export interface ForecastMes {
  mes: string;
  realizado: number | null;
  meta: number | null;
  porRitmo: number | null;
  porPipeline: number | null;
  vendasRealizadas: number | null;
  vendasMeta: number | null;
  winRate: number | null;
  cicloMedianoDias: number | null;
}

export interface PipelineAberto {
  negocios: number;
  mrr: number;
  semData: { negocios: number; mrr: number };
  vencidos: { negocios: number; mrr: number };
  porMes: { mes: string; negocios: number; mrr: number }[];
}

export interface MetaUnidade {
  unidade: string;
  trimestre: string;
  meta: number;
  vendido: number;
}

export interface Aquisicao {
  meses: MesAquisicao[];
  forecast: ForecastMes | null;
  pipeline: PipelineAberto | null;
  unidades: MetaUnidade[];
}

export interface EntradaAquisicao {
  serie: Record<string, unknown>[];
  metas: Record<string, unknown>[];
  mesCorrente: Record<string, unknown>[];
  abertos: Record<string, unknown>[] | null;
  distMetas: Record<string, unknown>[] | null;
}

const METRICAS_PLANO: Record<string, keyof PlanoAquisicao> = {
  investimento_mes: "investimento",
  mql_mes: "mql",
  vendas_mes: "vendas",
  new_mrr_mes: "mrrNovo",
};

export function montarAquisicao(e: EntradaAquisicao, hoje: string): Aquisicao {
  const mesHoje = hoje.slice(0, 7);
  const planos = new Map<string, PlanoAquisicao>();
  for (const m of e.metas) {
    const mes = mesDe(m.mes);
    const chave = METRICAS_PLANO[String(m.metrica)];
    if (!mes || !chave || m.papel !== "funil") continue;
    const p = planos.get(mes) ?? { investimento: null, mql: null, vendas: null, mrrNovo: null };
    p[chave] = numero(m.alvo);
    planos.set(mes, p);
  }
  const meses = e.serie
    .map((s): MesAquisicao | null => {
      const mes = mesDe(s.mes);
      if (!mes) return null;
      const investimento = numero(s.investimento);
      const vendas = numero(s.vendas);
      return {
        mes,
        investimento,
        leads: numero(s.leads),
        mql: numero(s.mql),
        vendas,
        mrrNovo: numero(s.mrr),
        custoMidiaPorVenda:
          investimento !== null && vendas ? Math.round((investimento / vendas) * 100) / 100 : null,
        plano: planos.get(mes) ?? null,
        emAndamento: mes === mesHoje,
      };
    })
    .filter((m): m is MesAquisicao => m !== null && m.mes <= mesHoje)
    .sort((a, b) => a.mes.localeCompare(b.mes));

  const mc = e.mesCorrente.find((x) => x.porte === "consolidado") ?? null;
  const forecast: ForecastMes | null = mc
    ? {
        mes: mesDe(mc.mes) ?? mesHoje,
        realizado: numero(mc.mrr_real),
        meta: numero(mc.mrr_meta),
        porRitmo: numero(mc.mrr_forecast_ritmo),
        porPipeline: numero(mc.mrr_forecast_pipeline),
        vendasRealizadas: numero(mc.vendas_real),
        vendasMeta: numero(mc.vendas_meta),
        winRate: numero(mc.win_rate_rr),
        cicloMedianoDias: numero(mc.ciclo_mediana_dias),
      }
    : null;

  let pipeline: PipelineAberto | null = null;
  if (e.abertos) {
    const porMes = new Map<string, { negocios: number; c: number }>();
    let c = 0;
    const semData = { negocios: 0, c: 0 };
    const vencidos = { negocios: 0, c: 0 };
    for (const d of e.abertos) {
      const v = Math.round((numero(d.mrr_efetivo) ?? numero(d.mrr) ?? 0) * 100);
      c += v;
      const mes = mesDe(d.expected_close_date);
      if (!mes) {
        semData.negocios += 1;
        semData.c += v;
        continue;
      }
      if (mes < mesHoje) {
        vencidos.negocios += 1;
        vencidos.c += v;
        continue;
      }
      const x = porMes.get(mes) ?? { negocios: 0, c: 0 };
      x.negocios += 1;
      x.c += v;
      porMes.set(mes, x);
    }
    pipeline = {
      negocios: e.abertos.length,
      mrr: c / 100,
      semData: { negocios: semData.negocios, mrr: semData.c / 100 },
      vencidos: { negocios: vencidos.negocios, mrr: vencidos.c / 100 },
      porMes: [...porMes.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, x]) => ({ mes, negocios: x.negocios, mrr: x.c / 100 })),
    };
  }

  const unidades = (e.distMetas ?? [])
    .map((d) => ({
      unidade: String(d.unidade ?? ""),
      trimestre: String(d.quarter ?? ""),
      meta: numero(d.meta) ?? 0,
      vendido: numero(d.vendido) ?? 0,
    }))
    .filter((d) => d.unidade && d.trimestre)
    .sort((a, b) => a.trimestre.localeCompare(b.trimestre) || b.vendido - a.vendido);

  return { meses, forecast, pipeline, unidades };
}

/** Trimestre ("AAAA-Tn") da data. */
export const trimestreDe = (dia: string) =>
  `${dia.slice(0, 4)}-T${Math.floor((Number(dia.slice(5, 7)) - 1) / 3) + 1}`;

/** Resposta da leitura do Growth (aquisicao.functions.ts). */
export type RespostaAquisicao =
  | {
      estado: "ok";
      lidoEm: string;
      dado: Aquisicao;
      unidadesLidas: boolean;
      atualizadoEm: string | null;
    }
  | { estado: "acesso_insuficiente" | "fonte_indisponivel"; lidoEm: string; motivo: string };
