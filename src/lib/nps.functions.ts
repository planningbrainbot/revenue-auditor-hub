import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface NpsRow {
  id: number;
  empresa: string | null;
  empresa_id: number | null;
  unidade: string | null;
  segmento: string | null;
  email_pesquisa: string | null;
  nome_contato: string | null;
  telefone_pesquisa: string | null;
  nps_recomendacao: string | null;
  avaliacao_fiscal: string | null;
  avaliacao_contabil: string | null;
  avaliacao_folha_pagamento: string | null;
  servicos_contratados: string[] | null;
  data_envio: string | null;
  fase: string | null;
  created_at: string | null;
  updated_at: string | null;
  // joined from empresas via empresa_id (when matched)
  empresa_cnpj: string | null;
  empresa_segmento: string | null;
  empresa_unidade: string | null;
  empresa_grupo_id: number | null;
}

type Joined = {
  id: number;
  empresa: string | null;
  empresa_id: number | null;
  unidade: string | null;
  segmento: string | null;
  email_pesquisa: string | null;
  nome_contato: string | null;
  telefone_pesquisa: string | null;
  nps_recomendacao: string | null;
  avaliacao_fiscal: string | null;
  avaliacao_contabil: string | null;
  avaliacao_folha_pagamento: string | null;
  servicos_contratados: string[] | null;
  data_envio: string | null;
  fase: string | null;
  created_at: string | null;
  updated_at: string | null;
  empresas: { cnpj: string | null; segmento: string | null; unidade: string | null; grupo_id: number | null } | null;
};

export interface NpsCoverageRow {
  unidade: string;
  empresas: number;
  comWhatsapp: number;
  baseAntiga: number;
  baseNova: number;
  semClassificacao: number;
  jaDisparadas: number;
  jaDisparadasBaseAntiga: number;
  jaDisparadasBaseNova: number;
}

export interface NpsCoverageResult {
  rows: NpsCoverageRow[];
  totalEmpresas: number;
  totalComWhatsapp: number;
  contatosSemEmpresa: number;
  totalJaDisparadas: number;
  pesquisasComEmpresaResolvida: number;
  pesquisasTotal: number;
}

// "São Luís"/"São Luis" (com e sem acento) chegam como valores distintos no
// Pipefy/Supabase — sem essa normalização a mesma unidade aparece em duas
// linhas na cobertura.
function normalizeUnidade(raw: string | null): string {
  if (!raw || !raw.trim()) return "Sem unidade";
  const s = raw.trim();
  if (s.toLowerCase() === "são luis" || s.toLowerCase() === "sao luis") return "São Luís";
  return s;
}

function hasValidWhatsapp(raw: string | null): boolean {
  if (!raw) return false;
  return raw.replace(/\D/g, "").length >= 10;
}

export const listNpsCoverage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NpsCoverageResult> => {
    const { supabase } = context;
    const pageSize = 1000;

    type EmpresaRow = { id: number; unidade: string | null; origem_da_base: string | null };
    type ContatoRow = { empresa_id: number | null; whatsapp: string | null };

    async function fetchEmpresas(): Promise<EmpresaRow[]> {
      let from = 0;
      const all: EmpresaRow[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("empresas")
          .select("id,unidade,origem_da_base")
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    async function fetchContatos(): Promise<ContatoRow[]> {
      let from = 0;
      const all: ContatoRow[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("contatos")
          .select("empresa_id,whatsapp")
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    async function fetchPesquisasEmpresaIds(): Promise<(number | null)[]> {
      let from = 0;
      const all: (number | null)[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("nps_pesquisas")
          .select("empresa_id")
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        all.push(...batch.map((r) => r.empresa_id));
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    const empresas = await fetchEmpresas();
    const contatos = await fetchContatos();
    const pesquisasEmpresaIds = await fetchPesquisasEmpresaIds();

    const empresasComWhatsapp = new Set<number>();
    let contatosSemEmpresa = 0;
    for (const c of contatos) {
      if (c.empresa_id == null) {
        contatosSemEmpresa += 1;
        continue;
      }
      if (hasValidWhatsapp(c.whatsapp)) empresasComWhatsapp.add(c.empresa_id);
    }

    // "Já disparadas" conta empresas DISTINTAS com pelo menos 1 pesquisa —
    // só é confiável na fatia de nps_pesquisas com empresa_id resolvido
    // (ver pesquisasComEmpresaResolvida/pesquisasTotal no retorno).
    const empresasJaDisparadas = new Set<number>();
    let pesquisasComEmpresaResolvida = 0;
    for (const id of pesquisasEmpresaIds) {
      if (id != null) {
        empresasJaDisparadas.add(id);
        pesquisasComEmpresaResolvida += 1;
      }
    }

    const map = new Map<string, NpsCoverageRow>();
    for (const e of empresas) {
      const unidade = normalizeUnidade(e.unidade);
      const cur = map.get(unidade) ?? {
        unidade,
        empresas: 0,
        comWhatsapp: 0,
        baseAntiga: 0,
        baseNova: 0,
        semClassificacao: 0,
        jaDisparadas: 0,
        jaDisparadasBaseAntiga: 0,
        jaDisparadasBaseNova: 0,
      };
      cur.empresas += 1;
      if (empresasComWhatsapp.has(e.id)) cur.comWhatsapp += 1;
      if (e.origem_da_base === "Base Antiga") cur.baseAntiga += 1;
      else if (e.origem_da_base === "Base Nova") cur.baseNova += 1;
      else cur.semClassificacao += 1;
      if (empresasJaDisparadas.has(e.id)) {
        cur.jaDisparadas += 1;
        if (e.origem_da_base === "Base Antiga") cur.jaDisparadasBaseAntiga += 1;
        else if (e.origem_da_base === "Base Nova") cur.jaDisparadasBaseNova += 1;
      }
      map.set(unidade, cur);
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      if (a.unidade === "Sem unidade") return 1;
      if (b.unidade === "Sem unidade") return -1;
      return b.comWhatsapp / Math.max(b.empresas, 1) - a.comWhatsapp / Math.max(a.empresas, 1);
    });

    return {
      rows,
      totalEmpresas: empresas.length,
      totalComWhatsapp: empresasComWhatsapp.size,
      contatosSemEmpresa,
      totalJaDisparadas: empresasJaDisparadas.size,
      pesquisasComEmpresaResolvida,
      pesquisasTotal: pesquisasEmpresaIds.length,
    };
  });

export interface NpsExecucaoRow {
  id: number;
  telefone: string;
  pipefyCardId: string;
  enviadoEm: string;
  respondido: boolean;
  empresa: string | null;
  npsRecomendacao: string | null;
  fase: string | null;
}

export interface NpsExecucaoResult {
  rows: NpsExecucaoRow[];
  totalEnviados: number;
  totalRespondidos: number;
  totalAguardando: number;
}

export const listNpsExecucao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NpsExecucaoResult> => {
    const { supabase } = context;

    const { data: envios, error: erroEnvios } = await supabase
      .from("nps_envio_map")
      .select("id,telefone,pipefy_card_id,enviado_em,respondido")
      .order("enviado_em", { ascending: false })
      .limit(500);
    if (erroEnvios) throw new Error(erroEnvios.message);

    const cardIds = (envios ?? []).map((e) => e.pipefy_card_id);
    const porCard = new Map<string, { empresa: string | null; nps_recomendacao: string | null; fase: string | null }>();
    if (cardIds.length > 0) {
      const { data: pesquisas, error: erroPesquisas } = await supabase
        .from("nps_pesquisas")
        .select("pipefy_card_id,empresa,nps_recomendacao,fase")
        .in("pipefy_card_id", cardIds);
      if (erroPesquisas) throw new Error(erroPesquisas.message);
      for (const p of pesquisas ?? []) {
        if (!p.pipefy_card_id) continue;
        porCard.set(p.pipefy_card_id, {
          empresa: p.empresa,
          nps_recomendacao: p.nps_recomendacao,
          fase: p.fase,
        });
      }
    }

    const rows: NpsExecucaoRow[] = (envios ?? []).map((e) => {
      const info = porCard.get(e.pipefy_card_id);
      return {
        id: e.id,
        telefone: e.telefone,
        pipefyCardId: e.pipefy_card_id,
        enviadoEm: e.enviado_em,
        respondido: e.respondido,
        empresa: info?.empresa ?? null,
        npsRecomendacao: info?.nps_recomendacao ?? null,
        fase: info?.fase ?? null,
      };
    });

    return {
      rows,
      totalEnviados: rows.length,
      totalRespondidos: rows.filter((r) => r.respondido).length,
      totalAguardando: rows.filter((r) => !r.respondido).length,
    };
  });

export const listNps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: NpsRow[] }> => {
    const { supabase } = context;
    const pageSize = 1000;
    let from = 0;
    const all: NpsRow[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("nps_pesquisas")
        .select(
          "id,empresa,empresa_id,unidade,segmento,email_pesquisa,nome_contato,telefone_pesquisa,nps_recomendacao,avaliacao_fiscal,avaliacao_contabil,avaliacao_folha_pagamento,servicos_contratados,data_envio,fase,created_at,updated_at,empresas:empresa_id(cnpj,segmento,unidade,grupo_id)",
        )
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Joined[];
      for (const r of batch) {
        all.push({
          id: r.id,
          empresa: r.empresa,
          empresa_id: r.empresa_id,
          unidade: r.unidade,
          segmento: r.segmento,
          email_pesquisa: r.email_pesquisa,
          nome_contato: r.nome_contato,
          telefone_pesquisa: r.telefone_pesquisa,
          nps_recomendacao: r.nps_recomendacao,
          avaliacao_fiscal: r.avaliacao_fiscal,
          avaliacao_contabil: r.avaliacao_contabil,
          avaliacao_folha_pagamento: r.avaliacao_folha_pagamento,
          servicos_contratados: r.servicos_contratados,
          data_envio: r.data_envio,
          fase: r.fase,
          created_at: r.created_at,
          updated_at: r.updated_at,
          empresa_cnpj: r.empresas?.cnpj ?? null,
          empresa_segmento: r.empresas?.segmento ?? null,
          empresa_unidade: r.empresas?.unidade ?? null,
          empresa_grupo_id: r.empresas?.grupo_id ?? null,
        });
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
    return { rows: all };
  });
