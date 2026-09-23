import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { ORDEM_DEFINICOES, definicaoSemDado, montarDefinicao } from "./clientes-ativos";
import type { DefinicaoCliente, IdDefinicao } from "./clientes-ativos";
import { todasAsPaginas } from "./paginar";
import { faltasDasDefinicoes, motivoSemAcesso } from "./portas";

// Definições candidatas de cliente ativo, lidas com a sessão da pessoa (RLS da casa). Somente
// leitura. Os CNPJs voltam para a tela porque o vínculo com a conta da Base acontece lá, sobre a
// carga que a pessoa já tem; só quem tem as chaves da Base e enxerga todas as unidades recebe.
//
// Cada definição passa pela porta das próprias fontes (portas.ts) ANTES de ler: tabela que a RLS
// devolve vazia viraria "0 clientes, disponível". `qb_clientes_ativos` não é security_invoker (roda
// como dono da view), então a porta dela é a de `empresas` mais todas as unidades.
//
// Paginação com ordem por chave única: Omie é (unidade, contrato_id); contas a receber, `id`;
// `qb_clientes_ativos` e `v_cliente_mrr` saem uma linha por empresa, então `empresa_id`.

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
      await todasAsPaginas((de, ate) =>
        db
          .from("omie_contratos_servico")
          .select("unidade, contrato_id, cnpj, cnpj_digitos")
          .eq("situacao", "10")
          .gt("valor_mensal", 0)
          .order("unidade")
          .order("contrato_id")
          .range(de, ate),
      )
    ).map((x) => x.cnpj_digitos || x.cnpj),
  recebeu_90d: async () =>
    (
      await todasAsPaginas((de, ate) =>
        db
          .from("contas_receber")
          .select("id, cpf_cnpj")
          .in("status_pagamento", ["RECEBIDO", "recebido"])
          .gte("data_pagamento", menos90(hoje))
          .order("id")
          .range(de, ate),
      )
    ).map((x) => x.cpf_cnpj),
  qb_ativos: async () =>
    (
      await todasAsPaginas((de, ate) =>
        db
          .from("qb_clientes_ativos")
          .select("empresa_id, cnpj_num")
          .order("empresa_id")
          .range(de, ate),
      )
    ).map((x) => x.cnpj_num),
  mrr_positivo: async () => {
    const ids = (
      await todasAsPaginas((de, ate) =>
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
      const lote = ids.slice(i, i + 300);
      const { data, error } = await db.from("empresas").select("id, cnpj").in("id", lote);
      if (error) throw error;
      const porId = new Map(
        ((data ?? []) as { id: number; cnpj: string | null }[]).map((e) => [e.id, e.cnpj]),
      );
      for (const id of lote) docs.push(porId.get(id) ?? null);
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
    const lidoEm = new Date().toISOString();
    const todas = (estado: DefinicaoCliente["estado"], nota: string) => ({
      lidoEm,
      definicoes: ORDEM_DEFINICOES.map((id) => definicaoSemDado(id, estado, nota)),
    });
    if (escopo?.error) {
      console.error("[cockpit-ceo] escopo de acesso:", escopo.error);
      return todas("fonte_indisponivel", "não foi possível ler seu escopo de acesso");
    }
    const podeBase =
      acesso.permissions.includes("view.aquario") || acesso.permissions.includes("view.clientes");
    if (!podeBase) return todas("acesso_insuficiente", "sem as chaves da Base de clientes");
    if (!escopo?.data?.todas_unidades)
      return todas("acesso_insuficiente", "a contagem da rede exige ver todas as unidades");
    const faltas = faltasDasDefinicoes(acesso);
    const fontes = leituras(db, hojeSaoPaulo());
    const definicoes = await Promise.all(
      ORDEM_DEFINICOES.map(async (id) => {
        if (faltas[id].length)
          return definicaoSemDado(id, "acesso_insuficiente", motivoSemAcesso(faltas[id]));
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
