// Cliente admin do projeto Supabase do GROWTH (wojgzfoeokgquxeobpwk).
// Projeto separado do Ops, com dono diferente — usado só pela tela de
// /admin/usuarios pra provisionar acesso lá sem precisar de um segundo painel.
//
// Schema é diferente do Ops (autorização por e-mail em public.membros), então
// este client é intencionalmente sem tipos do Database do Ops.
//
// SECURITY: service role, só em código de servidor. Nunca importar do client.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

/**
 * Devolve o client admin do Growth, ou `null` se as variáveis de ambiente não
 * estiverem configuradas. Retornar null (em vez de lançar) é proposital: a
 * tela de usuários do Ops tem que continuar funcionando normalmente em
 * ambientes onde a integração com o Growth não está ligada.
 */
export function getGrowthAdmin(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.GROWTH_SUPABASE_URL;
  const key = process.env.GROWTH_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      '[growth] GROWTH_SUPABASE_URL / GROWTH_SUPABASE_SERVICE_ROLE_KEY ausentes — ' +
        'gestão de acesso ao Growth desligada.',
    );
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

// Espelham os CHECK constraints de public.membros no Growth — se mudarem lá,
// mudar aqui também, senão o insert falha com erro de constraint.
export const GROWTH_PAPEIS = ['admin', 'gestao', 'operacional'] as const;
export const GROWTH_DEPARTAMENTOS = [
  'comercial',
  'diretoria',
  'marketing',
  'backoffice',
  'parcerias',
] as const;

export type GrowthPapel = (typeof GROWTH_PAPEIS)[number];
export type GrowthDepartamento = (typeof GROWTH_DEPARTAMENTOS)[number];
