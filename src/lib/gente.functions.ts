import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";

// Cadastro de gente da rede. As 215 primeiras linhas vieram do export do
// Qulture (migration 53 + tools/importar_qulture_gente.py no repo do wiki).
//
// O ISOLAMENTO NÃO MORA AQUI. Quem separa uma unidade da outra é a RLS: a
// policy RESTRICTIVE `gente_pessoas_escopo_unidade` combina por AND com
// qualquer policy de leitura, então `select *` já volta recortado por unidade.
// O `context.supabase` do middleware usa a publishable key com o Bearer do
// usuário, ou seja, roda como ele. Nada de service role nesta tela.
//
// Consequência: quem tem só `view.gente.agregado` (admin, diretor, head) recebe
// no máximo a própria linha em `pessoas`, e a tela cai na visão por unidade.
// Isso é a decisão de governança de 14/09/2026, não um efeito colateral: a
// Matriz vê número por unidade, não nota nominal de quem é empregado da unidade.
//
// `as any` no cliente porque `types.ts` é gerado e ainda não conhece as tabelas
// novas, do mesmo jeito que `cac_apuracao_itens` e `broker_movimentos`.

export interface GentePessoaRow {
  id: number;
  nomeCompleto: string;
  email: string | null;
  cargo: string | null;
  departamento: string | null;
  tipoVinculo: string | null;
  status: string;
  dataAdmissao: string | null;
  unidade: string | null;
  gestorNome: string | null;
  temLogin: boolean;
}

export interface GenteUnidadeRow {
  unidadeId: number;
  unidade: string;
  pessoas: number;
  ativos: number;
  clt: number;
  pj: number;
  socios: number;
  comGestor: number;
  gestores: number;
}

export interface GenteResult {
  pessoas: GentePessoaRow[];
  unidades: GenteUnidadeRow[];
  /** Tem a chave que abre o módulo. Sem ela a tela mostra o aviso de acesso. */
  podeVer: boolean;
  podeIndividual: boolean;
  podeAgregado: boolean;
  podeGerir: boolean;
  /** Pessoas visíveis sem unidade preenchida: contas administrativas do Qulture. */
  semUnidade: number;
}

type PessoaDB = {
  id: number;
  nome_completo: string;
  email: string | null;
  cargo: string | null;
  departamento: string | null;
  tipo_vinculo: string | null;
  status: string;
  data_admissao: string | null;
  user_id: string | null;
  gestor_id: number | null;
  unidade_id: number | null;
};

type UnidadeDB = {
  unidade_id: number;
  unidade: string;
  pessoas: number;
  ativos: number;
  clt: number;
  pj: number;
  socios: number;
  com_gestor: number;
  gestores: number;
};

export const listGente = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GenteResult> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;

    // Resolve pelo mesmo helper que `getMyPermissions` usa. Até 15/09/2026 esta
    // função lia `role_permissions` com a sua própria consulta; com a matriz
    // agora em `role_areas`, a consulta própria viraria uma segunda resposta
    // para a mesma pergunta — e o Gente continuaria liberando pela tabela
    // antiga depois de alguém tirar a área na tela de permissões.
    const acesso = await acessoDoUsuario(supabase, context.userId);

    const [pessoasRes, unidadesRes, praçasRes] = await Promise.all([
      supabase
        .from("gente_pessoas")
        .select(
          "id,nome_completo,email,cargo,departamento,tipo_vinculo,status,data_admissao,user_id,gestor_id,unidade_id",
        )
        .order("nome_completo"),
      supabase.from("v_gente_por_unidade").select("*"),
      supabase.from("unidades").select("id,nome_da_praca"),
    ]);

    const chaves: string[] = acesso.permissions;

    if (pessoasRes?.error && pessoasRes.error.code !== "42P01") {
      throw new Error(pessoasRes.error.message);
    }

    const pessoasDB: PessoaDB[] = (pessoasRes?.data ?? []) as PessoaDB[];
    const unidadesDB: UnidadeDB[] = (unidadesRes?.data ?? []) as UnidadeDB[];
    const praças = new Map<number, string>(
      ((praçasRes?.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => [
        u.id,
        u.nome_da_praca,
      ]),
    );
    const nomePorId = new Map<number, string>(pessoasDB.map((p) => [p.id, p.nome_completo]));

    const pessoas: GentePessoaRow[] = pessoasDB.map((p) => ({
      id: p.id,
      nomeCompleto: p.nome_completo,
      email: p.email,
      cargo: p.cargo,
      departamento: p.departamento,
      tipoVinculo: p.tipo_vinculo,
      status: p.status,
      dataAdmissao: p.data_admissao,
      unidade: p.unidade_id != null ? (praças.get(p.unidade_id) ?? null) : null,
      gestorNome: p.gestor_id != null ? (nomePorId.get(p.gestor_id) ?? null) : null,
      temLogin: !!p.user_id,
    }));

    const unidades: GenteUnidadeRow[] = unidadesDB
      .map((u) => ({
        unidadeId: u.unidade_id,
        unidade: u.unidade,
        pessoas: Number(u.pessoas ?? 0),
        ativos: Number(u.ativos ?? 0),
        clt: Number(u.clt ?? 0),
        pj: Number(u.pj ?? 0),
        socios: Number(u.socios ?? 0),
        comGestor: Number(u.com_gestor ?? 0),
        gestores: Number(u.gestores ?? 0),
      }))
      .sort((a, b) => b.pessoas - a.pessoas);

    // Uma pessoa sempre enxerga a própria linha, então "1 linha" não é sinal de
    // acesso individual. O que distingue é a chave.
    const temChaves = chaves.length > 0;
    const podeIndividual = temChaves
      ? chaves.includes("view.gente.individual") || chaves.includes("manage.gente")
      : pessoas.length > 1;

    return {
      pessoas,
      unidades,
      podeVer: temChaves ? chaves.includes("view.gente") : pessoas.length > 0,
      podeIndividual,
      podeAgregado: temChaves ? chaves.includes("view.gente.agregado") : unidades.length > 0,
      podeGerir: chaves.includes("manage.gente"),
      semUnidade: pessoas.filter((p) => !p.unidade).length,
    };
  });
