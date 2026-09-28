import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContextoCockpit } from "./contexto";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { extrairFaturamento } from "./receita-fontes";
import { extrairPorCliente, montarPonte } from "./financeiro";
import { clienteFinancialBrain, conferirPortaFinanceiro } from "./financeiro-porta";
import { mesesFechadosDaFonte } from "./receita.functions";
import type { Falha } from "./operacao";
import { todasAsPaginas } from "./paginar";
import { fontesSemAcesso, motivoSemAcesso } from "./portas";
import type { FonteRls } from "./portas";
import {
  agregarFranqueadora,
  agregarOmie,
  agregarTratativas,
  mesesFechados,
  taxasDaPonte,
} from "./visual";
import type { CategoriaReceita, RespostaVisual } from "./visual";

// Leituras novas da revisão visual do Cockpit do CEO (28/09/2026): o que os gráficos da Visão
// executiva pedem e o cockpit ainda não lia.
//
// - Financeiro (credencial de servidor, atrás da porta do Financeiro conferida com a sessão da
//   pessoa): receita por categoria de serviço dos meses fechados do ano, e a saída de faturamento
//   só em Honorários Contábeis. Do servidor descem só agregados por categoria e contagens por mês.
// - Ops (sessão da pessoa, RLS): contratos do Omie das unidades (MRR ativo por base e encerramentos
//   por mês), churn datado da Central de Tratativas e títulos da franqueadora por vencimento.
//   Exigem todas as unidades: leitura parcial seria outra população.
// A falha de uma parte não apaga as outras; cada uma diz o motivo.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const falhou = (onde: string, e: any): Falha => {
  console.error(`[cockpit-ceo] ${onde}:`, e);
  return {
    estado: "fonte_indisponivel",
    motivo: `a consulta de ${onde} falhou${e?.code ? ` (código ${e.code})` : ""}`,
  };
};
const semAcesso = (motivo: string): Falha => ({ estado: "acesso_insuficiente", motivo });
const HONORARIOS = "Honorários Contábeis";

async function lerFinanceiro(
  db: Db,
  todasEmpresas: boolean,
  hoje: string,
): Promise<Pick<RespostaVisual, "categorias" | "honorarios">> {
  const porta = await conferirPortaFinanceiro(db, todasEmpresas);
  if (!porta.aberta) {
    const f: Falha = { estado: porta.estado, motivo: porta.motivo };
    return { categorias: f, honorarios: f };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = (await clienteFinancialBrain()) as any;
  if (!fin) {
    const f: Falha = {
      estado: "fonte_indisponivel",
      motivo: "a credencial do Financial Brain não está configurada neste ambiente",
    };
    return { categorias: f, honorarios: f };
  }
  const mesAtual = hoje.slice(0, 7);
  const ultimoFechado = mesesFechados(hoje, 1)[0];
  const deAno = `${hoje.slice(0, 4)}-01-01`;
  // A mesma janela da leitura do grupo (24 meses), para os meses fechados baterem com a ponte.
  const de24 = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)) - 24, 1))
    .toISOString()
    .slice(0, 10);
  const [cat, hon] = await Promise.all([
    // Um cliente basta: aqui só importa o bloco `categorias`, que vem inteiro.
    ultimoFechado >= deAno.slice(0, 7)
      ? fin.rpc("fn_faturamento_mensal", {
          p_comp_de: deAno,
          p_comp_ate: `${ultimoFechado}-01`,
          p_limite_clientes: 1,
        })
      : Promise.resolve({ data: null, error: null }),
    fin.rpc("fn_faturamento_mensal", {
      p_comp_de: de24,
      p_comp_ate: `${mesAtual}-01`,
      p_categorias: [HONORARIOS],
    }),
  ]);

  let categorias: RespostaVisual["categorias"];
  if (cat.error) categorias = falhou("receita por categoria", cat.error);
  else if (!cat.data)
    categorias = { estado: "nao_apurado", motivo: "Nenhum mês do ano está fechado." };
  else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itens = (cat.data?.categorias?.itens ?? []) as any[];
    categorias = {
      estado: "ok",
      de: deAno.slice(0, 7),
      ate: ultimoFechado,
      itens: itens
        .filter((i) => typeof i?.categoria === "string")
        .map(
          (i): CategoriaReceita => ({
            categoria: i.categoria,
            // `receita_no_recorte` é o que soma o total da tela de Faturamento (recortes padrão).
            receita: Number(i.receita_no_recorte ?? i.receita ?? 0),
            recorrente: typeof i.recorrente === "boolean" ? i.recorrente : null,
            clientes: Number(i.clientes_no_recorte ?? i.clientes ?? 0),
          }),
        ),
    };
  }

  let honorarios: RespostaVisual["honorarios"];
  if (hon.error) honorarios = falhou("saída de honorários", hon.error);
  else
    try {
      const fechados = mesesFechadosDaFonte(extrairFaturamento(hon.data), mesAtual);
      honorarios = {
        estado: "ok",
        meses: taxasDaPonte(montarPonte(extrairPorCliente(hon.data), fechados).meses),
      };
    } catch (e) {
      honorarios = falhou("saída de honorários", e);
    }
  return { categorias, honorarios };
}

async function lerOps(
  db: Db,
  acesso: { roles: string[]; permissions: string[] },
  todasUnidades: boolean,
  hoje: string,
): Promise<Pick<RespostaVisual, "omie" | "tratativas" | "franqueadora">> {
  if (!todasUnidades) {
    const f = semAcesso("Esta leitura exige ver todas as unidades; seu escopo é por unidade.");
    return { omie: f, tratativas: f, franqueadora: f };
  }
  const porta = (fontes: FonteRls[]) => {
    const faltam = fontesSemAcesso(fontes, acesso);
    return faltam.length ? semAcesso(`Sem leitura: ${motivoSemAcesso(faltam)}.`) : null;
  };
  const inicio = `${mesesFechados(hoje, 12)[0]}-01`;
  const fimDoMes = new Date(Date.UTC(Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

  const lerOmie = async (): Promise<RespostaVisual["omie"]> => {
    const fechada = porta(["omie_contratos_servico"]);
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((i, f) =>
        db
          .from("omie_contratos_servico")
          .select(
            "unidade, contrato_id, situacao, valor_mensal, vigencia_inicial, vigencia_final, sincronizado_em",
          )
          .order("unidade")
          .order("contrato_id")
          .range(i, f),
      );
      const sincronizadoEm = linhas.reduce<string | null>(
        (m, x) => (x.sincronizado_em && (!m || x.sincronizado_em > m) ? x.sincronizado_em : m),
        null,
      );
      return {
        estado: "ok",
        sincronizadoEm,
        ...agregarOmie(
          linhas.map((x) => ({
            unidade: String(x.unidade ?? "Sem unidade"),
            situacao: String(x.situacao ?? ""),
            valorMensal: x.valor_mensal == null ? null : Number(x.valor_mensal),
            vigenciaInicial: x.vigencia_inicial ?? null,
            vigenciaFinal: x.vigencia_final ?? null,
          })),
          hoje,
        ),
      };
    } catch (e) {
      return falhou("contratos do Omie", e);
    }
  };

  const lerTratativas = async (): Promise<RespostaVisual["tratativas"]> => {
    const fechada = porta(["central_tratativas", "contratos"]);
    if (fechada) return fechada;
    try {
      const [churns, ganhos] = await Promise.all([
        todasAsPaginas((i, f) =>
          db
            .from("central_tratativas")
            .select("id, data_churn")
            .eq("status", "lost")
            .not("data_churn", "is", null)
            .order("id")
            .range(i, f),
        ),
        todasAsPaginas((i, f) =>
          db
            .from("contratos")
            .select("id, ganho_em")
            .eq("origem_pipeline", "inside_sales")
            .not("ganho_em", "is", null)
            .order("id")
            .range(i, f),
        ),
      ]);
      const datas = churns.map((x) => String(x.data_churn).slice(0, 10)).sort();
      return {
        estado: "ok",
        meses: agregarTratativas(
          datas,
          ganhos.map((x) => String(x.ganho_em).slice(0, 10)),
          hoje,
        ),
        comData: datas.length,
        ultimaData: datas.at(-1) ?? null,
      };
    } catch (e) {
      return falhou("Central de Tratativas", e);
    }
  };

  const lerFranqueadora = async (): Promise<RespostaVisual["franqueadora"]> => {
    const fechada = porta(["contas_receber"]);
    if (fechada) return fechada;
    try {
      const linhas = await todasAsPaginas((i, f) =>
        db
          .from("contas_receber")
          .select("id, data_vencimento, status_pagamento, valor, created_at")
          .eq("unidade", "Partners")
          .gte("data_vencimento", inicio)
          .lte("data_vencimento", fimDoMes)
          .order("id")
          .range(i, f),
      );
      return {
        estado: "ok",
        meses: agregarFranqueadora(
          linhas.map((x) => ({
            vencimento: String(x.data_vencimento),
            status: String(x.status_pagamento ?? ""),
            valor: Number(x.valor ?? 0),
          })),
        ),
        ultimaCarga: linhas.reduce<string | null>(
          (m, x) => (x.created_at && (!m || x.created_at > m) ? x.created_at : m),
          null,
        ),
      };
    } catch (e) {
      return falhou("títulos da franqueadora", e);
    }
  };

  const [omie, tratativas, franqueadora] = await Promise.all([
    lerOmie(),
    lerTratativas(),
    lerFranqueadora(),
  ]);
  return { omie, tratativas, franqueadora };
}

/** A leitura sem o transporte: a mesma regra serve a tela e o servidor da conversa. */
export async function lerVisualCockpit(context: ContextoCockpit): Promise<RespostaVisual> {
  const { supabase, userId } = context;
  const db = supabase as Db;
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
  if (escopo?.error) {
    const f = falhou("escopo de acesso", escopo.error);
    return { lidoEm, categorias: f, honorarios: f, omie: f, tratativas: f, franqueadora: f };
  }
  const hoje = hojeSaoPaulo();
  const [fin, ops] = await Promise.all([
    lerFinanceiro(db, Boolean(escopo?.data?.todas_empresas), hoje),
    lerOps(db, acesso, Boolean(escopo?.data?.todas_unidades), hoje),
  ]);
  return { lidoEm, ...fin, ...ops };
}

export const carregarVisualCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerVisualCockpit(context));
