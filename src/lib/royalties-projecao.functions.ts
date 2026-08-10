import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ listRoyaltiesProjecaoRede ============
// Projeção de royalties por unidade, 6 meses rolantes a partir do mês
// seguinte ao último mês com apuração confirmada na rede.
//
// V2 (decisão do Victor em 10/08/2026): a v1 projetava a partir do histórico
// de `royalties_itens` (carregar o último valor apurado por cliente) — mas
// isso tem furo estrutural: qualquer problema na apuração (item confirmado
// com is_cac errado, mês ainda em conciliação, apuração nunca aberta pra
// aquela unidade/mês) some da projeção inteira, mesmo o contrato estando
// ativo e pagando MRR de verdade. Ex. real: Maceió tinha R$86mil de MRR
// contratado (12% = ~R$10,4k/mês de piso), mas a v1 projetava só ~R$6-9k
// porque 12 dos 13 itens de royalties de jun/26 estavam com is_cac=true por
// engano.
//
// V2 projeta direto de `contratos` (MRR já vendido/ganho no Pipedrive) — sem
// depender de nenhuma apuração já ter sido aberta:
//   - Universo: todo contrato com `ganho_em` vinculado a uma unidade
//     regional. Nenhuma premissa de venda futura (só quem já foi ganho).
//   - Só sai da projeção quem tem churn REGISTRADO (`churn_pipefy_card_id`
//     em algum item de `royalties_itens` daquele contrato) — não existe
//     nenhum outro sinal de churn confiável no schema hoje
//     (`contratos.status_contrato` é sempre "Ativo", nunca atualizado).
//   - Quem não tem churn registrado entra por mrr_mensal (ou mrr/12 se
//     mrr_mensal não tiver) × % de royalties da unidade, todo mês, flat.

function addMeses(mesYYYYMM: string, n: number): string {
  const [y, m] = mesYYYYMM.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface RoyaltiesProjecaoUnidade {
  unidade_id: number;
  unidade_nome: string;
  porMes: Record<string, number>; // key = "YYYY-MM" — mesmo valor todo mês (flat)
}

export interface RoyaltiesProjecaoCliente {
  unidade_id: number;
  razao_social: string;
  cnpj: string | null;
  status: "ativo";
  porMes: Record<string, number>;
}

export const listRoyaltiesProjecaoRede = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      meses: string[]; // "YYYY-MM", 6 meses rolantes
      unidades: RoyaltiesProjecaoUnidade[];
      clientes: RoyaltiesProjecaoCliente[];
    }> => {
      const { supabase, userId } = context;
      await assertAdmin(supabase, userId);

      const { data: unidadesRows, error: uErr } = await supabase
        .from("unidades")
        .select("id,nome_da_praca,royalties_percentual")
        .eq("tipo", "regional")
        .order("nome_da_praca");
      if (uErr) throw new Error(uErr.message);
      const unidades = (unidadesRows ?? []) as {
        id: number;
        nome_da_praca: string;
        royalties_percentual: number | null;
      }[];
      if (unidades.length === 0) return { meses: [], unidades: [], clientes: [] };

      const unidadeIdPorNome = new Map(unidades.map((u) => [u.nome_da_praca, u.id]));
      const pctUnidade = new Map(unidades.map((u) => [u.id, Number(u.royalties_percentual) || 0]));

      // Mês-base da projeção: mês seguinte ao último com apuração confirmada
      // em qualquer unidade da rede (mesmo critério da v1, só isso mudou de
      // fonte pra `contratos`).
      const { data: apuracoesRows, error: aErr } = await supabase
        .from("royalties_apuracao")
        .select("mes_referencia,status,unidade_id")
        .in(
          "unidade_id",
          unidades.map((u) => u.id),
        );
      if (aErr) throw new Error(aErr.message);
      const mesesConfirmados = Array.from(
        new Set(
          (apuracoesRows ?? [])
            .filter((a) => a.status === "confirmado")
            .map((a) => String(a.mes_referencia).slice(0, 7)),
        ),
      ).sort();
      const hoje = new Date();
      const mesAtual = `${hoje.getUTCFullYear()}-${String(hoje.getUTCMonth() + 1).padStart(2, "0")}`;
      const baseMes =
        mesesConfirmados.length > 0
          ? mesesConfirmados[mesesConfirmados.length - 1]
          : addMeses(mesAtual, -1);
      const mesesFuturos = Array.from({ length: 6 }, (_, i) => addMeses(baseMes, i + 1));

      // Contratos ganhos, vinculados a alguma unidade regional. Exige
      // `pipedrive_deal_id` preenchido — só entra venda de verdade do
      // Pipedrive, não linha manual em `contratos` (decisão do Victor:
      // "tem que ser venda com id do pipedrive apenas"). Consequência aceita:
      // cliente que paga royalties de verdade mas não tem contrato_id/deal
      // vinculado (ex.: boa parte do cluster Genial/BC no RJ) fica de fora
      // até o vínculo ser corrigido — não tenta compensar via apuração.
      const { data: contratosRows, error: cErr } = await supabase
        .from("contratos")
        .select("id,titulo,cnpj,mrr,mrr_mensal,ganho_em,unidade,pipedrive_deal_id")
        .not("ganho_em", "is", null)
        .not("pipedrive_deal_id", "is", null)
        .in(
          "unidade",
          unidades.map((u) => u.nome_da_praca),
        );
      if (cErr) throw new Error(cErr.message);
      const contratos = contratosRows ?? [];

      // Churn registrado — único sinal confiável disponível hoje. Junta por
      // contrato_id (a maioria dos casos) e por CNPJ como reforço pra quando
      // o item de churn não tem contrato_id vinculado.
      const { data: churnRows, error: chErr } = await supabase
        .from("royalties_itens")
        .select("contrato_id,cnpj,razao_social")
        .not("churn_pipefy_card_id", "is", null);
      if (chErr) throw new Error(chErr.message);
      const contratoIdsChurned = new Set(
        (churnRows ?? []).map((r) => r.contrato_id).filter((id): id is number => id != null),
      );
      const cnpjsChurned = new Set(
        (churnRows ?? []).map((r) => r.cnpj).filter((c): c is string => !!c),
      );
      const nomesChurned = new Set(
        (churnRows ?? [])
          .filter((r) => r.contrato_id == null && !r.cnpj)
          .map((r) => (r.razao_social ?? "").trim().toLowerCase())
          .filter(Boolean),
      );

      const unidadesOut: RoyaltiesProjecaoUnidade[] = unidades.map((u) => ({
        unidade_id: u.id,
        unidade_nome: u.nome_da_praca,
        porMes: Object.fromEntries(mesesFuturos.map((m) => [m, 0])),
      }));
      const porUnidadeMap = new Map(unidadesOut.map((u) => [u.unidade_id, u]));
      const clientesOut: RoyaltiesProjecaoCliente[] = [];

      for (const c of contratos) {
        const uid = unidadeIdPorNome.get(c.unidade ?? "");
        if (uid == null) continue;
        const churned =
          contratoIdsChurned.has(c.id) ||
          (c.cnpj != null && cnpjsChurned.has(c.cnpj)) ||
          nomesChurned.has((c.titulo ?? "").trim().toLowerCase());
        if (churned) continue;

        const mrrMensal =
          c.mrr_mensal != null ? Number(c.mrr_mensal) : c.mrr != null ? Number(c.mrr) / 12 : 0;
        if (mrrMensal <= 0) continue;
        const pct = pctUnidade.get(uid) ?? 0;
        const valorMensal = Math.round(mrrMensal * (pct / 100) * 100) / 100;
        if (valorMensal <= 0) continue;

        const u = porUnidadeMap.get(uid)!;
        for (const mes of mesesFuturos) u.porMes[mes] += valorMensal;

        clientesOut.push({
          unidade_id: uid,
          razao_social: c.titulo ?? "—",
          cnpj: c.cnpj ?? null,
          status: "ativo",
          porMes: Object.fromEntries(mesesFuturos.map((m) => [m, valorMensal])),
        });
      }

      for (const u of unidadesOut) {
        for (const m of mesesFuturos) u.porMes[m] = Math.round(u.porMes[m] * 100) / 100;
      }

      return { meses: mesesFuturos, unidades: unidadesOut, clientes: clientesOut };
    },
  );
