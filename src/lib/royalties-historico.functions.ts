import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, digits } from "@/lib/server-utils";

// ============ listRoyaltiesHistoricoRede ============
// Visão consolidada da rede pra tela `/royalties`: histórico de royalties por
// cliente (mês a mês, cross-unidade) + evolução mensal do valor apurado.
// Reconstrói o valor apurado direto de `royalties_itens` (em vez de confiar em
// `royalties_apuracao.royalties_valor`, que pode ficar desatualizado se o item
// for confirmado depois do fechamento — mesma fórmula de `fecharApuracao`).
//
// Cobertura: só existem dados pros meses em que alguém já abriu a tela de
// apuração daquela unidade (itens são gerados sob demanda). Meses nunca
// abertos simplesmente não aparecem — não é ausência de cobrança.

export interface RoyaltiesHistoricoMes {
  apuracao_status: string;
  categoria: string;
  valor_confirmado: number;
  confirmado: boolean;
  status_match: string | null;
  excluido_em: string | null;
  churn_pipefy_card_id: string | null;
}

export interface RoyaltiesHistoricoCliente {
  chave: string;
  cnpj: string | null;
  razao_social: string;
  unidade_id: number;
  unidade_nome: string;
  data_ganho: string | null;
  meses: Record<string, RoyaltiesHistoricoMes>; // key = mes_referencia (YYYY-MM-DD)
}

export interface RoyaltiesEvolucaoPonto {
  mes_referencia: string;
  unidade_id: number;
  unidade_nome: string;
  apuracao_status: string;
  royalties_apurado: number;
}

export const listRoyaltiesHistoricoRede = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{
    meses: string[];
    unidades: { id: number; nome: string }[];
    clientes: RoyaltiesHistoricoCliente[];
    evolucao: RoyaltiesEvolucaoPonto[];
  }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: unidadesRows, error: uErr } = await supabase
      .from("unidades")
      .select("id,nome_da_praca")
      .eq("tipo", "regional")
      .order("nome_da_praca");
    if (uErr) throw new Error(uErr.message);
    const unidades = (unidadesRows ?? []) as { id: number; nome_da_praca: string }[];
    const unidadeNome = new Map(unidades.map((u) => [u.id, u.nome_da_praca]));
    if (unidades.length === 0) {
      return { meses: [], unidades: [], clientes: [], evolucao: [] };
    }

    const { data: apuracoes, error: aErr } = await supabase
      .from("royalties_apuracao")
      .select("id,unidade_id,mes_referencia,status,royalties_percentual")
      .in(
        "unidade_id",
        unidades.map((u) => u.id),
      );
    if (aErr) throw new Error(aErr.message);
    if (!apuracoes || apuracoes.length === 0) {
      return {
        meses: [],
        unidades: unidades.map((u) => ({ id: u.id, nome: u.nome_da_praca })),
        clientes: [],
        evolucao: [],
      };
    }

    type ApInfo = { unidade_id: number; mes_referencia: string; status: string; royalties_percentual: number | null };
    const apInfo = new Map<number, ApInfo>(
      apuracoes.map((a: any) => [a.id, a as ApInfo]),
    );

    const { data: itens, error: iErr } = await supabase
      .from("royalties_itens")
      .select(
        "apuracao_id,cnpj,razao_social,contrato_id,categoria,valor_confirmado,confirmado,is_cac,royalties_percentual_override,status_match,excluido_em,churn_pipefy_card_id,data_ganho",
      )
      .in(
        "apuracao_id",
        apuracoes.map((a: any) => a.id),
      );
    if (iErr) throw new Error(iErr.message);

    const clientesMap = new Map<string, RoyaltiesHistoricoCliente>();
    const evolMap = new Map<string, { unidade_id: number; mes_referencia: string; status: string; total: number }>();
    const mesesSet = new Set<string>();

    for (const it of (itens ?? []) as any[]) {
      const ap = apInfo.get(it.apuracao_id);
      if (!ap) continue;
      mesesSet.add(ap.mes_referencia);

      // ---- histórico por cliente ----
      // Chave por CNPJ (não contrato_id): o mesmo contrato pode trocar de id
      // entre meses (recontratação/merge de filiais) mas o CNPJ persiste —
      // ver achado em `royalties.functions.ts` (merge por CNPJ "principal").
      const cnpjDigits = digits(it.cnpj);
      const chave = cnpjDigits
        ? `${cnpjDigits}|${ap.unidade_id}`
        : `sem-cnpj:${it.contrato_id ?? it.razao_social}|${ap.unidade_id}`;

      let cliente = clientesMap.get(chave);
      if (!cliente) {
        cliente = {
          chave,
          cnpj: it.cnpj ?? null,
          razao_social: it.razao_social,
          unidade_id: ap.unidade_id,
          unidade_nome: unidadeNome.get(ap.unidade_id) ?? "—",
          data_ganho: it.data_ganho ?? null,
          meses: {},
        };
        clientesMap.set(chave, cliente);
      }
      if (it.razao_social) cliente.razao_social = it.razao_social;
      if (it.data_ganho && (!cliente.data_ganho || it.data_ganho < cliente.data_ganho)) {
        cliente.data_ganho = it.data_ganho;
      }

      const existente = cliente.meses[ap.mes_referencia];
      if (!existente) {
        cliente.meses[ap.mes_referencia] = {
          apuracao_status: ap.status,
          categoria: it.categoria,
          valor_confirmado: Number(it.valor_confirmado ?? 0),
          confirmado: !!it.confirmado,
          status_match: it.status_match,
          excluido_em: it.excluido_em,
          churn_pipefy_card_id: it.churn_pipefy_card_id,
        };
      } else {
        // Mais de um item no mesmo mês (raro — ex: royalties + csc_base_antiga
        // pro mesmo CNPJ): soma o valor, só marca confirmado se todos estiverem.
        existente.valor_confirmado += Number(it.valor_confirmado ?? 0);
        existente.confirmado = existente.confirmado && !!it.confirmado;
        if (it.excluido_em) existente.excluido_em = it.excluido_em;
        if (it.churn_pipefy_card_id) existente.churn_pipefy_card_id = it.churn_pipefy_card_id;
      }

      // ---- evolução do valor apurado (royalties, exclui CAC e itens excluídos) ----
      // Reconstrói com a mesma fórmula de `fecharApuracao`: valor_confirmado ×
      // percentual (override do item, senão o da apuração) ÷ 100 — só itens
      // confirmados contam, mesmo que o mês ainda esteja em rascunho/revisão.
      if (it.categoria === "royalties" && !it.is_cac && it.confirmado && !it.excluido_em) {
        const pct =
          it.royalties_percentual_override != null
            ? Number(it.royalties_percentual_override)
            : Number(ap.royalties_percentual ?? 0);
        const valor = (Number(it.valor_confirmado ?? 0) * pct) / 100;
        const evolKey = `${ap.unidade_id}|${ap.mes_referencia}`;
        const cur = evolMap.get(evolKey);
        if (cur) cur.total += valor;
        else evolMap.set(evolKey, { unidade_id: ap.unidade_id, mes_referencia: ap.mes_referencia, status: ap.status, total: valor });
      }
    }

    const evolucao: RoyaltiesEvolucaoPonto[] = Array.from(evolMap.values())
      .map((e) => ({
        mes_referencia: e.mes_referencia,
        unidade_id: e.unidade_id,
        unidade_nome: unidadeNome.get(e.unidade_id) ?? "—",
        apuracao_status: e.status,
        royalties_apurado: Math.round(e.total * 100) / 100,
      }))
      .sort((a, b) => a.mes_referencia.localeCompare(b.mes_referencia));

    return {
      meses: Array.from(mesesSet).sort(),
      unidades: unidades.map((u) => ({ id: u.id, nome: u.nome_da_praca })),
      clientes: Array.from(clientesMap.values()).sort((a, b) =>
        a.razao_social.localeCompare(b.razao_social),
      ),
      evolucao,
    };
  });
