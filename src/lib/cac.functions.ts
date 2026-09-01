import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin, digits, monthRange } from "@/lib/server-utils";
import { gerarItensApuracaoCore } from "@/lib/royalties.functions";
import { assertAffected } from "@/lib/supabase-assert";

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
  valor_pago_parcela_1: number | null;
  status_parcela_1: string;

  data_recebimento_cliente: string | null;
  prazo_parcela_2: string | null;
  data_envio_parcela_2: string | null;
  data_pagamento_parcela_2: string | null;
  valor_pago_parcela_2: number | null;
  estimativa_parcela_2: string | null;
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
  // Gate de "disponível pra cobrar" (achado 21/08/2026: venda ganha !=
  // contrato assinado; a apuração gera o item já no mês da venda). A fonte é o
  // card do cliente no pipe Pipefy "[PTRS-CLI-03] Central de Contratos"
  // (307285170): só conta como assinado quem está na fase "Contrato Assinado"
  // ou posterior. Decisão do usuário em 24/08/2026 — antes o gate era
  // contratos.entrada_contrato_assinado_em, a entrada do deal-cópia no stage
  // 170 do Pipedrive (pipeline 28), que o pipe do Pipefy substituiu em
  // 03/08/2026 e que por isso ia parar de chegar pras vendas novas.
  // Itens sem contrato_id (adicionados manualmente) não passam por esse gate.
  contrato_assinado: boolean;
  // Data de assinatura registrada no card, quando preenchida — o gate não
  // depende dela (card pode estar em "Contrato Assinado" com o campo vazio).
  contrato_assinado_em: string | null;
  // Fase atual do card, pra mostrar onde o contrato está parado. null = o
  // cliente não tem card no pipe.
  fase_contrato_pipefy: string | null;
}

// Fases do pipe 307285170 que valem como "contrato assinado".
const FASES_CONTRATO_ASSINADO = new Set(["Contrato Assinado", "Vigente", "Encerrado"]);

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

// ============ Regras de CAC por unidade (definidas com o usuário em 27/07/2026) ============
// - Fortaleza, Maceió, São Luis: regra "atribuição" — 50% no mês em que o
//   contrato foi ganho, 50% no fluxo de caixa do 1º pagamento do cliente.
// - Campo Novo: fica na regra antiga (7 dias após assinatura) até acumular
//   R$50 mil de MRR atribuído histórico; o contrato que cruzar esse total
//   (e os seguintes) passam a entrar na regra "atribuição" — não retroage
//   pros contratos anteriores.
// - Patos de Minas: regra "excedente mensal" — só gera CAC sobre a parcela
//   do MRR atribuído da unidade no mês que ultrapassar R$10 mil; sem
//   parcela 1 (tudo reconhecido no fluxo de caixa do 1º pagamento). Unidade
//   antiga (entrou em 08/24) — a regra não é retroativa, vale só a partir de
//   agosto/2026, nunca pros ~2 anos de contratos anteriores.
type RegimeCac = "atribuicao" | "sete_dias" | "excedente_mensal";

const UNIDADES_REGIME_ATRIBUICAO = new Set(["Fortaleza", "Maceió", "São Luis"]);
const CAMPO_NOVO_LIMITE_MRR_ATRIBUIDO = 50_000;
const PATOS_DE_MINAS_LIMITE_MENSAL = 10_000;
const PATOS_DE_MINAS_INICIO_CAC = "2026-08"; // AAAA-MM: contratos ganhos antes disso não entram

function regimeParaUnidade(unidadeNome: string): RegimeCac | "campo_novo" {
  if (unidadeNome === "Patos de Minas") return "excedente_mensal";
  if (UNIDADES_REGIME_ATRIBUICAO.has(unidadeNome)) return "atribuicao";
  if (unidadeNome === "Campo Novo") return "campo_novo";
  return "sete_dias";
}

// Mês (AAAA-MM) a partir do qual a unidade passou a ter CAC — contratos
// ganhos antes disso não geram apuração nenhuma. null = sem corte (unidade
// nova, todo o histórico dela já nasceu depois do CAC existir).
function mesMinimoCac(unidadeNome: string): string | null {
  if (unidadeNome === "Patos de Minas") return PATOS_DE_MINAS_INICIO_CAC;
  return null;
}

// Decide o regime de cada contrato da Campo Novo pelo MRR atribuído
// acumulado da unidade (histórico completo, em ordem de fechamento) — só
// migra pra regra de atribuição quem cruzar os R$50 mil pra frente.
async function regimesCampoNovoPorContrato(supabase: any): Promise<Map<number, RegimeCac>> {
  const { data: contratos, error } = await supabase
    .from("contratos")
    .select("id,mrr_mensal,ganho_em")
    .eq("unidade", "Campo Novo")
    .eq("tipo_unidade", "franquia")
    .eq("status_contrato", "Ativo")
    .not("ganho_em", "is", null)
    .order("ganho_em", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);

  const regimes = new Map<number, RegimeCac>();
  let acumulado = 0;
  for (const c of (contratos ?? []) as any[]) {
    acumulado += Number(c.mrr_mensal ?? 0);
    regimes.set(c.id, acumulado >= CAMPO_NOVO_LIMITE_MRR_ATRIBUIDO ? "atribuicao" : "sete_dias");
  }
  return regimes;
}

// Excedente mensal de Patos de Minas: soma o MRR atribuído dos contratos do
// mês em ordem de fechamento; só a parte que ultrapassa R$10 mil no
// acumulado do mês vira base de CAC — cada contrato carrega só a fatia dele
// que caiu acima da linha (contrato que sozinho já passa de R$10 mil banca
// o excedente inteiro; contratos anteriores a ele no mês não geram nada).
function excedentesMensais(
  contratosDoMes: { id: number; mrr_mensal: number }[],
  limite: number,
): Map<number, number> {
  let acumulado = 0;
  const excedentes = new Map<number, number>();
  for (const c of contratosDoMes) {
    const antes = acumulado;
    acumulado += Number(c.mrr_mensal ?? 0);
    excedentes.set(c.id, Math.max(0, acumulado - limite) - Math.max(0, antes - limite));
  }
  return excedentes;
}

// ============ gerarItensParaApuracao (helper reaproveitado) ============
// CAC é sempre editável (não existe mais fechamento mensal) — esta função só
// cria/atualiza itens, nunca bloqueia por status da apuração.
async function gerarItensParaApuracao(
  supabase: any,
  apuracao_id: number,
  force: boolean,
  regimesCampoNovo: Map<number, RegimeCac> | null,
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

  // Defesa extra: mesmo que uma apuração de mês anterior ao início do CAC da
  // unidade já exista (ex: registro remanescente de antes desse corte), nunca
  // gera item pra ela.
  const minimo = mesMinimoCac(unidadeNome);
  if (minimo && mes < minimo) return { created: 0, skipped: true };

  // Itens já existentes nesta apuração nunca ganham um irmão duplicado —
  // mesma lógica de idempotência de gerarItensApuracao (royalties).
  const { data: itensExistentes, error: ieErr } = await (supabase as any)
    .from("cac_apuracao_itens")
    .select(
      "id,contrato_id,data_recebimento_cliente,data_pagamento_parcela_1,data_pagamento_parcela_2,excluido_em,valor_cac_total,data_envio_parcela_1,valor_pago_parcela_1,data_envio_parcela_2,valor_pago_parcela_2",
    )
    .eq("apuracao_id", apuracao_id);
  if (ieErr) throw new Error(ieErr.message);
  const itemPorContrato = new Map<number, any>(
    (itensExistentes ?? [])
      .filter((i: any) => i.contrato_id != null)
      .map((i: any) => [i.contrato_id as number, i]),
  );

  // Contratos GANHOS neste mês (CAC nasce só no mês de aquisição do cliente —
  // diferente de royalties, que é recorrente todo mês). Ordenado por data de
  // fechamento — necessário pro cálculo do excedente mensal de Patos de Minas.
  const { data: contratos, error: kErr } = await supabase
    .from("contratos")
    .select("id,cnpj,titulo,mrr_mensal,ganho_em")
    .eq("unidade", unidadeNome)
    .eq("tipo_unidade", "franquia")
    .eq("status_contrato", "Ativo")
    .gte("ganho_em", start)
    .lte("ganho_em", end)
    .order("ganho_em", { ascending: true })
    .order("id", { ascending: true });
  if (kErr) throw new Error(kErr.message);

  const regimeUnidade = regimeParaUnidade(unidadeNome);
  const excedentes =
    regimeUnidade === "excedente_mensal"
      ? excedentesMensais(
          (contratos ?? []).map((c: any) => ({ id: c.id, mrr_mensal: c.mrr_mensal })),
          PATOS_DE_MINAS_LIMITE_MENSAL,
        )
      : null;

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
    const dataAssinatura = c.ganho_em ?? null;
    const dataRecebimento = cnpjDigits
      ? (primeiroRecebimentoPorCnpj.get(cnpjDigits) ?? null)
      : null;
    const prazo2 = dataRecebimento ? prazoParcela2(dataRecebimento) : null;
    const statusMatch = !cnpjDigits ? "sem_cnpj" : "matched";

    const regime: RegimeCac =
      regimeUnidade === "campo_novo" ? (regimesCampoNovo?.get(c.id) ?? "sete_dias") : regimeUnidade;

    let valorTotal: number;
    let valorParcela1: number;
    let prazo1: string | null;
    let dataPagamentoParcela1: string | null = null;

    if (regime === "excedente_mensal") {
      valorTotal = excedentes?.get(c.id) ?? 0;
      valorParcela1 = 0;
      prazo1 = null;
      dataPagamentoParcela1 = dataAssinatura; // sem 1ª parcela nessa regra, nada a cobrar aqui
    } else {
      valorTotal = Number(c.mrr_mensal ?? 0);
      valorParcela1 = valorTotal / 2;
      prazo1 = dataAssinatura
        ? regime === "atribuicao"
          ? endOfMonthISO(dataAssinatura)
          : addDaysISO(dataAssinatura, 7)
        : null;
    }
    const valorParcela2 = valorTotal - valorParcela1;

    if (existente) {
      if (existente.excluido_em) continue; // excluído manualmente, nunca recalcula
      const patch: Record<string, unknown> = {};

      // Só re-sincroniza o dado que pode ter mudado desde a última geração
      // (chegada do 1º recebimento) — nunca sobrescreve pagamentos manuais.
      if ((existente.data_recebimento_cliente ?? null) !== dataRecebimento) {
        patch.data_recebimento_cliente = dataRecebimento;
        patch.prazo_parcela_2 = prazo2;
        patch.status_match = statusMatch;
      }

      // Re-sincroniza o valor do CAC com o mrr_mensal atual do contrato — só
      // quando nada foi cobrado/pago ainda em nenhuma das parcelas. Sem essa
      // guarda o valor fica congelado pra sempre no que foi calculado na
      // criação do item, mesmo que o contrato seja corrigido depois (achado
      // real: "Alfa Peças" congelado em R$479,17 com mrr_mensal já em
      // R$1.479,17 no contrato — nunca resincronizava).
      const nadaMovimentadoAinda =
        !existente.data_envio_parcela_1 &&
        !existente.data_pagamento_parcela_1 &&
        existente.valor_pago_parcela_1 == null &&
        !existente.data_envio_parcela_2 &&
        !existente.data_pagamento_parcela_2 &&
        existente.valor_pago_parcela_2 == null;
      if (
        nadaMovimentadoAinda &&
        Math.abs(Number(existente.valor_cac_total ?? 0) - valorTotal) > 0.01
      ) {
        patch.valor_cac_total = valorTotal;
        patch.valor_parcela_1 = valorParcela1;
        patch.valor_parcela_2 = valorParcela2;
      }

      if (Object.keys(patch).length > 0) {
        atualizacoes.push({ id: existente.id, patch });
      }
      continue;
    }

    if (regime === "excedente_mensal" && valorTotal <= 0) continue; // dentro da franquia mensal de R$10 mil, não gera CAC

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
      data_pagamento_parcela_1: dataPagamentoParcela1,
      status_parcela_1: statusParcela1(prazo1, null, dataPagamentoParcela1, hoje),
      data_recebimento_cliente: dataRecebimento,
      prazo_parcela_2: prazo2,
      status_parcela_2: statusParcela2(dataRecebimento, prazo2, null, null, hoje),
      fonte: "pipedrive",
      status_match: statusMatch,
    });
  }

  for (const upd of atualizacoes) {
    const result = await (supabase as any)
      .from("cac_apuracao_itens")
      .update(upd.patch)
      .eq("id", upd.id)
      .select("id");
    assertAffected(result, `Item de CAC ${upd.id} não foi atualizado — possível bloqueio de permissão (RLS).`);
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
// contrato_assinado_em é anexado depois, numa passada única sobre todas as
// unidades (listCacItensTodasUnidades) — mais barato que consultar contratos
// unidade por unidade aqui.
type ApuracaoCacItemSemAssinatura = Omit<
  ApuracaoCacItemComUnidade,
  "contrato_assinado" | "contrato_assinado_em" | "fase_contrato_pipefy"
>;

async function syncApuracoesEItensUnidade(
  supabase: any,
  unidade: CacUnidade,
  force: boolean,
): Promise<ApuracaoCacItemSemAssinatura[]> {
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

  const minimo = mesMinimoCac(unidade.nome_da_praca);
  const mesesNecessarios = new Set<string>([mesAtual]);
  for (const c of contratos ?? []) {
    const mes = String((c as any).ganho_em).slice(0, 7);
    if (minimo && mes < minimo) continue;
    mesesNecessarios.add(mes);
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

  const regimesCampoNovo =
    unidade.nome_da_praca === "Campo Novo" ? await regimesCampoNovoPorContrato(supabase) : null;
  for (const ap of apuracoes ?? []) {
    await gerarItensParaApuracao(supabase, (ap as any).id, force, regimesCampoNovo);
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

      const itensSemAssinatura: ApuracaoCacItemSemAssinatura[] = [];
      for (const u of unidades as CacUnidade[]) {
        const its = await syncApuracoesEItensUnidade(supabase, u, !!data.force);
        itensSemAssinatura.push(...its);
      }

      // Gate de contrato assinado: card do cliente no pipe Pipefy de contratos,
      // casado pelo deal do Pipedrive (contratos.pipedrive_deal_id ->
      // contratos_documentos.pipedrive_deal_id). Ver ApuracaoCacItemComUnidade.
      const contratoIds = [
        ...new Set(itensSemAssinatura.map((i) => i.contrato_id).filter((x): x is number => x != null)),
      ];
      const dealPorContrato = new Map<number, string | null>();
      for (let i = 0; i < contratoIds.length; i += 200) {
        const chunk = contratoIds.slice(i, i + 200);
        const { data: contratos, error: cErr } = await supabase
          .from("contratos")
          .select("id,pipedrive_deal_id")
          .in("id", chunk);
        if (cErr) throw new Error(cErr.message);
        for (const c of (contratos ?? []) as any[]) {
          dealPorContrato.set(c.id, c.pipedrive_deal_id ?? null);
        }
      }

      const deals = [...new Set([...dealPorContrato.values()].filter((d): d is string => !!d))];
      const cardPorDeal = new Map<string, { fase: string | null; assinatura: string | null }>();
      for (let i = 0; i < deals.length; i += 200) {
        const chunk = deals.slice(i, i + 200);
        const { data: docs, error: dErr } = await supabase
          .from("contratos_documentos")
          .select("pipedrive_deal_id,fase_atual,data_assinatura")
          .in("pipedrive_deal_id", chunk);
        if (dErr) throw new Error(dErr.message);
        for (const d of (docs ?? []) as any[]) {
          const atual = cardPorDeal.get(d.pipedrive_deal_id);
          // Um deal pode ter mais de um card (aditivo, distrato). Vale o mais
          // avançado: se qualquer card já está assinado, o contrato existe.
          const assinado = FASES_CONTRATO_ASSINADO.has(d.fase_atual ?? "");
          if (!atual || (assinado && !FASES_CONTRATO_ASSINADO.has(atual.fase ?? ""))) {
            cardPorDeal.set(d.pipedrive_deal_id, {
              fase: d.fase_atual ?? null,
              assinatura: d.data_assinatura ?? null,
            });
          }
        }
      }

      const itens: ApuracaoCacItemComUnidade[] = itensSemAssinatura.map((it) => {
        const deal = it.contrato_id != null ? dealPorContrato.get(it.contrato_id) : null;
        const card = deal ? cardPorDeal.get(deal) : undefined;
        return {
          ...it,
          contrato_assinado: FASES_CONTRATO_ASSINADO.has(card?.fase ?? ""),
          contrato_assinado_em: card?.assinatura ?? null,
          fase_contrato_pipefy: card?.fase ?? null,
        };
      });
      itens.sort((a, b) =>
        (b.data_assinatura_contrato ?? "").localeCompare(a.data_assinatura_contrato ?? ""),
      );

      return { unidades: unidades as CacUnidade[], itens };
    },
  );

// ============ Vínculo automático CAC → apuração de Royalties ============
// Ao marcar uma parcela de CAC como "boleto enviado" ou "pago", o valor
// efetivo passa a contar automaticamente na fatura mensal (apuração de
// Royalties) da unidade, no mês do evento — reaproveitando o mecanismo já
// existente de is_cac + royalties_percentual_override em royalties_itens
// (não muda o cálculo de fecharApuracao, só popula o que ele já lê).
// Definido com o usuário em 24/08/2026.
type ParcelaCac = 1 | 2;
type AvisoVinculoCac = { mes: string; motivo: string };

// Desfaz o vínculo de um item de royalties com uma parcela de CAC: se o item
// só existe por causa dessa automação (fonte "cac_auto"), remove de vez —
// senão ele ficaria fantasma, contando como royalties normal. Se é um item
// real (cliente com contrato casado), só desliga is_cac/override, devolvendo
// pro cálculo normal de royalties. Não mexe se a apuração daquele mês já
// estiver fechada (edição bloqueada, igual updateItem).
async function desvincularRoyaltiesCac(supabase: any, royaltiesItemId: number): Promise<void> {
  const { data: ri, error: riErr } = await supabase
    .from("royalties_itens")
    .select("id,fonte,apuracao:royalties_apuracao!inner(status)")
    .eq("id", royaltiesItemId)
    .maybeSingle();
  if (riErr) throw new Error(riErr.message);
  if (!ri) return;
  const status = (ri as any).apuracao.status;
  if (status === "confirmado" || status === "faturado") return;
  if ((ri as any).fonte === "cac_auto") {
    const { error } = await supabase.from("royalties_itens").delete().eq("id", royaltiesItemId);
    if (error) throw new Error(error.message);
  } else {
    const result = await supabase
      .from("royalties_itens")
      .update({ is_cac: false, royalties_percentual_override: null })
      .eq("id", royaltiesItemId)
      .select("id");
    assertAffected(result, `Item de royalties ${royaltiesItemId} não foi desvinculado do CAC — possível bloqueio de permissão (RLS).`);
  }
}

async function vincularRoyaltiesCac(
  supabase: any,
  cacItem: {
    id: number;
    apuracao_id: number;
    contrato_id: number | null;
    razao_social: string;
    cnpj: string | null;
    valor_parcela_1: number;
    valor_parcela_2: number;
    valor_pago_parcela_1: number | null;
    valor_pago_parcela_2: number | null;
    royalties_item_id_parcela_1: number | null;
    royalties_mes_parcela_1: string | null;
    royalties_item_id_parcela_2: number | null;
    royalties_mes_parcela_2: string | null;
  },
  parcela: ParcelaCac,
  dataEventoISO: string,
): Promise<AvisoVinculoCac | null> {
  if (!cacItem.contrato_id) return null; // item manual, sem contrato — nada a vincular

  const valorParcela = parcela === 1 ? cacItem.valor_parcela_1 : cacItem.valor_parcela_2;
  const valorPago = parcela === 1 ? cacItem.valor_pago_parcela_1 : cacItem.valor_pago_parcela_2;
  const valorEfetivo = Number(valorPago ?? valorParcela ?? 0);
  if (valorEfetivo <= 0) return null;

  const mes = dataEventoISO.slice(0, 7);
  const { firstDay } = monthRange(mes);

  const royaltiesItemIdAntigo =
    parcela === 1 ? cacItem.royalties_item_id_parcela_1 : cacItem.royalties_item_id_parcela_2;
  const mesAntigo = parcela === 1 ? cacItem.royalties_mes_parcela_1 : cacItem.royalties_mes_parcela_2;

  const { data: cacAp, error: cacApErr } = await supabase
    .from("cac_apuracao")
    .select("unidade_id")
    .eq("id", cacItem.apuracao_id)
    .single();
  if (cacApErr) throw new Error(cacApErr.message);
  const unidadeId: number = (cacAp as any).unidade_id;

  // Evento anterior (ex: boleto enviado) já tinha vinculado outro mês (ex:
  // pagamento caiu no mês seguinte) — desvincula de lá antes de vincular no
  // mês novo, senão o mesmo valor conta em duas faturas.
  if (royaltiesItemIdAntigo && mesAntigo && String(mesAntigo).slice(0, 7) !== mes) {
    await desvincularRoyaltiesCac(supabase, royaltiesItemIdAntigo);
  }

  // Apuração de Royalties da unidade nesse mês — get or create (mesmo padrão
  // de getOrCreateApuracao em royalties.functions.ts).
  const { data: existenteAp, error: eApErr } = await supabase
    .from("royalties_apuracao")
    .select("id,status")
    .eq("unidade_id", unidadeId)
    .eq("mes_referencia", firstDay)
    .maybeSingle();
  if (eApErr) throw new Error(eApErr.message);

  let royaltiesApuracaoId: number;
  let statusAp: string;
  if (existenteAp) {
    royaltiesApuracaoId = (existenteAp as any).id;
    statusAp = (existenteAp as any).status;
  } else {
    const { data: u, error: uErr } = await supabase
      .from("unidades")
      .select("royalties_percentual,csc_valor_fixo,csc_percentual_base_antiga")
      .eq("id", unidadeId)
      .single();
    if (uErr) throw new Error(uErr.message);
    const { data: novaAp, error: novaApErr } = await supabase
      .from("royalties_apuracao")
      .insert({
        unidade_id: unidadeId,
        mes_referencia: firstDay,
        status: "rascunho",
        royalties_percentual: (u as any).royalties_percentual,
        csc_valor_fixo: (u as any).csc_valor_fixo,
        csc_percentual_base_antiga: (u as any).csc_percentual_base_antiga,
      })
      .select("id,status")
      .single();
    if (novaApErr) throw new Error(novaApErr.message);
    royaltiesApuracaoId = (novaAp as any).id;
    statusAp = (novaAp as any).status;
  }

  if (statusAp === "confirmado" || statusAp === "faturado") {
    return { mes, motivo: "a apuração de Royalties desse mês já está fechada — vincule manualmente" };
  }

  // Gera os itens normais da apuração se ainda estiver vazia, pra ter onde
  // procurar o item do cliente pelo contrato antes de criar um manual.
  const { count: itensCount, error: cntErr } = await supabase
    .from("royalties_itens")
    .select("id", { count: "exact", head: true })
    .eq("apuracao_id", royaltiesApuracaoId);
  if (cntErr) throw new Error(cntErr.message);
  if ((itensCount ?? 0) === 0) {
    await gerarItensApuracaoCore(supabase, royaltiesApuracaoId);
  }

  const { data: itemRoyalties, error: itErr } = await supabase
    .from("royalties_itens")
    .select("id,valor_confirmado")
    .eq("apuracao_id", royaltiesApuracaoId)
    .eq("contrato_id", cacItem.contrato_id)
    .is("excluido_em", null)
    .maybeSingle();
  if (itErr) throw new Error(itErr.message);

  let royaltiesItemId: number;
  let valorConfirmadoAtual: number;

  if (itemRoyalties) {
    royaltiesItemId = (itemRoyalties as any).id;
    valorConfirmadoAtual = Number((itemRoyalties as any).valor_confirmado ?? 0);
  } else {
    // Sem item casado nessa apuração (ex: CNPJ não bate) — cria um item
    // manual só pra carregar o valor de CAC dessa parcela na fatura do mês.
    const { data: novoItem, error: novoItemErr } = await supabase
      .from("royalties_itens")
      .insert({
        apuracao_id: royaltiesApuracaoId,
        razao_social: cacItem.razao_social,
        cnpj: cacItem.cnpj,
        contrato_id: cacItem.contrato_id,
        valor_confirmado: 0,
        categoria: "royalties",
        fonte: "cac_auto",
        status_match: "manual",
        confirmado: true,
      })
      .select("id,valor_confirmado")
      .single();
    if (novoItemErr) throw new Error(novoItemErr.message);
    royaltiesItemId = (novoItem as any).id;
    valorConfirmadoAtual = Number((novoItem as any).valor_confirmado ?? 0);
  }

  const patchRoyalties: Record<string, unknown> = { is_cac: true, confirmado: true };
  if (valorEfetivo > valorConfirmadoAtual) {
    // Parcela de CAC maior que a receita reconhecida do cliente nesse mês —
    // sobe o valor_confirmado (fatura) e o mrr_mensal do contrato
    // (permanente, vale pros meses seguintes também), pra 100% do item
    // cobrir a parcela inteira.
    patchRoyalties.valor_confirmado = valorEfetivo;
    patchRoyalties.royalties_percentual_override = 100;
    const contResult = await supabase
      .from("contratos")
      .update({ mrr_mensal: valorEfetivo })
      .eq("id", cacItem.contrato_id)
      .select("id");
    assertAffected(contResult, `Contrato ${cacItem.contrato_id} não teve mrr_mensal atualizado — possível bloqueio de permissão (RLS).`);
  } else {
    // Percentual = fatia da receita do mês que essa parcela representa.
    patchRoyalties.royalties_percentual_override = (valorEfetivo / valorConfirmadoAtual) * 100;
  }

  const updResult = await supabase.from("royalties_itens").update(patchRoyalties).eq("id", royaltiesItemId).select("id");
  assertAffected(updResult, `Item de royalties ${royaltiesItemId} não foi vinculado ao CAC — possível bloqueio de permissão (RLS).`);

  const vinculoPatch =
    parcela === 1
      ? { royalties_item_id_parcela_1: royaltiesItemId, royalties_mes_parcela_1: firstDay }
      : { royalties_item_id_parcela_2: royaltiesItemId, royalties_mes_parcela_2: firstDay };
  const vincResult = await supabase.from("cac_apuracao_itens").update(vinculoPatch).eq("id", cacItem.id).select("id");
  assertAffected(vincResult, `Item de CAC ${cacItem.id} não foi vinculado — possível bloqueio de permissão (RLS).`);

  return null;
}

// ============ updateItemCac ============
// Marcar parcela como paga é uma ação manual do admin — o repasse em si
// (unidade → matriz) não tem integração automática de conferência (Omie por
// unidade só cobre recebíveis de clientes, não repasses internos), mas o
// valor é refletido automaticamente na apuração de Royalties da unidade via
// vincularRoyaltiesCac acima.
export const updateItemCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: number;
      valor_cac_total?: number;
      prazo_parcela_1?: string | null;
      data_envio_parcela_1?: string | null;
      data_pagamento_parcela_1?: string | null;
      valor_pago_parcela_1?: number | null;
      prazo_parcela_2?: string | null;
      data_envio_parcela_2?: string | null;
      data_pagamento_parcela_2?: string | null;
      valor_pago_parcela_2?: number | null;
      estimativa_parcela_2?: string | null;
      observacao?: string | null;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);

    const patch: any = {};
    if ("prazo_parcela_1" in data) patch.prazo_parcela_1 = data.prazo_parcela_1;
    if ("data_envio_parcela_1" in data) patch.data_envio_parcela_1 = data.data_envio_parcela_1;
    if ("data_pagamento_parcela_1" in data)
      patch.data_pagamento_parcela_1 = data.data_pagamento_parcela_1;
    if ("valor_pago_parcela_1" in data) patch.valor_pago_parcela_1 = data.valor_pago_parcela_1;
    if ("prazo_parcela_2" in data) patch.prazo_parcela_2 = data.prazo_parcela_2;
    if ("data_envio_parcela_2" in data) patch.data_envio_parcela_2 = data.data_envio_parcela_2;
    if ("data_pagamento_parcela_2" in data)
      patch.data_pagamento_parcela_2 = data.data_pagamento_parcela_2;
    if ("valor_pago_parcela_2" in data) patch.valor_pago_parcela_2 = data.valor_pago_parcela_2;
    if ("estimativa_parcela_2" in data) patch.estimativa_parcela_2 = data.estimativa_parcela_2;
    if ("observacao" in data) patch.observacao = data.observacao;

    // Corrigir o valor total redistribui só a(s) parcela(s) ainda não paga(s)
    // — parcela já paga é fato histórico, não muda retroativamente. Sem
    // nenhuma parcela paga ainda, divide 50/50 como na geração automática
    // (gerarItensParaApuracao); com uma paga, a outra absorve o restante.
    if ("valor_cac_total" in data && data.valor_cac_total != null) {
      const novoTotal = Number(data.valor_cac_total);
      patch.valor_cac_total = novoTotal;

      const { data: atual, error: atualErr } = await (supabase as any)
        .from("cac_apuracao_itens")
        .select("valor_parcela_1,valor_parcela_2,status_parcela_1,status_parcela_2")
        .eq("id", data.id)
        .single();
      if (atualErr) throw new Error(atualErr.message);

      const pago1 = atual.status_parcela_1 === "pago";
      const pago2 = atual.status_parcela_2 === "pago";
      if (pago1 && !pago2) {
        patch.valor_parcela_2 = Math.max(0, novoTotal - Number(atual.valor_parcela_1 ?? 0));
      } else if (!pago1 && pago2) {
        patch.valor_parcela_1 = Math.max(0, novoTotal - Number(atual.valor_parcela_2 ?? 0));
      } else if (!pago1 && !pago2) {
        patch.valor_parcela_1 = novoTotal / 2;
        patch.valor_parcela_2 = novoTotal - patch.valor_parcela_1;
      }
      // pago1 && pago2: as duas já viraram fato histórico — só o total muda.
    }

    const patchResult = await (supabase as any).from("cac_apuracao_itens").update(patch).eq("id", data.id).select("id");
    assertAffected(patchResult, `Item de CAC ${data.id} não foi atualizado — possível bloqueio de permissão (RLS).`);

    // Dispara o vínculo com Royalties só quando uma data de envio/pagamento
    // acabou de ser MARCADA (valor não-nulo) — desmarcar (Desfazer) não
    // desvincula automaticamente, fica pra ajuste manual na apuração de
    // Royalties. Pagamento tem prioridade sobre envio quando os dois vêm no
    // mesmo patch (não acontece hoje pela UI, mas evita rodar duas vezes com
    // meses diferentes por engano).
    const eventos: { parcela: ParcelaCac; dataISO: string }[] = [];
    if (data.data_pagamento_parcela_1) eventos.push({ parcela: 1, dataISO: data.data_pagamento_parcela_1 });
    else if (data.data_envio_parcela_1) eventos.push({ parcela: 1, dataISO: data.data_envio_parcela_1 });
    if (data.data_pagamento_parcela_2) eventos.push({ parcela: 2, dataISO: data.data_pagamento_parcela_2 });
    else if (data.data_envio_parcela_2) eventos.push({ parcela: 2, dataISO: data.data_envio_parcela_2 });

    const avisos: AvisoVinculoCac[] = [];
    if (eventos.length > 0) {
      const { data: itemAtualizado, error: itemErr } = await (supabase as any)
        .from("cac_apuracao_itens")
        .select(
          "id,apuracao_id,contrato_id,razao_social,cnpj,valor_parcela_1,valor_parcela_2,valor_pago_parcela_1,valor_pago_parcela_2,royalties_item_id_parcela_1,royalties_mes_parcela_1,royalties_item_id_parcela_2,royalties_mes_parcela_2",
        )
        .eq("id", data.id)
        .single();
      if (itemErr) throw new Error(itemErr.message);

      for (const ev of eventos) {
        try {
          const aviso = await vincularRoyaltiesCac(supabase, itemAtualizado, ev.parcela, ev.dataISO);
          if (aviso) avisos.push(aviso);
        } catch (e) {
          // A parcela já foi marcada com sucesso acima — uma falha no vínculo
          // com Royalties não deve desfazer isso, só avisar pra ajuste manual.
          const msg = e instanceof Error ? e.message : "erro desconhecido";
          avisos.push({ mes: ev.dataISO.slice(0, 7), motivo: `falha ao vincular na apuração de Royalties: ${msg}` });
        }
      }
    }

    return { ok: true, avisos };
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
    const result = await (supabase as any)
      .from("cac_apuracao_itens")
      .update({
        excluido_em: new Date().toISOString(),
        excluido_por: email ?? userId,
        motivo_exclusao: data.motivo.trim(),
      })
      .eq("id", data.item_id)
      .select("id");
    assertAffected(result, `Item de CAC ${data.item_id} não foi excluído — possível bloqueio de permissão (RLS).`);
    return { ok: true };
  });

// ============ reincluirItemMesCac ============
export const reincluirItemMesCac = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { item_id: number }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await assertAdmin(supabase, userId);
    const result = await (supabase as any)
      .from("cac_apuracao_itens")
      .update({ excluido_em: null, excluido_por: null, motivo_exclusao: null })
      .eq("id", data.item_id)
      .select("id");
    assertAffected(result, `Item de CAC ${data.item_id} não foi reincluído — possível bloqueio de permissão (RLS).`);
    return { ok: true };
  });
