// Cliente admin do projeto Supabase do FINANCIAL BRAIN (itpddzjfrgrbathcqbpo).
//
// SECURITY: service role, só em código de servidor. Nunca importar do client.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null | undefined;

/** `null` se as variáveis não estiverem configuradas — o login do Ops não pode quebrar por isso. */
export function getFinanceiroAdmin(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = process.env.FINANCEIRO_SUPABASE_URL;
  const key = process.env.FINANCEIRO_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.warn(
      '[financeiro] FINANCEIRO_SUPABASE_URL / FINANCEIRO_SUPABASE_SERVICE_ROLE_KEY ausentes — ' +
        'emissão de sessão do Financial desligada.',
    );
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
  return _client;
}
