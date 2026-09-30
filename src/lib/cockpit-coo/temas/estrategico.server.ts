// Leitura do tema Sex · Estratégico: o IDU (Pacto Trimestral) e a apuração de royalties da rede.
//
// A foto de OKR e os compromissos NÃO são lidos aqui: vêm da carga comum (base.functions.ts) e
// chegam prontos ao `montarEstrategico`.
//
// Tudo com a sessão da pessoa (RLS), e cada fonte falha sozinha. As portas são conferidas antes,
// porque a RLS devolve lista vazia a quem não pode ler, e lista vazia viraria "0 unidades no pacto"
// ou "R$ 0 de faturamento" com cara de dado:
// - IDU: as RPCs só devolvem linhas a quem tem `view.idu` (idu_pode_ver / can('view.idu'));
// - royalties: a mesma porta do Cockpit do CEO (portas.ts, FONTES_REDE: admin ou diretor) e o
//   escopo de todas as unidades.
import type { ContextoCoo } from "../contexto.server.ts";
import { motivoDoErro } from "../contexto.server.ts";
import { todasAsPaginas } from "../../cockpit-ceo/paginar.ts";
import { FONTES_REDE, fontesSemAcesso, motivoSemAcesso } from "../../cockpit-ceo/portas.ts";
import type { ApuracaoRede, UnidadeRede } from "../../cockpit-ceo/receita-fontes.ts";
import { trimestreIdu, trimestreSeguinte } from "./estrategico.ts";
import type {
  DadosEstrategico,
  DadosIdu,
  LinhaApuracaoIdu,
  LinhaRankingIdu,
  ParteEstrategico,
} from "./estrategico.ts";

/**
 * Meses de apuração lidos para trás: 12 da janela, 12 do ano anterior (crescimento) e folga para a
 * janela que termina antes do último mês fechado por mês incompleto.
 */
const MESES_DE_APURACAO = 30;

function inicioDaLeitura(hoje: string): string {
  return new Date(
    Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 1 - MESES_DE_APURACAO, 1),
  )
    .toISOString()
    .slice(0, 10);
}

async function lerIdu(ctx: ContextoCoo): Promise<ParteEstrategico<DadosIdu>> {
  if (!ctx.permissoes.includes("view.idu"))
    return {
      ok: false,
      estado: "acesso_insuficiente",
      motivo: "sua conta não tem a permissão de ver o IDU",
    };
  const { db } = ctx;
  const tri = trimestreIdu(ctx.hoje);
  const prox = trimestreSeguinte(tri);
  const args = { p_inicio: tri.inicio, p_fim: tri.fim };
  try {
    const [rank, apur, metas, padrao] = await Promise.all([
      db.rpc("idu_ranking", args),
      db.rpc("idu_apuracao", args),
      db.from("idu_metas").select("periodo_inicio").in("periodo_inicio", [tri.inicio, prox.inicio]),
      db
        .from("idu_metas_padrao")
        .select("periodo_inicio")
        .in("periodo_inicio", [tri.inicio, prox.inicio]),
    ]);
    if (rank.error)
      return {
        ok: false,
        estado: "fonte_indisponivel",
        motivo: motivoDoErro("ranking do IDU", rank.error),
      };
    if (apur.error)
      return {
        ok: false,
        estado: "fonte_indisponivel",
        motivo: motivoDoErro("apuração do IDU", apur.error),
      };
    // A contagem de metas é complemento: se falhar, o número segue e só o alerta do próximo trimestre cala.
    const gravadas =
      metas.error || padrao.error ? null : [...(metas.data ?? []), ...(padrao.data ?? [])];
    const contar = (inicio: string) =>
      gravadas === null
        ? null
        : gravadas.filter(
            (m: { periodo_inicio: string }) => String(m.periodo_inicio).slice(0, 10) === inicio,
          ).length;
    return {
      ok: true,
      dado: {
        trimestre: tri,
        ranking: (rank.data ?? []) as LinhaRankingIdu[],
        apuracao: ((apur.data ?? []) as LinhaApuracaoIdu[]).map((a) => ({
          unidade_id: Number(a.unidade_id),
          indicador: a.indicador,
          peso: a.peso,
          meta: a.meta,
          meta_origem: a.meta_origem ?? null,
        })),
        metasNoTrimestre: contar(tri.inicio),
        proximo: { trimestre: prox, metas: contar(prox.inicio) },
      },
    };
  } catch (e) {
    return {
      ok: false,
      estado: "fonte_indisponivel",
      motivo: motivoDoErro("IDU", e as { code?: string }),
    };
  }
}

async function lerRede(
  ctx: ContextoCoo,
): Promise<ParteEstrategico<{ unidades: UnidadeRede[]; apuracoes: ApuracaoRede[] }>> {
  const { db, userId } = ctx;
  const [papeis, escopo] = await Promise.all([
    db.from("user_roles").select("role").eq("user_id", userId),
    db.from("usuario_escopo").select("todas_unidades").eq("user_id", userId).maybeSingle(),
  ]);
  if (papeis.error || escopo.error)
    return {
      ok: false,
      estado: "fonte_indisponivel",
      motivo: motivoDoErro("escopo de acesso", papeis.error ?? escopo.error),
    };
  if (!escopo.data?.todas_unidades)
    return {
      ok: false,
      estado: "acesso_insuficiente",
      motivo: "a leitura da rede exige ver todas as unidades; seu escopo é por unidade",
    };
  const roles = ((papeis.data ?? []) as { role: string }[]).map((r) => String(r.role));
  const faltam = fontesSemAcesso(FONTES_REDE, { roles, permissions: ctx.permissoes });
  if (faltam.length)
    return { ok: false, estado: "acesso_insuficiente", motivo: motivoSemAcesso(faltam) };

  const de = inicioDaLeitura(ctx.hoje);
  const ate = `${ctx.hoje.slice(0, 7)}-01`;
  try {
    const [u, a] = await Promise.all([
      todasAsPaginas((i, f) =>
        db
          .from("unidades")
          .select("id, nome_da_praca, tipo, data_inauguracao")
          .order("id")
          .range(i, f),
      ),
      todasAsPaginas((i, f) =>
        db
          .from("royalties_apuracao")
          .select(
            "id, unidade_id, mes_referencia, status, receita_base, receita_base_antiga, royalties_valor, csc_valor_fixo, csc_base_antiga_valor",
          )
          .gte("mes_referencia", de)
          .lte("mes_referencia", ate)
          .order("id")
          .range(i, f),
      ),
    ]);
    return {
      ok: true,
      dado: {
        unidades: u.map((x): UnidadeRede => ({
          id: Number(x.id),
          nome: String(x.nome_da_praca ?? `Unidade ${x.id}`),
          tipo: (x.tipo as string | null) ?? null,
          inauguracao: (x.data_inauguracao as string | null) ?? null,
        })),
        apuracoes: a.map((x): ApuracaoRede => ({
          unidade_id: Number(x.unidade_id),
          mes: String(x.mes_referencia),
          status: String(x.status),
          receita_base: x.receita_base as number | null,
          receita_base_antiga: x.receita_base_antiga as number | null,
          royalties_valor: x.royalties_valor as number | null,
          csc_valor_fixo: x.csc_valor_fixo as number | null,
          csc_base_antiga_valor: x.csc_base_antiga_valor as number | null,
        })),
      },
    };
  } catch (e) {
    return {
      ok: false,
      estado: "fonte_indisponivel",
      motivo: motivoDoErro("apuração de royalties", e as { code?: string }),
    };
  }
}

export async function lerEstrategico(ctx: ContextoCoo): Promise<DadosEstrategico> {
  const [idu, rede] = await Promise.all([lerIdu(ctx), lerRede(ctx)]);
  return { idu, rede };
}
