import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * O histórico do repasse por unidade e mês, para o gráfico da Apuração de
 * Royalties (16/10/2026): o mesmo "do que o repasse é feito" da Visão geral da
 * Receita, mas aberto por unidade, para ver cada uma isolada no tempo.
 *
 * Mesma régua da Visão geral (`receita-repasses.functions.ts`): royalties, CSC
 * e outras pelo mês da apuração (caixa), CAC e mídia na competência da
 * apuração. O CSC soma o fixo e o percentual da base antiga; outras soma
 * `outras_receitas` e os serviços fixos do boleto de contas fixas (CS, RH,
 * Compliance). O agregado no navegador tem que bater com o gráfico da Visão
 * geral quando nenhum filtro está aplicado.
 */

const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Até quantos meses o histórico volta, contando o mês selecionado. */
const JANELA_MESES = 24;

/** O PostgREST corta em 1000 linhas; paginar por range. */
const PAGINA = 1000;

export interface RepasseUnidadeMes {
  /** `YYYY-MM`. */
  mes: string;
  unidade_id: number;
  status: string | null;
  royalties: number;
  csc: number;
  outras: number;
  cac: number;
  midia: number;
}

export interface HistoricoRepasse {
  /** Do primeiro mês com apuração na janela até o selecionado, em ordem. */
  meses: string[];
  unidades: { id: number; nome: string }[];
  linhas: RepasseUnidadeMes[];
}

function primeiroDia(mes: string, delta = 0): string {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 10);
}

const N = (v: unknown) => Number(v ?? 0);

export const carregarHistoricoRepasse = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { mes: string }) => {
    const mes = String(input?.mes ?? "").slice(0, 7);
    if (!MES_RE.test(mes)) throw new Error("Competência inválida.");
    return { mes };
  })
  .handler(async ({ data, context }): Promise<HistoricoRepasse> => {
    const sb = context.supabase as any;

    const { data: pode } = await sb.rpc("can", { _key: "view.auditoria.royalties" });
    if (pode !== true) throw new Error("Acesso negado: view.auditoria.royalties.");

    const inicio = primeiroDia(data.mes, -(JANELA_MESES - 1));
    const fimExclusivo = primeiroDia(data.mes, 1);

    const apuracoes: any[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data: pagina, error } = await sb
        .from("royalties_apuracao")
        .select(
          "unidade_id,mes_referencia,status,royalties_valor,csc_valor_fixo,csc_base_antiga_valor," +
            "cac_valor,csc_trafego_pago,outras_receitas,servicos_fixos_valor",
        )
        .gte("mes_referencia", inicio)
        .lt("mes_referencia", fimExclusivo)
        .order("id")
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(`Apurações: ${error.message}`);
      apuracoes.push(...(pagina ?? []));
      if (!pagina || pagina.length < PAGINA) break;
    }

    // Toda unidade que já teve apuração entra, mesmo a que saiu da régua
    // regional: o histórico dela continua sendo repasse da rede.
    const ids = [...new Set(apuracoes.map((a) => Number(a.unidade_id)))];
    const nomes = new Map<number, string>();
    if (ids.length > 0) {
      const { data: us, error } = await sb
        .from("unidades")
        .select("id,nome_da_praca")
        .in("id", ids);
      if (error) throw new Error(`Unidades: ${error.message}`);
      for (const u of us ?? []) nomes.set(Number(u.id), u.nome_da_praca);
    }

    const linhas: RepasseUnidadeMes[] = apuracoes.map((a) => ({
      mes: String(a.mes_referencia).slice(0, 7),
      unidade_id: Number(a.unidade_id),
      status: a.status ?? null,
      royalties: N(a.royalties_valor),
      csc: N(a.csc_valor_fixo) + N(a.csc_base_antiga_valor),
      outras: N(a.outras_receitas) + N(a.servicos_fixos_valor),
      cac: N(a.cac_valor),
      midia: N(a.csc_trafego_pago),
    }));

    // A série começa no primeiro mês com apuração: antes disso não havia
    // apuração no sistema, e doze barras vazias só empurram o gráfico.
    const primeiro = linhas.reduce<string | null>(
      (min, l) => (min == null || l.mes < min ? l.mes : min),
      null,
    );
    const meses: string[] = [];
    if (primeiro) {
      for (let i = JANELA_MESES - 1; i >= 0; i--) {
        const m = primeiroDia(data.mes, -i).slice(0, 7);
        if (m >= primeiro) meses.push(m);
      }
    }

    const unidades = ids
      .map((id) => ({ id, nome: nomes.get(id) ?? `Unidade ${id}` }))
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

    return { meses, unidades, linhas };
  });
