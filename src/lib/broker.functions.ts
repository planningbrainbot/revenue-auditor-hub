import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Broker da Expansão — camada de servidor da tela da matriz.
 *
 * Duas camadas que nunca se misturam: a matriz enxerga custo, multiplicador e
 * apuração; a unidade enxerga só o preço por cliente. Tudo que expõe composição
 * de custo vive atrás de view.broker_admin.
 */

export type OportunidadeRow = {
  id: number;
  pipedrive_deal_id: string;
  titulo: string | null;
  empresa: string | null;
  segmento: string | null;
  unidade_origem: string | null;
  estagio_pipedrive: string | null;
  mrr_precificado: number | null;
  multiplicador: number | null;
  preco_cb: number | null;
  status: string;
  reservado_por: number | null;
  reservado_em: string | null;
  entrou_em: string;
};

export type SaldoRow = {
  unidade_id: number;
  // `nome` é apelido de unidades.nome_da_praca, coluna herdada. "Praça" não é
  // termo do negócio; no broker só existe unidade.
  nome: string | null;
  creditado: number;
  bloqueado: number;
  investido: number;
  disponivel: number;
};

export type MovimentoRow = {
  id: number;
  unidade_id: number;
  tipo: string;
  valor_cb: number;
  oportunidade_id: number | null;
  mes_ref: string | null;
  observacao: string | null;
  criado_em: string;
  criado_por: string | null;
};

export type MultiplicadorRow = {
  id: number;
  mes: string;
  unidade_id: number | null;
  midia: number | null;
  time_cm: number | null;
  new_mrr: number | null;
  apurado: number | null;
  aplicado: number | null;
  observacao: string | null;
};

export type BrokerAdminData = {
  oportunidades: OportunidadeRow[];
  saldos: SaldoRow[];
  movimentos: MovimentoRow[];
  multiplicadores: MultiplicadorRow[];
  unidades: { id: number; nome: string }[];
  podeOperar: boolean;
  bloqueioPorSaldo: boolean;
};

async function assertCan(supabase: any, chave: string, recado: string) {
  const { data, error } = await supabase.rpc("can", { _key: chave });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error(`Acesso negado: ${recado}`);
}

async function can(supabase: any, chave: string): Promise<boolean> {
  const { data } = await supabase.rpc("can", { _key: chave });
  return data === true;
}

/** Quem operou, para o extrato. O ledger é imutável, então isto não se corrige depois. */
async function autor(supabase: any, userId: string): Promise<string> {
  const { data } = await supabase.auth.getUser();
  return data?.user?.email ?? userId;
}

export const carregarBrokerAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrokerAdminData> => {
    const sb = context.supabase as any;
    await assertCan(sb, "view.broker_admin", "você não tem acesso ao Broker da matriz.");

    const [opor, saldos, movs, mults, unids, cfg] = await Promise.all([
      sb
        .from("broker_oportunidades")
        .select(
          "id,pipedrive_deal_id,titulo,empresa,segmento,unidade_origem,estagio_pipedrive," +
            "mrr_precificado,multiplicador,preco_cb,status,reservado_por,reservado_em,entrou_em",
        )
        .order("entrou_em", { ascending: false }),
      sb
        .from("broker_saldo")
        .select("unidade_id,nome:nome_da_praca,creditado,bloqueado,investido,disponivel")
        .order("nome_da_praca"),
      sb
        .from("broker_movimentos")
        .select(
          "id,unidade_id,tipo,valor_cb,oportunidade_id,mes_ref,observacao,criado_em,criado_por",
        )
        .order("criado_em", { ascending: false })
        .limit(200),
      sb
        .from("broker_multiplicador")
        .select("id,mes,unidade_id,midia,time_cm,new_mrr,apurado,aplicado,observacao")
        .order("mes", { ascending: false }),
      sb.from("unidades").select("id,nome:nome_da_praca").order("nome_da_praca"),
      sb.rpc("broker_config_ativo", { _chave: "bloqueio_por_saldo", _unidade_id: null }),
    ]);

    for (const r of [opor, saldos, movs, mults, unids]) {
      if (r.error) throw new Error(r.error.message);
    }

    return {
      oportunidades: opor.data ?? [],
      saldos: saldos.data ?? [],
      movimentos: movs.data ?? [],
      multiplicadores: mults.data ?? [],
      unidades: unids.data ?? [],
      podeOperar: await can(sb, "manage.broker"),
      bloqueioPorSaldo: cfg?.data === true,
    };
  });

export const reservarOportunidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oportunidade_id: number; unidade_id: number }) => {
    const oportunidade_id = Number(input.oportunidade_id);
    const unidade_id = Number(input.unidade_id);
    if (!Number.isInteger(oportunidade_id) || oportunidade_id <= 0)
      throw new Error("Oportunidade inválida.");
    if (!Number.isInteger(unidade_id) || unidade_id <= 0) throw new Error("Unidade inválida.");
    return { oportunidade_id, unidade_id };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "manage.broker", "você não pode operar o Broker.");
    const { error } = await sb.rpc("broker_reservar", {
      _oportunidade_id: data.oportunidade_id,
      _unidade_id: data.unidade_id,
      _por: await autor(sb, context.userId),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const liberarOportunidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oportunidade_id: number; motivo?: string | null }) => {
    const oportunidade_id = Number(input.oportunidade_id);
    if (!Number.isInteger(oportunidade_id) || oportunidade_id <= 0)
      throw new Error("Oportunidade inválida.");
    return { oportunidade_id, motivo: input.motivo?.trim() || null };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "manage.broker", "você não pode operar o Broker.");
    const { error } = await sb.rpc("broker_liberar", {
      _oportunidade_id: data.oportunidade_id,
      _por: await autor(sb, context.userId),
      _motivo: data.motivo,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Crédito e aporte entram no extrato; correção só por estorno, porque
 * broker_movimentos não aceita update nem delete.
 */
export const lancarMovimento = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      unidade_id: number;
      tipo: "credito" | "aporte" | "estorno";
      valor_cb: number;
      mes_ref?: string | null;
      observacao?: string | null;
    }) => {
      const unidade_id = Number(input.unidade_id);
      const valor_cb = Number(input.valor_cb);
      if (!Number.isInteger(unidade_id) || unidade_id <= 0) throw new Error("Unidade inválida.");
      if (!Number.isFinite(valor_cb) || valor_cb <= 0)
        throw new Error("O valor precisa ser maior que zero.");
      if (!["credito", "aporte", "estorno"].includes(input.tipo))
        throw new Error("Tipo de movimento não permitido por esta tela.");
      return {
        unidade_id,
        tipo: input.tipo,
        valor_cb,
        mes_ref: input.mes_ref || null,
        observacao: input.observacao?.trim() || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "manage.broker", "você não pode operar o Broker.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("broker_movimentos").insert({
      ...data,
      criado_por: await autor(sb, context.userId),
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * O apurado é do job; o aplicado é ato humano. Esta é a única porta que move o
 * preço que a rede vê, e por isso exige observação.
 */
export const definirMultiplicadorAplicado = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number; aplicado: number; observacao?: string | null }) => {
    const id = Number(input.id);
    const aplicado = Number(input.aplicado);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Registro inválido.");
    if (!Number.isFinite(aplicado) || aplicado < 1)
      throw new Error("O multiplicador aplicado não pode ser menor que 1,0 — é o piso do modelo.");
    const observacao = input.observacao?.trim() || null;
    if (!observacao) throw new Error("Explique por que o multiplicador está mudando.");
    return { id, aplicado, observacao };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "manage.broker", "você não pode operar o Broker.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any)
      .from("broker_multiplicador")
      .update({
        aplicado: data.aplicado,
        observacao: data.observacao,
        fechado_em: new Date().toISOString(),
        fechado_por: await autor(sb, context.userId),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ------------------------------------------------------------------ *
 * Visão da unidade.
 *
 * Lê só as views v_broker_*, nunca as tabelas — elas carregam multiplicador,
 * MRR precificado e o extrato da rede inteira, e a policy de SELECT já barra.
 * O que chega aqui é preço e mais nada.
 * ------------------------------------------------------------------ */

export type FilaUnidadeRow = {
  id: number;
  empresa: string | null;
  segmento: string | null;
  preco_cb: number | null;
  status: string;
  entrou_em: string;
  reservado_em: string | null;
  minha_reserva: boolean;
};

export type ExtratoUnidadeRow = {
  id: number;
  unidade_id: number;
  tipo: string;
  valor_cb: number;
  oportunidade_id: number | null;
  mes_ref: string | null;
  observacao: string | null;
  criado_em: string;
};

export type BrokerUnidadeData = {
  fila: FilaUnidadeRow[];
  extrato: ExtratoUnidadeRow[];
  saldo: SaldoRow | null;
  semVinculo: boolean;
};

export const carregarBrokerUnidade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BrokerUnidadeData> => {
    const sb = context.supabase as any;
    await assertCan(sb, "view.broker", "você não tem acesso ao Broker.");

    const [fila, extrato, saldo] = await Promise.all([
      sb.from("v_broker_fila").select("*").order("entrou_em", { ascending: false }),
      sb.from("v_broker_extrato").select("*").order("criado_em", { ascending: false }).limit(100),
      sb
        .from("v_broker_meu_saldo")
        .select("unidade_id,nome:nome_da_praca,creditado,bloqueado,investido,disponivel"),
    ]);
    for (const r of [fila, extrato, saldo]) if (r.error) throw new Error(r.error.message);

    // Sem linha de saldo = usuário sem unidade vinculada em socios.user_id.
    // A tela precisa dizer isso em vez de mostrar zero, que seria uma afirmação.
    const linhas = saldo.data ?? [];
    return {
      fila: fila.data ?? [],
      extrato: extrato.data ?? [],
      saldo: linhas[0] ?? null,
      semVinculo: linhas.length === 0,
    };
  });

export const reservarParaMinhaUnidade = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oportunidade_id: number }) => {
    const oportunidade_id = Number(input.oportunidade_id);
    if (!Number.isInteger(oportunidade_id) || oportunidade_id <= 0)
      throw new Error("Oportunidade inválida.");
    return { oportunidade_id };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "view.broker", "você não tem acesso ao Broker.");
    // A unidade não viaja do cliente: broker_reservar_minha resolve pelo login.
    const { error } = await sb.rpc("broker_reservar_minha", {
      _oportunidade_id: data.oportunidade_id,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const liberarMinhaReserva = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { oportunidade_id: number }) => {
    const oportunidade_id = Number(input.oportunidade_id);
    if (!Number.isInteger(oportunidade_id) || oportunidade_id <= 0)
      throw new Error("Oportunidade inválida.");
    return { oportunidade_id };
  })
  .handler(async ({ data, context }) => {
    const sb = context.supabase as any;
    await assertCan(sb, "view.broker", "você não tem acesso ao Broker.");
    const { error } = await sb.rpc("broker_liberar", {
      _oportunidade_id: data.oportunidade_id,
      _por: await autor(sb, context.userId),
      _motivo: "liberado pela unidade",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
