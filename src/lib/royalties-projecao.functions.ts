import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

// ============ listRoyaltiesProjecaoRede ============
// Projeção de royalties por unidade, 6 meses rolantes a partir do mês
// seguinte ao último mês com apuração confirmada (rede toda — não é por
// unidade individual, já que unidades diferentes podem ter confirmado meses
// diferentes). Mesma metodologia validada em tools/projecao_royalties_
// clientes_existentes.py (conversa 21/07/2026):
//
//   - Universo fixo: só cliente que já foi ganho no Pipedrive (tem contrato).
//     Nenhuma premissa de venda futura.
//   - Cliente "active"/"irregular" (já pagou royalties em algum mês, ainda
//     dentro da janela de churn): mantém o ÚLTIMO valor conhecido pros 6
//     meses futuros — sem decaimento de churn (decisão explícita: um teste
//     anterior com taxa de churn blended deu queda implausível de ~53%/ano).
//   - Cliente "never_paid" mas dentro da janela de maturação (~60 dias desde
//     o ganho no Pipedrive): entra pelo valor esperado = mrr_contratado ×
//     % de royalties da unidade.
//   - Cliente "churned" (2+ meses seguidos sem pagar, no fim da série) ou
//     "never_paid" fora da janela de maturação: R$0, não projeta.

const LAG_MATURACAO_DIAS = 60;
const JANELA_CHURNED_MESES = 2;

type StatusCliente = "active" | "irregular" | "churned" | "never_paid";

function classificarStatus(valores: number[]): {
  status: StatusCliente;
  ultimoValor: number | null;
} {
  if (valores.every((v) => v <= 0)) return { status: "never_paid", ultimoValor: null };
  let ultimoPagoIdx = -1;
  for (let i = 0; i < valores.length; i++) if (valores[i] > 0) ultimoPagoIdx = i;
  const ultimoValor = valores[ultimoPagoIdx];
  const mesesSemPagarNoFinal = valores.length - 1 - ultimoPagoIdx;
  if (mesesSemPagarNoFinal >= JANELA_CHURNED_MESES) return { status: "churned", ultimoValor };
  if (mesesSemPagarNoFinal === 0) return { status: "active", ultimoValor };
  return { status: "irregular", ultimoValor };
}

function diasDesde(dataStr: string | null, hoje: Date): number | null {
  if (!dataStr) return null;
  const d = new Date(dataStr.slice(0, 10) + "T00:00:00Z");
  return Math.floor((hoje.getTime() - d.getTime()) / 86_400_000);
}

function addMeses(mesYYYYMM: string, n: number): string {
  const [y, m] = mesYYYYMM.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface RoyaltiesProjecaoUnidade {
  unidade_id: number;
  unidade_nome: string;
  porMes: Record<string, number>; // key = "YYYY-MM"
}

export const listRoyaltiesProjecaoRede = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{
      meses: string[]; // "YYYY-MM", 6 meses rolantes
      unidades: RoyaltiesProjecaoUnidade[];
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
      if (unidades.length === 0) return { meses: [], unidades: [] };

      const unidadeIds = unidades.map((u) => u.id);
      const nomeUnidade = new Map(unidades.map((u) => [u.id, u.nome_da_praca]));
      const pctUnidade = new Map(unidades.map((u) => [u.id, Number(u.royalties_percentual) || 0]));
      const pctMedia =
        unidades.reduce((acc, u) => acc + (Number(u.royalties_percentual) || 0), 0) /
        unidades.length;

      const { data: apuracoesRows, error: aErr } = await supabase
        .from("royalties_apuracao")
        .select("id,unidade_id,mes_referencia,status")
        .in("unidade_id", unidadeIds);
      if (aErr) throw new Error(aErr.message);
      const apuracoes = apuracoesRows ?? [];
      const apInfo = new Map(apuracoes.map((a) => [a.id, a]));

      const mesesConfirmados = Array.from(
        new Set(
          apuracoes
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

      // Itens paginados (PostgREST corta em 1000 linhas por padrão).
      const apuracaoIds = apuracoes.map((a) => a.id);
      const itens: {
        apuracao_id: number;
        contrato_id: number | null;
        cnpj: string | null;
        mrr_contratado: number | null;
        valor_confirmado: number | null;
        royalties_item: number | null;
        valor_omie: number | null;
      }[] = [];
      if (apuracaoIds.length > 0) {
        const PAGE = 1000;
        for (let offset = 0; ; offset += PAGE) {
          const { data: pagina, error: iErr } = await supabase
            .from("royalties_itens")
            .select(
              "apuracao_id,contrato_id,cnpj,mrr_contratado,valor_confirmado,royalties_item,valor_omie",
            )
            .in("apuracao_id", apuracaoIds)
            .eq("is_cac", false)
            .is("excluido_em", null)
            .range(offset, offset + PAGE - 1);
          if (iErr) throw new Error(iErr.message);
          itens.push(...(pagina ?? []));
          if (!pagina || pagina.length < PAGE) break;
        }
      }

      // Contratos referenciados — precisa de `ganho_em` (janela de maturação)
      // e `mrr_mensal`/`mrr` (valor esperado de quem ainda não apurou nada).
      const contratoIds = Array.from(
        new Set(itens.map((i) => i.contrato_id).filter((id): id is number => id != null)),
      );
      const contratoInfo = new Map<
        number,
        { ganho_em: string | null; mrr: number | null; mrr_mensal: number | null }
      >();
      if (contratoIds.length > 0) {
        const PAGE = 1000;
        for (let offset = 0; offset < contratoIds.length; offset += PAGE) {
          const chunk = contratoIds.slice(offset, offset + PAGE);
          const { data: contratosRows, error: cErr } = await supabase
            .from("contratos")
            .select("id,ganho_em,mrr,mrr_mensal")
            .in("id", chunk);
          if (cErr) throw new Error(cErr.message);
          for (const c of contratosRows ?? []) contratoInfo.set(c.id, c);
        }
      }

      // ---- monta série mensal por cliente ----
      type ClienteAgg = {
        unidade_id: number;
        mrrContratado: number | null;
        ganhoEm: string | null;
        serie: Map<string, number>;
      };
      const clientes = new Map<string, ClienteAgg>();
      for (const it of itens) {
        const ap = apInfo.get(it.apuracao_id);
        if (!ap) continue;
        const mes = String(ap.mes_referencia).slice(0, 7);
        const chave = it.contrato_id != null ? `c:${it.contrato_id}` : `cnpj:${it.cnpj ?? "?"}`;
        let c = clientes.get(chave);
        if (!c) {
          const contrato = it.contrato_id != null ? contratoInfo.get(it.contrato_id) : undefined;
          c = {
            unidade_id: ap.unidade_id,
            mrrContratado: it.mrr_contratado ?? contrato?.mrr_mensal ?? contrato?.mrr ?? null,
            ganhoEm: contrato?.ganho_em ?? null,
            serie: new Map(),
          };
          clientes.set(chave, c);
        }
        const valor = Number(it.valor_confirmado ?? it.royalties_item ?? it.valor_omie ?? 0);
        c.serie.set(mes, (c.serie.get(mes) ?? 0) + valor);
        if (it.mrr_contratado != null) c.mrrContratado = it.mrr_contratado;
      }

      // eixo comum pra classificar status de forma consistente entre clientes
      const mesesSerieGlobal = Array.from(
        new Set(Array.from(clientes.values()).flatMap((c) => Array.from(c.serie.keys()))),
      ).sort();

      // ---- projeta os 6 meses futuros, agregado por unidade ----
      const porUnidadeMes = new Map<string, number>(); // key `${uid}|${mes}`
      for (const c of clientes.values()) {
        const valores = mesesSerieGlobal.map((m) => c.serie.get(m) ?? 0);
        const { status, ultimoValor } = classificarStatus(valores);
        const dias = diasDesde(c.ganhoEm, hoje);
        const pct = pctUnidade.get(c.unidade_id) ?? pctMedia;

        for (const mes of mesesFuturos) {
          let valorMes = 0;
          if ((status === "active" || status === "irregular") && ultimoValor) {
            valorMes = ultimoValor; // sem decaimento de churn — ver nota acima
          } else if (status === "never_paid" && dias != null && dias < LAG_MATURACAO_DIAS) {
            const valorEsperado = (c.mrrContratado ?? 0) * (pct / 100);
            // aproximação simples: só entra a partir do 2º mês futuro, a
            // menos que já esteja perto do fim da janela de maturação
            if (mes !== mesesFuturos[0] || dias >= LAG_MATURACAO_DIAS - 30) {
              valorMes = valorEsperado;
            }
          }
          if (valorMes > 0) {
            const key = `${c.unidade_id}|${mes}`;
            porUnidadeMes.set(key, (porUnidadeMes.get(key) ?? 0) + valorMes);
          }
        }
      }

      const unidadesOut: RoyaltiesProjecaoUnidade[] = unidades.map((u) => ({
        unidade_id: u.id,
        unidade_nome: nomeUnidade.get(u.id) ?? "—",
        porMes: Object.fromEntries(
          mesesFuturos.map((m) => [
            m,
            Math.round((porUnidadeMes.get(`${u.id}|${m}`) ?? 0) * 100) / 100,
          ]),
        ),
      }));

      return { meses: mesesFuturos, unidades: unidadesOut };
    },
  );
