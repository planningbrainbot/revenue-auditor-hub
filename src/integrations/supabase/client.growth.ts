/**
 * Client do Supabase do GROWTH para o navegador.
 *
 * Existe só para a tela de login do Ops conseguir autenticar também no Growth,
 * gravando a sessão dele no cookie do domínio raiz. Não serve para consultar
 * dados do Growth pela UI do Ops.
 *
 * Usa a publishable key (pública por definição, protegida por RLS lá) — nunca
 * a service key, que é server-side e vive em client.growth.server.ts.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookieStorage } from './cookie-storage';

let _client: SupabaseClient | null | undefined;

/** `null` quando as variáveis não estão configuradas — o login do Ops segue normal. */
export function getGrowthBrowserClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = import.meta.env.VITE_GROWTH_SUPABASE_URL;
  const key = import.meta.env.VITE_GROWTH_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: {
      storage: typeof window !== 'undefined' ? cookieStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // A tela de login do Ops não deve consumir tokens de OAuth destinados
      // ao próprio Ops que estejam na URL.
      detectSessionInUrl: false,
    },
  });
  return _client;
}
