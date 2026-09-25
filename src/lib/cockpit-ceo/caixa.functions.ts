import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ContextoCockpit } from "./contexto";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { clienteFinancialBrain, conferirPortaFinanceiro } from "./financeiro-porta";
import { extrairEmitidoRecebido, extrairIndicadores, extrairInadimplencia } from "./financeiro";
import type { ParteCaixa, RespostaCaixa } from "./financeiro";

// Caixa e margem do grupo: emitido × recebido, inadimplência ao vivo, caixa livre e margem por
// grupo de apuração. Todas as regras são das funções oficiais do Financial Brain; o cockpit só
// agrega e descarta cliente e CNPJ antes de responder. Mesma porta da leitura do grupo
// (financeiro-porta.ts). Cada leitura falha sozinha: uma fonte fora não apaga as outras.

// Cliente do Supabase e erro do PostgREST sem tipo gerado para estes schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const ultimoDia = (mes: string) =>
  new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);
const mesAnterior = (m: string) =>
  new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);

function parte<T>(
  r: { data: unknown; error: Db },
  extrair: (x: unknown) => T,
  nome: string,
): ParteCaixa<T> {
  if (r.error) {
    console.error(`[cockpit-ceo] ${nome}:`, r.error);
    return {
      estado: "fonte_indisponivel",
      motivo: `a consulta de ${nome} falhou${r.error?.code ? ` (código ${r.error.code})` : ""}`,
    };
  }
  try {
    return { estado: "ok", dado: extrair(r.data) };
  } catch (e) {
    console.error(`[cockpit-ceo] ${nome}:`, e);
    return { estado: "fonte_indisponivel", motivo: (e as Error).message };
  }
}

/** A leitura sem o transporte: a mesma regra serve a tela e as ferramentas da conversa. */
export async function lerCaixaCockpit(context: ContextoCockpit): Promise<RespostaCaixa> {
  const { supabase, userId } = context;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [acesso, escopo] = await Promise.all([
    acessoDoUsuario(db, userId),
    db.from("usuario_escopo").select("todas_empresas").eq("user_id", userId).maybeSingle(),
  ]);
  if (!acesso.areas.includes("cockpit_ceo"))
    throw new Error("Acesso negado: sua conta não tem a área Cockpit do CEO.");
  const lidoEm = new Date().toISOString();
  const hoje = hojeSaoPaulo();
  const ate = mesAnterior(hoje.slice(0, 7));
  const janela = { de: `${ate.slice(0, 4)}-01`, ate };
  const todas = (motivo: string, estado: "acesso_insuficiente" | "fonte_indisponivel") => {
    const p = { estado, motivo } as const;
    return { lidoEm, janela, emitidoRecebido: p, inadimplencia: p, indicadores: p };
  };
  if (escopo?.error) return todas("a leitura do seu escopo de acesso falhou", "fonte_indisponivel");
  const porta = await conferirPortaFinanceiro(db, Boolean(escopo?.data?.todas_empresas));
  if (!porta.aberta) return todas(porta.motivo, porta.estado);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fin = (await clienteFinancialBrain()) as any;
  if (!fin)
    return todas(
      "a credencial do Financial Brain não está configurada neste ambiente",
      "fonte_indisponivel",
    );
  const de = `${janela.de}-01`;
  const [er, ina, ind] = await Promise.all([
    fin.rpc("fn_receita_emitido_recebido", { p_comp_de: de, p_comp_ate: ultimoDia(ate) }),
    fin.rpc("fn_inadimplencia_live", {
      p_grupos: null,
      p_empresas: null,
      p_prev_de: null,
      p_prev_ate: null,
    }),
    fin.rpc("fn_cockpit_indicadores", {
      p_grupos: null,
      p_empresas: null,
      p_departamentos: null,
      p_comp_de: de,
      p_comp_ate: ultimoDia(ate),
    }),
  ]);
  return {
    lidoEm,
    janela,
    emitidoRecebido: parte(er, extrairEmitidoRecebido, "emitido × recebido"),
    inadimplencia: parte(ina, extrairInadimplencia, "inadimplência"),
    indicadores: parte(ind, extrairIndicadores, "indicadores do Financeiro"),
  };
}

export const carregarCaixaCockpit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerCaixaCockpit(context));
