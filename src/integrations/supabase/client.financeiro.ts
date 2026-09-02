/**
 * Client do Supabase do FINANCIAL BRAIN para o navegador.
 *
 * Mesmo papel do client.growth.ts: existe só para a tela de login do Ops
 * gravar a sessão do Financial no cookie do domínio raiz. Não serve para
 * consultar dados do Financial pela UI do Ops.
 *
 * Diferença importante em relação ao Growth: lá a sessão é criada com a senha
 * (as duas bases têm a mesma). Aqui NÃO — o Financial nasceu sem login e
 * ninguém tem senha lá. A sessão é emitida pelo servidor do Ops
 * (emitirSessaoFinanceiro) e materializada aqui com verifyOtp.
 *
 * Usa a publishable key (pública por definição) — nunca a secret.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookieStorage } from './cookie-storage';

let _client: SupabaseClient | null | undefined;

/** `null` quando as variáveis não estão configuradas — o login do Ops segue normal. */
export function getFinanceiroBrowserClient(): SupabaseClient | null {
  if (_client !== undefined) return _client;

  const url = import.meta.env.VITE_FINANCEIRO_SUPABASE_URL;
  const key = import.meta.env.VITE_FINANCEIRO_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    _client = null;
    return null;
  }

  _client = createClient(url, key, {
    auth: {
      storage: typeof window !== 'undefined' ? cookieStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
      // Não consumir tokens de OAuth da URL que são destinados ao próprio Ops.
      detectSessionInUrl: false,
    },
  });
  return _client;
}
