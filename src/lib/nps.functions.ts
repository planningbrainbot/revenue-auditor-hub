import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

// URL do webhook n8n que dispara a campanha (workflow "NPS - Criar Card e
// Enviar WhatsApp") — o trigger era manual (só rodava clicando "Execute
// Workflow" na UI do n8n); convertido pra webhook em 24/08/2026 pra virar
// botão no Ops Board. Segurança: token no próprio path (mesmo padrão já
// aceito no webhook de resposta, nps-resposta — sem HMAC, ver
// [[project_n8n_nps_whatsapp]]). Não expor esse valor no client.
const N8N_DISPARO_WEBHOOK_URL = "https://n8n.planningbrain.com.br/webhook/nps-disparar-a8f3c91d";

async function assertCanDispararCampanha(supabase: any) {
  const { data, error } = await supabase.rpc("can", { _key: "view.disparos_whatsapp" });
  if (error) throw new Error("Erro de autorização.");
  if (!data) throw new Error("Acesso negado: você não pode disparar campanhas.");
}

export interface NpsRow {
  id: number;
  pipefy_card_id: string | null;
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
  rodada: string | null;
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
  pipefy_card_id: string | null;
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
  rodada: string | null;
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

    type EmpresaRow = {
      id: number;
      unidade: string | null;
      origem_da_base: string | null;
      tipo_unidade: string | null;
      pipedrive_id: string | null;
    };
    type ContatoRow = { empresa_id: number | null; whatsapp: string | null };

    async function fetchEmpresas(): Promise<EmpresaRow[]> {
      let from = 0;
      const all: EmpresaRow[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from("empresas")
          .select("id,unidade,origem_da_base,tipo_unidade,pipedrive_id")
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = data ?? [];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    // Mesma régua de "cliente ativo" da página /clientes: franquia, unidade
    // regional ativa (tabela `unidades`, tipo='regional') e sem card de churn
    // em central_tratativas. Sem isso o denominador de cobertura de NPS não
    // batia com o que o CS já usa como referência (ex.: Belém 101 "Base Nova"
    // brutas vs. 51 "ativos" reais).
    async function fetchRegionais(): Promise<Set<string>> {
      const { data, error } = await supabase.from("unidades").select("nome_da_praca").eq("tipo", "regional");
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((u) => u.nome_da_praca).filter((v): v is string => !!v));
    }

    async function fetchChurned(): Promise<Set<string>> {
      const { data, error } = await supabase
        .from("central_tratativas")
        .select("pipedrive_deal_id")
        // status="lost" vem do id da fase (PHASE_STATUS), não do nome — robusto a
        // rename. Ver nota em clientes.tsx.
        .eq("status", "lost")
        .limit(2000);
      if (error) throw new Error(error.message);
      return new Set((data ?? []).map((t) => String(t.pipedrive_deal_id)).filter(Boolean));
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

    const [empresasRaw, contatos, pesquisasEmpresaIds, regionais, churned] = await Promise.all([
      fetchEmpresas(),
      fetchContatos(),
      fetchPesquisasEmpresaIds(),
      fetchRegionais(),
      fetchChurned(),
    ]);
    const isAtivo = (e: EmpresaRow) =>
      e.tipo_unidade === "franquia" &&
      regionais.has(e.unidade ?? "") &&
      !(e.pipedrive_id && churned.has(e.pipedrive_id));
    const empresas = empresasRaw.filter(isAtivo);

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
  enviadoEm: string;
  respondido: boolean;
  status: string | null;
  erro: Json | null;
  statusAtualizadoEm: string | null;
  empresa: string | null;
  unidade: string | null;
  rodada: string | null;
  npsRecomendacao: string | null;
  fase: string | null;
  nomeContato: string | null;
  emailPesquisa: string | null;
  avaliacaoFiscal: string | null;
  avaliacaoContabil: string | null;
  avaliacaoFolhaPagamento: string | null;
  servicosContratados: string[] | null;
}

export interface NpsTextoLivreRow {
  id: number;
  telefone: string;
  texto: string | null;
  tipoMensagem: string | null;
  recebidoEm: string;
}

export interface NpsExecucaoResult {
  rows: NpsExecucaoRow[];
  textoLivre: NpsTextoLivreRow[];
  totalEnviados: number;
  totalRespondidos: number;
  totalAguardando: number;
  totalFalhas: number;
  rodadas: string[];
  unidades: string[];
}

export const listNpsExecucao = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<NpsExecucaoResult> => {
    const { supabase } = context;

    const { data: envios, error: erroEnvios } = await supabase
      .from("nps_envio_map")
      .select("id,telefone,pipefy_card_id,nps_pesquisa_id,enviado_em,respondido,status,erro,status_atualizado_em")
      .order("enviado_em", { ascending: false })
      .limit(500);
    if (erroEnvios) throw new Error(erroEnvios.message);

    // Vínculo confiável hoje é nps_pesquisa_id (Supabase direto) — pipefy_card_id
    // fica só como legado dos envios de antes da migração pra escrita direta.
    const pesquisaIds = (envios ?? []).map((e) => e.nps_pesquisa_id).filter((v): v is number => v != null);
    const cardIds = (envios ?? []).map((e) => e.pipefy_card_id).filter((v): v is string => v != null);

    type PesquisaInfo = {
      empresa: string | null;
      unidade: string | null;
      rodada: string | null;
      nps_recomendacao: string | null;
      fase: string | null;
      nome_contato: string | null;
      email_pesquisa: string | null;
      avaliacao_fiscal: string | null;
      avaliacao_contabil: string | null;
      avaliacao_folha_pagamento: string | null;
      servicos_contratados: string[] | null;
    };
    const pesquisaCols =
      "id,pipefy_card_id,empresa,unidade,rodada,nps_recomendacao,fase,nome_contato,email_pesquisa,avaliacao_fiscal,avaliacao_contabil,avaliacao_folha_pagamento,servicos_contratados";
    const porPesquisaId = new Map<number, PesquisaInfo>();
    const porCard = new Map<string, PesquisaInfo>();

    if (pesquisaIds.length > 0) {
      const { data: pesquisas, error } = await supabase.from("nps_pesquisas").select(pesquisaCols).in("id", pesquisaIds);
      if (error) throw new Error(error.message);
      for (const p of pesquisas ?? []) {
        porPesquisaId.set(p.id, p);
      }
    }
    if (cardIds.length > 0) {
      const { data: pesquisas, error } = await supabase.from("nps_pesquisas").select(pesquisaCols).in("pipefy_card_id", cardIds);
      if (error) throw new Error(error.message);
      for (const p of pesquisas ?? []) {
        if (!p.pipefy_card_id) continue;
        porCard.set(p.pipefy_card_id, p);
      }
    }

    const rows: NpsExecucaoRow[] = (envios ?? []).map((e) => {
      const info = (e.nps_pesquisa_id != null ? porPesquisaId.get(e.nps_pesquisa_id) : null) ?? (e.pipefy_card_id ? porCard.get(e.pipefy_card_id) : null);
      return {
        id: e.id,
        telefone: e.telefone,
        enviadoEm: e.enviado_em,
        respondido: e.respondido,
        status: e.status,
        erro: e.erro,
        statusAtualizadoEm: e.status_atualizado_em,
        empresa: info?.empresa ?? null,
        unidade: info?.unidade ?? null,
        rodada: info?.rodada ?? null,
        npsRecomendacao: info?.nps_recomendacao ?? null,
        fase: info?.fase ?? null,
        nomeContato: info?.nome_contato ?? null,
        emailPesquisa: info?.email_pesquisa ?? null,
        avaliacaoFiscal: info?.avaliacao_fiscal ?? null,
        avaliacaoContabil: info?.avaliacao_contabil ?? null,
        avaliacaoFolhaPagamento: info?.avaliacao_folha_pagamento ?? null,
        servicosContratados: info?.servicos_contratados ?? null,
      };
    });

    const { data: textos, error: erroTextos } = await supabase
      .from("nps_mensagens_texto_livre")
      .select("id,telefone,texto,tipo_mensagem,recebido_em")
      .order("recebido_em", { ascending: false })
      .limit(100);
    if (erroTextos) throw new Error(erroTextos.message);

    return {
      rows,
      textoLivre: (textos ?? []).map((t) => ({
        id: t.id,
        telefone: t.telefone,
        texto: t.texto,
        tipoMensagem: t.tipo_mensagem,
        recebidoEm: t.recebido_em,
      })),
      totalEnviados: rows.length,
      totalRespondidos: rows.filter((r) => r.respondido).length,
      totalAguardando: rows.filter((r) => !r.respondido && r.status !== "failed").length,
      totalFalhas: rows.filter((r) => r.status === "failed").length,
      rodadas: Array.from(new Set(rows.map((r) => r.rodada).filter((v): v is string => !!v))).sort().reverse(),
      unidades: Array.from(new Set(rows.map((r) => r.unidade).filter((v): v is string => !!v))).sort(),
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
          "id,pipefy_card_id,empresa,empresa_id,unidade,segmento,email_pesquisa,nome_contato,telefone_pesquisa,nps_recomendacao,avaliacao_fiscal,avaliacao_contabil,avaliacao_folha_pagamento,servicos_contratados,data_envio,rodada,fase,created_at,updated_at,empresas:empresa_id(cnpj,segmento,unidade,grupo_id)",
        )
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as unknown as Joined[];
      for (const r of batch) {
        all.push({
          id: r.id,
          pipefy_card_id: r.pipefy_card_id,
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
          rodada: r.rodada,
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

export interface AudienciaPorUnidadeRow {
  unidade: string;
  totalContatos: number;
  jaDisparados: number;
}

// Lista as unidades com contato de WhatsApp válido pra disparo, cruzando com
// quem já tem pesquisa enviada — alimenta o seletor do botão "Disparar".
export const listAudienciaPorUnidade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ rows: AudienciaPorUnidadeRow[] }> => {
    const { supabase } = context;
    const pageSize = 1000;

    async function fetchAll<T>(table: string, columns: string): Promise<T[]> {
      let from = 0;
      const all: T[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as T[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    const audiencia = await fetchAll<{ unidade: string | null }>("nps_audiencia", "unidade");
    const pesquisas = await fetchAll<{ unidade: string | null }>("nps_pesquisas", "unidade");

    const jaDisparadosPorUnidade = new Map<string, number>();
    for (const p of pesquisas) {
      if (!p.unidade) continue;
      jaDisparadosPorUnidade.set(p.unidade, (jaDisparadosPorUnidade.get(p.unidade) ?? 0) + 1);
    }

    const map = new Map<string, number>();
    for (const a of audiencia) {
      if (!a.unidade) continue;
      map.set(a.unidade, (map.get(a.unidade) ?? 0) + 1);
    }

    const rows = Array.from(map.entries())
      .map(([unidade, totalContatos]) => ({
        unidade,
        totalContatos,
        jaDisparados: jaDisparadosPorUnidade.get(unidade) ?? 0,
      }))
      .sort((a, b) => a.unidade.localeCompare(b.unidade, "pt-BR"));

    return { rows };
  });

// Dispara a campanha real de WhatsApp pra uma unidade — chama o webhook do
// n8n (workflow "NPS - Criar Card e Enviar WhatsApp"), que busca a
// audiência, cria as pesquisas e envia o template via WhatsApp Cloud API.
// Ação real e outward-facing: manda mensagem de verdade pra clientes reais.
export const dispararCampanhaNps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { unidade: string }) => d)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase } = context;
    await assertCanDispararCampanha(supabase);

    const unidade = data.unidade?.trim();
    if (!unidade) throw new Error("Selecione uma unidade.");

    const res = await fetch(N8N_DISPARO_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unidade }),
    });
    if (!res.ok) throw new Error(`Falha ao acionar o disparo (HTTP ${res.status}).`);

    return { ok: true };
  });
