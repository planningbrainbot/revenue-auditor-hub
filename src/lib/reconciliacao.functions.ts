import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { digits } from "@/lib/server-utils";
import { assertAffected } from "@/lib/supabase-assert";

export interface ReconciliacaoRow {
  // Identidade
  contrato_id: number;
  deal_id: string | null;
  nome: string;
  razao_social: string | null;
  cnpj: string | null;
  unidade: string | null;
  // Financeiro
  mrr: number | null;
  data_venda: string | null;
  // Flags de rastreabilidade
  em_pipedrive: boolean;
  em_omie: boolean;
  na_planilha_ana: boolean | null;
  // Status de reconciliação
  status_reconciliacao: "ativo" | "churn" | "pausa" | null;
  obs_reconciliacao: string | null;
  // Fonte
  fonte: "pipedrive" | "omie" | "manual";
  // Histórico de pagamento
  primeiro_pagamento: string | null;
  dias_ate_primeiro_pag: number | null;
  total_recebido: number;
  pagamentos_mensais: { mes: string; valor: number }[];
  // Empresa
  empresa_id: number | null;
  telefone: string | null;
  email: string | null;
  // CNPJs associados (filiais)
  cnpjs_associados: { cnpj: string; razao_social: string | null }[];
}

export interface OmieNaoMapeado {
  cnpj: string;
  razao_social: string;
  unidade: string;
  total_recebido: number;
  primeiro_pagamento: string | null;
  pagamentos_mensais: { mes: string; valor: number }[];
}

const UNIDADES_COM_OMIE = ["Belém", "Campo Novo", "Curitiba", "Rio de Janeiro"];

export const listReconciliacao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: ReconciliacaoRow[]; nao_mapeados: OmieNaoMapeado[] }> => {
    const { supabase } = context;

    // 1. Contratos das unidades com Omie
    const { data: contratos, error: ce } = await supabase
      .from("contratos")
      .select("id,pipedrive_deal_id,titulo,cnpj,mrr_mensal,ganho_em,unidade,tipo_unidade,empresa_id,status_reconciliacao,na_planilha_ana,obs_reconciliacao")
      .in("unidade", UNIDADES_COM_OMIE)
      .limit(2000);
    if (ce) throw new Error(ce.message);

    // 2. Empresas (para razao_social, telefone, email)
    const empresaIds = [...new Set((contratos ?? []).map((c) => c.empresa_id).filter(Boolean))];
    let empresasMap = new Map<number, { razao_social: string | null; telefone: string | null; email: string | null }>();
    if (empresaIds.length > 0) {
      const { data: emps } = await supabase
        .from("empresas")
        .select("id,razao_social,telefone,email_fiscal")
        .in("id", empresaIds)
        .limit(2000);
      for (const e of emps ?? []) {
        empresasMap.set(e.id, { razao_social: e.razao_social, telefone: e.telefone, email: e.email_fiscal });
      }
    }

    // 3. Grupos (filiais por contrato)
    const contratoIds = (contratos ?? []).map((c) => c.id);
    let gruposMap = new Map<number, { cnpj: string; razao_social: string | null }[]>();
    if (contratoIds.length > 0) {
      const { data: grupos } = await supabase
        .from("contrato_omie_grupos")
        .select("contrato_id,cpf_cnpj,razao_social")
        .in("contrato_id", contratoIds)
        .limit(2000);
      for (const g of grupos ?? []) {
        const d = digits(g.cpf_cnpj);
        if (!d) continue;
        const arr = gruposMap.get(g.contrato_id) ?? [];
        arr.push({ cnpj: d, razao_social: g.razao_social });
        gruposMap.set(g.contrato_id, arr);
      }
    }

    // 4. Todos os recebimentos (RECEBIDO) das unidades
    let contas: { cpf_cnpj: string | null; valor: number | null; data_pagamento: string | null; unidade: string | null; cliente: string | null }[] = [];
    let from = 0;
    while (true) {
      const { data: page } = await supabase
        .from("contas_receber")
        .select("cpf_cnpj,valor,data_pagamento,unidade,cliente")
        .eq("status_pagamento", "RECEBIDO")
        .in("unidade", UNIDADES_COM_OMIE)
        .range(from, from + 999);
      contas.push(...(page ?? []));
      if ((page ?? []).length < 1000) break;
      from += 1000;
    }

    // Indexar recebimentos por CNPJ
    const recByCnpj = new Map<string, { mes: string; valor: number }[]>();
    for (const c of contas) {
      const k = digits(c.cpf_cnpj);
      if (!k || !c.data_pagamento) continue;
      const mes = c.data_pagamento.slice(0, 7);
      const arr = recByCnpj.get(k) ?? [];
      arr.push({ mes, valor: Number(c.valor ?? 0) });
      recByCnpj.set(k, arr);
    }

    // 5. Montar linhas
    const rows: ReconciliacaoRow[] = [];
    const cnpjsUsados = new Set<string>();

    for (const c of contratos ?? []) {
      const cnpjD = digits(c.cnpj);
      const filiais = gruposMap.get(c.id) ?? [];
      const todosCnpjs = (cnpjD ? [cnpjD] : []).concat(filiais.map((f) => f.cnpj));

      // Agregar pagamentos
      const pagMap = new Map<string, number>();
      for (const cn of todosCnpjs) {
        for (const p of recByCnpj.get(cn) ?? []) {
          pagMap.set(p.mes, (pagMap.get(p.mes) ?? 0) + p.valor);
        }
        cnpjsUsados.add(cn);
      }

      const pags = Array.from(pagMap.entries())
        .map(([mes, valor]) => ({ mes, valor }))
        .sort((a, b) => a.mes.localeCompare(b.mes));

      const totalRec = pags.reduce((s, p) => s + p.valor, 0);
      const primeiroPag = pags[0]?.mes ?? null;

      let diasAtePrimeiro: number | null = null;
      if (c.ganho_em && primeiroPag) {
        const vendaDt = new Date(c.ganho_em).getTime();
        const pagDt = new Date(primeiroPag + "-01").getTime();
        if (!isNaN(vendaDt) && !isNaN(pagDt) && pagDt >= vendaDt) {
          diasAtePrimeiro = Math.round((pagDt - vendaDt) / 86_400_000);
        }
      }

      const emp = c.empresa_id ? empresasMap.get(c.empresa_id) : null;

      rows.push({
        contrato_id: c.id,
        deal_id: c.pipedrive_deal_id ? String(c.pipedrive_deal_id) : null,
        nome: c.titulo ?? "",
        razao_social: emp?.razao_social ?? null,
        cnpj: cnpjD || null,
        unidade: c.unidade,
        mrr: c.mrr_mensal,
        data_venda: c.ganho_em,
        em_pipedrive: true,
        em_omie: totalRec > 0,
        na_planilha_ana: c.na_planilha_ana ?? null,
        status_reconciliacao: (c.status_reconciliacao as ReconciliacaoRow["status_reconciliacao"]) ?? null,
        obs_reconciliacao: c.obs_reconciliacao ?? null,
        fonte: "pipedrive",
        primeiro_pagamento: primeiroPag ? primeiroPag + "-01" : null,
        dias_ate_primeiro_pag: diasAtePrimeiro,
        total_recebido: totalRec,
        pagamentos_mensais: pags,
        empresa_id: c.empresa_id ?? null,
        telefone: emp?.telefone ?? null,
        email: emp?.email ?? null,
        cnpjs_associados: filiais,
      });
    }

    // 6. CNPJs Omie sem Pipedrive
    // Need cliente name — fetch it from contas index
    const clienteByCnpj = new Map<string, { cliente: string | null; unidade: string | null }>();
    for (const c of contas) {
      const k = digits(c.cpf_cnpj);
      if (k && !clienteByCnpj.has(k)) clienteByCnpj.set(k, { cliente: c.cliente ?? null, unidade: c.unidade ?? null });
    }

    const naoMapeados: OmieNaoMapeado[] = [];
    for (const [cnpj, pags] of recByCnpj.entries()) {
      if (cnpjsUsados.has(cnpj)) continue;
      const sorted = [...pags].sort((a, b) => a.mes.localeCompare(b.mes));
      const pagMap = new Map<string, number>();
      for (const p of sorted) pagMap.set(p.mes, (pagMap.get(p.mes) ?? 0) + p.valor);
      const pagMensais = Array.from(pagMap.entries()).map(([mes, valor]) => ({ mes, valor })).sort((a, b) => a.mes.localeCompare(b.mes));
      const total = pagMensais.reduce((s, p) => s + p.valor, 0);
      const meta = clienteByCnpj.get(cnpj);
      const primMes = pagMensais[0]?.mes;
      naoMapeados.push({
        cnpj,
        razao_social: meta?.cliente ?? cnpj,
        unidade: meta?.unidade ?? "",
        total_recebido: total,
        primeiro_pagamento: primMes ? primMes + "-01" : null,
        pagamentos_mensais: pagMensais,
      });
    }

    return { rows, nao_mapeados: naoMapeados };
  });

export const updateReconciliacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: { data: { contrato_id: number; status_reconciliacao?: string | null; na_planilha_ana?: boolean | null; obs_reconciliacao?: string | null }; context: any }) => {
    const { supabase } = context;
    const { contrato_id, ...updates } = data;
    const result = await supabase.from("contratos").update(updates).eq("id", contrato_id).select("id");
    assertAffected(result, `Contrato ${contrato_id} não foi atualizado — possível bloqueio de permissão (RLS).`);
    return { ok: true };
  });

export const addAssociacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: { data: { contrato_id: number; cpf_cnpj: string; razao_social?: string }; context: any }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("contrato_omie_grupos")
      .upsert({
        contrato_id: data.contrato_id,
        cpf_cnpj: data.cpf_cnpj,
        razao_social: data.razao_social ?? null,
        criado_por: "reconciliacao_manual",
      }, { onConflict: "contrato_id,cpf_cnpj" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeAssociacao = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ data, context }: { data: { contrato_id: number; cpf_cnpj: string }; context: any }) => {
    const { supabase } = context;
    const { error } = await supabase
      .from("contrato_omie_grupos")
      .delete()
      .eq("contrato_id", data.contrato_id)
      .eq("cpf_cnpj", data.cpf_cnpj);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
