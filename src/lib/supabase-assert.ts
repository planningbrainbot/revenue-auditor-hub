// Verificação genérica pra pegar update()/delete() bloqueado em silêncio
// pelo RLS: sem policy de escrita pra aquela tabela/role, o Supabase não
// lança erro nenhum — só não afeta nenhuma linha, e o app segue achando que
// salvou. Foi exatamente o bug de 01/09/2026 em "Registrar resposta colhida
// por telefone" (toast de sucesso, nada salvo — ver
// supabase/migrations/20260901090000_nps_update_policy_resposta_ligacao.sql).
//
// Uso: encadear `.select("id")` (ou outra coluna) na escrita e checar o
// resultado com essa função, em vez de só olhar `error`.
export function assertAffected<T>(
  result: { data: T[] | null; error: { message: string } | null },
  message: string,
): T[] {
  if (result.error) throw new Error(result.error.message);
  if (!result.data || result.data.length === 0) {
    throw new Error(message);
  }
  return result.data;
}
