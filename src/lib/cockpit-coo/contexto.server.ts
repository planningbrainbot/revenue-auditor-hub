// Contexto de toda leitura do Cockpit do COO no servidor.
//
// A área `cockpit_coo` decide se alguma consulta sai. As leituras usam a sessão da pessoa (RLS):
// o cockpit não abre dado novo para ninguém. A exceção são fontes que o Ops lê com credencial de
// servidor (Financial Brain), e cada uma confere a sua porta antes (financeiro-porta.ts).
import type { ContextoCockpit } from "../cockpit-ceo/contexto.ts";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { hoje as hojeSaoPaulo } from "@/lib/monetizacao/model";
import { lerUnidades } from "./unidades.ts";
import type { UnidadeCadastro, UnidadeCoo } from "./unidades.ts";

// Cliente do Supabase sem tipo gerado para os schemas lidos aqui.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = any;

export const AREA_COO = "cockpit_coo";

export interface ContextoCoo {
  db: Db;
  userId: string;
  unidades: UnidadeCoo[];
  hoje: string;
  lidoEm: string;
  permissoes: string[];
}

export class AcessoNegadoCoo extends Error {}

export async function abrirContextoCoo(context: ContextoCockpit): Promise<ContextoCoo> {
  const db = context.supabase as Db;
  const acesso = await acessoDoUsuario(db, context.userId);
  if (!acesso.areas.includes(AREA_COO))
    throw new AcessoNegadoCoo("Acesso negado: sua conta não tem a área Cockpit do COO.");
  const { data, error } = await db
    .from("unidades")
    .select("id, nome_da_praca, tipo, data_inauguracao")
    .order("id");
  if (error) throw new Error(`a leitura do cadastro de unidades falhou${error.code ? ` (código ${error.code})` : ""}`);
  return {
    db,
    userId: context.userId,
    unidades: lerUnidades((data ?? []) as UnidadeCadastro[]),
    hoje: hojeSaoPaulo(),
    lidoEm: new Date().toISOString(),
    permissoes: acesso.permissions,
  };
}

/** Erro do PostgREST em texto curto, sem expor a consulta. */
export function motivoDoErro(nome: string, erro: { code?: string; message?: string } | null | undefined): string {
  return `a consulta de ${nome} falhou${erro?.code ? ` (código ${erro.code})` : ""}`;
}
