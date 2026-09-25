import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContextoCockpit } from "./contexto";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { montarAquisicao } from "./aquisicao";
import type { RespostaAquisicao } from "./aquisicao";
import { todasAsPaginas } from "./paginar";

// Aquisição (Growth) com a sessão da pessoa: a RLS do schema `growth` vale inteira. A porta é a
// própria policy de SELECT das tabelas (`tem_produto('growth')` e `growth.e_membro()`), conferida
// por RPC antes de ler — sem ela, tabela vazia viraria "nenhum investimento" com cara de dado.
// A meta por unidade (`dist_metas`) tem policy mais estreita (diretoria/comercial): se ela vier
// vazia para quem passou na porta, a tela diz "sem leitura" em vez de "sem meta".

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const codigo = (e: any) => (e?.code ? ` (código ${e.code})` : "");

/** A leitura sem o transporte: a mesma regra serve a tela e as ferramentas da conversa. */
export async function lerAquisicaoCockpit(context: ContextoCockpit): Promise<RespostaAquisicao> {
  const { supabase, userId } = context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const lidoEm = new Date().toISOString();
  const acesso = await acessoDoUsuario(db, userId);
  if (!acesso.areas.includes("cockpit_ceo"))
    throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
  const [produto, membro] = await Promise.all([
    db.schema("public").rpc("tem_produto", { _produto: "growth" }),
    db.schema("growth").rpc("e_membro"),
  ]);
  if (produto.error || membro.error) {
    console.error("[cockpit-ceo] porta do Growth:", produto.error ?? membro.error);
    return {
      estado: "fonte_indisponivel",
      lidoEm,
      motivo: `a consulta de acesso ao Growth falhou${codigo(produto.error ?? membro.error)}`,
    };
  }
  if (!produto.data || !membro.data)
    return {
      estado: "acesso_insuficiente",
      lidoEm,
      motivo: !produto.data
        ? "Sua conta não tem o produto Growth."
        : "Sua conta não é membro do Growth; os dados de aquisição são lidos só por membros.",
    };
  const g = db.schema("growth");
  try {
    const [serie, metas, mesCorrente, abertos, dist, ultimo] = await Promise.all([
      g.from("serie_mensal").select("mes, vendas, mrr, investimento, leads, mql").order("mes"),
      g.from("metas").select("mes, papel, metrica, alvo").eq("papel", "funil").order("mes"),
      g.from("mes_corrente").select("*").eq("porte", "consolidado"),
      todasAsPaginas((i, f) =>
        g
          .from("deals")
          .select("deal_id, mrr, mrr_efetivo, expected_close_date")
          .eq("pipeline", "Inside Sales")
          .eq("status", "open")
          .order("deal_id")
          .range(i, f),
      ),
      g.from("dist_metas").select("unidade, quarter, meta, vendido"),
      // Frescor: a última atualização de negócio que o sync do Growth gravou.
      g.from("deals").select("updated_at").order("updated_at", { ascending: false }).limit(1),
    ]);
    const erro = serie.error ?? metas.error ?? mesCorrente.error;
    if (erro) throw erro;
    return {
      estado: "ok",
      lidoEm,
      unidadesLidas: !dist.error && (dist.data ?? []).length > 0,
      atualizadoEm: ultimo.error ? null : ((ultimo.data?.[0]?.updated_at as string) ?? null),
      dado: montarAquisicao(
        {
          serie: serie.data ?? [],
          metas: metas.data ?? [],
          mesCorrente: mesCorrente.data ?? [],
          abertos,
          distMetas: dist.error ? null : (dist.data ?? []),
        },
        hojeSaoPaulo(),
      ),
    };
  } catch (e) {
    console.error("[cockpit-ceo] aquisição:", e);
    return {
      estado: "fonte_indisponivel",
      lidoEm,
      motivo: `a leitura do Growth falhou${codigo(e)}`,
    };
  }
}

export const carregarAquisicaoCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerAquisicaoCockpit(context));
