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

export type FaturaDoMes = {
  unidade_id: number;
  status: string;
  num_os: string | null;
  valor_total: number;
  vence_em: string;
  faturada_em: string | null;
  erro: string | null;
  recebimento: {
    status: string;
    vencimento: string | null;
    pago_em: string | null;
    valor: number;
  } | null;
};

/**
 * Situação das faturas do mês e do título de cada uma no Omie da Partners.
 *
 * O título sai de `contas_receber` (unidade = Partners), que o sync atualiza
 * uma vez por dia: o recebimento aparece no dia seguinte à baixa. O vínculo é
 * pelo `cod_titulo`; enquanto a Edge Function não gravar esse código em toda
 * emissão, cai para valor + vencimento, que é único na prática porque a
 * fatura soma royalties, CAC e outras receitas num título só.
 */
export const listarFaturasRoyalties = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { competencia: string }) => {
    const competencia = String(input.competencia ?? "").slice(0, 7);
    if (!MES_RE.test(competencia)) throw new Error("Competência inválida.");
    return { competencia };
  })
  .handler(async ({ data, context }): Promise<{ faturas: FaturaDoMes[] }> => {
    const sb = context.supabase as any;
    await assertAdmin(sb, context.userId);

    const { data: faturas, error } = await sb
      .from("royalties_faturas")
      .select("unidade_id,status,num_os,valor_total,vence_em,faturada_em,erro,cod_titulo")
      .eq("competencia", `${data.competencia}-01`);
    if (error) throw new Error(error.message);
    if (!faturas?.length) return { faturas: [] };

    const vencimentos = [...new Set(faturas.map((f: any) => f.vence_em))];
    const { data: titulos, error: tErr } = await sb
      .from("contas_receber")
      .select("codigo_omie,status_pagamento,data_vencimento,data_pagamento,valor")
      .eq("unidade", "Partners")
      .in("data_vencimento", vencimentos);
    if (tErr) throw new Error(tErr.message);

    const porCodigo = new Map<number, any>();
    for (const t of titulos ?? []) porCodigo.set(Number(t.codigo_omie), t);

    return {
      faturas: faturas.map((f: any) => {
        const titulo =
          (f.cod_titulo && porCodigo.get(Number(f.cod_titulo))) ||
          (titulos ?? []).find(
            (t: any) =>
              t.data_vencimento === f.vence_em &&
              Number(t.valor) === Number(f.valor_total) &&
              t.status_pagamento !== "CANCELADO",
          ) ||
          null;
        return {
          unidade_id: f.unidade_id,
          status: f.status,
          num_os: f.num_os ? String(Number(f.num_os)) : null,
          valor_total: Number(f.valor_total),
          vence_em: f.vence_em,
          faturada_em: f.faturada_em,
          erro: f.erro,
          recebimento: titulo
            ? {
                status: titulo.status_pagamento,
                vencimento: titulo.data_vencimento,
                pago_em: titulo.data_pagamento,
                valor: Number(titulo.valor),
              }
            : null,
        };
      }),
    };
  });
