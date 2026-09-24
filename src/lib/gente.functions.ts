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
  /** Unidades em que quem está logado pode cadastrar gente. Vazio se não pode gerir. */
  unidadesCadastro: { id: number; nome: string }[];
  /** Candidatos a gestor no formulário de cadastro: ativos visíveis. */
  gestores: { id: number; nome: string; unidadeId: number | null }[];
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

    const [pessoasRes, unidadesRes, praçasRes, soMinhaRes, minhasRes] = await Promise.all([
      supabase
        .from("gente_pessoas")
        .select(
          "id,nome_completo,email,cargo,departamento,tipo_vinculo,status,data_admissao,user_id,gestor_id,unidade_id",
        )
        .order("nome_completo"),
      supabase.from("v_gente_por_unidade").select("*"),
      supabase.from("unidades").select("id,nome_da_praca"),
      // As duas perguntas que a RLS de escrita faz, feitas antes para o
      // formulário só oferecer unidade em que o insert vai passar.
      supabase.rpc("can", { _key: "data.scope.own_unit_only" }),
      supabase.rpc("minhas_unidades_gente"),
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

    const podeGerir = chaves.includes("manage.gente");
    const minhas = new Set<number>((minhasRes?.data ?? []) as number[]);
    const soMinha = soMinhaRes?.data === true;
    const unidadesCadastro = podeGerir
      ? Array.from(praças.entries())
          .filter(([id]) => !soMinha || minhas.has(id))
          .map(([id, nome]) => ({ id, nome }))
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
      : [];

    return {
      pessoas,
      unidades,
      podeVer: temChaves ? chaves.includes("view.gente") : pessoas.length > 0,
      podeIndividual,
      podeAgregado: temChaves ? chaves.includes("view.gente.agregado") : unidades.length > 0,
      podeGerir,
      semUnidade: pessoas.filter((p) => !p.unidade).length,
      unidadesCadastro,
      gestores: pessoasDB
        .filter((p) => p.status === "ativo")
        .map((p) => ({ id: p.id, nome: p.nome_completo, unidadeId: p.unidade_id })),
    };
  });

export interface NovaPessoaInput {
  nomeCompleto: string;
  email: string;
  unidadeId: number;
  cargo?: string;
  departamento?: string;
  tipoVinculo?: string;
  dataAdmissao?: string;
  gestorId?: number | null;
}

const VINCULOS = ["socio", "clt", "pj", "estagio", "prolabore", "terceiro"];

// Cadastro manual, feito por quem implanta o módulo na unidade. Até 24/09/2026
// não existia: as 215 pessoas vieram do import do Qulture e as unidades de
// 2026 (Maceió, Fortaleza, São Luís, Campo Novo) não tinham como entrar.
//
// Quem pode é decidido pela RLS, não aqui: `gente_pessoas_write` pede
// `manage.gente` e a RESTRICTIVE `gente_pessoas_escopo_unidade` prende o
// sócio regional na unidade dele. O insert roda como o usuário.
export const criarPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: NovaPessoaInput) => {
    const nomeCompleto = (input?.nomeCompleto ?? "").trim().replace(/\s+/g, " ");
    if (nomeCompleto.split(" ").length < 2) throw new Error("Informe nome e sobrenome.");
    const email = (input?.email ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("E-mail inválido.");
    if (!Number.isInteger(input?.unidadeId)) throw new Error("Escolha a unidade.");
    const tipoVinculo = input.tipoVinculo || null;
    if (tipoVinculo && !VINCULOS.includes(tipoVinculo)) throw new Error("Vínculo inválido.");
    const dataAdmissao = input.dataAdmissao || null;
    if (dataAdmissao && !/^\d{4}-\d{2}-\d{2}$/.test(dataAdmissao)) {
      throw new Error("Data de admissão inválida.");
    }
    return {
      nomeCompleto,
      email,
      unidadeId: input.unidadeId,
      cargo: input.cargo?.trim() || null,
      departamento: input.departamento?.trim() || null,
      tipoVinculo,
      dataAdmissao,
      gestorId: input.gestorId ?? null,
    };
  })
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = context.supabase as any;

    const { data: criada, error } = await supabase
      .from("gente_pessoas")
      .insert({
        nome_completo: data.nomeCompleto,
        email: data.email,
        unidade_id: data.unidadeId,
        cargo: data.cargo,
        departamento: data.departamento,
        tipo_vinculo: data.tipoVinculo,
        data_admissao: data.dataAdmissao,
        gestor_id: data.gestorId,
        status: "ativo",
        origem: "manual",
      })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new Error(
          "Já existe alguém com esse e-mail no cadastro da rede. Se for de outra unidade, peça à Matriz para transferir.",
        );
      }
      if (error.code === "42501") {
        throw new Error("Sem permissão para cadastrar gente nessa unidade.");
      }
      throw new Error(error.message);
    }

    // Login e cadastro são duas identidades. Sem `user_id` a pessoa entra no
    // Ops e 1:1 e feedback barram em silêncio (memória de 22/09/2026). Se o
    // e-mail já tem conta, liga agora. A busca em `profiles` precisa de service
    // role porque o usuário comum só lê a própria linha; a escrita não. Quem
    // ganhar login depois continua precisando do vínculo à mão.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: perfil } = await (supabaseAdmin as any)
      .from("profiles")
      .select("user_id")
      .ilike("email", data.email)
      .maybeSingle();

    let vinculouLogin = false;
    if (perfil?.user_id) {
      const { error: e2 } = await supabase
        .from("gente_pessoas")
        .update({ user_id: perfil.user_id })
        .eq("id", criada.id)
        .is("user_id", null);
      vinculouLogin = !e2;
    }

    return { id: criada.id as number, vinculouLogin };
  });
