// Leitura da tela Forecast com a sessão da pessoa (15/10/2026): o horizonte que o Jev estimou para os cards sem data
// esperada de fechamento. Nada usa service role; a RPC confere a permissão da Monetização.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizarPrevisoes, type PrevisaoJev } from "./fechamentos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any;

export async function lerPrevisoes(context: { supabase: unknown }): Promise<PrevisaoJev[]> {
  const { data, error } = await (context.supabase as DB)
    .schema("ops")
    .rpc("monetizacao_previsao_fechamento", {});
  if (error) throw new Error(`Não foi possível ler a previsão do Jev: ${error.message}`);
  return normalizarPrevisoes(data);
}

export const carregarPrevisoesFechamento = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) => lerPrevisoes(context));
