import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Extrato de custo dos disparos de WhatsApp (Meta Cloud API).
//
// Fonte: tabela public.whatsapp_custos, espelhada da Graph API
// (pricing_analytics do WABA) pela Edge Function whatsapp-custos-sync.
//
// A Meta cobra por CONVERSA (janela de 24h), não por mensagem: `volume` é
// conversa cobrada, não mensagem enviada. Por isso o número aqui não bate
// com a contagem de disparos da aba Execução — e não deveria.

export interface WhatsappCustoRow {
  dia: string;
  waba_nome: string | null;
  phone_number: string;
  categoria: string;
  tipo: string;
  volume: number;
  custo: number;
  moeda: string;
}

export interface WhatsappCustosResumo {
  linhas: WhatsappCustoRow[];
  totalCusto: number;
  totalConversas: number;
  custoMesAtual: number;
  conversasMesAtual: number;
  custoMesAnterior: number;
  custoMedioConversa: number;
  ultimaAtualizacao: string | null;
}

function mesDe(dia: string): string {
  return dia.slice(0, 7);
}

export const listWhatsappCustos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WhatsappCustosResumo> => {
    const { supabase } = context;

    // RLS já filtra por can('view.disparos_whatsapp') — quem não tem a
    // permissão recebe zero linhas em vez de erro.
    const { data, error } = await supabase
      .from("whatsapp_custos")
      .select("dia, waba_nome, phone_number, categoria, tipo, volume, custo, moeda, updated_at")
      .order("dia", { ascending: false });

    if (error) throw new Error(`Erro ao carregar custos de WhatsApp: ${error.message}`);

    const rows = (data ?? []) as (WhatsappCustoRow & { updated_at: string | null })[];

    const agora = new Date();
    const mesAtual = agora.toISOString().slice(0, 7);
    const mesAnterior = new Date(agora.getFullYear(), agora.getMonth() - 1, 1)
      .toISOString()
      .slice(0, 7);

    let totalCusto = 0;
    let totalConversas = 0;
    let custoMesAtual = 0;
    let conversasMesAtual = 0;
    let custoMesAnterior = 0;
    let ultimaAtualizacao: string | null = null;

    for (const r of rows) {
      const custo = Number(r.custo) || 0;
      const volume = Number(r.volume) || 0;
      totalCusto += custo;
      totalConversas += volume;
      const mes = mesDe(r.dia);
      if (mes === mesAtual) {
        custoMesAtual += custo;
        conversasMesAtual += volume;
      }
      if (mes === mesAnterior) custoMesAnterior += custo;
      if (r.updated_at && (!ultimaAtualizacao || r.updated_at > ultimaAtualizacao)) {
        ultimaAtualizacao = r.updated_at;
      }
    }

    return {
      linhas: rows.map(({ updated_at: _updated, ...r }) => ({ ...r, custo: Number(r.custo) || 0 })),
      totalCusto,
      totalConversas,
      custoMesAtual,
      conversasMesAtual,
      custoMesAnterior,
      custoMedioConversa: totalConversas > 0 ? totalCusto / totalConversas : 0,
      ultimaAtualizacao,
    };
  });

// Força um refresh imediato do extrato chamando a Edge Function de sync, em
// vez de esperar o agendamento. Mesmo padrão do botão de sync do /ebit-operacional.
export const syncWhatsappCustos = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ linhas: number; custoTotal: number }> => {
    const { supabase } = context;

    const { data: pode, error: permErro } = await supabase.rpc("can", {
      _key: "view.disparos_whatsapp",
    });
    if (permErro) throw new Error("Erro de autorização.");
    if (!pode) throw new Error("Acesso negado.");

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Supabase não configurado no servidor.");

    const res = await fetch(`${url}/functions/v1/whatsapp-custos-sync?dias=180`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = await res.json();
    if (!res.ok || !body?.ok) {
      throw new Error(`Sync de custos falhou: ${body?.erro ?? res.status}`);
    }
    return { linhas: body.linhas ?? 0, custoTotal: body.custo_total ?? 0 };
  });
