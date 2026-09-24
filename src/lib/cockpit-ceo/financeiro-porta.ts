// Porta das leituras do Financeiro consolidado no cockpit. Uma regra só, usada pela trajetória e
// pela ponte (receita.functions.ts) e por caixa e margem (caixa.functions.ts).
//
// As funções do Financial Brain são SECURITY DEFINER e não conferem acesso por dentro, e o cockpit
// as chama com a credencial de servidor do Ops. Por isso a porta é conferida ANTES, com a sessão da
// pessoa: `tem_produto('financeiro')` (a regra da RLS dos lançamentos) e escopo de todas as
// empresas (o Financeiro exige "tudo" para o consolidado). Sem as duas, nenhuma chamada sai.

// Cliente do Supabase e erro do PostgREST sem tipo gerado para estes schemas.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type PortaFinanceiro =
  | { aberta: true }
  | { aberta: false; estado: "acesso_insuficiente" | "fonte_indisponivel"; motivo: string };

export async function conferirPortaFinanceiro(
  db: Db,
  todasEmpresas: boolean,
): Promise<PortaFinanceiro> {
  const { data, error } = await db.schema("public").rpc("tem_produto", { _produto: "financeiro" });
  if (error)
    return {
      aberta: false,
      estado: "fonte_indisponivel",
      motivo: `a consulta de acesso ao Financeiro falhou${error?.code ? ` (código ${error.code})` : ""}`,
    };
  if (!data)
    return {
      aberta: false,
      estado: "acesso_insuficiente",
      motivo: "Sua conta não tem acesso ao Brain Financeiro.",
    };
  if (!todasEmpresas)
    return {
      aberta: false,
      estado: "acesso_insuficiente",
      motivo:
        "O consolidado do grupo exige ver todas as empresas no Financeiro; seu escopo é por empresa.",
    };
  return { aberta: true };
}

/** Cliente do Financial Brain no servidor; `null` quando a credencial não está no ambiente. */
export async function clienteFinancialBrain() {
  const { getFinanceiroAdmin } = await import("@/integrations/supabase/client.financeiro.server");
  return getFinanceiroAdmin();
}
