import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Segredos de integração (chaves de API, tokens de webhook).
 *
 * O valor nunca volta para o navegador: a leitura passa por
 * `v_integracoes_segredos_status`, que devolve só se está preenchido e os
 * quatro últimos caracteres. A tabela em si tem RLS sem policy — só o service
 * role a enxerga. Escrever é só de admin.
 */

export type SegredoStatus = {
  chave: string;
  descricao: string | null;
  atualizado_em: string;
  atualizado_por: string | null;
  configurado: boolean;
  sensivel: boolean;
  final: string;
};

/** Chaves que a tela oferece, com o que cada uma faz e como obter. */
export const CHAVES_CONHECIDAS: {
  chave: string;
  rotulo: string;
  ajuda: string;
  grupo: string;
  opcoes?: string[];
  segredo: boolean;
}[] = [
  {
    chave: "ASAAS_API_KEY",
    rotulo: "Chave de API do Asaas",
    ajuda:
      "Painel do Asaas › Integrações › API. Use a chave do mesmo ambiente escolhido abaixo — chave de sandbox não funciona em produção.",
    grupo: "Asaas",
    segredo: true,
  },
  {
    chave: "ASAAS_BASE_URL",
    rotulo: "Ambiente",
    ajuda:
      "Sandbox para testar sem cobrar ninguém. Só troque para produção depois de uma cobrança de ponta a ponta dar certo.",
    grupo: "Asaas",
    opcoes: ["https://api-sandbox.asaas.com/v3", "https://api.asaas.com/v3"],
    segredo: false,
  },
  {
    chave: "ASAAS_WEBHOOK_TOKEN",
    rotulo: "Token do webhook",
    ajuda:
      "Você inventa esta senha e cadastra a mesma no Asaas, em Integrações › Webhooks. É ela que prova que o aviso de pagamento veio mesmo de lá — sem ela o webhook recusa tudo.",
    grupo: "Asaas",
    segredo: true,
  },
  {
    chave: "ASAAS_BILLING_TYPE",
    rotulo: "Meio de cobrança",
    ajuda:
      "UNDEFINED deixa o pagador escolher entre boleto, pix e cartão. Trave em um só se quiser dirigir o pagamento.",
    grupo: "Asaas",
    opcoes: ["UNDEFINED", "PIX", "BOLETO", "CREDIT_CARD"],
    segredo: false,
  },
];

async function assertAdminIntegracoes(supabase: any) {
  const { data, error } = await supabase.rpc("can", { _key: "view.admin.credenciais" });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error("Acesso negado: você não administra credenciais.");
}

export const listarSegredos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: SegredoStatus[] }> => {
    const sb = context.supabase as any;
    await assertAdminIntegracoes(sb);
    const { data, error } = await sb.from("v_integracoes_segredos_status").select("*");
    if (error) throw new Error(error.message);
    return { status: data ?? [] };
  });

export const salvarSegredo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chave: string; valor: string }) => {
    const chave = String(input.chave ?? "").trim();
    const valor = String(input.valor ?? "").trim();
    if (!CHAVES_CONHECIDAS.some((c) => c.chave === chave)) {
      throw new Error("Chave desconhecida.");
    }
    if (!valor) throw new Error("Informe um valor.");
    return { chave, valor };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertAdminIntegracoes(sb);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: u } = await sb.auth.getUser();
    const meta = CHAVES_CONHECIDAS.find((c) => c.chave === data.chave);
    const { error } = await (supabaseAdmin as any).from("integracoes_segredos").upsert(
      {
        chave: data.chave,
        valor: data.valor,
        descricao: meta?.rotulo ?? null,
        sensivel: meta?.segredo ?? true,
        atualizado_em: new Date().toISOString(),
        atualizado_por: u?.user?.email ?? context.userId,
      },
      { onConflict: "chave" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const apagarSegredo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { chave: string }) => {
    const chave = String(input.chave ?? "").trim();
    if (!CHAVES_CONHECIDAS.some((c) => c.chave === chave)) throw new Error("Chave desconhecida.");
    return { chave };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertAdminIntegracoes(sb);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("integracoes_segredos")
      .delete()
      .eq("chave", data.chave);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Confere a chave contra o Asaas de verdade, sem criar cobrança. */
export const testarAsaas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: boolean; detalhe: string }> => {
    const sb = context.supabase as any;
    await assertAdminIntegracoes(sb);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("integracoes_segredos")
      .select("chave,valor")
      .in("chave", ["ASAAS_API_KEY", "ASAAS_BASE_URL"]);
    const mapa = new Map((data ?? []).map((r: any) => [r.chave, r.valor]));
    const chave = mapa.get("ASAAS_API_KEY");
    const base = mapa.get("ASAAS_BASE_URL") ?? "https://api-sandbox.asaas.com/v3";
    if (!chave) return { ok: false, detalhe: "Chave de API ainda não cadastrada." };

    // /myAccount só lê o cadastro da conta: valida a chave sem efeito colateral.
    const r = await fetch(`${base}/myAccount`, { headers: { access_token: String(chave) } });
    if (!r.ok) {
      return {
        ok: false,
        detalhe:
          r.status === 401
            ? "O Asaas recusou a chave. Confira se ela é do mesmo ambiente selecionado."
            : `O Asaas respondeu ${r.status}.`,
      };
    }
    const conta = await r.json().catch(() => ({}));
    const ambiente = String(base).includes("sandbox") ? "sandbox" : "produção";
    return {
      ok: true,
      detalhe: `Conectado a ${conta?.name ?? "conta sem nome"} (${ambiente}).`,
    };
  });
