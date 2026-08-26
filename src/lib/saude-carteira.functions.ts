import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { digits } from "@/lib/server-utils";

// Pilar Financeiro do Customer Health Score (ver apresentação "Customer
// Success" da Expansão, jul/2026). Calculado 100% a partir de dados já
// existentes (contas_receber, contratos, central_tratativas) — não usa
// empresas.status_financeiro porque a lógica de cálculo desse campo não foi
// localizada em nenhum script/migration do repo, então não é auditável.
//
// Categoria financeira usa as mesmas faixas já conhecidas na tela /clientes
// (STATUS_META), mas recalculadas aqui de forma transparente:
//   ATIVO          — sem título vencido em aberto, pagou nos últimos 90 dias
//   EM_ATRASO      — tem título vencido em aberto há até 90 dias
//   INADIMPLENTE   — tem título vencido em aberto há mais de 90 dias
//   SEM_ATIVIDADE  — sem título vencido em aberto, mas sem pagamento há +90 dias
//   NUNCA_PAGOU    — nenhum título RECEBIDO no histórico
//   SEM_AR         — nenhum título encontrado (sem faturamento no Omie)

export type CategoriaFinanceira =
  | "ATIVO"
  | "EM_ATRASO"
  | "INADIMPLENTE"
  | "SEM_ATIVIDADE"
  | "NUNCA_PAGOU"
  | "SEM_AR";

export type Semaforo = "saudavel" | "atencao" | "risco" | "sem_medicao";

export interface SaudeClienteRow {
  id: number;
  razao_social: string | null;
  titulo: string | null;
  cnpj: string | null;
  unidade: string | null;
  mrr_ativo: number;
  categoria_financeira: CategoriaFinanceira;
  dias_atraso: number | null;
  valor_em_atraso: number;
  tratativa_ativa: boolean;
  tratativa_estagio: string | null;
  churn: boolean;
  semaforo: Semaforo | null; // null quando churn=true (fora da carteira ativa)
}

const DIAS_LIMITE_INADIMPLENTE = 90;
const DIAS_LIMITE_ATIVIDADE = 90;

function diasDesde(dataStr: string | null): number | null {
  if (!dataStr) return null;
  const d = new Date(dataStr);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function classificarSemaforo(cat: CategoriaFinanceira): Semaforo {
  switch (cat) {
    case "ATIVO":
      return "saudavel";
    case "INADIMPLENTE":
    case "NUNCA_PAGOU":
      return "risco";
    // SEM_AR = nenhum título encontrado no Omie pra esse CNPJ — não é possível
    // medir saúde financeira (não é o mesmo que "saudável"), então fica fora
    // das estatísticas de saudável/atenção/risco em vez de cair no default.
    case "SEM_AR":
      return "sem_medicao";
    case "EM_ATRASO":
    case "SEM_ATIVIDADE":
    default:
      return "atencao";
  }
}

export const listSaudeCarteira = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: SaudeClienteRow[] }> => {
    const { supabase } = context;

    const [unidadesRes, empresasRes, contratosRes, tratativasRes] = await Promise.all([
      supabase.from("unidades").select("nome_da_praca").eq("tipo", "regional"),
      supabase
        .from("empresas")
        .select("id,razao_social,titulo,cnpj,unidade,pipedrive_id")
        .eq("tipo_unidade", "franquia")
        .limit(5000),
      supabase
        .from("contratos")
        .select("pipedrive_deal_id,mrr_mensal,status_contrato,unidade")
        .eq("status_contrato", "Ativo")
        .limit(20000),
      supabase
        .from("central_tratativas")
        .select("pipedrive_deal_id,estagio,status")
        .limit(2000),
    ]);
    if (empresasRes.error) throw new Error(empresasRes.error.message);
    if (contratosRes.error) throw new Error(contratosRes.error.message);
    if (tratativasRes.error) throw new Error(tratativasRes.error.message);

    const regionais = new Set((unidadesRes.data ?? []).map((u: { nome_da_praca: string }) => u.nome_da_praca));

    // contas_receber é grande (~29k linhas) — pagina em paralelo, mesmo padrão de listContasReceber.
    const pageSize = 1000;
    const { count, error: countErr } = await supabase
      .from("contas_receber")
      .select("id", { count: "exact", head: true });
    if (countErr) throw new Error(countErr.message);
    const totalPages = Math.max(1, Math.ceil((count ?? 0) / pageSize));
    const pagePromises = Array.from({ length: totalPages }, (_, i) => {
      const from = i * pageSize;
      return supabase
        .from("contas_receber")
        .select("cpf_cnpj,valor,valor_liquido,status_pagamento,data_vencimento,data_pagamento")
        .range(from, from + pageSize - 1);
    });
    const pages = await Promise.all(pagePromises);
    const titulosPorCnpj = new Map<
      string,
      { valor: number; status_pagamento: string | null; data_vencimento: string | null; data_pagamento: string | null }[]
    >();
    for (const { data, error } of pages) {
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const cnpjDigits = digits(r.cpf_cnpj as string | null);
        if (!cnpjDigits) continue;
        const list = titulosPorCnpj.get(cnpjDigits) ?? [];
        list.push({
          valor: Number((r.valor_liquido as number | null) ?? (r.valor as number | null) ?? 0),
          status_pagamento: r.status_pagamento as string | null,
          data_vencimento: r.data_vencimento as string | null,
          data_pagamento: r.data_pagamento as string | null,
        });
        titulosPorCnpj.set(cnpjDigits, list);
      }
    }

    const mrrPorDeal = new Map<string, number>();
    for (const c of contratosRes.data ?? []) {
      if (!regionais.has(c.unidade ?? "")) continue;
      const id = c.pipedrive_deal_id != null ? String(c.pipedrive_deal_id) : null;
      if (!id) continue;
      mrrPorDeal.set(id, (mrrPorDeal.get(id) ?? 0) + Number(c.mrr_mensal ?? 0));
    }

    const tratativaPorDeal = new Map<string, { estagio: string | null; status: string | null }[]>();
    for (const t of tratativasRes.data ?? []) {
      const id = t.pipedrive_deal_id != null ? String(t.pipedrive_deal_id) : null;
      if (!id) continue;
      const list = tratativaPorDeal.get(id) ?? [];
      list.push({ estagio: t.estagio, status: t.status });
      tratativaPorDeal.set(id, list);
    }

    const rows: SaudeClienteRow[] = [];
    for (const e of empresasRes.data ?? []) {
      if (!regionais.has(e.unidade ?? "")) continue;

      const cnpjDigits = digits(e.cnpj as string | null);
      const titulos = (cnpjDigits ? titulosPorCnpj.get(cnpjDigits) : undefined) ?? [];
      const validos = titulos.filter((t) => t.status_pagamento !== "CANCELADO");
      const atrasados = validos.filter((t) => t.status_pagamento === "ATRASADO");
      const recebidos = validos.filter((t) => t.status_pagamento === "RECEBIDO");

      let diasAtrasoMax: number | null = null;
      let valorEmAtraso = 0;
      for (const t of atrasados) {
        const d = diasDesde(t.data_vencimento);
        if (d != null && (diasAtrasoMax == null || d > diasAtrasoMax)) diasAtrasoMax = d;
        valorEmAtraso += t.valor;
      }

      let ultimoPagamento: number | null = null;
      for (const t of recebidos) {
        const d = diasDesde(t.data_pagamento);
        if (d != null && (ultimoPagamento == null || d < ultimoPagamento)) ultimoPagamento = d;
      }

      let categoria: CategoriaFinanceira;
      if (validos.length === 0) {
        categoria = "SEM_AR";
      } else if (recebidos.length === 0) {
        categoria = "NUNCA_PAGOU";
      } else if (atrasados.length > 0) {
        categoria = diasAtrasoMax != null && diasAtrasoMax > DIAS_LIMITE_INADIMPLENTE ? "INADIMPLENTE" : "EM_ATRASO";
      } else {
        categoria = ultimoPagamento != null && ultimoPagamento <= DIAS_LIMITE_ATIVIDADE ? "ATIVO" : "SEM_ATIVIDADE";
      }

      const dealId = e.pipedrive_id != null ? String(e.pipedrive_id) : null;
      const tratativas = (dealId ? tratativaPorDeal.get(dealId) : undefined) ?? [];
      // status vem do id da fase no Pipefy (PHASE_STATUS em tratativas.functions.ts),
      // não do nome — robusto a rename (a fase "Perdido" virou "Churn Confirmado
      // (Perdido)" em ago/2026; comparar por t.estagio quebrava tudo).
      const churn = tratativas.some((t) => t.status === "lost");
      const emAberto = tratativas.filter((t) => t.status === "open");
      const tratativaAtiva = emAberto.length > 0;

      rows.push({
        id: e.id,
        razao_social: e.razao_social,
        titulo: e.titulo,
        cnpj: e.cnpj,
        unidade: e.unidade,
        mrr_ativo: dealId ? (mrrPorDeal.get(dealId) ?? 0) : 0,
        categoria_financeira: categoria,
        dias_atraso: diasAtrasoMax,
        valor_em_atraso: valorEmAtraso,
        tratativa_ativa: tratativaAtiva,
        tratativa_estagio: emAberto[0]?.estagio ?? null,
        churn,
        semaforo: churn ? null : tratativaAtiva ? "risco" : classificarSemaforo(categoria),
      });
    }

    return { rows };
  });
