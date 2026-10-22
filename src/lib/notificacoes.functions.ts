import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAffected } from "@/lib/supabase-assert";

export interface Notificacao {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string;
  unidade_id: number | null;
  referencia_id: number | null;
  destinatario_id: string | null;
  link: string | null;
  lida: boolean;
  created_at: string;
}

const LIMITE_LISTA = 30;

// Quem vê o quê é a RLS de ops.notificacoes: a pessoa lê as suas (destinatario_id) e o
// admin/diretor também lê os avisos coletivos (destinatario_id nulo). Por isso nenhuma
// função aqui exige admin.

export const listNotificacoes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ notificacoes: Notificacao[]; naoLidas: number }> => {
    const { supabase } = context;

    const { data, error } = await (supabase as any)
      .from("notificacoes")
      .select(
        "id,tipo,titulo,mensagem,unidade_id,referencia_id,destinatario_id,link,lida,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(LIMITE_LISTA);
    if (error) throw new Error(error.message);

    const { count, error: cErr } = await (supabase as any)
      .from("notificacoes")
      .select("id", { count: "exact", head: true })
      .eq("lida", false);
    if (cErr) throw new Error(cErr.message);

    return { notificacoes: (data ?? []) as Notificacao[], naoLidas: count ?? 0 };
  });

export const marcarNotificacaoLida = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    const email = (claims as any)?.email ?? null;
    const result = await (supabase as any)
      .from("notificacoes")
      .update({ lida: true, lida_em: new Date().toISOString(), lida_por: email ?? userId })
      .eq("id", data.id)
      .select("id");
    assertAffected(
      result,
      `Notificação ${data.id} não foi marcada como lida — possível bloqueio de permissão (RLS).`,
    );
    return { ok: true };
  });

// Nota: aqui 0 linhas afetadas é um resultado normal (nada estava não-lido),
// não um sinal de bloqueio — por isso não usa assertAffected.
export const marcarTodasNotificacoesLidas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId, claims } = context;
    const email = (claims as any)?.email ?? null;
    const { error } = await (supabase as any)
      .from("notificacoes")
      .update({ lida: true, lida_em: new Date().toISOString(), lida_por: email ?? userId })
      .eq("lida", false);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
