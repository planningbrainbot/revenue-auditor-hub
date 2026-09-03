/**
 * Garante que as sessões dos produtos irmãos (Growth e Financial) existam.
 *
 * POR QUE NÃO FICA SÓ NO LOGIN: a emissão estava amarrada ao `handleSubmit`
 * da tela de login (e-mail + senha). Quem entrava pelo botão "Entrar com
 * Microsoft", pelo fluxo de redefinir senha, ou simplesmente já tinha sessão
 * do Ops aberta de antes, nunca ganhava as sessões irmãs — e batia em 401 no
 * cockpit sem entender por quê. Foi exatamente o que aconteceu em 03/09/2026.
 *
 * Aqui a regra é outra: existe sessão do Ops e falta a irmã? emite. Funciona
 * em qualquer caminho de entrada e se autocorrige para quem já estava logado.
 *
 * Idempotente e best-effort: se a sessão já existe não faz nada, e falha
 * nunca derruba o Ops.
 */
import { getGrowthBrowserClient } from "@/integrations/supabase/client.growth";
import { getFinanceiroBrowserClient } from "@/integrations/supabase/client.financeiro";
import { emitirSessaoGrowth, emitirSessaoFinanceiro } from "@/lib/sessoes-irmas.functions";

let emAndamento: Promise<void> | null = null;

async function garantirUma(
  nome: string,
  cliente: ReturnType<typeof getGrowthBrowserClient>,
  emitir: () => Promise<{ ok: true; tokenHash: string } | { ok: false; motivo: string }>,
  /** Quando informado, uma sessão existente SEM esta marca é reemitida. */
  exigeClaim?: (appMetadata: Record<string, unknown> | undefined) => boolean,
) {
  if (!cliente) return;
  try {
    const { data } = await cliente.auth.getSession();
    if (data.session) {
      // Sessão emitida antes de a concessão existir não carrega a claim, e o
      // servidor responderia 403. Reemitir é o que evita 403 em massa na
      // virada — sem isto, todo mundo com sessão aberta precisaria relogar.
      const meta = data.session.user?.app_metadata as Record<string, unknown> | undefined;
      if (!exigeClaim || exigeClaim(meta)) return;
      console.info(`[sessoes-irmas] ${nome}: sessão sem concessão, reemitindo`);
    }

    const r = await emitir();
    if (!r.ok) {
      console.info(`[sessoes-irmas] ${nome} sem sessão:`, r.motivo);
      return;
    }
    const { error } = await cliente.auth.verifyOtp({
      type: "email",
      token_hash: r.tokenHash,
    });
    if (error) console.info(`[sessoes-irmas] ${nome} não autenticado:`, error.message);
  } catch (e) {
    console.info(`[sessoes-irmas] ${nome} indisponível:`, e);
  }
}

/** Chamar de dentro da área autenticada. Concorrência protegida: chamadas
 *  simultâneas compartilham a mesma promessa em vez de emitir token duplicado. */
export function garantirSessoesIrmas(): Promise<void> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    await Promise.all([
      garantirUma("Growth", getGrowthBrowserClient(), emitirSessaoGrowth),
      garantirUma(
        "Financial",
        getFinanceiroBrowserClient(),
        emitirSessaoFinanceiro,
        (meta) => Boolean((meta?.brain as { financeiro?: boolean } | undefined)?.financeiro),
      ),
    ]);
  })().finally(() => {
    // Libera para uma nova tentativa numa próxima navegação, caso tenha falhado.
    emAndamento = null;
  });
  return emAndamento;
}
