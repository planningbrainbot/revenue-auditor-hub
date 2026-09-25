// Sessão da pessoa numa rota de servidor (fora dos createServerFn): a mesma regra do middleware
// `requireSupabaseAuth` — token Bearer, cliente com a chave pública e o token do usuário (RLS),
// `getClaims` para confirmar quem é. Nenhuma credencial de serviço.
import { createClient } from "@supabase/supabase-js";
import { opcoesDeSchema } from "@/integrations/supabase/schema";
import type { ContextoCockpit } from "../contexto";

export class SemSessao extends Error {}

export async function contextoDaRequisicao(request: Request): Promise<ContextoCockpit> {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !chave) throw new Error("Supabase não configurado no servidor.");
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new SemSessao("Sessão ausente.");
  const token = auth.slice(7);
  const supabase = createClient(url, chave, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    ...opcoesDeSchema,
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new SemSessao("Sessão inválida.");
  return { supabase, userId: data.claims.sub };
}
