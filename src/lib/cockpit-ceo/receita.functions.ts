import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContextoCockpit } from "./contexto";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { extrairFaturamento, montarLeituraGrupo, montarLeituraRede } from "./receita-fontes";
import type { ApuracaoRede, UnidadeRede } from "./receita-fontes";
import type { LeituraReceita } from "./receita";
import { extrairFrescor, extrairPorCliente, montarPonte } from "./financeiro";
import type { Frescor, Ponte } from "./financeiro";
import { clienteFinancialBrain, conferirPortaFinanceiro } from "./financeiro-porta";
import { todasAsPaginas } from "./paginar";
import { FONTES_REDE, fontesSemAcesso, motivoSemAcesso } from "./portas";
import type { AcessoMin } from "./portas";

// Leituras candidatas do faturamento para a trajetória de R$ 1 bi, e a ponte mensal do grupo.
//
// Grupo: a fonte é o projeto Financial Brain — o mesmo que a tela de Faturamento lê em produção.
// A cópia do schema `financeiro` no banco único parou no corte de 02/09 e diverge ~10% da tela
// (docs/dev_notes/cockpit-ceo-empresa/diagnostico.md §0); o cockpit deixou de lê-la em 23/09.
// A leitura usa a credencial de servidor que o Ops já tem para emitir a sessão do Financeiro
// (`getFinanceiroAdmin`), e por isso a porta é conferida AQUI, antes, com a sessão da pessoa:
// `tem_produto('financeiro')` — a regra da RLS dos lançamentos — e escopo de todas as empresas, que
// é o que o Financeiro exige para o consolidado. Sem as duas, a chamada nem sai. Do payload só desce
// agregado: série mensal e ponte em contagens e reais. Nome de cliente não deixa o servidor.
//
// Rede: apuração de royalties, só para quem enxerga todas as unidades e passa na porta da tabela
// (portas.ts); em cima disso vale a RLS. Leitura paginada, até o mês corrente.

// Cliente do Supabase e erro do PostgREST sem tipo gerado para estes schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

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

export interface LeituraGrupo {
  leitura: LeituraReceita;
  ponte: Ponte | null;
  frescor: Frescor | null;
}

/** Meses que a ponte pode usar: fechados na fonte e anteriores ao mês corrente. */
export function mesesFechadosDaFonte(
  f: ReturnType<typeof extrairFaturamento>,
  mesCorrente: string,
): string[] {
  const parciais = new Set([
    ...f.serie.filter((s) => s.parcial).map((s) => s.mes),
    ...f.meses.filter((m) => m.parcial || m.semCobertura).map((m) => m.mes),
  ]);
  return f.serie.map((s) => s.mes).filter((m) => m < mesCorrente && !parciais.has(m));
}

async function lerGrupo(
  db: Db,
  todasEmpresas: boolean,
  de: string,
  ate: string,
): Promise<LeituraGrupo> {
  const sem = (leitura: LeituraReceita): LeituraGrupo => ({ leitura, ponte: null, frescor: null });
  const porta = await conferirPortaFinanceiro(db, todasEmpresas);
  if (!porta.aberta)
    return sem(
      porta.estado === "acesso_insuficiente"
        ? montarLeituraGrupo({ acesso: false, motivo: porta.motivo, faturamento: null })
        : montarLeituraGrupo({ acesso: true, erro: porta.motivo, faturamento: null }),
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = (await clienteFinancialBrain()) as any;
  if (!fin)
    return sem(
      montarLeituraGrupo({
        acesso: true,
        erro: "a credencial do Financial Brain não está configurada neste ambiente",
        faturamento: null,
      }),
    );
  // Sem limite de clientes: a ponte precisa de todas as linhas (medido em 23/09: 1.274 clientes,
  // 2,6 s no banco, teto do service_role de 30 s).
  const [fat, fr] = await Promise.all([
    fin.rpc("fn_faturamento_mensal", { p_comp_de: de, p_comp_ate: ate }),
    fin.from("dado_frescor").select("carregado_em, cobre_ate").eq("dataset", "lancamentos"),
  ]);
  if (fat.error)
    return sem(
      montarLeituraGrupo({
        acesso: true,
        erro: falha("faturamento", fat.error),
        faturamento: null,
      }),
    );
  const frescor = fr.error ? null : extrairFrescor(fr.data ?? []);
  let faturamento;
  try {
    faturamento = extrairFaturamento(fat.data);
  } catch (e) {
    return sem(
      montarLeituraGrupo({ acesso: true, erro: falha("faturamento", e), faturamento: null }),
    );
  }
  const leitura = montarLeituraGrupo({ acesso: true, faturamento });
  let ponte: Ponte | null = null;
  try {
    ponte = montarPonte(
      extrairPorCliente(fat.data),
      mesesFechadosDaFonte(faturamento, `${hojeSaoPaulo().slice(0, 7)}`),
    );
  } catch (e) {
    console.error("[cockpit-ceo] ponte:", e);
  }
  return { leitura, ponte, frescor };
}

async function lerRede(db: Db, acesso: AcessoMin, todasUnidades: boolean, de: string, ate: string) {
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

export interface RespostaReceita {
  leituras: LeituraReceita[];
  lidoEm: string;
  ponte: Ponte | null;
  frescorFinanceiro: Frescor | null;
}

/** A leitura sem o transporte: a mesma regra serve a tela e as ferramentas da conversa. */
export async function lerReceitaCockpit(context: ContextoCockpit): Promise<RespostaReceita> {
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
      ponte: null,
      frescorFinanceiro: null,
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
  return {
    leituras: [grupo.leitura, rede],
    lidoEm,
    ponte: grupo.ponte,
    frescorFinanceiro: grupo.frescor,
  };
}

export const carregarReceitaCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerReceitaCockpit(context));
