import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { AREA_BI_FINANCEIRO } from "@/lib/bi-financeiro-acesso";

// DRE e Caixa da Partners (/dre-caixa). Contrato: docs/design/contratos/dre-caixa.md.
//
// Quem calcula é tools/dre_caixa_payload.py (repo ai-projects-scripts), depois de montar as abas
// DRE e FCX da planilha "Financeiro - Planning Partners": grava o retrato pronto em
// `ops.dre_caixa` (uma linha, id=1). Mesmo desenho do Financeiro semanal: RLS ligada sem policy,
// leitura pelo service_role depois de conferir a área `bi_financeiro` (era `receita` até 19/10/2026).
//
// Prévia local: com `DRE_CAIXA_ARQUIVO` apontando para o JSON do `--dry-run`, o servidor de
// desenvolvimento lê o arquivo em vez da tabela. Só em dev; o build ignora a variável.

/** Uma linha da DRE. `v` segue a ordem de `meses`. Despesa é negativa. */
export interface LinhaDre {
  k: string;
  /** 0 bloco, 1 grupo, 2 conta, 3 fornecedor ou unidade. */
  nivel: 0 | 1 | 2 | 3;
  bloco: string;
  grupo: string;
  conta: string;
  /** Linha de conferência: fica fora dos totais. */
  conferencia: boolean;
  pct: boolean;
  /** Acima do EBIT (entra na ponte do EBIT). */
  ebit: boolean;
  v: number[];
  acc: number;
}

export interface LinhaFcx {
  k: string;
  v: number[];
}

export interface Degrau {
  id: string;
  rotulo: string;
  explica: string;
  dre: number;
  caixa: number;
  /** caixa − DRE: o quanto este motivo leva da DRE ao caixa. */
  efeito: number;
}

export type TomConferencia = "atencao" | "perigo" | "info";

export interface Conferencia {
  tipo: string;
  titulo: string;
  valor: number;
  tom: TomConferencia;
  dono: string;
  itens: { nome: string; valor: number; obs: string }[];
}

export interface DreCaixa {
  gerado_em: string;
  /** `YYYY-MM`. */
  meses: string[];
  situacao: Record<string, string>;
  dre: LinhaDre[];
  notas: string[];
  fcx: { meses: string[]; resumo: LinhaFcx[]; entradas: LinhaFcx[]; saidas: LinhaFcx[] };
  ponte: Record<string, { resultado_dre: number; resultado_caixa: number; degraus: Degrau[] }>;
  conferencias: Record<string, Conferencia[]>;
  /**
   * CAC que as vendas de cada mês (`YYYY-MM` da venda) geraram: 1 honorário por venda
   * elegível sem churn. `estimado` usa o MRR quando o card ainda não tem honorário.
   * Ausente nos retratos anteriores a 16/10/2026.
   */
  /** Ausente nos retratos anteriores a 16/10/2026. */
  inadimplencia?: {
    /** (A) o que cada unidade deve à Partners, vencido, por faixa de atraso. */
    unidades_partners: {
      unidade: string;
      ate30: number;
      d31_60: number;
      d61_90: number;
      mais90: number;
      total: number;
      categorias: Record<string, number>;
    }[];
    /** (B) clientes da rede com as unidades no ano: faturado, pago, vencido e o royalty que não entrou. */
    rede: { unidade: string; pct_royalty: number; faturado: number; pago: number; vencido: number; royalty: number }[];
    rede_por_mes: Record<string, { faturado: number; pago: number; vencido: number; royalty: number }>;
    sem_dado: string[];
  };
  /** Ausente nos retratos anteriores a 19/10/2026. */
  vendas?: VendasRetrato;
  /** Abas de análise da planilha (área BI Financeiro). Ausente nos retratos anteriores a 19/10/2026. */
  bi?: BiPlanilha;
  cac?: Record<
    string,
    { vendas: number; cobrado: number; a_cobrar: number; estimado: number; churn: number }
  >;
}

/**
 * Aba Vendas e ROAS (19/10/2026), gravada por tools/vendas_roas_planilha.py. Linhas cruas: a
 * tela soma pelo período e pela unidade.
 */
export interface VendasRetrato {
  gerado_em: string;
  /** `YYYY-MM`, de jan/26 até o mês corrente. */
  meses: string[];
  /** Deals ganhos no pipeline Inside Sales, rede toda. `funil_cac`: unidade aparece no Funil de CAC. */
  vendas: { titulo: string; unidade: string; criado: string; ganho: string; mrr: number; funil_cac: boolean }[];
  /** Mídia da finalidade inside_sales por mês. */
  midia: Record<string, number>;
  /** Deals criados no mês (safra), rede toda: ganhos até hoje, abertos e MRR ganho. */
  safra: Record<string, { criados: number; ganhos: number; abertos: number; mrr: number }>;
  /** Parcelas de CAC. `mes_caixa` é `YYYY-MM` ou "sem data"; esperado = valor × peso. */
  agenda: {
    unidade: string;
    cliente: string;
    parcela: string;
    valor: number;
    peso: number;
    situacao: "recebida" | "atrasada" | "cobrada" | "a cobrar" | "termo sem contrato";
    termo: string;
    assinatura: string;
    competencia: string;
    mes_caixa: string;
  }[];
  premissas: { conv: number; chance_m2: number; lag_p1: number; lag_p2: number; lag_comp: number };
}

/** Uma linha do Forecast Oficial × DRE. `p` e `v` seguem `meses`; custo é positivo dos dois lados. */
export interface LinhaForecast {
  r: string;
  /** r: receita ou resultado (subir é bom) · c: custo (subir é ruim) · t: título de bloco. */
  tipo: "r" | "c" | "t";
  total?: boolean;
  nota?: string;
  p?: number[];
  v?: number[];
}

/** Linha de uma aba mês a mês da planilha (DRE Aquisição, DRE Retenção, Burn Rate, Competência × Caixa). */
export interface LinhaAba {
  k: string;
  nivel: 0 | 1;
  titulo?: boolean;
  v?: number[];
}

export interface AbaMensal {
  meses: string[];
  linhas: LinhaAba[];
}

export interface BiPlanilha {
  forecast: { meses: string[]; parcial: string | null; atualizado: string; linhas: LinhaForecast[] };
  aquisicao: AbaMensal;
  retencao: AbaMensal;
  burn: AbaMensal;
  competencia_caixa: AbaMensal;
  /** Parcelas de CAC de contratos assinados, pelo mês em que devem entrar no caixa. */
  cac_agenda: {
    por_mes: Record<string, { valor: number; parcelas: number }>;
    atrasado: { valor: number; parcelas: number };
  };
}

export const carregarDreCaixa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ payload: DreCaixa; gravadoEm: string } | null> => {
    const acesso = await acessoDoUsuario(context.supabase, context.userId);
    if (!acesso.areas.includes(AREA_BI_FINANCEIRO))
      throw new Error("Acesso negado: sua conta não tem a área BI Financeiro.");
    const arquivo = import.meta.env.DEV ? process.env.DRE_CAIXA_ARQUIVO : undefined;
    if (arquivo) {
      const { readFile } = await import("node:fs/promises");
      const payload = JSON.parse(await readFile(arquivo, "utf8")) as DreCaixa;
      return { payload, gravadoEm: payload.gerado_em };
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const { data, error } = await db
      .from("dre_caixa")
      .select("gerado_em, payload")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`A leitura da DRE falhou (${error.code ?? error.message}).`);
    if (!data) return null;
    return { payload: data.payload as DreCaixa, gravadoEm: data.gerado_em as string };
  });
