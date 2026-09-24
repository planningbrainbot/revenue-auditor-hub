import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { acessoDoUsuario } from "@/lib/permissions.functions";
import { gerarLinkDefinirSenha } from "@/lib/admin-users.functions";
import { enviarEmailAcesso as enviarEmail } from "@/lib/email-access.server";
import { emailBoasVindas } from "@/lib/email-templates";

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
    const supabase = context.supabase as Cliente;

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

// ---------------------------------------------------------------------------
// Cadastro e acesso
// ---------------------------------------------------------------------------

/**
 * O que a pessoa recebe no Brain quando entra pelo Planning People.
 * - `colaborador`: a rotina dela. As policies dessas chaves já recortam em
 *   "eu e quem eu lidero", então o gestor enxerga o time sem chave a mais.
 * - `gestao`: quem implanta o módulo na unidade (RH, sócio). Vira
 *   administradora da área `people` no nível "sócio" (`area_admins`), presa à
 *   unidade: tem a área inteira e pode convidar gente para ela em /equipe.
 *   Não dá para ir por chave avulsa: por usuário só vale `view.*` e a exceção
 *   `edit.gente.conversas` (migration 20260924210000, decisão de 24/09/2026).
 * Clima fica fora do colaborador de propósito: ele responde pelo link do
 * e-mail, e `view.gente.clima` mostra quem da unidade foi convidado.
 */
export type PerfilGente = "colaborador" | "gestao";

const CHAVES_COLABORADOR = [
  "view.gente",
  "view.gente.um_a_um",
  "view.gente.feedback",
  "view.gente.elogios",
  "view.gente.lideranca",
  "view.gente.pdi",
  "view.gente.avaliacao",
  "edit.gente.conversas",
];

const PERFIS: PerfilGente[] = ["colaborador", "gestao"];
const ROTULO_PERFIL: Record<PerfilGente, string> = {
  colaborador: "Planning People",
  gestao: "Planning People, gestão de gente da unidade",
};

export interface AcessoResult {
  /** `criado`: conta nova com convite. `vinculado`: já tinha login, só ligou. */
  situacao: "criado" | "vinculado" | "sem_acesso";
  emailEnviado: boolean;
  /** Só quando o e-mail não saiu, para repassar na mão. */
  link: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any;

/**
 * Cadastro de gente vira pessoa no Brain. Antes de 24/09/2026 eram três passos
 * soltos (cadastro, login, escopo) e qualquer um esquecido travava a pessoa.
 *
 * A AUTORIDADE sai do próprio usuário: a pessoa tem que estar visível para ele
 * e o vínculo final (`update user_id`) roda com o cliente dele, então a RLS de
 * `gente_pessoas` (manage.gente + unidade) decide. O service role só entra
 * para o que o usuário comum não alcança: criar a conta e gravar a concessão.
 * `acesso_adicionar_na_area` não serve aqui porque exige nível 2 na área, e o
 * sócio regional tem nível 1 (a área vem do papel, não de delegação).
 *
 * Conta que já existe NÃO ganha nada além do vínculo: pode ser de outra
 * unidade, de admin, ou um pedido de acesso pendente em /equipe.
 */
async function darAcesso(
  db: Cliente,
  ator: string,
  chavesDoAtor: string[],
  pessoaId: number,
  perfil: PerfilGente,
): Promise<AcessoResult> {
  const { data: pessoa, error } = await db
    .from("gente_pessoas")
    .select("id,nome_completo,email,unidade_id,user_id")
    .eq("id", pessoaId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!pessoa) throw new Error("Pessoa não encontrada no seu cadastro.");
  if (pessoa.user_id) return { situacao: "vinculado", emailEnviado: false, link: null };
  if (!pessoa.email) throw new Error("Cadastre o e-mail da pessoa antes de dar acesso.");
  if (!pessoa.unidade_id) throw new Error("Defina a unidade da pessoa antes de dar acesso.");
  if (!chavesDoAtor.includes("manage.gente")) {
    throw new Error("Só quem gere o cadastro de gente pode dar acesso.");
  }

  const email = String(pessoa.email).trim().toLowerCase();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const adm = supabaseAdmin as Cliente;

  const ligar = async (userId: string) => {
    const { data: ok, error: e } = await db
      .from("gente_pessoas")
      .update({ user_id: userId })
      .eq("id", pessoa.id)
      .is("user_id", null)
      .select("id");
    if (e || !ok?.length) {
      throw new Error(e?.message ?? "Sem permissão para alterar esta pessoa.");
    }
  };

  const { data: existente } = await adm
    .from("profiles")
    .select("user_id")
    .ilike("email", email)
    .maybeSingle();
  if (existente?.user_id) {
    await ligar(existente.user_id);
    return { situacao: "vinculado", emailEnviado: false, link: null };
  }

  // Nunca concede o que o ator não tem.
  const chaves =
    perfil === "gestao" ? [] : CHAVES_COLABORADOR.filter((k) => chavesDoAtor.includes(k));

  const { data: criado, error: eCriar } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { nome: pessoa.nome_completo },
  });
  if (eCriar || !criado?.user) {
    console.error("[gente.darAcesso] createUser falhou:", eCriar);
    throw new Error("Não foi possível criar o login. Confira o e-mail.");
  }
  const userId = criado.user.id;

  try {
    // Primeiro o vínculo, que é a prova de autoridade: se a RLS recusar, a
    // conta recém-criada é apagada e nada foi concedido.
    await ligar(userId);

    const passos = await Promise.all([
      adm
        .from("profiles")
        .upsert({ user_id: userId, nome: pessoa.nome_completo, email }, { onConflict: "user_id" }),
      adm
        .schema("public")
        .from("produto_acesso")
        .upsert(
          { user_id: userId, produto: "ops", concedido_por: ator },
          { onConflict: "user_id,produto", ignoreDuplicates: true },
        ),
      adm
        .from("usuario_escopo")
        .upsert(
          { user_id: userId, todas_unidades: false, todas_empresas: false },
          { onConflict: "user_id", ignoreDuplicates: true },
        ),
      adm
        .from("usuario_unidades")
        .upsert(
          { user_id: userId, unidade_id: pessoa.unidade_id },
          { onConflict: "user_id,unidade_id", ignoreDuplicates: true },
        ),
      ...(perfil === "gestao"
        ? [
            adm
              .from("area_admins")
              .upsert(
                { user_id: userId, area: "people", nivel: "socio", concedido_por: ator },
                { onConflict: "user_id,area" },
              ),
          ]
        : [
            adm
              .from("usuario_areas")
              .upsert(
                { user_id: userId, area: "people", allowed: true, concedido_por: ator },
                { onConflict: "user_id,area" },
              ),
            adm.from("usuario_chaves").upsert(
              chaves.map((k) => ({
                user_id: userId,
                permission_key: k,
                allowed: true,
                concedido_por: ator,
              })),
              { onConflict: "user_id,permission_key" },
            ),
          ]),
    ]);
    const falha = passos.find((r: { error?: { message: string } | null }) => r?.error);
    if (falha) throw new Error(falha.error.message);
  } catch (e) {
    await db.from("gente_pessoas").update({ user_id: null }).eq("id", pessoa.id);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    throw e;
  }

  await adm.from("acessos_log").insert({
    ator,
    alvo: userId,
    acao: "gente_dar_acesso",
    area: "people",
    detalhe: { pessoa_id: pessoa.id, unidade_id: pessoa.unidade_id, perfil, chaves },
  });

  let emailEnviado = false;
  let link: string | null = null;
  try {
    link = await gerarLinkDefinirSenha(email);
    const msg = emailBoasVindas({
      nome: pessoa.nome_completo,
      email,
      link,
      papel: ROTULO_PERFIL[perfil],
    });
    const envio = await enviarEmail({ to: email, ...msg });
    emailEnviado = envio.enviado;
  } catch (err) {
    console.error("[gente.darAcesso] convite falhou:", err);
  }
  return { situacao: "criado", emailEnviado, link: emailEnviado ? null : link };
}

export interface NovaPessoaInput {
  nomeCompleto: string;
  email: string;
  unidadeId: number;
  cargo?: string;
  departamento?: string;
  tipoVinculo?: string;
  dataAdmissao?: string;
  gestorId?: number | null;
  /** `null` cadastra sem login (quem não vai usar o Brain). */
  acesso: PerfilGente | null;
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
    const acesso = input.acesso ?? null;
    if (acesso && !PERFIS.includes(acesso)) throw new Error("Perfil de acesso inválido.");
    return {
      nomeCompleto,
      email,
      unidadeId: input.unidadeId,
      cargo: input.cargo?.trim() || null,
      departamento: input.departamento?.trim() || null,
      tipoVinculo,
      dataAdmissao,
      gestorId: input.gestorId ?? null,
      acesso,
    };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;

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

    const id = criada.id as number;
    if (!data.acesso) {
      // Sem login novo, mas se o e-mail já tem conta, liga do mesmo jeito.
      const r = await darAcessoSoVinculo(supabase, id);
      return { id, ...r, erroAcesso: null as string | null };
    }

    // O cadastro já está gravado. Se o acesso falhar, a pessoa fica sem login
    // e a tela oferece "Dar acesso" na linha dela; não desfaz o cadastro.
    try {
      const acesso = await acessoDoUsuario(supabase, context.userId);
      const r = await darAcesso(supabase, context.userId, acesso.permissions, id, data.acesso);
      return { id, ...r, erroAcesso: null as string | null };
    } catch (e) {
      return {
        id,
        situacao: "sem_acesso" as const,
        emailEnviado: false,
        link: null,
        erroAcesso: e instanceof Error ? e.message : "Falha ao criar o acesso.",
      };
    }
  });

/** Liga a pessoa a uma conta que já existe com o mesmo e-mail. Não cria nada. */
async function darAcessoSoVinculo(db: Cliente, pessoaId: number): Promise<AcessoResult> {
  const { data: pessoa } = await db
    .from("gente_pessoas")
    .select("email")
    .eq("id", pessoaId)
    .maybeSingle();
  if (!pessoa?.email) return { situacao: "sem_acesso", emailEnviado: false, link: null };
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: perfil } = await (supabaseAdmin as Cliente)
    .from("profiles")
    .select("user_id")
    .ilike("email", String(pessoa.email).trim())
    .maybeSingle();
  if (!perfil?.user_id) return { situacao: "sem_acesso", emailEnviado: false, link: null };
  const { error } = await db
    .from("gente_pessoas")
    .update({ user_id: perfil.user_id })
    .eq("id", pessoaId)
    .is("user_id", null);
  return { situacao: error ? "sem_acesso" : "vinculado", emailEnviado: false, link: null };
}

/** "Dar acesso" na linha de quem está no cadastro e ainda não tem login. */
export const darAcessoPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pessoaId: number; perfil: PerfilGente }) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    if (!PERFIS.includes(input?.perfil)) throw new Error("Perfil de acesso inválido.");
    return { pessoaId: input.pessoaId, perfil: input.perfil };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;
    const acesso = await acessoDoUsuario(supabase, context.userId);
    return darAcesso(supabase, context.userId, acesso.permissions, data.pessoaId, data.perfil);
  });
