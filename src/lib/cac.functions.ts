import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, digits, monthRange } from "@/lib/server-utils";

// ============ Types ============
export interface ApuracaoCacItem {
  id: number;
  apuracao_id: number;
  cnpj: string | null;
  razao_social: string;
  contrato_id: number | null;

  valor_cac_total: number;
  valor_parcela_1: number;
  valor_parcela_2: number;

  data_assinatura_contrato: string | null;
  prazo_parcela_1: string | null;
  data_envio_parcela_1: string | null;
  data_pagamento_parcela_1: string | null;
  status_parcela_1: string;

  data_recebimento_cliente: string | null;
  prazo_parcela_2: string | null;
  data_envio_parcela_2: string | null;
  data_pagamento_parcela_2: string | null;
  status_parcela_2: string;

  fonte: string;
  status_match: string | null;
  observacao: string | null;
  excluido_em: string | null;
  excluido_por: string | null;
  motivo_exclusao: string | null;
}

export interface ApuracaoCacItemComUnidade extends ApuracaoCacItem {
  unidade_id: number;
  unidade_nome: string;
  mes_referencia: string;
}

export interface CacUnidade {
  id: number;
  nome_da_praca: string;
}

// ============ Date helpers ============
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function endOfMonthISO(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

// Prazo da parcela 2: fim do mês do recebimento, ou recebimento+7d se
// faltarem menos de 7 dias até o fim do mês a partir do recebimento
// (regra confirmada com o usuário — evita janela curta demais perto da virada).
function prazoParcela2(dataRecebimento: string): string {
  const eom = endOfMonthISO(dataRecebimento);
  const diffDias = Math.round(
    (new Date(`${eom}T00:00:00Z`).getTime() - new Date(`${dataRecebimento}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  return diffDias >= 7 ? eom : addDaysISO(dataRecebimento, 7);
}

function statusParcela1(
  prazo: string | null,
  dataEnvio: string | null,
  dataPagamento: string | null,
  hoje: string,
): string {
  if (dataPagamento) return "pago";
  if (prazo && hoje > prazo) return "atrasado";
  if (dataEnvio) return "cobrado";
  return "pendente";
}

function statusParcela2(
  dataRecebimento: string | null,
  prazo: string | null,
  dataEnvio: string | null,
  dataPagamento: string | null,
  hoje: string,
): string {
  if (dataPagamento) return "pago";
  if (!dataRecebimento) return "aguardando_cliente";
  if (prazo && hoje > prazo) return "atrasado";
  if (dataEnvio) return "cobrado";
  return "pendente";
}

function withLiveStatus(it: ApuracaoCacItem, hoje: string): ApuracaoCacItem {
  return {
    ...it,
    status_parcela_1: statusParcela1(
      it.prazo_parcela_1,
      it.data_envio_parcela_1,
      it.data_pagamento_parcela_1,
      hoje,
    ),
    status_parcela_2: statusParcela2(
      it.data_recebimento_cliente,
      it.prazo_parcela_2,
      it.data_envio_parcela_2,
      it.data_pagamento_parcela_2,
      hoje,
    ),
  };
}

// ============ gerarItensParaApuracao (helper reaproveitado) ============
// CAC é sempre editável (não existe mais fechamento mensal) — esta função só
// cria/atualiza itens, nunca bloqueia por status da apuração.
async function gerarItensParaApuracao(
  supabase: any,
  apuracao_id: number,
  force: boolean,
): Promise<{ created: number; skipped: boolean }> {
  if (!force) {
    const { count, error: cErr } = await (supabase as any)
      .from("cac_apuracao_itens")
      .select("id", { count: "exact", head: true })
      .eq("apuracao_id", apuracao_id);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) return { created: 0, skipped: true };
  }

  const { data: ap, error: apErr } = await (supabase as any)
    .from("cac_apuracao")
    .select("id,mes_referencia,unidade_id, unidade:unidades!inner(id,nome_da_praca)")
    .eq("id", apuracao_id)
    .single();
  if (apErr) throw new Error(apErr.message);

  const unidadeNome: string = ap.unidade.nome_da_praca;
  const mes = String(ap.mes_referencia).slice(0, 7);
  const { start, end } = monthRange(mes);
  const hoje = todayISO();

  // Itens já existentes nesta apuração nunca ganham um irmão duplicado —
  // mesma lógica de idempotência de gerarItensApuracao (royalties).
  const { data: itensExistentes, error: ieErr } = await (supabase as any)
    .from("cac_apuracao_itens")
    .select(
      "id,contrato_id,data_recebimento_cliente,data_pagamento_parcela_1,data_pagamento_parcela_2,excluido_em",
    )
    .eq("apuracao_id", apuracao_id);
  if (ieErr) throw new Error(ieErr.message);
  const itemPorContrato = new Map<number, any>(
    (itensExistentes ?? [])
      .filter((i: any) => i.contrato_id != null)
      .map((i: any) => [i.contrato_id as number, i]),
  );

  // Contratos GANHOS neste mês (CAC nasce só no mês de aquisição do cliente —
  // diferente de royalties, que é recorrente todo mês).
  const { data: contratos, error: kErr } = await supabase
    .from("contratos")
    .select("id,cnpj,titulo,mrr_mensal,ganho_em")
    .eq("unidade", unidadeNome)
    .eq("tipo_unidade", "franquia")
    .eq("status_contrato", "Ativo")
    .gte("ganho_em", start)
    .lte("ganho_em", end);
  if (kErr) throw new Error(kErr.message);

  // Primeiro RECEBIDO histórico por CNPJ (sem limitar ao mês — é o gatilho
  // da parcela 2, que pode acontecer em qualquer mês futuro).
  const { data: recs, error: rErr } = await supabase
    .from("contas_receber")
    .select("cpf_cnpj,data_pagamento")
    .eq("unidade", unidadeNome)
    .eq("status_pagamento", "RECEBIDO")
    .not("data_pagamento", "is", null)
    .order("data_pagamento", { ascending: true });
  if (rErr) throw new Error(rErr.message);
  const primeiroRecebimentoPorCnpj = new Map<string, string>();
  for (const r of recs ?? []) {
    const k = digits(r.cpf_cnpj);
    if (!k || primeiroRecebimentoPorCnpj.has(k)) continue;
    primeiroRecebimentoPorCnpj.set(k, r.data_pagamento as string);
  }

  const itens: any[] = [];
  const atualizacoes: { id: number; patch: Record<string, unknown> }[] = [];

  for (const c of contratos ?? []) {
    const existente = itemPorContrato.get(c.id);
    const cnpjDigits = digits(c.cnpj);
    const valorTotal = Number(c.mrr_mensal ?? 0);
    const valorParcela1 = valorTotal / 2;
    const valorParcela2 = valorTotal / 2;
    const dataAssinatura = c.ganho_em ?? null;
    const prazo1 = dataAssinatura ? addDaysISO(dataAssinatura, 7) : null;
    const dataRecebimento = cnpjDigits
      ? (primeiroRecebimentoPorCnpj.get(cnpjDigits) ?? null)
      : null;
    const prazo2 = dataRecebimento ? prazoParcela2(dataRecebimento) : null;
    const statusMatch = !cnpjDigits ? "sem_cnpj" : "matched";

    if (existente) {
      if (existente.excluido_em) continue; // excluído manualmente, nunca recalcula
      // Só re-sincroniza o dado que pode ter mudado desde a última geração
      // (chegada do 1º recebimento) — nunca sobrescreve pagamentos manuais.
      if ((existente.data_recebimento_cliente ?? null) !== dataRecebimento) {
        atualizacoes.push({
          id: existente.id,
          patch: {
            data_recebimento_cliente: dataRecebimento,
            prazo_parcela_2: prazo2,
            status_match: statusMatch,
          },
        });
      }
      continue;
    }

    itens.push({
      apuracao_id: apuracao_id,
      cnpj: cnpjDigits || null,
      razao_social: c.titulo ?? "—",
      contrato_id: c.id,
      valor_cac_total: valorTotal,
      valor_parcela_1: valorParcela1,
      valor_parcela_2: valorParcela2,
      data_assinatura_contrato: dataAssinatura,
      prazo_parcela_1: prazo1,
      status_parcela_1: statusParcela1(prazo1, null, null, hoje),
      data_recebimento_cliente: dataRecebimento,
      prazo_parcela_2: prazo2,
      status_parcela_2: statusParcela2(dataRecebimento, prazo2, null, null, hoje),
      fonte: "pipedrive",
      status_match: statusMatch,
    });
  }

  for (const upd of atualizacoes) {
    const { error } = await (supabase as any)
      .from("cac_apuracao_itens")
      .update(upd.patch)
      .eq("id", upd.id);
    if (error) throw new Error(error.message);
  }

  if (itens.length === 0) return { created: 0, skipped: false };

  const { error } = await (supabase as any).from("cac_apuracao_itens").insert(itens);
  if (error) throw new Error(error.message);
  return { created: itens.length, skipped: false };
}

// Garante que toda apuração mensal necessária existe (mês atual + meses com
// contrato ganho ainda não vistos) para uma unidade, sincroniza os itens e
// devolve todos eles com a unidade já anexada. Reaproveitado pela listagem
// única (todas as unidades numa tabela só).
async function syncApuracoesEItensUnidade(
  supabase: any,
  unidade: CacUnidade,
  force: boolean,
): Promise<ApuracaoCacItemComUnidade[]> {
  const mesAtual = todayISO().slice(0, 7);

  const { data: existentes, error: aErr } = await (supabase as any)
    .from("cac_apuracao")
    .select("id,mes_referencia")
    .eq("unidade_id", unidade.id);
  if (aErr) throw new Error(aErr.message);

  const mesesExistentes = new Set(
    (existentes ?? []).map((a: any) => String(a.mes_referencia).slice(0, 7)),
  );

  const { data: contratos, error: kErr } = await supabase
    .from("contratos")
    .select("ganho_em")
    .eq("unidade", unidade.nome_da_praca)
    .eq("tipo_unidade", "franquia")
    .eq("status_contrato", "Ativo")
    .not("ganho_em", "is", null);
  if (kErr) throw new Error(kErr.message);

  const mesesNecessarios = new Set<string>([mesAtual]);
  for (const c of contratos ?? []) {
    mesesNecessarios.add(String((c as any).ganho_em).slice(0, 7));
  }

  const mesesFaltantes = [...mesesNecessarios].filter((m) => !mesesExistentes.has(m));
  if (mesesFaltantes.length > 0) {
    const novas = mesesFaltantes.map((mes) => ({
      unidade_id: unidade.id,
      mes_referencia: monthRange(mes).firstDay,
      status: "rascunho",
    }));
    const { error: iErr } = await (supabase as any).from("cac_apuracao").insert(novas);
    if (iErr) throw new Error(iErr.message);
  }

  const { data: apuracoes, error: a2Err } = await (supabase as any)
    .from("cac_apuracao")
    .select("id,mes_referencia")
    .eq("unidade_id", unidade.id);
  if (a2Err) throw new Error(a2Err.message);

  for (const ap of apuracoes ?? []) {
    await gerarItensParaApuracao(supabase, (ap as any).id, force);
  }

  const apuracaoIds = (apuracoes ?? []).map((a: any) => a.id);
  if (apuracaoIds.length === 0) return [];

  const { data: itens, error: itErr } = await (supabase as any)
    .from("cac_apuracao_itens")
    .select("*")
    .in("apuracao_id", apuracaoIds);
  if (itErr) throw new Error(itErr.message);

  const mesPorApuracao = new Map<number, string>(
    (apuracoes ?? []).map((a: any) => [a.id, a.mes_referencia]),
  );
  const hoje = todayISO();
  return ((itens ?? []) as ApuracaoCacItem[]).map((it) => ({
    ...withLiveStatus(it, hoje),
    unidade_id: unidade.id,
    unidade_nome: unidade.nome_da_praca,
    mes_referencia: mesPorApuracao.get(it.apuracao_id) ?? "",
  }));
}

async function getOrCreateApuracaoAtual(supabase: any, unidade_id: number): Promise<number> {
  const mesAtual = todayISO().slice(0, 7);
  const { data: existentes, error: eErr } = await (supabase as any)
    .from("cac_apuracao")
    .select("id,mes_referencia")
    .eq("unidade_id", unidade_id);
  if (eErr) throw new Error(eErr.message);
  const found = (existentes ?? []).find(
    (a: any) => String(a.mes_referencia).slice(0, 7) === mesAtual,
  );
  if (found) return found.id;

  const { data: created, error: cErr } = await (supabase as any)
    .from("cac_apuracao")
    .insert({ unidade_id, mes_referencia: monthRange(mesAtual).firstDay, status: "rascunho" })
    .select("id")
    .single();
  if (cErr) throw new Error(cErr.message);
  return created.id;
}

// ============ listCacItensTodasUnidades ============
// Tela única: todos os clientes com CAC, de todas as unidades, numa tabela só
// (filtro por unidade fica no front). Sempre editável — não existe mais
// conceito de mês fechado/confirmado.
export const listCacItensTodasUnidades = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { force?: boolean } | undefined) => d ?? {})
  .handler(
    async ({
      data,
      context,
    }): Promise<{ unidades: CacUnidade[]; itens: ApuracaoCacItemComUnidade[] }> => {
      const { supabase, userId } = context;
      await assertAdmin(supabase, userId);

      const { data: unidades, error: uErr } = await supabase
        .from("unidades")
        .select("id,nome_da_praca")
        .eq("tipo", "regional")
        .eq("paga_cac", true)
        .order("nome_da_praca");
      if (uErr) throw new Error(uErr.message);
      if (!unidades || unidades.length === 0) return { unidades: [], itens: [] };

      const itens: ApuracaoCacItemComUnidade[] = [];
      for (const u of unidades as CacUnidade[]) {
        const its = await syncApuracoesEItensUnidade(supabase, u, !!data.force);
        itens.push(...its);
      }
      itens.sort((a, b) =>
        (b.data_assinatura_contrato ?? "").localeCompare(a.data_assinatura_contrato ?? ""),
      );

      return { unidades: unidades as CacUnidade[], itens };
    },
  );

// ============ updateItemCac ============
// Marcar parcela como paga é uma ação manual do admin — hoje não existe
// integração automática que rastreie a unidade repassando o CAC pra matriz
// (Omie por unidade só cobre recebíveis de clientes, não repasses internos).
export const updateItemCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: number;
      data_envio_parcela_1?: string | null;
      data_pagamento_parcela_1?: string | null;
      data_envio_parcela_2?: string | null;
      data_pagamento_parcela_2?: string | null;
      observacao?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const patch: any = {};
    if ("data_envio_parcela_1" in data) patch.data_envio_parcela_1 = data.data_envio_parcela_1;
    if ("data_pagamento_parcela_1" in data)
      patch.data_pagamento_parcela_1 = data.data_pagamento_parcela_1;
    if ("data_envio_parcela_2" in data) patch.data_envio_parcela_2 = data.data_envio_parcela_2;
    if ("data_pagamento_parcela_2" in data)
      patch.data_pagamento_parcela_2 = data.data_pagamento_parcela_2;
    if ("observacao" in data) patch.observacao = data.observacao;

    const { error } = await (supabase as any)
      .from("cac_apuracao_itens")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ addItemManualCac ============
export const addItemManualCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      unidade_id: number;
      razao_social: string;
      cnpj?: string | null;
      valor_cac_total: number;
      observacao?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const apuracao_id = await getOrCreateApuracaoAtual(supabase, data.unidade_id);
    const valorTotal = Number(data.valor_cac_total ?? 0);
    const { error } = await (supabase as any).from("cac_apuracao_itens").insert({
      apuracao_id,
      razao_social: data.razao_social,
      cnpj: data.cnpj ? digits(data.cnpj) : null,
      valor_cac_total: valorTotal,
      valor_parcela_1: valorTotal / 2,
      valor_parcela_2: valorTotal / 2,
      status_parcela_1: "pendente",
      status_parcela_2: "aguardando_cliente",
      observacao: data.observacao ?? null,
      fonte: "manual",
      status_match: "manual",
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ deleteItemCac ============
export const deleteItemCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await (supabase as any).from("cac_apuracao_itens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ excluirItemMesCac ============
export const excluirItemMesCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number; motivo: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);
    if (!data.motivo?.trim()) throw new Error("Motivo da exclusão é obrigatório.");

    const email = (claims as any)?.email ?? null;
    const { error } = await (supabase as any)
      .from("cac_apuracao_itens")
      .update({
        excluido_em: new Date().toISOString(),
        excluido_por: email ?? userId,
        motivo_exclusao: data.motivo.trim(),
      })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ reincluirItemMesCac ============
export const reincluirItemMesCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await (supabase as any)
      .from("cac_apuracao_itens")
      .update({ excluido_em: null, excluido_por: null, motivo_exclusao: null })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
