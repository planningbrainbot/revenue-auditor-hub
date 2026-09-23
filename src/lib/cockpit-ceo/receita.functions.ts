import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { extrairFaturamento, montarLeituraGrupo, montarLeituraRede } from "./receita-fontes";
import type { ApuracaoRede, UnidadeRede } from "./receita-fontes";
import type { LeituraReceita } from "./receita";
import { todasAsPaginas } from "./paginar";
import { FONTES_REDE, fontesSemAcesso, motivoSemAcesso } from "./portas";
import type { AcessoMin } from "./portas";

// Leituras candidatas do faturamento para a trajetória de R$ 1 bi. Somente leitura, com a sessão
// da pessoa: nenhuma service role, nenhum dado que a tela de origem não mostraria a ela.
//
// Grupo: a função do Faturamento é SECURITY DEFINER e não confere acesso por dentro (medido em
// 22/09: um sócio regional sem Financeiro recebe a série). Por isso a porta é conferida AQUI antes
// da chamada, com as mesmas regras do Financeiro: `tem_produto('financeiro')` — a da RLS de
// `financeiro.lancamentos` — e escopo de todas as empresas, que é o que o Financeiro exige para o
// consolidado. Do payload só sai agregado mensal; linha de cliente não deixa o servidor.
//
// Rede: apuração de royalties, só para quem enxerga todas as unidades e passa na porta da tabela
// (portas.ts); em cima disso vale a RLS. Leitura paginada, até o mês corrente.

const JANELA_MESES = 24;

const inicioDaJanela = (hoje: string) => {
  const d = new Date(
    Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - JANELA_MESES, 1),
  );
  return d.toISOString().slice(0, 10);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const falha = (onde: string, e: any) => {
  console.error(`[cockpit-ceo] ${onde}:`, e);
  return `consulta de ${onde} falhou${e?.code ? ` (código ${e.code})` : ""}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerGrupo(db: any, todasEmpresas: boolean, de: string, ate: string) {
  const { data: temFinanceiro, error: eAcesso } = await db
    .schema("public")
    .rpc("tem_produto", { _produto: "financeiro" });
  if (eAcesso)
    return montarLeituraGrupo({
      acesso: true,
      erro: falha("acesso ao Financeiro", eAcesso),
      faturamento: null,
    });
  if (!temFinanceiro)
    return montarLeituraGrupo({
      acesso: false,
      motivo: "Sua conta não tem acesso ao Brain Financeiro.",
      faturamento: null,
    });
  if (!todasEmpresas)
    return montarLeituraGrupo({
      acesso: false,
      motivo:
        "O consolidado do grupo exige ver todas as empresas no Financeiro; seu escopo é por empresa.",
      faturamento: null,
    });
  const { data, error } = await db.schema("financeiro").rpc("fn_faturamento_mensal", {
    p_comp_de: de,
    p_comp_ate: ate,
    // O ranking de clientes não é usado: 1 é o mínimo que a função aceita, e a linha é descartada.
    p_limite_clientes: 1,
  });
  if (error)
    return montarLeituraGrupo({
      acesso: true,
      erro: falha("faturamento", error),
      faturamento: null,
    });
  try {
    return montarLeituraGrupo({ acesso: true, faturamento: extrairFaturamento(data) });
  } catch (e) {
    return montarLeituraGrupo({ acesso: true, erro: falha("faturamento", e), faturamento: null });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerRede(
  db: any,
  acesso: AcessoMin,
  todasUnidades: boolean,
  de: string,
  ate: string,
) {
  const sem = (motivo: string) =>
    montarLeituraRede({ acesso: false, motivo, unidades: [], apuracoes: [] });
  if (!todasUnidades)
    return sem("A leitura da rede exige ver todas as unidades; seu escopo é por unidade.");
  const faltam = fontesSemAcesso(FONTES_REDE, acesso);
  if (faltam.length) return sem(`Sem leitura da rede: ${motivoSemAcesso(faltam)}.`);
  let u: Record<string, unknown>[];
  let a: Record<string, unknown>[];
  try {
    [u, a] = await Promise.all([
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
  } catch (e) {
    return montarLeituraRede({
      acesso: true,
      erro: falha("apuração de royalties", e),
      unidades: [],
      apuracoes: [],
    });
  }
  const apuracoes = a.map((x): ApuracaoRede => ({
    unidade_id: Number(x.unidade_id),
    mes: String(x.mes_referencia),
    status: String(x.status),
    receita_base: x.receita_base as number | null,
    receita_base_antiga: x.receita_base_antiga as number | null,
    royalties_valor: x.royalties_valor as number | null,
    csc_valor_fixo: x.csc_valor_fixo as number | null,
    csc_base_antiga_valor: x.csc_base_antiga_valor as number | null,
  }));
  const unidades = u.map((x): UnidadeRede => ({
    id: Number(x.id),
    nome: String(x.nome_da_praca ?? `Unidade ${x.id}`),
    tipo: (x.tipo as string | null) ?? null,
    inauguracao: (x.data_inauguracao as string | null) ?? null,
  }));
  return montarLeituraRede({ acesso: true, unidades, apuracoes });
}

export const carregarReceitaCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ leituras: LeituraReceita[]; lidoEm: string }> => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;
    const [acesso, escopo] = await Promise.all([
      acessoDoUsuario(db, userId),
      db
        .from("usuario_escopo")
        .select("todas_unidades, todas_empresas")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
    if (!acesso.areas.includes("cockpit_ceo"))
      throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
    const lidoEm = new Date().toISOString();
    // Sem ler o escopo não dá para saber se a pessoa vê o todo: falha, não "escopo por empresa".
    if (escopo?.error) {
      const erro = falha("escopo de acesso", escopo.error);
      return {
        lidoEm,
        leituras: [
          montarLeituraGrupo({ acesso: true, erro, faturamento: null }),
          montarLeituraRede({ acesso: true, erro, unidades: [], apuracoes: [] }),
        ],
      };
    }
    const hoje = hojeSaoPaulo();
    const de = inicioDaJanela(hoje);
    const ate = `${hoje.slice(0, 7)}-01`;
    const [grupo, rede] = await Promise.all([
      lerGrupo(db, Boolean(escopo?.data?.todas_empresas), de, ate),
      lerRede(db, acesso, Boolean(escopo?.data?.todas_unidades), de, ate),
    ]);
    return { leituras: [grupo, rede], lidoEm };
  });
