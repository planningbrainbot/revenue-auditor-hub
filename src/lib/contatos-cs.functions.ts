import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Plano de ação de contatos pro time de CS: toda empresa (Base Nova ou
// Antiga) precisa de pelo menos 1 contato com WhatsApp válido vinculado —
// hoje só ~21% tem. Essa tela vira a lista de trabalho: quem não tem nada,
// quem tem contato mas sem WhatsApp, e quem tem contato solto (sem empresa
// vinculada) esperando classificação.

export interface EmpresaSemContatoRow {
  id: number;
  titulo: string | null;
  cnpj: string | null;
  unidade: string;
  origemDaBase: string | null;
  status: "sem_contato" | "contato_sem_whatsapp";
  contatosNomes: string[];
}

export interface ContatoParaClassificarRow {
  id: number;
  nomeCompleto: string | null;
  whatsapp: string | null;
  email: string | null;
  cargo: string | null;
}

export interface PlanoAcaoContatosResult {
  empresasSemContato: EmpresaSemContatoRow[];
  contatosParaClassificar: ContatoParaClassificarRow[];
  totalEmpresas: number;
  totalComContatoValido: number;
  unidades: string[];
}

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

export const listPlanoAcaoContatos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlanoAcaoContatosResult> => {
    const { supabase } = context;
    const pageSize = 1000;

    type EmpresaRow = {
      id: number;
      titulo: string | null;
      cnpj: string | null;
      unidade: string | null;
      origem_da_base: string | null;
      tipo_unidade: string | null;
      pipedrive_id: string | null;
    };
    type ContatoRow = {
      id: number;
      nome_completo: string | null;
      whatsapp: string | null;
      email: string | null;
      cargo: string | null;
      empresa_id: number | null;
    };

    async function fetchAll<T>(table: "empresas" | "contatos", columns: string): Promise<T[]> {
      let from = 0;
      const all: T[] = [];
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase
          .from(table)
          .select(columns)
          .range(from, from + pageSize - 1);
        if (error) throw new Error(error.message);
        const batch = (data ?? []) as unknown as T[];
        all.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
      }
      return all;
    }

    const empresasRaw = await fetchAll<EmpresaRow>(
      "empresas",
      "id,titulo,cnpj,unidade,origem_da_base,tipo_unidade,pipedrive_id",
    );
    const contatos = await fetchAll<ContatoRow>(
      "contatos",
      "id,nome_completo,whatsapp,email,cargo,empresa_id",
    );

    // Mesma régua de "cliente ativo" da página /clientes e da cobertura de
    // NPS: franquia, unidade regional ativa e sem card de churn em
    // Tratativas — plano de ação do CS só faz sentido pra quem é cliente
    // ativo de verdade, não pra base bruta de `empresas`.
    const { data: regionaisData, error: erroRegionais } = await supabase
      .from("unidades")
      .select("nome_da_praca")
      .eq("tipo", "regional");
    if (erroRegionais) throw new Error(erroRegionais.message);
    const regionais = new Set(
      (regionaisData ?? []).map((u) => u.nome_da_praca).filter((v): v is string => !!v),
    );

    const { data: churnData, error: erroChurn } = await supabase
      .from("central_tratativas")
      .select("pipedrive_deal_id")
      .eq("estagio", "Perdido")
      .eq("status", "lost")
      .limit(2000);
    if (erroChurn) throw new Error(erroChurn.message);
    const churned = new Set((churnData ?? []).map((t) => String(t.pipedrive_deal_id)).filter(Boolean));

    const empresas = empresasRaw.filter(
      (e) =>
        e.tipo_unidade === "franquia" &&
        regionais.has(e.unidade ?? "") &&
        !(e.pipedrive_id && churned.has(e.pipedrive_id)),
    );

    const contatosPorEmpresa = new Map<number, ContatoRow[]>();
    const contatosSemEmpresa: ContatoRow[] = [];
    for (const c of contatos) {
      if (c.empresa_id == null) {
        contatosSemEmpresa.push(c);
        continue;
      }
      const list = contatosPorEmpresa.get(c.empresa_id) ?? [];
      list.push(c);
      contatosPorEmpresa.set(c.empresa_id, list);
    }

    const empresasSemContato: EmpresaSemContatoRow[] = [];
    let totalComContatoValido = 0;
    const unidadesSet = new Set<string>();

    for (const e of empresas) {
      const unidade = normalizeUnidade(e.unidade);
      unidadesSet.add(unidade);
      const seusContatos = contatosPorEmpresa.get(e.id) ?? [];
      const temValido = seusContatos.some((c) => hasValidWhatsapp(c.whatsapp));
      if (temValido) {
        totalComContatoValido += 1;
        continue;
      }
      empresasSemContato.push({
        id: e.id,
        titulo: e.titulo,
        cnpj: e.cnpj,
        unidade,
        origemDaBase: e.origem_da_base,
        status: seusContatos.length === 0 ? "sem_contato" : "contato_sem_whatsapp",
        contatosNomes: seusContatos.map((c) => c.nome_completo).filter((n): n is string => !!n),
      });
    }

    empresasSemContato.sort((a, b) => {
      if (a.unidade !== b.unidade) return a.unidade.localeCompare(b.unidade);
      return (a.titulo ?? "").localeCompare(b.titulo ?? "");
    });

    const contatosParaClassificar: ContatoParaClassificarRow[] = contatosSemEmpresa.map((c) => ({
      id: c.id,
      nomeCompleto: c.nome_completo,
      whatsapp: c.whatsapp,
      email: c.email,
      cargo: c.cargo,
    }));

    return {
      empresasSemContato,
      contatosParaClassificar,
      totalEmpresas: empresas.length,
      totalComContatoValido,
      unidades: Array.from(unidadesSet).sort(),
    };
  });
