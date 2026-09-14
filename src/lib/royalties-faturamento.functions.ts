import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

/**
 * Faturamento da apuração de royalties na conta Omie da Planning Partners.
 *
 * Camada fina: toda a conversa com a Omie vive na Edge Function
 * `royalties-faturamento`, que é quem tem as credenciais e a trava contra
 * cobrar duas vezes. Aqui só entra o guarda de permissão e a validação do que
 * a tela manda.
 *
 * O que sai nesta fatura: royalties, CAC e outras receitas. CSC fixo e
 * reembolso de tráfego pago NÃO entram — os dois já são emitidos pela
 * `csc-faturamento-mensal`, e repeti-los cobraria a unidade duas vezes.
 */

export type LinhaFaturamento = {
  sigla: string;
  unidade: string;
  unidade_id: number;
  apuracao_id?: number;
  apuracao_status?: string;
  royalties?: number;
  cac?: number;
  outras?: number;
  total?: number;
  /**
   * a_emitir       nada no Omie, entra no lote
   * ja_existia     a varredura achou OS equivalente (inclusive emitida à mão)
   * ja_registrada  já temos registro em royalties_faturas
   * sem_valor      apuração sem royalties, CAC ou outras receitas
   * sem_apuracao   a unidade não tem apuração do mês
   * criada         OS incluída, ainda sem nota nem boleto
   * faturada       nota de débito, título e boleto gerados
   * erro           ver o campo erro
   */
  status: string;
  motivo?: string;
  cod_os?: number;
  num_os?: string;
  num_recibo?: string | null;
  cod_titulo?: number | null;
  destinatarios?: string[];
  erro?: string;
  os_no_omie?: Array<{ nCodOS: number; cNumOS: string; cCodIntOS: string; valor: number }>;
};

export type RespostaFaturamento = {
  ok: boolean;
  modo: string;
  competencia: string;
  vence_em: string | null;
  resumo: {
    a_emitir: number;
    criadas: number;
    faturadas: number;
    ja_existia: number;
    ja_registrada: number;
    sem_valor: number;
    sem_apuracao: number;
    erros: number;
    total_a_emitir: number;
  };
  unidades: LinhaFaturamento[];
};

const MES_RE = /^20\d{2}-(0[1-9]|1[0-2])$/;
const DATA_RE = /^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function invocar(sb: any, body: Record<string, unknown>): Promise<RespostaFaturamento> {
  const { data, error } = await sb.functions.invoke("royalties-faturamento", { body });
  if (error) {
    // A mensagem útil vem no corpo da resposta, não no error.message.
    let msg = error.message ?? "Falha ao falar com o Omie.";
    try {
      const corpo = await error.context?.json?.();
      if (corpo?.erro) msg = corpo.erro;
    } catch {
      /* sem corpo legível: fica a mensagem genérica */
    }
    throw new Error(msg);
  }
  if (!data?.ok) throw new Error(data?.erro ?? "Falha ao falar com o Omie.");
  return data as RespostaFaturamento;
}

/**
 * Monta o plano do mês sem escrever nada: nem no Omie, nem no nosso banco.
 * É o que a tela mostra antes de alguém confirmar a emissão.
 */
export const simularFaturamentoRoyalties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { competencia: string }) => {
    const competencia = String(input.competencia ?? "").slice(0, 7);
    if (!MES_RE.test(competencia)) throw new Error("Competência inválida.");
    return { competencia };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertAdmin(sb, context.userId);
    return invocar(sb, { modo: "simular", competencia: data.competencia });
  });

/**
 * Emite de verdade: inclui a OS e chama FaturarOS, que gera nota de débito,
 * título e boleto. Só entra unidade escolhida na tela, e a Edge Function ainda
 * confere no Omie antes de criar cada uma.
 */
export const emitirFaturasRoyalties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { competencia: string; vence_em: string; unidades: number[] }) => {
    const competencia = String(input.competencia ?? "").slice(0, 7);
    if (!MES_RE.test(competencia)) throw new Error("Competência inválida.");

    const vence_em = String(input.vence_em ?? "").slice(0, 10);
    if (!DATA_RE.test(vence_em)) throw new Error("Informe a data de vencimento do boleto.");

    const unidades = (input.unidades ?? []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
    if (!unidades.length) throw new Error("Escolha ao menos uma unidade.");

    return { competencia, vence_em, unidades };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertAdmin(sb, context.userId);
    const { data: perfil } = await sb.auth.getUser();
    return invocar(sb, {
      modo: "faturar",
      competencia: data.competencia,
      vence_em: data.vence_em,
      unidades: data.unidades,
      solicitado_por: perfil?.user?.email ?? context.userId,
    });
  });
