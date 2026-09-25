// Peças comuns da gestão de acessos que só o servidor usa (service role).
//
// Existe por causa da auditoria de 24/09/2026: cada arquivo de acesso tinha a
// sua versão de "quem é admin", "ache a conta por e-mail" e nenhum deixava
// rastro. Aqui ficam as três, uma vez só.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

async function admin(): Promise<Cliente> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Super admin ATIVO. É a mesma pergunta que a RLS faz (`ops.eh_super_admin`),
 * que desde a migration 20260925100000 também exige `profiles.ativo`: um admin
 * desativado com o token ainda válido não administra nada.
 */
export async function exigirSuperAdmin(userId: string): Promise<void> {
  const db = await admin();
  const { data, error } = await db.rpc("eh_super_admin", { _user: userId });
  if (error) {
    console.error("[exigirSuperAdmin] eh_super_admin falhou:", error);
    throw new Error("Erro de autorização. Tente novamente.");
  }
  if (!data) throw new Error("Acesso negado: somente super admin.");
}

/**
 * Registra uma ação de administração em `ops.acessos_log`.
 *
 * As funções `ops.acesso_*` já registravam as delas. As do servidor (criar
 * conta, trocar perfil, abrir porta, senha, excluir) não deixavam rastro
 * nenhum, e eram justamente as mais sensíveis. Falhar ao registrar não desfaz a
 * ação: o log é para quem pergunta depois, não uma trava.
 */
export async function registrarAcesso(
  ator: string,
  alvo: string | null,
  acao: string,
  detalhe: Record<string, unknown> = {},
): Promise<void> {
  const db = await admin();
  const { error } = await db.rpc("acesso_registrar", {
    _ator: ator,
    _alvo: alvo,
    _acao: acao,
    _detalhe: detalhe,
  });
  if (error) console.error(`[registrarAcesso] ${acao} não registrado:`, error.message);
}

/**
 * A conta do banco único para um e-mail, por `public.profiles`.
 *
 * Igualdade exata, nunca `ilike`: com `ilike` o `_` do e-mail é curinga, e
 * `ana_paula@` casava com `ana.paula@`. Os e-mails são gravados em minúsculas
 * (conferido em 24/09/2026: 0 exceções em profiles, gente_pessoas e socios).
 */
export async function contaPorEmail(email: string): Promise<{ user_id: string; nome: string | null; ativo: boolean } | null> {
  const db = await admin();
  const { data, error } = await db
    .schema("public")
    .from("profiles")
    .select("user_id, nome, ativo")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  if (error) {
    console.error("[contaPorEmail] falhou:", error);
    throw new Error("Falha ao consultar a conta.");
  }
  return data ?? null;
}

/**
 * Todas as contas do Auth, página por página.
 *
 * `listUsers()` sem argumento devolve só as 50 primeiras. Na revogação do
 * Financeiro isso virava "sem conta" a partir da 51ª pessoa, e ela seguia
 * entrando.
 */
export async function todasAsContasDoAuth(
  cliente: Cliente,
): Promise<{ id: string; email?: string; last_sign_in_at?: string | null; banned_until?: string | null }[]> {
  const contas: { id: string; email?: string; last_sign_in_at?: string | null; banned_until?: string | null }[] = [];
  for (let page = 1; page < 100; page++) {
    const { data, error } = await cliente.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const lote = data?.users ?? [];
    contas.push(...lote);
    if (lote.length < 1000) break;
  }
  return contas;
}
