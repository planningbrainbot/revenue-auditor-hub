// Leitura do tema Seg · Growth. Tudo com a sessão da pessoa (RLS), e cada fonte falha sozinha.
//
// A porta de cada fonte é conferida ANTES de ler, porque a RLS devolve lista vazia a quem não
// pode ler, e lista vazia viraria "R$ 0 vendido" ou "nenhum contrato" com cara de dado:
// - Growth (metas, série de mídia): `public.tem_produto('growth')` e `growth.e_membro()`, a própria
//   policy, por RPC (como o Cockpit do CEO). A meta por unidade (`dist_metas`) tem policy mais
//   estreita (diretoria e comercial do Growth): vazia para quem passou na porta = sem leitura;
// - contratos: a porta de `portas.ts` (admin, diretor, auditor ou as chaves de leitura inteira);
// - apuração de royalties: admin ou diretor (`portas.ts`);
// - Broker: `view.broker_admin` (policy `broker_oport_sel`);
// - e nenhuma das três do Ops com escopo "só a própria unidade" (policy `escopo_unidade`).
//
// A RPC `indicadores_trimestre` não é chamada: com a sessão do COO ela passou de 110 s em 29/09
// (o papel `authenticated` corta em 8 s), só devolve as regionais e conta o lote do pipe Sócios.
import type { ContextoCoo } from "../contexto.server.ts";
import { motivoDoErro } from "../contexto.server.ts";
import { todasAsPaginas } from "../../cockpit-ceo/paginar.ts";
import { fontesSemAcesso, motivoSemAcesso } from "../../cockpit-ceo/portas.ts";
import type { FonteRls } from "../../cockpit-ceo/portas.ts";
import { mesAnterior } from "../montar.ts";
import { janelaTrimestre, trimestreAnterior } from "./growth.ts";
import type {
  DadosGrowth,
  LinhaBroker,
  LinhaContratoGrowth,
  LinhaDistMeta,
  LinhaMidiaUnidade,
  LinhaPlanoGrowth,
  LinhaSerieMensal,
  ParteGrowth,
} from "./growth.ts";

type Falha = { ok: false; estado: "fonte_indisponivel" | "acesso_insuficiente"; motivo: string };

const indisponivel = (nome: string, e: unknown): Falha => ({
  ok: false,
  estado: "fonte_indisponivel",
  motivo: motivoDoErro(nome, e as { code?: string }),
});
const semAcesso = (motivo: string): Falha => ({ ok: false, estado: "acesso_insuficiente", motivo });

const ESCOPO_PROPRIO = "data.scope.own_unit_only";

/** Maior data/hora das linhas (ISO compara como texto). */
function maisRecente<T>(linhas: T[], pegar: (l: T) => unknown): string | null {
  let m: string | null = null;
  for (const l of linhas) {
    const v = pegar(l);
    if (typeof v === "string" && v && (m === null || v > m)) m = v;
  }
  return m;
}

async function portaGrowth(ctx: ContextoCoo): Promise<Falha | null> {
  const [produto, membro] = await Promise.all([
    ctx.db.schema("public").rpc("tem_produto", { _produto: "growth" }),
    ctx.db.schema("growth").rpc("e_membro"),
  ]);
  if (produto.error || membro.error) return indisponivel("acesso ao Growth", produto.error ?? membro.error);
  if (!produto.data) return semAcesso("sua conta não tem o produto Growth");
  if (!membro.data) return semAcesso("sua conta não é membro do Growth; os dados de aquisição são lidos só por membros");
  return null;
}

/** Porta das fontes do Ops: papel ou chave que libera a tabela inteira, e nenhum escopo por unidade. */
function portaOps(ctx: ContextoCoo, roles: string[] | null, fontes: FonteRls[]): Falha | null {
  if (roles === null) return indisponivel("papéis da conta", null);
  if (ctx.permissoes.includes(ESCOPO_PROPRIO)) return semAcesso("sua conta lê só a própria unidade; o tema lê a rede inteira");
  const faltam = fontesSemAcesso(fontes, { roles, permissions: ctx.permissoes });
  return faltam.length ? semAcesso(motivoSemAcesso(faltam)) : null;
}

async function lerMetas(ctx: ContextoCoo, porta: Falha | null): Promise<ParteGrowth<LinhaDistMeta[]>> {
  if (porta) return porta;
  const { data, error } = await ctx.db
    .schema("growth")
    .from("dist_metas")
    .select("unidade, quarter, meta, vendido, atualizado_em");
  if (error) return indisponivel("metas por unidade do Growth", error);
  const linhas = (data ?? []) as (LinhaDistMeta & { atualizado_em: string | null })[];
  // A tabela tem meta desde 2026-T1: vazia inteira é a policy fechando, não "sem meta".
  if (!linhas.length)
    return semAcesso("a meta por unidade do Growth é lida só pela diretoria e pelo comercial do Growth");
  const tri = janelaTrimestre(ctx.hoje).chave;
  return {
    ok: true,
    dado: linhas.map(({ unidade, quarter, meta, vendido }) => ({ unidade, quarter, meta, vendido })),
    atualizadoEm: maisRecente(
      linhas.filter((l) => l.quarter === tri),
      (l) => l.atualizado_em,
    ),
  };
}

async function lerMidia(
  ctx: ContextoCoo,
  porta: Falha | null,
): Promise<ParteGrowth<{ serie: LinhaSerieMensal[]; planos: LinhaPlanoGrowth[] }>> {
  if (porta) return porta;
  const tri = janelaTrimestre(ctx.hoje);
  const desde = trimestreAnterior(tri).meses[0];
  const g = ctx.db.schema("growth");
  const [serie, planos, ultimo] = await Promise.all([
    g.from("serie_mensal").select("mes, vendas, mrr, investimento").gte("mes", desde).order("mes"),
    g
      .from("metas")
      .select("mes, metrica, alvo")
      .eq("papel", "funil")
      .eq("metrica", "investimento_mes")
      .gte("mes", desde)
      .order("mes"),
    // Frescor: o último dia com mídia importada.
    g.from("midia_paga").select("data").order("data", { ascending: false }).limit(1),
  ]);
  if (serie.error) return indisponivel("série de mídia do Growth", serie.error);
  return {
    ok: true,
    dado: {
      serie: (serie.data ?? []) as LinhaSerieMensal[],
      // Sem plano o número segue, sem a meta ao lado.
      planos: planos.error ? [] : ((planos.data ?? []) as LinhaPlanoGrowth[]),
    },
    atualizadoEm: ultimo.error ? null : ((ultimo.data?.[0]?.data as string | undefined) ?? null),
  };
}

async function lerContratos(ctx: ContextoCoo, porta: Falha | null): Promise<ParteGrowth<LinhaContratoGrowth[]>> {
  if (porta) return porta;
  const desde = trimestreAnterior(janelaTrimestre(ctx.hoje)).inicio;
  try {
    const linhas = (await todasAsPaginas((i, f) =>
      ctx.db
        .from("contratos")
        .select("id, unidade, ganho_em, mrr_mensal, created_at")
        .eq("origem_pipeline", "inside_sales")
        .gte("ganho_em", desde)
        .order("id")
        .range(i, f),
    )) as (LinhaContratoGrowth & { created_at: string | null })[];
    return {
      ok: true,
      dado: linhas.map(({ id, unidade, ganho_em, mrr_mensal }) => ({ id, unidade, ganho_em, mrr_mensal })),
      // Frescor: o último contrato que o sync do Pipedrive gravou.
      atualizadoEm: maisRecente(linhas, (l) => l.created_at),
    };
  } catch (e) {
    return indisponivel("contratos do Inside Sales", e);
  }
}

async function lerMidiaUnidades(ctx: ContextoCoo, porta: Falha | null): Promise<ParteGrowth<LinhaMidiaUnidade[]>> {
  if (porta) return porta;
  const mes = `${mesAnterior(ctx.hoje.slice(0, 7))}-01`;
  const { data, error } = await ctx.db
    .from("royalties_apuracao")
    .select("unidade_id, mes_referencia, csc_trafego_pago, updated_at")
    .eq("status", "confirmado")
    .eq("mes_referencia", mes)
    .order("unidade_id");
  if (error) return indisponivel("apuração de royalties", error);
  const linhas = (data ?? []) as (LinhaMidiaUnidade & { updated_at: string | null })[];
  return {
    ok: true,
    dado: linhas.map(({ unidade_id, mes_referencia, csc_trafego_pago }) => ({
      unidade_id,
      mes_referencia,
      csc_trafego_pago,
    })),
    atualizadoEm: maisRecente(linhas, (l) => l.updated_at),
  };
}

async function lerBroker(ctx: ContextoCoo): Promise<ParteGrowth<LinhaBroker[]>> {
  if (!ctx.permissoes.includes("view.broker_admin"))
    return semAcesso("sua conta não tem a Matriz do Broker (view.broker_admin)");
  try {
    const linhas = (await todasAsPaginas((i, f) =>
      ctx.db
        .from("broker_oportunidades")
        .select("id, status, reservado_por, updated_at, fechado_em, mrr_precificado")
        .order("id")
        .range(i, f),
    )) as LinhaBroker[];
    return { ok: true, dado: linhas, atualizadoEm: maisRecente(linhas, (l) => l.updated_at) };
  } catch (e) {
    return indisponivel("Broker", e);
  }
}

/** Nunca lança: cada parte volta com o próprio estado. */
export async function lerGrowth(ctx: ContextoCoo): Promise<DadosGrowth> {
  const [pg, papeis] = await Promise.all([
    portaGrowth(ctx).catch((e) => indisponivel("acesso ao Growth", e)),
    Promise.resolve(ctx.db.from("user_roles").select("role").eq("user_id", ctx.userId)).then(
      (r: { data: { role: string }[] | null; error: unknown }) =>
        r.error ? null : (r.data ?? []).map((x) => String(x.role)),
      () => null,
    ),
  ]);
  const guarda = <T>(nome: string, p: Promise<ParteGrowth<T>>): Promise<ParteGrowth<T>> =>
    p.catch((e) => indisponivel(nome, e));
  const [metas, midia, contratos, midiaUnidades, broker] = await Promise.all([
    guarda("metas por unidade do Growth", lerMetas(ctx, pg)),
    guarda("série de mídia do Growth", lerMidia(ctx, pg)),
    guarda("contratos do Inside Sales", lerContratos(ctx, portaOps(ctx, papeis, ["contratos"]))),
    guarda("apuração de royalties", lerMidiaUnidades(ctx, portaOps(ctx, papeis, ["royalties_apuracao"]))),
    guarda("Broker", lerBroker(ctx)),
  ]);
  return { metas, contratos, midia, midiaUnidades, broker };
}
