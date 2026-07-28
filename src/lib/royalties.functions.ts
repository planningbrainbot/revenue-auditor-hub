import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, digits, monthRange } from "@/lib/server-utils";

// ============ Types ============
export interface UnidadeRoyalties {
  id: number;
  nome_da_praca: string;
  royalties_percentual: number | null;
  csc_valor_fixo: number | null;
  csc_percentual_base_antiga: number | null;
  observacoes_financeiras: string | null;
  apuracao: ApuracaoSummary | null;
}

export interface ApuracaoSummary {
  id: number;
  status: string;
  mes_referencia: string;
  total_fatura: number | null;
  receita_base: number | null;
  royalties_valor: number | null;
  csc_valor_fixo: number | null;
  csc_base_antiga_valor: number | null;
  cac_valor: number | null;
  csc_trafego_pago: number | null;
  outras_receitas: number | null;
  confirmado_em: string | null;
}

export interface ApuracaoFull {
  id: number;
  unidade_id: number;
  mes_referencia: string;
  status: string;
  receita_base: number | null;
  royalties_percentual: number | null;
  royalties_valor: number | null;
  csc_valor_fixo: number | null;
  receita_base_antiga: number | null;
  csc_percentual_base_antiga: number | null;
  csc_base_antiga_valor: number | null;
  cac_valor: number | null;
  csc_trafego_pago: number | null;
  outras_receitas: number | null;
  total_fatura: number | null;
  confirmado_em: string | null;
  confirmado_por: string | null;
  observacao: string | null;
  unidade: {
    id: number;
    nome_da_praca: string;
    royalties_percentual: number | null;
    csc_valor_fixo: number | null;
    csc_percentual_base_antiga: number | null;
    observacoes_financeiras: string | null;
    tem_omie: boolean;
  };
}

export interface ApuracaoItem {
  id: number;
  apuracao_id: number;
  cnpj: string | null;
  razao_social: string;
  contrato_id: number | null;
  categoria: string; // 'royalties' | 'csc_base_antiga'
  mrr_contratado: number | null;
  mrr_override: number | null;
  valor_omie: number | null;
  valor_confirmado: number | null;
  royalties_percentual_override: number | null;
  is_cac: boolean;
  royalties_item: number | null;
  fonte: string;
  status_match: string | null;
  confirmado: boolean | null;
  observacao: string | null;
  filiais_count?: number;
  churn_pipefy_card_id: string | null;
  churn_reportado_em: string | null;
  data_ganho: string | null;
  excluido_em: string | null;
  excluido_por: string | null;
  motivo_exclusao: string | null;
  data_pagamento_omie: string[] | null;
  data_competencia_omie: string[] | null;
}

export interface OutraReceitaItem {
  id: number;
  apuracao_id: number;
  nome: string;
  valor: number;
  observacao: string | null;
}

// ============ listRoyaltiesUnidades ============
export const listRoyaltiesUnidades = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { mes: string }) => d)
  .handler(async ({ data, context }): Promise<{ rows: UnidadeRoyalties[] }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { firstDay } = monthRange(data.mes);

    const { data: unidades, error: uErr } = await supabase
      .from("unidades")
      .select(
        "id,nome_da_praca,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,observacoes_financeiras",
      )
      .eq("tipo", "regional")
      .order("nome_da_praca");
    if (uErr) throw new Error(uErr.message);

    const { data: aps, error: aErr } = await supabase
      .from("royalties_apuracao")
      .select(
        "id,unidade_id,status,mes_referencia,total_fatura,receita_base,royalties_valor,csc_valor_fixo,csc_base_antiga_valor,cac_valor,csc_trafego_pago,outras_receitas,confirmado_em",
      )
      .eq("mes_referencia", firstDay);
    if (aErr) throw new Error(aErr.message);

    const byUnit = new Map<number, ApuracaoSummary>();
    for (const a of aps ?? []) byUnit.set(a.unidade_id, a as ApuracaoSummary);

    return {
      rows: (unidades ?? []).map((u: any) => ({
        ...u,
        apuracao: byUnit.get(u.id) ?? null,
      })),
    };
  });

// ============ getOrCreateApuracao ============
export const getOrCreateApuracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { unidade_id: number; mes: string }) => d)
  .handler(async ({ data, context }): Promise<{ apuracao_id: number; created: boolean }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { firstDay } = monthRange(data.mes);

    const { data: existing, error: e1 } = await supabase
      .from("royalties_apuracao")
      .select("id")
      .eq("unidade_id", data.unidade_id)
      .eq("mes_referencia", firstDay)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (existing) return { apuracao_id: existing.id, created: false };

    const { data: u, error: uErr } = await supabase
      .from("unidades")
      .select("royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga")
      .eq("id", data.unidade_id)
      .single();
    if (uErr) throw new Error(uErr.message);

    const { data: inserted, error: iErr } = await supabase
      .from("royalties_apuracao")
      .insert({
        unidade_id: data.unidade_id,
        mes_referencia: firstDay,
        status: "rascunho",
        royalties_percentual: u.royalties_percentual,
        csc_valor_fixo: u.csc_valor_fixo,
        csc_percentual_base_antiga: u.csc_percentual_base_antiga,
      })
      .select("id")
      .single();
    if (iErr) throw new Error(iErr.message);

    // "Outras receitas" (softwares recorrentes: Qulture.rocks, Pipedrive, etc.)
    // é praticamente igual todo mês — copia os itens da apuração anterior mais
    // recente da mesma unidade em vez de nascer em branco, pra não precisar
    // redigitar a lista toda vez. O valor pode ser ajustado depois normalmente.
    const { data: anterior } = await supabase
      .from("royalties_apuracao")
      .select("id")
      .eq("unidade_id", data.unidade_id)
      .lt("mes_referencia", firstDay)
      .order("mes_referencia", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (anterior) {
      const { data: itensAnteriores } = await supabase
        .from("royalties_outras_receitas_itens")
        .select("nome,valor,observacao")
        .eq("apuracao_id", anterior.id);
      if (itensAnteriores && itensAnteriores.length > 0) {
        await supabase.from("royalties_outras_receitas_itens").insert(
          itensAnteriores.map((it: any) => ({
            apuracao_id: inserted.id,
            nome: it.nome,
            valor: it.valor,
            observacao: it.observacao,
          })),
        );
        await recomputeOutrasReceitas(supabase, inserted.id);
      }
    }

    return { apuracao_id: inserted.id, created: true };
  });

// Churn sem recebimento no mês não precisa de revisão manual — o item já nasce
// (ou é atualizado/self-healed) excluído do mês automaticamente. Se HOUVER valor
// do Omie no mês (ex: fatura residual paga antes do churn efetivar), o item
// continua ativo normalmente pra um humano confirmar — só o "sem recebimento" é
// automático.
const MOTIVO_EXCLUSAO_CHURN_AUTOMATICO =
  "Churn registrado — sem recebimento no mês (exclusão automática)";
const EXCLUIDO_POR_CHURN_AUTOMATICO = "sistema (churn automático)";
const camposExclusaoChurn = (
  churnInfo: { churn_pipefy_card_id: string | null; churn_reportado_em: string | null } | null,
  temValorOmie: boolean,
) => {
  if (!churnInfo || temValorOmie) return {};
  return {
    excluido_em: new Date().toISOString(),
    excluido_por: EXCLUIDO_POR_CHURN_AUTOMATICO,
    motivo_exclusao: MOTIVO_EXCLUSAO_CHURN_AUTOMATICO,
  };
};

// ============ apagarItensNaoConfirmados / gerarItensApuracaoCore ============
// Núcleo compartilhado da regeneração de itens — usado tanto pelos server fns
// abaixo quanto pela propagação entre meses (addFiliais, em contrato-omie-grupos)
// quando um vínculo de filial precisa recalcular outras apurações além da atual.
export async function apagarItensNaoConfirmados(supabase: any, apuracao_id: number) {
  const { error } = await supabase
    .from("royalties_itens")
    .delete()
    .eq("apuracao_id", apuracao_id)
    .in("fonte", ["pipedrive", "omie"])
    .eq("confirmado", false)
    .is("churn_pipefy_card_id", null)
    // Preserva qualquer exclusão manual (ex: "Cliente não pagou este mês"),
    // não só churn — sem isso, "Forçar atualização" apagava e recriava do
    // zero qualquer item excluído manualmente, perdendo o motivo/registro.
    .is("excluido_em", null);
  if (error) throw new Error(error.message);
}

export async function gerarItensApuracaoCore(
  supabase: any,
  apuracao_id: number,
): Promise<{ created: number }> {
  const { data: ap, error: apErr } = await supabase
    .from("royalties_apuracao")
    .select(
      "id,mes_referencia,unidade_id,status, unidade:unidades!inner(id,nome_da_praca,csc_percentual_base_antiga)",
    )
    .eq("id", apuracao_id)
    .single();
  if (apErr) throw new Error(apErr.message);
  if (ap.status === "confirmado" || ap.status === "faturado") {
    throw new Error("Apuração já fechada — não é possível regerar itens.");
  }

  const unidadeNome: string = ap.unidade.nome_da_praca;
  const usaCscVariavel = ap.unidade.csc_percentual_base_antiga != null;
  const mes = String(ap.mes_referencia).slice(0, 7);
  const { start, end } = monthRange(mes);

  // Itens que já existem nesta apuração (ex: confirmados, que regerarMatchApuracao
  // preserva de propósito) nunca devem ganhar um item irmão duplicado — sem isso,
  // rodar com force:true depois de itens confirmados gera duas linhas por contrato.
  // O valor correto de referência é sempre o do Omie: se um item já existente (mesmo
  // confirmado) tem um valor_omie desatualizado em relação ao que acabou de ser
  // recalculado (ex: chegou uma 2ª fatura do mês depois da confirmação), ele é
  // atualizado com o valor novo e volta pra "não confirmado" pra revisão humana.
  // Itens com churn marcado ou excluídos do mês (excluirItemMes) nunca são recalculados.
  const { data: itensExistentes, error: ieErr } = await supabase
    .from("royalties_itens")
    .select(
      "id,contrato_id,cnpj,valor_omie,confirmado,churn_pipefy_card_id,excluido_em,data_pagamento_omie,data_competencia_omie",
    )
    .eq("apuracao_id", apuracao_id);
  if (ieErr) throw new Error(ieErr.message);
  const itemPorContrato = new Map<number, any>(
    (itensExistentes ?? [])
      .filter((i: any) => i.contrato_id != null)
      .map((i: any) => [i.contrato_id as number, i]),
  );
  // Bug corrigido 20/07/2026: era um Set (só existência), então itens "so_omie"
  // (cliente recebido no Omie sem contrato casado no Pipedrive/CRM) nunca eram
  // atualizados depois de criados uma vez — regenerar a apuração não refletia
  // mudança nenhuma de valor pra esses clientes, silenciosamente. Agora é um Map
  // pro item existente, permitindo comparar e atualizar valor como já era feito
  // pro caminho "matched".
  const itemSemContratoPorCnpj = new Map<string, any>(
    (itensExistentes ?? [])
      .filter((i: any) => i.contrato_id == null)
      .map((i: any) => [digits(i.cnpj), i]),
  );
  const cnpjsSemContratoComItem = new Set(itemSemContratoPorCnpj.keys());
  const atualizacoesValorOmie: {
    id: number;
    cnpj?: string | null;
    valor_omie: number | null;
    valor_confirmado: number | null;
    confirmado: boolean;
    status_match: string;
    churn_pipefy_card_id?: string | null;
    churn_reportado_em?: string | null;
    excluido_em?: string;
    excluido_por?: string;
    motivo_exclusao?: string;
    data_pagamento_omie?: string[] | null;
    data_competencia_omie?: string[] | null;
  }[] = [];
  // Backfill de data_pagamento_omie/data_competencia_omie em itens já
  // existentes cujo valor do Omie não mudou (senão essas datas só apareceriam
  // depois que algo no valor mudasse) — não mexe em confirmado/status_match,
  // só nas duas colunas de data.
  const atualizacoesMetadadosOmie: {
    id: number;
    data_pagamento_omie: string[] | null;
    data_competencia_omie: string[] | null;
  }[] = [];
  const arraysIguais = (a: string[] | null | undefined, b: string[] | null | undefined) => {
    const x = a ?? [];
    const y = b ?? [];
    if (x.length !== y.length) return false;
    return x.every((v, i) => v === y[i]);
  };
  // contratos
  const { data: contratos, error: kErr } = await supabase
    .from("contratos")
    .select("id,cnpj,titulo,mrr_mensal,ganho_em,pipedrive_deal_id")
    .eq("unidade", unidadeNome)
    .eq("tipo_unidade", "franquia")
    .eq("status_contrato", "Ativo");
  if (kErr) throw new Error(kErr.message);

  // Churn já registrado no Pipefy (mesma fonte de verdade da página Clientes:
  // central_tratativas com estagio=Perdido). Preenche o item já nascendo marcado
  // como churn quando a apuração é de um mês novo (nunca gerado antes) — sem isso,
  // um mês futuro (ex: apuração criada em agosto/2026 pela primeira vez) incluiria
  // o contrato normalmente, já que nada além do próprio item de uma apuração já
  // gerada sabia do churn.
  const { data: tratativasChurn, error: tcErr } = await supabase
    .from("central_tratativas")
    .select("pipedrive_deal_id,pipefy_card_id,data_churn,stage_change_time")
    .eq("estagio", "Perdido")
    .eq("status", "lost");
  if (tcErr) throw new Error(tcErr.message);
  const churnPorDealId = new Map<string, any>(
    (tratativasChurn ?? [])
      .filter((t: any) => t.pipedrive_deal_id != null)
      .map((t: any) => [String(t.pipedrive_deal_id), t]),
  );
  // Retorna null (sem churn ou churn futuro — contrato segue ativo normalmente),
  // "expirado" (churn foi num mês ANTERIOR — contrato não deve mais aparecer
  // nesta apuração, nem como ativo nem como excluído; ele só existiu no mês do
  // churn) ou o objeto de churn (churn é exatamente este mês — cria o item já
  // marcado como excluído, como sempre foi feito).
  const churnInfoParaMes = (
    pipedriveDealId: string | number | null,
  ): "expirado" | { churn_pipefy_card_id: string | null; churn_reportado_em: string | null } | null => {
    if (pipedriveDealId == null) return null;
    const t = churnPorDealId.get(String(pipedriveDealId));
    if (!t || !t.data_churn) return null;
    const mesChurn = String(t.data_churn).slice(0, 7);
    if (mesChurn > mes) return null; // churn é depois deste mês — ainda ativo aqui
    if (mesChurn < mes) return "expirado"; // churn foi em mês anterior — não repete pra sempre
    return {
      churn_pipefy_card_id: t.pipefy_card_id ? String(t.pipefy_card_id) : null,
      churn_reportado_em: t.stage_change_time ?? null,
    };
  };

  // contas_receber agregado por cnpj — só categoria "Receitas Diretas" (Omie:
  // código pai 1.01) entra na base de royalty. Categorias como "Reembolsos"
  // (1.03) não são receita de serviço recorrente e nunca deveriam ter contado
  // — ver decisão 20/07/2026. codigo_categoria pode ser null pra lançamentos
  // sincronizados antes dessa coluna existir; nesse caso, inclui por padrão
  // (mesmo comportamento de antes) em vez de excluir por falta de dado.
  const { data: recs, error: rErr } = await supabase
    .from("contas_receber")
    .select("cpf_cnpj,cliente,valor,valor_liquido,data_pagamento,data_competencia,codigo_categoria")
    .eq("unidade", unidadeNome)
    .eq("status_pagamento", "RECEBIDO")
    .gte("data_pagamento", start)
    .lte("data_pagamento", end);
  if (rErr) throw new Error(rErr.message);
  const recsReceitasDiretas = (recs ?? []).filter(
    (r: any) => r.codigo_categoria == null || String(r.codigo_categoria).startsWith("1.01"),
  );

  // Data de cadastro do cliente no Omie — usada como "data do ganho" para
  // clientes só-Omie (sem contrato/deal no Pipedrive), onde não existe
  // ganho_em de verdade.
  const { data: cadastros, error: cadErr } = await supabase
    .from("omie_clientes_cadastro")
    .select("cnpj,data_cadastro")
    .eq("unidade", unidadeNome);
  if (cadErr) throw new Error(cadErr.message);
  const cadastroPorCnpj = new Map<string, string | null>(
    (cadastros ?? []).map((c: any) => [c.cnpj, c.data_cadastro]),
  );

  type OmieAgg = {
    cnpj: string;
    cliente: string;
    valor: number;
    pagamentos: Set<string>;
    competencias: Set<string>;
  };
  const omieMap = new Map<string, OmieAgg>();
  // Royalties incidem sobre o valor efetivamente recebido em caixa, não sobre
  // o valor bruto da NF — quando há retenção de imposto na fonte (IRRF/PIS/
  // COFINS/CSLL), o prestador nunca recebe o bruto, o imposto vai direto pro
  // governo. valor_liquido é calculado incrementalmente pelo sync (só títulos
  // recentes, ~60 dias — ver VALOR_LIQUIDO_JANELA_DIAS em
  // ~/sync_omie_supabase.py), então cai de volta pro bruto se ainda não foi
  // calculado pra aquele título (evita perder receita da apuração por causa
  // de um título fora da janela, à custa de usar bruto só nesse caso).
  let semValorLiquido = 0;
  for (const r of recsReceitasDiretas) {
    const k = digits(r.cpf_cnpj);
    if (!k) continue;
    const cur =
      omieMap.get(k) ??
      { cnpj: k, cliente: r.cliente ?? "—", valor: 0, pagamentos: new Set<string>(), competencias: new Set<string>() };
    if (r.valor_liquido == null) semValorLiquido += 1;
    cur.valor += Number(r.valor_liquido ?? r.valor ?? 0);
    if (r.data_pagamento) cur.pagamentos.add(r.data_pagamento);
    if (r.data_competencia) cur.competencias.add(r.data_competencia);
    omieMap.set(k, cur);
  }
  if (semValorLiquido > 0) {
    console.warn(
      `gerarItensApuracaoCore: ${semValorLiquido} título(s) de ${unidadeNome} sem valor_liquido calculado ainda — usado valor bruto como fallback.`,
    );
  }

  // Carrega filiais vinculadas a contratos desta unidade — precisa rodar antes de
  // decidir quem vai pro branch "sem CNPJ", pois um contrato sem CNPJ próprio no
  // Pipedrive ainda pode ter filiais vinculadas manualmente com CNPJ que bate com o Omie.
  const todosContratoIds = (contratos ?? []).map((c: any) => c.id);
  const filiaisPorContrato = new Map<number, string[]>();
  if (todosContratoIds.length > 0) {
    const { data: grupos, error: gErr } = await supabase
      .from("contrato_omie_grupos")
      .select("contrato_id,cpf_cnpj")
      .in("contrato_id", todosContratoIds);
    if (gErr) throw new Error(gErr.message);
    for (const g of grupos ?? []) {
      const arr = filiaisPorContrato.get(g.contrato_id) ?? [];
      arr.push(digits(g.cpf_cnpj));
      filiaisPorContrato.set(g.contrato_id, arr);
    }
  }

  const contratoMap = new Map<
    string,
    {
      id: number;
      titulo: string;
      mrr: number;
      cnpj: string | null;
      ganhoEm: string | null;
      pipedriveDealId: string | number | null;
    }
  >();
  const itensSemCnpj: any[] = [];
  // Contratos com CNPJ próprio são agrupados por CNPJ antes de entrar no Map —
  // é comum (e esperado) 1 empresa ter mais de 1 contrato ativo ao longo do tempo
  // (ex: churn e recontratação, "Segunda Oportunidade"). Sem agrupar aqui, o
  // Map por CNPJ mais abaixo sobrescreveria silenciosamente um contrato pelo
  // outro, perdendo o match do Omie pra um deles pra sempre.
  const contratosPorCnpjReal = new Map<string, any[]>();
  const idsParaExcluirRegeneracao: number[] = [];
  for (const c of contratos ?? []) {
    const k = digits(c.cnpj);
    const filiais = filiaisPorContrato.get(c.id) ?? [];
    if (!k && filiais.length === 0) {
      if (itemPorContrato.has(c.id)) continue;
      // Contrato sem CNPJ cadastrado e sem filiais vinculadas nunca pode ser cruzado
      // com o Omie (join é por CNPJ). Sem isso, o contrato desaparece silenciosamente
      // da apuração inteira.
      const churnInfoSemCnpj = churnInfoParaMes(c.pipedrive_deal_id);
      if (churnInfoSemCnpj === "expirado") continue; // churn foi em mês anterior — não aparece mais
      itensSemCnpj.push({
        apuracao_id: apuracao_id,
        cnpj: null,
        razao_social: c.titulo ?? "—",
        contrato_id: c.id,
        categoria: "royalties",
        mrr_contratado: Number(c.mrr_mensal ?? 0),
        valor_omie: null,
        valor_confirmado: null,
        fonte: "pipedrive",
        status_match: "so_pipedrive",
        observacao: "Contrato sem CNPJ cadastrado — não foi possível conciliar com o Omie.",
        confirmado: false,
        data_ganho: c.ganho_em ?? null,
        ...(churnInfoSemCnpj ?? {}),
        ...camposExclusaoChurn(churnInfoSemCnpj, false),
      });
      continue;
    }
    if (!k) {
      // Sem CNPJ próprio mas com filiais vinculadas — chave sintética (id do
      // contrato) sempre única, o match acontece inteiramente pelas filiais.
      contratoMap.set(`__filial_only_${c.id}`, {
        id: c.id,
        titulo: c.titulo ?? "—",
        mrr: Number(c.mrr_mensal ?? 0),
        cnpj: null,
        ganhoEm: c.ganho_em ?? null,
        pipedriveDealId: c.pipedrive_deal_id ?? null,
      });
      continue;
    }
    const arr = contratosPorCnpjReal.get(k) ?? [];
    arr.push(c);
    contratosPorCnpjReal.set(k, arr);
  }

  for (const [k, grupo] of contratosPorCnpjReal) {
    if (grupo.length === 1) {
      const c = grupo[0];
      contratoMap.set(k, {
        id: c.id,
        titulo: c.titulo ?? "—",
        mrr: Number(c.mrr_mensal ?? 0),
        cnpj: k,
        ganhoEm: c.ganho_em ?? null,
        pipedriveDealId: c.pipedrive_deal_id ?? null,
      });
      continue;
    }
    // 2+ contratos ativos com o mesmo CNPJ: agrupa em 1 item só, somando o MRR.
    // O contrato com ganho_em mais recente é o "principal" (referência de
    // contrato_id, título e data do ganho); os demais são fundidos nele — se
    // já tinham item próprio nesta apuração (de antes desse agrupamento
    // existir) e não estiverem confirmados/com churn/excluídos, esse item
    // avulso é removido pra não duplicar linha.
    const ordenado = [...grupo].sort((a, b) => {
      const da = a.ganho_em ?? "";
      const db = b.ganho_em ?? "";
      if (da !== db) return da < db ? 1 : -1;
      return b.id - a.id;
    });
    const [principal, ...secundarios] = ordenado;
    const mrrTotal = grupo.reduce((soma, g) => soma + Number(g.mrr_mensal ?? 0), 0);
    contratoMap.set(k, {
      id: principal.id,
      titulo: principal.titulo ?? "—",
      mrr: mrrTotal,
      cnpj: k,
      ganhoEm: principal.ganho_em ?? null,
      pipedriveDealId: principal.pipedrive_deal_id ?? null,
    });
    for (const sec of secundarios) {
      const itemSecundario = itemPorContrato.get(sec.id);
      if (
        itemSecundario &&
        !itemSecundario.confirmado &&
        !itemSecundario.churn_pipefy_card_id &&
        !itemSecundario.excluido_em
      ) {
        idsParaExcluirRegeneracao.push(itemSecundario.id);
        itemPorContrato.delete(sec.id);
      }
    }
  }

  const itens: any[] = [...itensSemCnpj];

  // Matched + so_pipedrive (com expansão por filiais vinculadas)
  for (const [, c] of contratoMap) {
    const filiais = filiaisPorContrato.get(c.id) ?? [];
    const cnpjsGrupo = [c.cnpj, ...filiais].filter((x): x is string => !!x);
    let omieValor = 0;
    let temOmie = false;
    const pagamentosGrupo = new Set<string>();
    const competenciasGrupo = new Set<string>();
    for (const cn of cnpjsGrupo) {
      const om = omieMap.get(cn);
      if (om) {
        omieValor += om.valor;
        temOmie = true;
        for (const d of om.pagamentos) pagamentosGrupo.add(d);
        for (const d of om.competencias) competenciasGrupo.add(d);
        omieMap.delete(cn);
      }
    }
    const dataPagamentoOmie = pagamentosGrupo.size ? Array.from(pagamentosGrupo).sort() : null;
    const dataCompetenciaOmie = competenciasGrupo.size ? Array.from(competenciasGrupo).sort() : null;
    // Já existe item pra esse contrato nesta apuração (ex: confirmado, preservado
    // de propósito por regerarMatchApuracao) — o Omie acima já foi consumido pra não
    // sobrar como "só omie", mas não criamos um item irmão duplicado. Em vez disso,
    // se o valor do Omie recalculado agora é diferente do que está salvo (ex: chegou
    // uma 2ª fatura do mês depois da confirmação), atualiza o item existente com o
    // valor novo do Omie — que é sempre a referência correta — e derruba confirmado
    // pra forçar revisão humana do valor atualizado.
    const churnInfo = churnInfoParaMes(c.pipedriveDealId);
    const itemExistente = itemPorContrato.get(c.id);
    if (churnInfo === "expirado") {
      // Churn foi num mês anterior a este — o contrato não deve mais aparecer
      // nesta apuração (nem ativo, nem excluído): ele só existe no mês exato
      // do churn. Se sobrou item de uma geração anterior a esta correção,
      // remove — seja ele um item ainda não excluído, seja um já excluído
      // automaticamente por churn (churn_pipefy_card_id setado). Uma exclusão
      // MANUAL por outro motivo (ex: "Cliente não pagou este mês", sem card de
      // churn) nunca é tocada aqui.
      if (
        itemExistente &&
        !itemExistente.confirmado &&
        (itemExistente.churn_pipefy_card_id != null || !itemExistente.excluido_em)
      ) {
        idsParaExcluirRegeneracao.push(itemExistente.id);
      }
      continue;
    }
    if (itemExistente) {
      if (itemExistente.excluido_em) continue; // excluído do mês manualmente, nunca recalcula
      const novoValorOmie = temOmie ? omieValor : null;
      const valorAtual = itemExistente.valor_omie == null ? null : Number(itemExistente.valor_omie);
      // cnpj do contrato pode ter sido editado depois que este item já existia
      // (ex: botão "Editar CNPJ" na apuração) — sem isso, o item nunca reflete
      // o CNPJ novo mesmo depois de regerado, mesmo quando o valor não muda.
      const cnpjMudou = digits(itemExistente.cnpj) !== (c.cnpj ?? "");
      if (novoValorOmie !== valorAtual || churnInfo || cnpjMudou) {
        atualizacoesValorOmie.push({
          id: itemExistente.id,
          cnpj: c.cnpj,
          valor_omie: novoValorOmie,
          valor_confirmado: novoValorOmie,
          confirmado: false,
          status_match: novoValorOmie == null ? "so_pipedrive" : "matched",
          data_pagamento_omie: dataPagamentoOmie,
          data_competencia_omie: dataCompetenciaOmie,
          ...(churnInfo ?? {}),
          ...camposExclusaoChurn(churnInfo, novoValorOmie != null),
        });
      } else if (
        !arraysIguais(itemExistente.data_pagamento_omie, dataPagamentoOmie) ||
        !arraysIguais(itemExistente.data_competencia_omie, dataCompetenciaOmie)
      ) {
        atualizacoesMetadadosOmie.push({
          id: itemExistente.id,
          data_pagamento_omie: dataPagamentoOmie,
          data_competencia_omie: dataCompetenciaOmie,
        });
      }
      continue;
    }
    if (temOmie) {
      // Recebido no Omie é sempre a referência de valor pra apuração do mês —
      // divergir do MRR contratado (reajuste, upsell, atraso) é normal e não
      // impede o match; não existe mais status "divergente".
      itens.push({
        apuracao_id: apuracao_id,
        cnpj: c.cnpj,
        razao_social: c.titulo,
        contrato_id: c.id,
        categoria: "royalties",
        mrr_contratado: c.mrr,
        valor_omie: omieValor,
        valor_confirmado: omieValor,
        fonte: "pipedrive",
        status_match: "matched",
        confirmado: false,
        data_ganho: c.ganhoEm,
        data_pagamento_omie: dataPagamentoOmie,
        data_competencia_omie: dataCompetenciaOmie,
        ...(churnInfo ?? {}),
      });
    } else {
      itens.push({
        apuracao_id: apuracao_id,
        cnpj: c.cnpj,
        razao_social: c.titulo,
        contrato_id: c.id,
        categoria: "royalties",
        mrr_contratado: c.mrr,
        valor_omie: null,
        valor_confirmado: null,
        fonte: "pipedrive",
        status_match: "so_pipedrive",
        ...(churnInfo ?? {}),
        ...camposExclusaoChurn(churnInfo, false),
        confirmado: false,
        data_ganho: c.ganhoEm,
      });
    }
  }

  // Restantes do Omie → so_omie
  for (const [k, o] of omieMap) {
    const itemSemContrato = itemSemContratoPorCnpj.get(k);
    if (itemSemContrato) {
      if (itemSemContrato.excluido_em) continue; // excluído do mês manualmente, nunca recalcula
      const valorAtual = itemSemContrato.valor_omie == null ? null : Number(itemSemContrato.valor_omie);
      const dataPagamentoOmie = o.pagamentos.size ? Array.from(o.pagamentos).sort() : null;
      const dataCompetenciaOmie = o.competencias.size ? Array.from(o.competencias).sort() : null;
      if (o.valor !== valorAtual) {
        atualizacoesValorOmie.push({
          id: itemSemContrato.id,
          valor_omie: o.valor,
          valor_confirmado: o.valor,
          confirmado: false,
          status_match: "so_omie",
          data_pagamento_omie: dataPagamentoOmie,
          data_competencia_omie: dataCompetenciaOmie,
        });
      } else if (
        !arraysIguais(itemSemContrato.data_pagamento_omie, dataPagamentoOmie) ||
        !arraysIguais(itemSemContrato.data_competencia_omie, dataCompetenciaOmie)
      ) {
        atualizacoesMetadadosOmie.push({
          id: itemSemContrato.id,
          data_pagamento_omie: dataPagamentoOmie,
          data_competencia_omie: dataCompetenciaOmie,
        });
      }
      continue;
    }
    itens.push({
      apuracao_id: apuracao_id,
      cnpj: k,
      razao_social: o.cliente,
      contrato_id: null,
      categoria: usaCscVariavel ? "csc_base_antiga" : "royalties",
      mrr_contratado: null,
      valor_omie: o.valor,
      valor_confirmado: o.valor,
      fonte: "omie",
      status_match: "so_omie",
      confirmado: false,
      data_ganho: cadastroPorCnpj.get(k) ?? null,
      data_pagamento_omie: o.pagamentos.size ? Array.from(o.pagamentos).sort() : null,
      data_competencia_omie: o.competencias.size ? Array.from(o.competencias).sort() : null,
    });
  }

  // Bug corrigido 20/07/2026: um CNPJ "so_omie" que tinha valor numa geração
  // anterior mas ficou sem nenhum título elegível nesta (ex: só tinha um
  // título de categoria "Reembolsos", agora filtrado) nunca aparece em
  // omieMap — o loop acima não o visita, então o item antigo ficava com o
  // valor travado pra sempre. Zera explicitamente quem sumiu do omieMap.
  for (const [k, itemSemContrato] of itemSemContratoPorCnpj) {
    if (omieMap.has(k)) continue; // já tratado no loop acima
    if (itemSemContrato.excluido_em) continue;
    const valorAtual = itemSemContrato.valor_omie == null ? null : Number(itemSemContrato.valor_omie);
    if (valorAtual !== null) {
      atualizacoesValorOmie.push({
        id: itemSemContrato.id,
        valor_omie: null,
        valor_confirmado: null,
        confirmado: false,
        status_match: "so_omie",
        data_pagamento_omie: null,
        data_competencia_omie: null,
      });
    }
  }

  // Remove itens avulsos de contratos "secundários" fundidos num grupo de CNPJ
  // (ver contratosPorCnpjReal acima) — só os não confirmados/sem churn/sem
  // exclusão manual chegam aqui, então é seguro apagar.
  if (idsParaExcluirRegeneracao.length > 0) {
    const { error: fusErr } = await supabase
      .from("royalties_itens")
      .delete()
      .in("id", idsParaExcluirRegeneracao);
    if (fusErr) throw new Error(fusErr.message);
  }

  // Atualiza itens já existentes cujo valor do Omie mudou desde a última geração
  for (const upd of atualizacoesValorOmie) {
    const patch: any = {
      valor_omie: upd.valor_omie,
      valor_confirmado: upd.valor_confirmado,
      confirmado: upd.confirmado,
      status_match: upd.status_match,
    };
    if (upd.cnpj !== undefined) patch.cnpj = upd.cnpj;
    if (upd.churn_pipefy_card_id !== undefined)
      patch.churn_pipefy_card_id = upd.churn_pipefy_card_id;
    if (upd.churn_reportado_em !== undefined) patch.churn_reportado_em = upd.churn_reportado_em;
    if (upd.excluido_em !== undefined) patch.excluido_em = upd.excluido_em;
    if (upd.excluido_por !== undefined) patch.excluido_por = upd.excluido_por;
    if (upd.motivo_exclusao !== undefined) patch.motivo_exclusao = upd.motivo_exclusao;
    if (upd.data_pagamento_omie !== undefined) patch.data_pagamento_omie = upd.data_pagamento_omie;
    if (upd.data_competencia_omie !== undefined) patch.data_competencia_omie = upd.data_competencia_omie;
    const { error: uErr } = await supabase.from("royalties_itens").update(patch).eq("id", upd.id);
    if (uErr) throw new Error(uErr.message);
  }

  // Backfill de data_pagamento_omie/data_competencia_omie sem tocar em
  // confirmado/valor — roda pra itens cujo valor não mudou desde a última
  // geração (senão essas datas nunca apareceriam pra apurações já confirmadas
  // ou com itens estáveis).
  for (const upd of atualizacoesMetadadosOmie) {
    const { error: uErr } = await supabase
      .from("royalties_itens")
      .update({
        data_pagamento_omie: upd.data_pagamento_omie,
        data_competencia_omie: upd.data_competencia_omie,
      })
      .eq("id", upd.id);
    if (uErr) throw new Error(uErr.message);
  }

  if (itens.length === 0) return { created: 0 };

  // Insert em chunks
  const chunkSize = 500;
  let created = 0;
  for (let i = 0; i < itens.length; i += chunkSize) {
    const chunk = itens.slice(i, i + chunkSize);
    const { error } = await supabase.from("royalties_itens").insert(chunk);
    if (error) throw new Error(error.message);
    created += chunk.length;
  }
  return { created };
}

// ============ gerarItensApuracao ============
export const gerarItensApuracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { apuracao_id: number; force?: boolean }) => d)
  .handler(async ({ data, context }): Promise<{ created: number; skipped: boolean }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    if (!data.force) {
      // Skip if items exist
      const { count, error: cErr } = await supabase
        .from("royalties_itens")
        .select("id", { count: "exact", head: true })
        .eq("apuracao_id", data.apuracao_id);
      if (cErr) throw new Error(cErr.message);
      if ((count ?? 0) > 0) return { created: 0, skipped: true };
    }

    const { created } = await gerarItensApuracaoCore(supabase, data.apuracao_id);
    return { created, skipped: false };
  });

// ============ garantirApuracoesAno ============
// Garante uma apuração (rascunho) + itens gerados pra cada unidade regional,
// em cada mês do ano informado que ainda não tem apuração — do mês atual até
// dezembro (meses passados não são tocados, criação não é retroativa). Usado
// pela aba Receitas/DRE Partners pra projetar Royalties automaticamente nos
// meses futuros sem entrada manual — a apuração já reflete contratos ativos e
// churn conhecido em cada mês (ver gerarItensApuracaoCore/churnInfoParaMes).
export const garantirApuracoesAno = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ano: number }) => d)
  .handler(async ({ data, context }): Promise<{ criadas: number }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    if (data.ano < anoAtual) return { criadas: 0 };
    const mesInicio = data.ano === anoAtual ? hoje.getMonth() + 1 : 1;

    const { data: unidades, error: uErr } = await supabase
      .from("unidades")
      .select("id,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga")
      .eq("tipo", "regional");
    if (uErr) throw new Error(uErr.message);

    let criadas = 0;
    for (const u of unidades ?? []) {
      for (let mes = mesInicio; mes <= 12; mes++) {
        const firstDay = `${data.ano}-${String(mes).padStart(2, "0")}-01`;
        const { data: existing, error: e1 } = await supabase
          .from("royalties_apuracao")
          .select("id")
          .eq("unidade_id", u.id)
          .eq("mes_referencia", firstDay)
          .maybeSingle();
        if (e1) throw new Error(e1.message);
        if (existing) continue;

        const { data: inserted, error: iErr } = await supabase
          .from("royalties_apuracao")
          .insert({
            unidade_id: u.id,
            mes_referencia: firstDay,
            status: "rascunho",
            royalties_percentual: u.royalties_percentual,
            csc_valor_fixo: u.csc_valor_fixo,
            csc_percentual_base_antiga: u.csc_percentual_base_antiga,
          })
          .select("id")
          .single();
        if (iErr) throw new Error(iErr.message);

        await gerarItensApuracaoCore(supabase, inserted.id);
        criadas++;
      }
    }

    return { criadas };
  });

// ============ getApuracao ============
export const getApuracao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { apuracao_id: number }) => d)
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      apuracao: ApuracaoFull;
      itens: ApuracaoItem[];
      outrasReceitasItens: OutraReceitaItem[];
    }> => {
      const { supabase, userId } = context;
      await assertAdmin(supabase, userId);

      const { data: ap, error: apErr } = await supabase
        .from("royalties_apuracao")
        .select(
          "id,unidade_id,mes_referencia,status,receita_base,royalties_percentual,royalties_valor,csc_valor_fixo,receita_base_antiga,csc_percentual_base_antiga,csc_base_antiga_valor,cac_valor,csc_trafego_pago,outras_receitas,total_fatura,confirmado_em,confirmado_por,observacao,unidade:unidades!inner(id,nome_da_praca,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,observacoes_financeiras)",
        )
        .eq("id", data.apuracao_id)
        .single();
      if (apErr) throw new Error(apErr.message);

      // tem_omie: existe pelo menos 1 recebimento histórico p/ unidade
      const { count: omieCount } = await supabase
        .from("contas_receber")
        .select("id", { count: "exact", head: true })
        .eq("unidade", ap.unidade.nome_da_praca)
        .limit(1);

      const { data: itens, error: iErr } = await supabase
        .from("royalties_itens")
        .select("*")
        .eq("apuracao_id", data.apuracao_id)
        .order("razao_social");
      if (iErr) throw new Error(iErr.message);

      // Conta filiais vinculadas por contrato
      const contratoIds = Array.from(
        new Set((itens ?? []).map((i: any) => i.contrato_id).filter((x: any) => x != null)),
      );
      const countByContrato = new Map<number, number>();
      if (contratoIds.length > 0) {
        const { data: grupos } = await supabase
          .from("contrato_omie_grupos")
          .select("contrato_id")
          .in("contrato_id", contratoIds as number[]);
        for (const g of grupos ?? []) {
          countByContrato.set(g.contrato_id, (countByContrato.get(g.contrato_id) ?? 0) + 1);
        }
      }
      const itensComFiliais = (itens ?? []).map((i: any) => ({
        ...i,
        filiais_count: i.contrato_id ? (countByContrato.get(i.contrato_id) ?? 0) : 0,
      }));

      const { data: outrasReceitasItens, error: orErr } = await supabase
        .from("royalties_outras_receitas_itens")
        .select("id,apuracao_id,nome,valor,observacao")
        .eq("apuracao_id", data.apuracao_id)
        .order("id");
      if (orErr) throw new Error(orErr.message);

      return {
        apuracao: {
          ...(ap as any),
          unidade: { ...(ap as any).unidade, tem_omie: (omieCount ?? 0) > 0 },
        },
        itens: itensComFiliais as ApuracaoItem[],
        outrasReceitasItens: (outrasReceitasItens ?? []) as OutraReceitaItem[],
      };
    },
  );

// ============ updateItem ============
export const updateItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: number;
      valor_confirmado?: number | null;
      confirmado?: boolean;
      observacao?: string | null;
      royalties_percentual_override?: number | null;
      mrr_override?: number | null;
      is_cac?: boolean;
      categoria?: "royalties" | "csc_base_antiga";
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    // Bloqueia se apuração fechada
    const { data: item, error: e1 } = await supabase
      .from("royalties_itens")
      .select("apuracao_id, contrato_id, apuracao:royalties_apuracao!inner(status)")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    const status = (item as any).apuracao.status;
    if (status === "confirmado" || status === "faturado") {
      throw new Error("Apuração fechada — reabra antes de editar.");
    }
    if ("categoria" in data && item.contrato_id != null) {
      // A troca de categoria (royalties ↔ csc_base_antiga) só existe pra migrar
      // clientes "só Omie" sem contrato ativo no Pipedrive entre os dois regimes
      // de cobrança — itens com contrato vinculado já têm categoria "royalties"
      // definida pela geração automática e não devem ser recategorizados.
      throw new Error("Só é possível trocar a categoria de itens sem contrato vinculado.");
    }

    const patch: any = {};
    if ("valor_confirmado" in data) patch.valor_confirmado = data.valor_confirmado;
    if ("confirmado" in data) patch.confirmado = data.confirmado;
    if ("observacao" in data) patch.observacao = data.observacao;
    if ("royalties_percentual_override" in data)
      patch.royalties_percentual_override = data.royalties_percentual_override;
    if ("mrr_override" in data) patch.mrr_override = data.mrr_override;
    if ("is_cac" in data) patch.is_cac = data.is_cac;
    if ("categoria" in data) patch.categoria = data.categoria;

    const { error } = await supabase.from("royalties_itens").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ atualizarCnpjContrato ============
// Preenche/corrige o CNPJ de um contrato direto na tela de apuração (item "Só
// no Pipedrive" sem CNPJ cadastrado). O CNPJ é o campo que gerarItensApuracao
// usa pra cruzar com contas_receber — sem ele o contrato nunca casa com o Omie.
export const atualizarCnpjContrato = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { contrato_id: number; cnpj: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const cnpj = digits(data.cnpj);
    if (cnpj.length !== 14) throw new Error("CNPJ inválido — precisa ter 14 dígitos.");

    const { error } = await supabase.from("contratos").update({ cnpj }).eq("id", data.contrato_id);
    if (error) throw new Error(error.message);
    return { ok: true, cnpj };
  });

// ============ marcarChurn ============
// Cria um card no pipe Pipefy "Tratativas" (307196408) já na fase "Perdido"
// (343394578), com motivo e data preenchidos. O card sincroniza de volta pra
// central_tratativas via sync_pipefy_tratativas.py (roda a cada 15min).
export const PIPEFY_PIPE_TRATATIVAS = "307196408";
export const PIPEFY_FASE_PERDIDO = "343394578";

// Opções fechadas do campo select "Categoria do Churn" (field_id
// categoria_do_churn) criado na fase Perdido do pipe Tratativas — precisa
// ficar em sincronia com as `options` desse campo no Pipefy.
export const MOTIVOS_CHURN = [
  "Inadimplência",
  "Insatisfação com o serviço",
  "Encerramento das atividades",
  "Trocou de fornecedor/concorrente",
  "Motivo financeiro do cliente",
  "Outro",
] as const;
export type MotivoChurn = (typeof MOTIVOS_CHURN)[number];

export const marcarChurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number; motivo: string; observacao?: string; data_churn: string }) => d)
  .handler(async ({ data, context }): Promise<{ ok: true; pipefy_card_id: string }> => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    if (!MOTIVOS_CHURN.includes(data.motivo as MotivoChurn)) {
      throw new Error("Selecione um motivo de churn válido.");
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.data_churn)) throw new Error("Data do churn inválida.");

    const { data: item, error: iErr } = await supabase
      .from("royalties_itens")
      .select(
        "id,razao_social,mrr_contratado,contrato_id,churn_pipefy_card_id,apuracao:royalties_apuracao!inner(status,unidade:unidades!inner(nome_da_praca)),contrato:contratos(pipedrive_deal_id)",
      )
      .eq("id", data.item_id)
      .single();
    if (iErr) throw new Error(iErr.message);

    const status = (item as any).apuracao.status;
    if (status === "confirmado" || status === "faturado") {
      throw new Error("Apuração fechada — reabra antes de marcar churn.");
    }
    if (!item.contrato_id)
      throw new Error("Só é possível marcar churn em itens com contrato vinculado.");
    if (item.churn_pipefy_card_id) throw new Error("Este cliente já tem churn registrado.");

    const pipefyToken = process.env.PIPEFY_TOKEN;
    if (!pipefyToken) throw new Error("PIPEFY_TOKEN não configurado no servidor.");

    const unidadeNome: string = (item as any).apuracao.unidade.nome_da_praca;
    const pipedriveDealId: string | number | null =
      (item as any).contrato?.pipedrive_deal_id ?? null;

    const mutation = `
      mutation($fields: [FieldValueInput!]) {
        createCard(input: {
          pipe_id: "${PIPEFY_PIPE_TRATATIVAS}"
          phase_id: "${PIPEFY_FASE_PERDIDO}"
          title: ${JSON.stringify(item.razao_social ?? "—")}
          fields_attributes: $fields
        }) { card { id } }
      }
    `;
    const fields = [
      { field_id: "unidade_de_neg_cio", field_value: [unidadeNome] },
      { field_id: "mrr_r", field_value: [String(item.mrr_contratado ?? 0)] },
      { field_id: "categoria_do_churn", field_value: [data.motivo] },
      { field_id: "data_do_churn", field_value: [data.data_churn] },
    ];
    if (data.observacao?.trim()) {
      fields.push({ field_id: "motivo_do_churn", field_value: [data.observacao.trim()] });
    }
    // Link de volta pro deal do Pipedrive — é o que clientes.tsx usa pra cruzar
    // central_tratativas.pipedrive_deal_id com empresas.pipedrive_id e mostrar o
    // badge de churn. Sem isso o card fica órfão (Tratativas mostra, Clientes não).
    if (pipedriveDealId != null) {
      fields.push({ field_id: "id_deal_pipedrive", field_value: [String(pipedriveDealId)] });
    }
    const variables = { fields };

    const resp = await fetch("https://api.pipefy.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${pipefyToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: mutation, variables }),
    });
    const body = await resp.json();
    if (body.errors) throw new Error(`Pipefy: ${body.errors[0]?.message ?? "erro desconhecido"}`);
    const cardId: string = body.data.createCard.card.id;

    const churnReportadoEm = new Date().toISOString();
    const { error: uErr } = await supabase
      .from("royalties_itens")
      .update({ churn_pipefy_card_id: cardId, churn_reportado_em: churnReportadoEm })
      .eq("id", data.item_id);
    if (uErr) throw new Error(uErr.message);

    // Propaga o churn pros itens do mesmo contrato em OUTRAS apurações (meses).
    // royalties_itens é gerado por apuração (uma linha por mês) — sem isso, marcar
    // churn só valeria pro mês em que o botão foi clicado, e o cliente continuaria
    // aparecendo pra apurar normalmente nos demais meses (inclusive meses passados
    // anteriores ao clique, mas posteriores à data do churn escolhida).
    const churnMonthStart = `${data.data_churn.slice(0, 7)}-01`;
    const { data: siblings, error: sErr } = await supabase
      .from("royalties_itens")
      .select("id, apuracao:royalties_apuracao!inner(status,mes_referencia)")
      .eq("contrato_id", item.contrato_id)
      .is("churn_pipefy_card_id", null)
      .neq("id", data.item_id);
    if (sErr) throw new Error(sErr.message);
    const idsParaPropagar = (siblings ?? [])
      .filter((s: any) => {
        const ap = s.apuracao;
        if (ap.status === "confirmado" || ap.status === "faturado") return false;
        return String(ap.mes_referencia) >= churnMonthStart;
      })
      .map((s: any) => s.id);
    if (idsParaPropagar.length > 0) {
      const { error: propErr } = await supabase
        .from("royalties_itens")
        .update({ churn_pipefy_card_id: cardId, churn_reportado_em: churnReportadoEm })
        .in("id", idsParaPropagar);
      if (propErr) throw new Error(propErr.message);
    }

    return { ok: true, pipefy_card_id: cardId };
  });

// ============ addItemManual ============
export const addItemManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      apuracao_id: number;
      razao_social: string;
      cnpj?: string | null;
      valor_confirmado?: number | null;
      observacao?: string | null;
      categoria?: "royalties" | "csc_base_antiga";
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { error } = await supabase.from("royalties_itens").insert({
      apuracao_id: data.apuracao_id,
      razao_social: data.razao_social,
      cnpj: data.cnpj ? digits(data.cnpj) : null,
      valor_confirmado: data.valor_confirmado ?? null,
      observacao: data.observacao ?? null,
      categoria: data.categoria ?? "royalties",
      fonte: "manual",
      status_match: "manual",
      confirmado: false,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ updateApuracao ============
export const updateApuracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: number;
      csc_trafego_pago?: number | null;
      outras_receitas?: number | null;
      observacao?: string | null;
      status?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const patch: any = {};
    if ("csc_trafego_pago" in data) patch.csc_trafego_pago = data.csc_trafego_pago;
    if ("outras_receitas" in data) patch.outras_receitas = data.outras_receitas;
    if ("observacao" in data) patch.observacao = data.observacao;
    if ("status" in data) patch.status = data.status;
    const { error } = await supabase.from("royalties_apuracao").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ royalties_outras_receitas_itens ============
// "Outras receitas" era um valor único digitado à mão; agora é a soma de itens
// nomeados por software/serviço (ex: Qulture.rocks, Pipedrive, Panda Pé — cada
// unidade usa um conjunto diferente). royalties_apuracao.outras_receitas
// continua sendo o total denormalizado — recalculado aqui a cada mutação —
// pra não precisar mudar confirmarApuracao, o PDF nem o resumo já existentes.
async function recomputeOutrasReceitas(supabase: any, apuracao_id: number) {
  const { data: itens, error } = await supabase
    .from("royalties_outras_receitas_itens")
    .select("valor")
    .eq("apuracao_id", apuracao_id);
  if (error) throw new Error(error.message);
  const total = (itens ?? []).reduce((soma: number, it: any) => soma + Number(it.valor ?? 0), 0);
  const { error: uErr } = await supabase
    .from("royalties_apuracao")
    .update({ outras_receitas: total })
    .eq("id", apuracao_id);
  if (uErr) throw new Error(uErr.message);
  return total;
}

async function assertApuracaoAberta(supabase: any, apuracao_id: number) {
  const { data: ap, error } = await supabase
    .from("royalties_apuracao")
    .select("status")
    .eq("id", apuracao_id)
    .single();
  if (error) throw new Error(error.message);
  if (ap.status === "confirmado" || ap.status === "faturado") {
    throw new Error("Apuração fechada — reabra antes de editar outras receitas.");
  }
}

export const addOutraReceitaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { apuracao_id: number; nome: string; valor: number; observacao?: string | null }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    await assertApuracaoAberta(supabase, data.apuracao_id);
    if (!data.nome.trim()) throw new Error("Nome do item é obrigatório.");
    const { error } = await supabase.from("royalties_outras_receitas_itens").insert({
      apuracao_id: data.apuracao_id,
      nome: data.nome.trim(),
      valor: data.valor,
      observacao: data.observacao ?? null,
    });
    if (error) throw new Error(error.message);
    await recomputeOutrasReceitas(supabase, data.apuracao_id);
    return { ok: true };
  });

export const updateOutraReceitaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { id: number; nome?: string; valor?: number; observacao?: string | null }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: item, error: e1 } = await supabase
      .from("royalties_outras_receitas_itens")
      .select("apuracao_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    await assertApuracaoAberta(supabase, item.apuracao_id);
    const patch: any = {};
    if ("nome" in data) patch.nome = data.nome?.trim();
    if ("valor" in data) patch.valor = data.valor;
    if ("observacao" in data) patch.observacao = data.observacao;
    const { error } = await supabase
      .from("royalties_outras_receitas_itens")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recomputeOutrasReceitas(supabase, item.apuracao_id);
    return { ok: true };
  });

export const deleteOutraReceitaItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: item, error: e1 } = await supabase
      .from("royalties_outras_receitas_itens")
      .select("apuracao_id")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    await assertApuracaoAberta(supabase, item.apuracao_id);
    const { error } = await supabase
      .from("royalties_outras_receitas_itens")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await recomputeOutrasReceitas(supabase, item.apuracao_id);
    return { ok: true };
  });

// ============ fecharApuracao ============
export const fecharApuracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);

    const { data: ap, error: apErr } = await supabase
      .from("royalties_apuracao")
      .select(
        "id,status,royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga,outras_receitas,csc_trafego_pago",
      )
      .eq("id", data.id)
      .single();
    if (apErr) throw new Error(apErr.message);
    if (ap.status === "confirmado" || ap.status === "faturado") {
      throw new Error("Apuração já está fechada.");
    }

    const { data: itens, error: iErr } = await supabase
      .from("royalties_itens")
      .select("categoria,valor_confirmado,royalties_percentual_override,confirmado,is_cac")
      .eq("apuracao_id", data.id)
      .is("excluido_em", null);
    if (iErr) throw new Error(iErr.message);

    const confirmados = (itens ?? []).filter((x: any) => x.confirmado);
    if (confirmados.length === 0) throw new Error("Confirme ao menos 1 item antes de fechar.");

    const pctPadrao = Number(ap.royalties_percentual ?? 0);
    let receitaBase = 0;
    let royalties = 0;
    let cacValor = 0;
    let receitaBaseAntiga = 0;
    for (const it of confirmados as any[]) {
      const v = Number(it.valor_confirmado ?? 0);
      if (it.categoria === "royalties") {
        receitaBase += v;
        const pct =
          it.royalties_percentual_override != null
            ? Number(it.royalties_percentual_override)
            : pctPadrao;
        const computado = (v * pct) / 100;
        if (it.is_cac) cacValor += computado;
        else royalties += computado;
      } else if (it.categoria === "csc_base_antiga") {
        receitaBaseAntiga += v;
      }
    }
    const cscPctBaseAntiga = Number(ap.csc_percentual_base_antiga ?? 0);
    const cscBaseAntigaValor = (receitaBaseAntiga * cscPctBaseAntiga) / 100;
    const cscFixo = ap.csc_valor_fixo != null ? Number(ap.csc_valor_fixo) : null;
    const cscEfetivo = cscFixo ?? (ap.csc_percentual_base_antiga != null ? cscBaseAntigaValor : 0);
    const outras = Number(ap.outras_receitas ?? 0);
    const trafegoPago = Number(ap.csc_trafego_pago ?? 0);
    const total = cscEfetivo + royalties + cacValor + outras + trafegoPago;

    // Atualizar royalties_item por item (em paralelo para evitar estado parcial)
    const { data: itensFull, error: itensFullErr } = await supabase
      .from("royalties_itens")
      .select("id,categoria,valor_confirmado,royalties_percentual_override,confirmado")
      .eq("apuracao_id", data.id)
      .is("excluido_em", null);
    if (itensFullErr) throw new Error(itensFullErr.message);

    const updates = (itensFull ?? [])
      .filter((it: any) => it.categoria === "royalties")
      .map((it: any) => {
        const v = Number(it.valor_confirmado ?? 0);
        const pct =
          it.royalties_percentual_override != null
            ? Number(it.royalties_percentual_override)
            : pctPadrao;
        const rv = it.confirmado ? (v * pct) / 100 : 0;
        return supabase.from("royalties_itens").update({ royalties_item: rv }).eq("id", it.id);
      });
    const results = await Promise.all(updates);
    const failed = results.find((r: any) => r?.error);
    if (failed?.error) throw new Error(`Falha ao atualizar itens: ${failed.error.message}`);

    const email = (claims as any)?.email ?? null;
    const { error: uErr } = await supabase
      .from("royalties_apuracao")
      .update({
        status: "confirmado",
        receita_base: receitaBase,
        royalties_valor: royalties,
        cac_valor: cacValor,
        receita_base_antiga: receitaBaseAntiga,
        csc_base_antiga_valor: ap.csc_percentual_base_antiga != null ? cscBaseAntigaValor : null,
        total_fatura: total,
        confirmado_em: new Date().toISOString(),
        confirmado_por: email ?? userId,
      })
      .eq("id", data.id);
    if (uErr) throw new Error(uErr.message);
    return { ok: true };
  });

// ============ reabrirApuracao ============
export const reabrirApuracao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { error } = await supabase
      .from("royalties_apuracao")
      .update({ status: "em_revisao", confirmado_em: null, confirmado_por: null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ deleteItem ============
export const deleteItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const { data: item, error: e1 } = await supabase
      .from("royalties_itens")
      .select("apuracao:royalties_apuracao!inner(status)")
      .eq("id", data.id)
      .single();
    if (e1) throw new Error(e1.message);
    const status = (item as any).apuracao.status;
    if (status === "confirmado" || status === "faturado") {
      throw new Error("Apuração fechada — reabra antes de excluir.");
    }
    const { error } = await supabase.from("royalties_itens").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ excluirItemMes ============
// Soft-delete escopado a este item/mês (ex: cliente não recebeu este mês).
// Diferente de marcarChurn: não cria card no Pipefy nem propaga para outros
// meses — royalties_itens é gerado por apuração, então o cliente volta a
// aparecer normalmente no mês seguinte se voltar a pagar.
export const MOTIVOS_EXCLUSAO_ROYALTIES = [
  "Cliente não pagou este mês",
  "Este é CAC",
  "Pagamento incoerente, não é um cliente",
  "Contrato ainda não assinou",
] as const;
export type MotivoExclusaoRoyalties = (typeof MOTIVOS_EXCLUSAO_ROYALTIES)[number];

export const excluirItemMes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number; motivo: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId, claims } = context;
    await assertAdmin(supabase, userId);

    if (!MOTIVOS_EXCLUSAO_ROYALTIES.includes(data.motivo as MotivoExclusaoRoyalties)) {
      throw new Error("Motivo da exclusão inválido.");
    }

    const { data: item, error: e1 } = await supabase
      .from("royalties_itens")
      .select("apuracao:royalties_apuracao!inner(status)")
      .eq("id", data.item_id)
      .single();
    if (e1) throw new Error(e1.message);
    const status = (item as any).apuracao.status;
    if (status === "confirmado" || status === "faturado") {
      throw new Error("Apuração fechada — reabra antes de excluir.");
    }

    const email = (claims as any)?.email ?? null;
    const { error } = await supabase
      .from("royalties_itens")
      .update({
        excluido_em: new Date().toISOString(),
        excluido_por: email ?? userId,
        motivo_exclusao: data.motivo.trim(),
        confirmado: false,
      })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ reincluirItemMes ============
export const reincluirItemMes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const { data: item, error: e1 } = await supabase
      .from("royalties_itens")
      .select("apuracao:royalties_apuracao!inner(status)")
      .eq("id", data.item_id)
      .single();
    if (e1) throw new Error(e1.message);
    const status = (item as any).apuracao.status;
    if (status === "confirmado" || status === "faturado") {
      throw new Error("Apuração fechada — reabra antes de reincluir.");
    }

    const { error } = await supabase
      .from("royalties_itens")
      .update({ excluido_em: null, excluido_por: null, motivo_exclusao: null })
      .eq("id", data.item_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
