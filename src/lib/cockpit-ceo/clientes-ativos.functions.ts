import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { ORDEM_DEFINICOES, definicaoSemDado, montarDefinicao } from "./clientes-ativos";
import type { DefinicaoCliente, IdDefinicao } from "./clientes-ativos";

// Definições candidatas de cliente ativo, lidas com a sessão da pessoa (RLS da casa). Somente
// leitura. Os CNPJs voltam para a tela porque o vínculo com a conta da Base acontece lá, sobre a
// carga que a pessoa já tem; só quem tem as chaves da Base e enxerga todas as unidades recebe.
//
// `qb_clientes_ativos` não é security_invoker (roda como dono da view), então a porta daqui — todas
// as unidades — é o que impede um escopo por unidade de ver a rede inteira por ela.

const PAGINA = 1000;
const LIMITE_LINHAS = 100_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Consulta = (de: number, ate: number) => PromiseLike<{ data: any[] | null; error: any }>;

async function todas(consulta: Consulta) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const linhas: any[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw error;
    linhas.push(...(data ?? []));
    if (!data || data.length < PAGINA) return linhas;
    if (linhas.length >= LIMITE_LINHAS) throw new Error("a leitura passou de 100 mil linhas");
  }
}

const menos90 = (hoje: string) => {
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 90);
  return d.toISOString().slice(0, 10);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const leituras = (
  db: any,
  hoje: string,
): Record<IdDefinicao, () => Promise<(string | null)[]>> => ({
  contrato_omie: async () =>
    (
      await todas((de, ate) =>
        db
          .from("omie_contratos_servico")
          .select("cnpj, cnpj_digitos")
          .eq("situacao", "10")
          .gt("valor_mensal", 0)
          .order("contrato_id")
          .range(de, ate),
      )
    ).map((x) => x.cnpj_digitos || x.cnpj),
  recebeu_90d: async () =>
    (
      await todas((de, ate) =>
        db
          .from("contas_receber")
          .select("cpf_cnpj")
          .in("status_pagamento", ["RECEBIDO", "recebido"])
          .gte("data_pagamento", menos90(hoje))
          .order("id")
          .range(de, ate),
      )
    ).map((x) => x.cpf_cnpj),
  qb_ativos: async () =>
    (
      await todas((de, ate) =>
        db.from("qb_clientes_ativos").select("cnpj_num").order("empresa_id").range(de, ate),
      )
    ).map((x) => x.cnpj_num),
  mrr_positivo: async () => {
    const ids = (
      await todas((de, ate) =>
        db
          .from("v_cliente_mrr")
          .select("empresa_id")
          .gt("mrr_mensal", 0)
          .order("empresa_id")
          .range(de, ate),
      )
    ).map((x) => x.empresa_id as number);
    const docs: (string | null)[] = [];
    for (let i = 0; i < ids.length; i += 300) {
      const { data, error } = await db
        .from("empresas")
        .select("id, cnpj")
        .in("id", ids.slice(i, i + 300));
      if (error) throw error;
      const porId = new Map(
        ((data ?? []) as { id: number; cnpj: string | null }[]).map((e) => [e.id, e.cnpj]),
      );
      for (const id of ids.slice(i, i + 300)) docs.push(porId.get(id) ?? null);
    }
    return docs;
  },
});

export const carregarClientesAtivosCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ definicoes: DefinicaoCliente[]; lidoEm: string }> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [acesso, escopo] = await Promise.all([
      acessoDoUsuario(db, userId),
      db.from("usuario_escopo").select("todas_unidades").eq("user_id", userId).maybeSingle(),
    ]);
    if (!acesso.areas.includes("cockpit_ceo"))
      throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
    const ids = ORDEM_DEFINICOES;
    const lidoEm = new Date().toISOString();
    const podeBase =
      acesso.permissions.includes("view.aquario") || acesso.permissions.includes("view.clientes");
    if (!podeBase)
      return {
        lidoEm,
        definicoes: ids.map((id) =>
          definicaoSemDado(id, "acesso_insuficiente", "sem as chaves da Base de clientes"),
        ),
      };
    if (!escopo?.data?.todas_unidades)
      return {
        lidoEm,
        definicoes: ids.map((id) =>
          definicaoSemDado(
            id,
            "acesso_insuficiente",
            "a contagem da rede exige ver todas as unidades",
          ),
        ),
      };
    const fontes = leituras(db, hojeSaoPaulo());
    const definicoes = await Promise.all(
      ids.map(async (id) => {
        try {
          return montarDefinicao(id, await fontes[id]());
        } catch (e) {
          console.error(`[cockpit-ceo] cliente ativo ${id}:`, e);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const codigo = (e as any)?.code;
          return definicaoSemDado(
            id,
            "fonte_indisponivel",
            `a leitura falhou${codigo ? ` (código ${codigo})` : ""}`,
          );
        }
      }),
    );
    return { lidoEm, definicoes };
  });
