import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Os números da abertura da área Receita e Repasses.
 *
 * A área tem nove páginas e nenhuma porta: quem entra cai na primeira da lista
 * (Funil de Receita) sem saber se a apuração do mês fechou, se a fatura saiu ou
 * se a unidade pagou. Esta função responde a essas três perguntas de uma vez.
 *
 * Duas réguas convivem aqui, e a tela precisa dizer qual está mostrando:
 *
 * - **Repasse** (o que a unidade deve à matriz) vem de `royalties_apuracao`,
 *   que é caixa e já com os ajustes manuais da apuração.
 * - **Receita da rede** (o que o cliente paga à unidade) vem de
 *   `v_reconciliacao_mensal`, que é competência e valor bruto de nota — a mesma
 *   fonte de /funil-receita, para os dois não discordarem.
 *
 * Ver `DATA-RULES.md` no repo da wiki: misturar as duas é o erro clássico desta
 * área, e foi a causa de "o recebimento não bate" em julho de 2026.
 *
 * Uma chamada só porque é tela de abertura: seis consultas em paralelo no
 * servidor batem qualquer arranjo de hooks no navegador, e todas as tabelas
 * envolvidas são pequenas (56 apurações, 8 faturas, 783 linhas de reconciliação).
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Quantos meses a série histórica mostra, contando o mês selecionado. */
const JANELA_MESES = 12;

export interface RepasseMes {
  /** `YYYY-MM`. */
  mes: string;
  royalties: number;
  /** CSC fixo + CSC percentual sobre base antiga: para quem lê, é uma linha só. */
  csc: number;
  cac: number;
  /** Reembolso de tráfego pago (`csc_trafego_pago`). Pass-through de mídia. */
  midia: number;
  outras: number;
  total: number;
  /** Receita da unidade que serviu de base, só das apurações confirmadas. */
  receitaBaseConfirmada: number;
  /** Royalties + CSC das confirmadas — numerador do take rate. */
  takeConfirmado: number;
  comApuracao: number;
  confirmadas: number;
}

export interface FaturaDoRepasse {
  status: string;
  num_os: string | null;
  valor_total: number;
  vence_em: string | null;
  faturada_em: string | null;
  erro: string | null;
  /** Status do título no Omie, quando o sync já trouxe. */
  recebimento: {
    status: string | null;
    vencimento: string | null;
    pago_em: string | null;
    valor: number;
  } | null;
}

export interface RepasseUnidade {
  unidade_id: number;
  unidade: string;
  /** `null` quando ninguém abriu a apuração do mês para esta unidade. */
  status: string | null;
  total: number;
  royalties: number;
  csc: number;
  cac: number;
  midia: number;
  outras: number;
  receitaBase: number | null;
  fatura: FaturaDoRepasse | null;
}

export interface ReceitaMes {
  mes: string;
  mrrContratado: number;
  faturado: number;
  recebido: number;
  aVencer: number;
  emAtraso: number;
}

export interface ReceitaRepassesOverview {
  mes: string;
  podeRepasse: boolean;
  podeReceita: boolean;
  /** Unidades regionais ativas — o denominador de "quantas já fecharam". */
  totalUnidades: number;
  meses: RepasseMes[];
  unidadesDoMes: RepasseUnidade[];
  receita: ReceitaMes[];
}

async function can(sb: any, chave: string): Promise<boolean> {
  const { data } = await sb.rpc("can", { _key: chave });
  return data === true;
}

/** Primeiro dia do mês, `delta` meses antes de `mes` (`YYYY-MM`). */
function primeiroDia(mes: string, delta = 0): string {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

function proximoMesPrimeiroDia(mes: string): string {
  return primeiroDia(mes, 1);
}

/** A lista de meses da janela, do mais antigo ao selecionado. */
function mesesDaJanela(mes: string): string[] {
  const out: string[] = [];
  for (let i = JANELA_MESES - 1; i >= 0; i--) out.push(primeiroDia(mes, -i).slice(0, 7));
  return out;
}

const N = (v: unknown) => Number(v ?? 0);

export const carregarReceitaRepasses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mes: string }) => {
    const mes = String(input?.mes ?? "").slice(0, 7);
    if (!MES_RE.test(mes)) throw new Error("Competência inválida.");
    return { mes };
  })
  .handler(async ({ data, context }): Promise<ReceitaRepassesOverview> => {
    const sb = context.supabase as any;

    // Dois blocos, duas chaves. Quem tem só uma delas vê meia tela em vez de um
    // erro: a controladoria que acompanha recebimento não precisa da apuração,
    // e quem apura royalties nem sempre tem contas a receber.
    const [podeRepasse, podeReceitaContas, podeReceitaFunil] = await Promise.all([
      can(sb, "view.unidades_rede"),
      can(sb, "view.contas_receber"),
      can(sb, "view.funil_receita"),
    ]);
    const podeReceita = podeReceitaContas || podeReceitaFunil;
    if (!podeRepasse && !podeReceita) {
      throw new Error("Acesso negado: você não tem nenhuma página da área Receita e Repasses.");
    }

    const inicio = primeiroDia(data.mes, -(JANELA_MESES - 1));
    const fimExclusivo = proximoMesPrimeiroDia(data.mes);
    const mesInicio = `${data.mes}-01`;

    const [unidadesRes, apuracoesRes, faturasRes, reconcRes] = await Promise.all([
      sb
        .from("unidades")
        .select("id,nome_da_praca")
        .eq("tipo", "regional")
        .order("nome_da_praca"),
      podeRepasse
        ? sb
            .from("royalties_apuracao")
            .select(
              "id,unidade_id,mes_referencia,status,receita_base,royalties_valor,csc_valor_fixo," +
                "csc_base_antiga_valor,cac_valor,csc_trafego_pago,outras_receitas,total_fatura",
            )
            .gte("mes_referencia", inicio)
            .lt("mes_referencia", fimExclusivo)
        : Promise.resolve({ data: [], error: null }),
      podeRepasse
        ? sb
            .from("royalties_faturas")
            .select(
              "apuracao_id,unidade_id,competencia,status,num_os,valor_total,vence_em,faturada_em,erro,cod_titulo",
            )
            .eq("competencia", mesInicio)
        : Promise.resolve({ data: [], error: null }),
      podeReceita
        ? sb
            .from("v_reconciliacao_mensal")
            .select("mes,unidade,mrr_contratado,faturado,recebido,a_vencer,em_atraso")
            .gte("mes", inicio)
            .lt("mes", fimExclusivo)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const [rotulo, res] of [
      ["Unidades", unidadesRes],
      ["Apurações", apuracoesRes],
      ["Faturas", faturasRes],
      ["Receita da rede", reconcRes],
    ] as const) {
      if (res.error) throw new Error(`${rotulo}: ${res.error.message}`);
    }

    const unidades = (unidadesRes.data ?? []) as { id: number; nome_da_praca: string }[];
    const nomeUnidade = new Map(unidades.map((u) => [u.id, u.nome_da_praca]));
    const apuracoes = (apuracoesRes.data ?? []) as any[];
    const faturas = (faturasRes.data ?? []) as any[];

    // O título do repasse é emitido na conta da Partners, e é por lá que se
    // descobre se a unidade pagou. Mesma amarração de `listarFaturasRoyalties`:
    // pelo `cod_titulo` quando existe, senão por vencimento + valor.
    let titulos: any[] = [];
    if (faturas.length > 0) {
      const vencimentos = [...new Set(faturas.map((f) => f.vence_em).filter(Boolean))];
      if (vencimentos.length > 0) {
        const { data: t, error } = await sb
          .from("contas_receber")
          .select("codigo_omie,status_pagamento,data_vencimento,data_pagamento,valor")
          .eq("unidade", "Partners")
          .in("data_vencimento", vencimentos);
        if (error) throw new Error(`Títulos do repasse: ${error.message}`);
        titulos = t ?? [];
      }
    }
    const tituloPorCodigo = new Map<number, any>(
      titulos.map((t) => [Number(t.codigo_omie), t] as const),
    );

    function recebimentoDa(f: any): FaturaDoRepasse["recebimento"] {
      const titulo =
        (f.cod_titulo && tituloPorCodigo.get(Number(f.cod_titulo))) ||
        titulos.find(
          (t) =>
            t.data_vencimento === f.vence_em &&
            Number(t.valor) === Number(f.valor_total) &&
            t.status_pagamento !== "CANCELADO",
        ) ||
        null;
      if (!titulo) return null;
      return {
        status: titulo.status_pagamento,
        vencimento: titulo.data_vencimento,
        pago_em: titulo.data_pagamento,
        valor: N(titulo.valor),
      };
    }

    // ---- série mensal do repasse ----
    const porMes = new Map<string, RepasseMes>();
    for (const mes of mesesDaJanela(data.mes)) {
      porMes.set(mes, {
        mes,
        royalties: 0,
        csc: 0,
        cac: 0,
        midia: 0,
        outras: 0,
        total: 0,
        receitaBaseConfirmada: 0,
        takeConfirmado: 0,
        comApuracao: 0,
        confirmadas: 0,
      });
    }

    for (const a of apuracoes) {
      const mes = String(a.mes_referencia).slice(0, 7);
      const alvo = porMes.get(mes);
      if (!alvo) continue;
      const csc = N(a.csc_valor_fixo) + N(a.csc_base_antiga_valor);
      alvo.royalties += N(a.royalties_valor);
      alvo.csc += csc;
      alvo.cac += N(a.cac_valor);
      alvo.midia += N(a.csc_trafego_pago);
      alvo.outras += N(a.outras_receitas);
      alvo.total += N(a.total_fatura);
      alvo.comApuracao += 1;
      // Take rate só sobre mês fechado: rascunho ainda não tem receita base
      // gravada, e dividir por zero pintaria a régua de vermelho sem motivo.
      // A fórmula é a do DATA-RULES: royalties + CSC sobre a receita apurada,
      // sem a mídia, que é repasse de custo e não remuneração da matriz.
      if (a.status === "confirmado" || a.status === "faturado") {
        alvo.confirmadas += 1;
        alvo.receitaBaseConfirmada += N(a.receita_base);
        alvo.takeConfirmado += N(a.royalties_valor) + csc;
      }
    }

    // ---- o mês selecionado, unidade a unidade ----
    const faturaPorUnidade = new Map<number, any>(faturas.map((f) => [f.unidade_id, f] as const));
    const apuracaoDoMes = new Map<number, any>(
      apuracoes
        .filter((a) => String(a.mes_referencia).slice(0, 7) === data.mes)
        .map((a) => [a.unidade_id, a] as const),
    );

    const unidadesDoMes: RepasseUnidade[] = unidades.map((u) => {
      const a = apuracaoDoMes.get(u.id);
      const f = faturaPorUnidade.get(u.id);
      return {
        unidade_id: u.id,
        unidade: u.nome_da_praca,
        status: a?.status ?? null,
        total: N(a?.total_fatura),
        royalties: N(a?.royalties_valor),
        csc: N(a?.csc_valor_fixo) + N(a?.csc_base_antiga_valor),
        cac: N(a?.cac_valor),
        midia: N(a?.csc_trafego_pago),
        outras: N(a?.outras_receitas),
        receitaBase: a?.receita_base == null ? null : N(a.receita_base),
        fatura: f
          ? {
              status: f.status,
              num_os: f.num_os ? String(Number(f.num_os)) : null,
              valor_total: N(f.valor_total),
              vence_em: f.vence_em,
              faturada_em: f.faturada_em,
              erro: f.erro,
              recebimento: recebimentoDa(f),
            }
          : null,
      };
    });

    // Fatura de unidade que saiu da régua regional (desativada, por exemplo)
    // ficaria invisível. Raro, mas some com dinheiro da tela — então entra.
    for (const f of faturas) {
      if (unidadesDoMes.some((u) => u.unidade_id === f.unidade_id)) continue;
      unidadesDoMes.push({
        unidade_id: f.unidade_id,
        unidade: nomeUnidade.get(f.unidade_id) ?? `Unidade ${f.unidade_id}`,
        status: null,
        total: 0,
        royalties: 0,
        csc: 0,
        cac: 0,
        midia: 0,
        outras: 0,
        receitaBase: null,
        fatura: {
          status: f.status,
          num_os: f.num_os ? String(Number(f.num_os)) : null,
          valor_total: N(f.valor_total),
          vence_em: f.vence_em,
          faturada_em: f.faturada_em,
          erro: f.erro,
          recebimento: recebimentoDa(f),
        },
      });
    }

    // ---- receita da rede (competência, bruto de nota) ----
    const receitaPorMes = new Map<string, ReceitaMes>();
    for (const mes of mesesDaJanela(data.mes)) {
      receitaPorMes.set(mes, {
        mes,
        mrrContratado: 0,
        faturado: 0,
        recebido: 0,
        aVencer: 0,
        emAtraso: 0,
      });
    }
    for (const r of (reconcRes.data ?? []) as any[]) {
      const mes = String(r.mes).slice(0, 7);
      const alvo = receitaPorMes.get(mes);
      if (!alvo) continue;
      alvo.mrrContratado += N(r.mrr_contratado);
      alvo.faturado += N(r.faturado);
      alvo.recebido += N(r.recebido);
      alvo.aVencer += N(r.a_vencer);
      alvo.emAtraso += N(r.em_atraso);
    }

    return {
      mes: data.mes,
      podeRepasse,
      podeReceita,
      totalUnidades: unidades.length,
      meses: Array.from(porMes.values()),
      unidadesDoMes,
      receita: Array.from(receitaPorMes.values()),
    };
  });
