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
  dataNascimento: string | null;
  /** Afastamento em aberto. O CID só vem para quem tem `manage.gente.saude`. */
  afastamento: {
    inicio: string;
    motivo: string;
    previsaoRetorno: string | null;
    cid: string | null;
  } | null;
  unidade: string | null;
  gestorNome: string | null;
  /** Para o formulário de edição abrir com o gestor e a unidade atuais. */
  gestorId: number | null;
  unidadeId: number | null;
  temLogin: boolean;
  dataDesligamento: string | null;
  motivoDesligamento: string | null;
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
  /** Lê e registra CID de afastamento (área restrita do RH). */
  podeSaude: boolean;
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
  data_nascimento: string | null;
  user_id: string | null;
  gestor_id: number | null;
  unidade_id: number | null;
  data_desligamento: string | null;
  motivo_desligamento: string | null;
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

    const [pessoasRes, unidadesRes, praçasRes, soMinhaRes, minhasRes, afastRes, cidRes] =
      await Promise.all([
        supabase
          .from("gente_pessoas")
          .select(
            "id,nome_completo,email,cargo,departamento,tipo_vinculo,status,data_admissao,data_nascimento,user_id,gestor_id,unidade_id,data_desligamento,motivo_desligamento",
          )
          .order("nome_completo"),
        supabase.from("v_gente_por_unidade").select("*"),
        supabase.from("unidades").select("id,nome_da_praca"),
        // As duas perguntas que a RLS de escrita faz, feitas antes para o
        // formulário só oferecer unidade em que o insert vai passar.
        supabase.rpc("can", { _key: "data.scope.own_unit_only" }),
        supabase.rpc("minhas_unidades_gente"),
        // Afastamentos em aberto (migration 20261005130000). O CID vem de outra
        // tabela, que a RLS só abre para o RH; para os demais volta vazio.
        supabase
          .from("gente_afastamentos")
          .select("id,pessoa_id,inicio,motivo,previsao_retorno")
          .is("retorno_em", null),
        supabase.from("gente_afastamento_cid").select("afastamento_id,cid"),
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

    const cidPor = new Map<number, string>(
      ((cidRes?.data ?? []) as { afastamento_id: number; cid: string }[]).map((c) => [
        c.afastamento_id,
        c.cid,
      ]),
    );
    const afastPorPessoa = new Map<number, NonNullable<GentePessoaRow["afastamento"]>>(
      (
        (afastRes?.data ?? []) as {
          id: number;
          pessoa_id: number;
          inicio: string;
          motivo: string;
          previsao_retorno: string | null;
        }[]
      ).map((a) => [
        a.pessoa_id,
        {
          inicio: a.inicio,
          motivo: a.motivo,
          previsaoRetorno: a.previsao_retorno,
          cid: cidPor.get(a.id) ?? null,
        },
      ]),
    );

    const pessoas: GentePessoaRow[] = pessoasDB.map((p) => ({
      id: p.id,
      nomeCompleto: p.nome_completo,
      email: p.email,
      cargo: p.cargo,
      departamento: p.departamento,
      tipoVinculo: p.tipo_vinculo,
      status: p.status,
      dataAdmissao: p.data_admissao,
      dataNascimento: p.data_nascimento,
      afastamento: afastPorPessoa.get(p.id) ?? null,
      unidade: p.unidade_id != null ? (praças.get(p.unidade_id) ?? null) : null,
      gestorNome: p.gestor_id != null ? (nomePorId.get(p.gestor_id) ?? null) : null,
      gestorId: p.gestor_id,
      unidadeId: p.unidade_id,
      temLogin: !!p.user_id,
      dataDesligamento: p.data_desligamento,
      motivoDesligamento: p.motivo_desligamento,
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
      podeSaude: chaves.includes("manage.gente.saude"),
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
/**
 * Uma conta que JÁ existe só pode ser ligada a um cadastro do Gente por quem
 * responde por ela: a conta tem de estar em branco (sem perfil, área nem
 * recorte) ou com todas as unidades dentro do recorte de quem liga, e nunca ser
 * de super admin. Sem isto, um sócio que cadastrasse no Gente o e-mail de
 * alguém da Matriz virava gestor dessa pessoa no People e lia os 1:1 e PDIs
 * dela (auditoria de 24/09/2026).
 */
async function podeLigarConta(
  db: Cliente,
  adm: Cliente,
  ator: string,
  alvo: string,
): Promise<boolean> {
  if (alvo === ator) return true;
  const [papeis, areas, admins, escopo, unidades] = await Promise.all([
    adm.from("user_roles").select("role").eq("user_id", alvo),
    adm.from("usuario_areas").select("area").eq("user_id", alvo).limit(1),
    adm.from("area_admins").select("area").eq("user_id", alvo).limit(1),
    adm.from("usuario_escopo").select("todas_unidades").eq("user_id", alvo).maybeSingle(),
    adm.from("usuario_unidades").select("unidade_id").eq("user_id", alvo).limit(1),
  ]);
  const roles = ((papeis.data ?? []) as { role: string }[]).map((r) => r.role);
  if (roles.includes("admin")) return false;
  const emBranco =
    !roles.length &&
    !(areas.data ?? []).length &&
    !(admins.data ?? []).length &&
    !escopo.data?.todas_unidades &&
    !(unidades.data ?? []).length;
  if (emBranco) return true;
  if (!(unidades.data ?? []).length && !escopo.data?.todas_unidades) return false;
  const { data: contido } = await db.rpc("escopo_contido", { _alvo: alvo, _ator: ator });
  return Boolean(contido);
}

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
  // "Gestão de gente" dá o nível sócio da área People. Só o admin de People
  // (ou o super admin) concede: é a regra de não escalada de 17/09, que o dono
  // confirmou para este perfil em 25/09/2026. Antes um sócio regional, que é
  // nível 1 em People pelo perfil, criava alguém no nível 2.
  if (perfil === "gestao") {
    const { data: nivel } = await db.rpc("nivel_na_area", { _user: ator, _area: "people" });
    if (Number(nivel ?? 0) < 3) {
      throw new Error("O perfil de gestão de gente só é dado pelo admin de Planning People.");
    }
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
    .eq("email", email)
    .maybeSingle();
  if (existente?.user_id) {
    if (!(await podeLigarConta(db, adm, ator, existente.user_id))) {
      throw new Error(
        "Este e-mail já tem conta no Brain fora da sua unidade. Peça à Matriz para ligar o cadastro.",
      );
    }
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
  dataNascimento?: string;
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
    const dataNascimento = input.dataNascimento || null;
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      throw new Error("Data de nascimento inválida.");
    }
    const acesso = input.acesso ?? null;
    if (acesso && !PERFIS.includes(acesso)) throw new Error("Perfil de acesso inválido.");
    return {
      nomeCompleto,
      email,
      dataNascimento,
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
        data_nascimento: data.dataNascimento,
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
      const r = await darAcessoSoVinculo(supabase, context.userId, id);
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
async function darAcessoSoVinculo(
  db: Cliente,
  ator: string,
  pessoaId: number,
): Promise<AcessoResult> {
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
    .eq("email", String(pessoa.email).trim().toLowerCase())
    .maybeSingle();
  if (!perfil?.user_id) return { situacao: "sem_acesso", emailEnviado: false, link: null };
  if (!(await podeLigarConta(db, supabaseAdmin, ator, perfil.user_id))) {
    return { situacao: "sem_acesso", emailEnviado: false, link: null };
  }
  const { error } = await db
    .from("gente_pessoas")
    .update({ user_id: perfil.user_id })
    .eq("id", pessoaId)
    .is("user_id", null);
  return { situacao: error ? "sem_acesso" : "vinculado", emailEnviado: false, link: null };
}

export interface EditarPessoaInput {
  pessoaId: number;
  nomeCompleto: string;
  cargo?: string;
  departamento?: string;
  tipoVinculo?: string;
  dataAdmissao?: string;
  dataNascimento?: string;
  gestorId?: number | null;
}

// Edição do cadastro pelo RH da unidade (pedido de 28/09/2026: a unidade
// cadastra sem setor enquanto o organograma está em construção e completa
// depois). O update roda como o usuário: `gente_pessoas_write` pede
// `manage.gente` e a RESTRICTIVE prende na unidade.
//
// Fora de propósito: e-mail (é a chave que liga o login), unidade
// (transferência é com a Matriz) e status (desligar precisa revogar o acesso,
// o que esta tela ainda não faz).
export const editarPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: EditarPessoaInput) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    const nomeCompleto = (input?.nomeCompleto ?? "").trim().replace(/\s+/g, " ");
    if (nomeCompleto.split(" ").length < 2) throw new Error("Informe nome e sobrenome.");
    const tipoVinculo = input.tipoVinculo || null;
    if (tipoVinculo && !VINCULOS.includes(tipoVinculo)) throw new Error("Vínculo inválido.");
    const dataNascimento = input.dataNascimento || null;
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      throw new Error("Data de nascimento inválida.");
    }
    const dataAdmissao = input.dataAdmissao || null;
    if (dataAdmissao && !/^\d{4}-\d{2}-\d{2}$/.test(dataAdmissao)) {
      throw new Error("Data de admissão inválida.");
    }
    const gestorId = input.gestorId ?? null;
    if (gestorId != null && !Number.isInteger(gestorId)) throw new Error("Gestor inválido.");
    if (gestorId === input.pessoaId) throw new Error("A pessoa não pode ser gestora de si mesma.");
    return {
      pessoaId: input.pessoaId,
      nomeCompleto,
      cargo: input.cargo?.trim() || null,
      departamento: input.departamento?.trim() || null,
      tipoVinculo,
      dataAdmissao,
      dataNascimento,
      gestorId,
    };
  })
  .handler(async ({ data, context }) => {
    const supabase = context.supabase as Cliente;

    // Ciclo na hierarquia: sobe a partir do novo gestor; se chegar na própria
    // pessoa, ela viraria gestora de quem a gere.
    if (data.gestorId != null) {
      const { data: todos, error: eH } = await supabase
        .from("gente_pessoas")
        .select("id,gestor_id,status")
        .order("id")
        .range(0, 4999);
      if (eH) throw new Error(eH.message);
      const chefe = new Map<number, number | null>(
        ((todos ?? []) as { id: number; gestor_id: number | null }[]).map((p) => [
          p.id,
          p.gestor_id,
        ]),
      );
      const g = ((todos ?? []) as { id: number; status: string }[]).find(
        (p) => p.id === data.gestorId,
      );
      if (!g || g.status !== "ativo")
        throw new Error("O gestor escolhido não está no cadastro ativo.");
      let atual: number | null | undefined = data.gestorId;
      for (let i = 0; atual != null && i < 100; i++) {
        if (atual === data.pessoaId) {
          throw new Error(
            "Esse gestor é liderado por esta pessoa. A hierarquia ficaria em círculo.",
          );
        }
        atual = chefe.get(atual);
      }
    }

    const { data: ok, error } = await supabase
      .from("gente_pessoas")
      .update({
        nome_completo: data.nomeCompleto,
        cargo: data.cargo,
        departamento: data.departamento,
        tipo_vinculo: data.tipoVinculo,
        data_admissao: data.dataAdmissao,
        data_nascimento: data.dataNascimento,
        gestor_id: data.gestorId,
      })
      .eq("id", data.pessoaId)
      .select("id");
    if (error) {
      if (error.code === "42501") throw new Error("Sem permissão para alterar esta pessoa.");
      throw new Error(error.message);
    }
    // RLS que recusa update não dá erro, só volta vazio.
    if (!ok?.length) throw new Error("Sem permissão para alterar esta pessoa.");
    return { id: data.pessoaId };
  });

export interface GestorLoteResult {
  alterados: number;
  ignorados: { nome: string; motivo: string }[];
}

// Definir o gestor de várias pessoas de uma vez (05/10/2026, pedido do RH de
// Maceió: 21 pessoas do Fiscal sem gestor, e o líder só enxerga como time quem
// o tem no campo Gestor). Mesma regra do `editarPessoa`: roda como o usuário,
// a RLS prende na unidade, e quem criaria círculo na hierarquia fica de fora.
export const definirGestorEmLote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pessoaIds: number[]; gestorId: number | null }) => {
    const ids = Array.from(new Set(Array.isArray(input?.pessoaIds) ? input.pessoaIds : []));
    if (!ids.length) throw new Error("Selecione ao menos uma pessoa.");
    if (ids.length > 500) throw new Error("No máximo 500 pessoas por vez.");
    if (ids.some((i) => !Number.isInteger(i))) throw new Error("Pessoa inválida.");
    const gestorId = input.gestorId ?? null;
    if (gestorId != null && !Number.isInteger(gestorId)) throw new Error("Gestor inválido.");
    return { pessoaIds: ids, gestorId };
  })
  .handler(async ({ data, context }): Promise<GestorLoteResult> => {
    const supabase = context.supabase as Cliente;

    type P = { id: number; nome_completo: string; gestor_id: number | null; status: string };
    const visiveis: P[] = [];
    for (let de = 0; ; de += 1000) {
      const { data: pag, error } = await supabase
        .from("gente_pessoas")
        .select("id,nome_completo,gestor_id,status")
        .order("id")
        .range(de, de + 999);
      if (error) throw new Error(error.message);
      visiveis.push(...((pag ?? []) as P[]));
      if (!pag || pag.length < 1000) break;
    }
    const porId = new Map(visiveis.map((p) => [p.id, p]));

    if (data.gestorId != null) {
      const g = porId.get(data.gestorId);
      if (!g || g.status !== "ativo")
        throw new Error("O gestor escolhido não está no cadastro ativo.");
    }

    const ignorados: GestorLoteResult["ignorados"] = [];
    const validos: number[] = [];
    for (const id of data.pessoaIds) {
      const p = porId.get(id);
      if (!p) {
        ignorados.push({ nome: `#${id}`, motivo: "fora do seu cadastro" });
        continue;
      }
      if (data.gestorId != null) {
        if (id === data.gestorId) {
          ignorados.push({ nome: p.nome_completo, motivo: "é o próprio gestor escolhido" });
          continue;
        }
        // Subindo a partir do gestor: se passar pela pessoa, ela lidera o gestor.
        let atual: number | null | undefined = data.gestorId;
        let ciclo = false;
        for (let i = 0; atual != null && i < 100; i++) {
          if (atual === id) {
            ciclo = true;
            break;
          }
          atual = porId.get(atual)?.gestor_id;
        }
        if (ciclo) {
          ignorados.push({
            nome: p.nome_completo,
            motivo: "está acima do gestor escolhido na hierarquia",
          });
          continue;
        }
      }
      if (p.gestor_id === data.gestorId) continue;
      validos.push(id);
    }

    let alterados = 0;
    if (validos.length) {
      const { data: ok, error } = await supabase
        .from("gente_pessoas")
        .update({ gestor_id: data.gestorId })
        .in("id", validos)
        .select("id");
      if (error) {
        if (error.code === "42501") throw new Error("Sem permissão para alterar essas pessoas.");
        throw new Error(error.message);
      }
      alterados = ok?.length ?? 0;
      const voltaram = new Set(((ok ?? []) as { id: number }[]).map((r) => r.id));
      for (const id of validos) {
        if (!voltaram.has(id)) {
          ignorados.push({
            nome: porId.get(id)?.nome_completo ?? `#${id}`,
            motivo: "sem permissão",
          });
        }
      }
    }
    return { alterados, ignorados };
  });

/** Para o import: preenche nascimento/admissão vazios de quem já existe. */
async function completarDatas(
  db: Cliente,
  l: { email: string; dataNascimento: string | null; dataAdmissao: string | null },
): Promise<string[]> {
  // `ilike` sem curinga, porque o e-mail do Qulture às vezes tem maiúscula.
  const email = l.email.replace(/[\\%_]/g, (c) => `\\${c}`);
  const feitos: string[] = [];
  for (const [coluna, valor, rotulo] of [
    ["data_nascimento", l.dataNascimento, "nascimento"],
    ["data_admissao", l.dataAdmissao, "admissão"],
  ] as const) {
    if (!valor) continue;
    const { data: ok } = await db
      .from("gente_pessoas")
      .update({ [coluna]: valor })
      .ilike("email", email)
      .is(coluna, null)
      .select("id");
    if (ok?.length) feitos.push(rotulo);
  }
  return feitos;
}

export interface LinhaImportacao {
  /** Número da linha na planilha, só para o relatório voltar apontando. */
  linha: number;
  nomeCompleto: string;
  email: string;
  cargo?: string;
  departamento?: string;
  tipoVinculo?: string;
  dataAdmissao?: string;
  dataNascimento?: string;
  /** E-mail do gestor: alguém já no cadastro ou outra linha da mesma planilha. */
  emailGestor?: string;
}

export interface ResultadoLinha {
  linha: number;
  email: string;
  situacao: "criada" | "ja_existe" | "erro";
  mensagem: string | null;
  /** Só quando o gestor informado não foi achado; a pessoa entra sem gestor. */
  avisoGestor: string | null;
  acesso: AcessoResult["situacao"] | null;
  /** Convite que não saiu por e-mail, para repassar na mão. */
  link: string | null;
}

const MAX_LINHAS_IMPORTACAO = 300;

// Import em lote pelo RH da unidade (pedido de 28/09/2026). Mesmo caminho do
// `criarPessoa`: o insert roda como o usuário, então a RLS decide a unidade.
// Duas passadas porque o gestor pode ser outra linha da mesma planilha: primeiro
// entram todos sem gestor, depois o gestor é ligado por e-mail.
//
// Acesso em lote é só `colaborador` ou nenhum. "Gestão de gente" é concessão de
// nível sócio e continua sendo dada uma a uma, pelo "Dar acesso".
export const importarPessoas = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { unidadeId: number; linhas: LinhaImportacao[]; acesso: "colaborador" | null }) => {
      if (!Number.isInteger(input?.unidadeId)) throw new Error("Escolha a unidade.");
      const linhas = Array.isArray(input?.linhas) ? input.linhas : [];
      if (!linhas.length) throw new Error("A planilha não tem nenhuma linha válida.");
      if (linhas.length > MAX_LINHAS_IMPORTACAO) {
        throw new Error(`Importe no máximo ${MAX_LINHAS_IMPORTACAO} pessoas por vez.`);
      }
      const acesso = input.acesso ?? null;
      if (acesso && acesso !== "colaborador") throw new Error("Perfil de acesso inválido.");
      return {
        unidadeId: input.unidadeId,
        acesso,
        linhas: linhas.map((l) => ({
          linha: Number(l.linha),
          nomeCompleto: String(l.nomeCompleto ?? "")
            .trim()
            .replace(/\s+/g, " "),
          email: String(l.email ?? "")
            .trim()
            .toLowerCase(),
          cargo: l.cargo?.trim() || null,
          departamento: l.departamento?.trim() || null,
          tipoVinculo: l.tipoVinculo || null,
          dataAdmissao: l.dataAdmissao || null,
          dataNascimento: l.dataNascimento || null,
          emailGestor: l.emailGestor?.trim().toLowerCase() || null,
        })),
      };
    },
  )
  .handler(async ({ data, context }): Promise<{ resultados: ResultadoLinha[] }> => {
    const supabase = context.supabase as Cliente;
    const resultados: ResultadoLinha[] = [];
    const vistos = new Set<string>();
    const criados: { id: number; r: ResultadoLinha; emailGestor: string | null }[] = [];

    const erro = (l: { linha: number; email: string }, mensagem: string): ResultadoLinha => ({
      linha: l.linha,
      email: l.email,
      situacao: "erro",
      mensagem,
      avisoGestor: null,
      acesso: null,
      link: null,
    });

    for (const l of data.linhas) {
      // O cliente já valida, mas a regra que vale é a daqui.
      if (l.nomeCompleto.split(" ").length < 2) {
        resultados.push(erro(l, "Informe nome e sobrenome."));
        continue;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email)) {
        resultados.push(erro(l, "E-mail inválido."));
        continue;
      }
      if (vistos.has(l.email)) {
        resultados.push(erro(l, "E-mail repetido na planilha."));
        continue;
      }
      vistos.add(l.email);
      if (l.tipoVinculo && !VINCULOS.includes(l.tipoVinculo)) {
        resultados.push(erro(l, "Vínculo inválido."));
        continue;
      }
      if (l.dataAdmissao && !/^\d{4}-\d{2}-\d{2}$/.test(l.dataAdmissao)) {
        resultados.push(erro(l, "Data de admissão inválida."));
        continue;
      }
      if (l.dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(l.dataNascimento)) {
        resultados.push(erro(l, "Data de nascimento inválida."));
        continue;
      }

      const { data: criada, error } = await supabase
        .from("gente_pessoas")
        .insert({
          nome_completo: l.nomeCompleto,
          email: l.email,
          unidade_id: data.unidadeId,
          cargo: l.cargo,
          departamento: l.departamento,
          tipo_vinculo: l.tipoVinculo,
          data_admissao: l.dataAdmissao,
          data_nascimento: l.dataNascimento,
          status: "ativo",
          origem: "planilha",
        })
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          // Já cadastrada: completa só nascimento e admissão que estiverem
          // VAZIOS (05/10/2026, Maceió entrou sem data de nascimento). Nada que
          // já tenha valor é sobrescrito, e a RLS só deixa tocar na unidade.
          const completou = await completarDatas(supabase, l);
          resultados.push({
            ...erro(
              l,
              completou.length
                ? `Já estava no cadastro. Completado: ${completou.join(" e ")}.`
                : "Já está no cadastro da rede. Não foi alterada.",
            ),
            situacao: "ja_existe",
          });
        } else if (error.code === "42501") {
          resultados.push(erro(l, "Sem permissão para cadastrar gente nessa unidade."));
        } else {
          resultados.push(erro(l, error.message));
        }
        continue;
      }

      const r: ResultadoLinha = {
        linha: l.linha,
        email: l.email,
        situacao: "criada",
        mensagem: null,
        avisoGestor: null,
        acesso: null,
        link: null,
      };
      resultados.push(r);
      criados.push({ id: criada.id as number, r, emailGestor: l.emailGestor });
    }

    // Segunda passada: gestor por e-mail, entre quem o usuário enxerga (a RLS já
    // recorta na unidade dele) e quem acabou de entrar.
    const emailsGestor = Array.from(
      new Set(criados.map((c) => c.emailGestor).filter((e): e is string => !!e)),
    );
    if (emailsGestor.length) {
      // Lê todos os visíveis em vez de `.in("email")`: o e-mail do Qulture veio
      // com maiúscula às vezes, e o `in` do PostgREST compara exato. Paginado
      // pelo corte de 1000 linhas.
      type G = { id: number; email: string; status: string };
      const visiveis: G[] = [];
      for (let de = 0; ; de += 1000) {
        const { data: pag, error: eG } = await supabase
          .from("gente_pessoas")
          .select("id,email,status")
          .not("email", "is", null)
          .order("id")
          .range(de, de + 999);
        // O cadastro já está gravado: não derruba o relatório por causa do gestor.
        if (eG) {
          console.error("[gente.importarPessoas] leitura de gestores falhou:", eG);
          break;
        }
        visiveis.push(...((pag ?? []) as G[]));
        if (!pag || pag.length < 1000) break;
      }
      const porEmail = new Map<string, G>(
        visiveis.map((g) => [String(g.email).trim().toLowerCase(), g]),
      );
      for (const c of criados) {
        if (!c.emailGestor) continue;
        const g = porEmail.get(c.emailGestor);
        if (!g || g.status !== "ativo") {
          c.r.avisoGestor = `Gestor ${c.emailGestor} não está no cadastro ativo; entrou sem gestor.`;
          continue;
        }
        if (g.id === c.id) {
          c.r.avisoGestor = "A pessoa não pode ser gestora de si mesma; entrou sem gestor.";
          continue;
        }
        const { error } = await supabase
          .from("gente_pessoas")
          .update({ gestor_id: g.id })
          .eq("id", c.id);
        if (error) c.r.avisoGestor = `Gestor não ligado: ${error.message}`;
      }
    }

    // Acesso por último, um por um: cada convite é uma conta nova. Falha aqui
    // não desfaz o cadastro, igual ao `criarPessoa`.
    const chavesDoAtor = data.acesso
      ? (await acessoDoUsuario(supabase, context.userId)).permissions
      : [];
    for (const c of criados) {
      try {
        const a = data.acesso
          ? await darAcesso(supabase, context.userId, chavesDoAtor, c.id, data.acesso)
          : await darAcessoSoVinculo(supabase, context.userId, c.id);
        c.r.acesso = a.situacao;
        c.r.link = a.link;
      } catch (e) {
        c.r.acesso = "sem_acesso";
        c.r.mensagem = `Cadastrada, mas o acesso falhou: ${e instanceof Error ? e.message : "erro"}`;
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: eLog } = await (supabaseAdmin as Cliente).from("acessos_log").insert({
      ator: context.userId,
      alvo: null,
      acao: "gente_importar_planilha",
      area: "people",
      detalhe: {
        unidade_id: data.unidadeId,
        acesso: data.acesso,
        linhas: data.linhas.length,
        criadas: criados.length,
      },
    });
    if (eLog) console.error("[gente.importarPessoas] log falhou:", eLog);

    return { resultados: resultados.sort((a, b) => a.linha - b.linha) };
  });

export type StatusPessoa = "ativo" | "afastado" | "desligado";

export const MOTIVOS_AFASTAMENTO = [
  "Doença (até 15 dias, atestado)",
  "Doença (INSS, auxílio-doença)",
  "Acidente de trabalho",
  "Licença-maternidade",
  "Licença-paternidade",
  "Licença não remunerada",
  "Outro",
];

// Afastar com data, motivo, previsão de retorno e CID (05/10/2026, pedido do
// RH de Maceió para o radar de SST). `ops.gente_afastar` grava o afastamento e
// troca o status juntos; CID só passa para quem tem `manage.gente.saude`.
export const afastarPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      pessoaId: number;
      inicio: string;
      motivo: string;
      previsaoRetorno?: string;
      cid?: string;
      observacao?: string;
    }) => {
      if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input?.inicio ?? "")) {
        throw new Error("Informe a data do afastamento.");
      }
      const motivo = (input?.motivo ?? "").trim();
      if (!motivo) throw new Error("Informe o motivo do afastamento.");
      const previsao = input.previsaoRetorno || null;
      if (previsao && !/^\d{4}-\d{2}-\d{2}$/.test(previsao)) {
        throw new Error("Previsão de retorno inválida.");
      }
      const cid = (input.cid ?? "").trim().toUpperCase() || null;
      if (cid && !/^[A-Z]\d{2}(\.?\d{1,2})?$/.test(cid)) {
        throw new Error("CID inválido. Use o formato da CID-10, como M54.5 ou F32.");
      }
      return {
        pessoaId: input.pessoaId,
        inicio: input.inicio,
        motivo,
        previsao,
        cid,
        observacao: input.observacao?.trim().slice(0, 500) || null,
      };
    },
  )
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as Cliente).rpc("gente_afastar", {
      _pessoa: data.pessoaId,
      _inicio: data.inicio,
      _motivo: data.motivo,
      _previsao: data.previsao,
      _cid: data.cid,
      _observacao: data.observacao,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export interface StatusResult {
  acessoCortado: boolean;
  acessoReativado: boolean;
  /** Login que ficou como estava, e por quê (a Matriz resolve). */
  acessoMantidoPor: string | null;
  lideradosAtivos: number;
}

const BANIMENTO = "876000h";

// Desligar, afastar ou reativar (01/10/2026, pedido do RH de Maceió). Quem
// decide e corta o login é `ops.gente_definir_status` (migration
// 20261001210000), que roda com a autoridade de quem chama. Aqui só se faz o
// que o banco não alcança: banir no Auth e avisar o Financeiro, do mesmo jeito
// que o "Desativar" do Admin.
export const definirStatusPessoa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { pessoaId: number; status: StatusPessoa; data?: string; motivo?: string }) => {
      if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
      if (!["ativo", "afastado", "desligado"].includes(input?.status)) {
        throw new Error("Situação inválida.");
      }
      const data = input.data || null;
      if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error("Data inválida.");
      if (input.status === "desligado" && !data) throw new Error("Informe a data do desligamento.");
      return {
        pessoaId: input.pessoaId,
        status: input.status,
        data,
        motivo: input.motivo?.trim().slice(0, 300) || null,
      };
    },
  )
  .handler(async ({ data, context }): Promise<StatusResult> => {
    const supabase = context.supabase as Cliente;
    const { data: r, error } = await supabase.rpc("gente_definir_status", {
      _pessoa: data.pessoaId,
      _status: data.status,
      _data: data.data,
      _motivo: data.motivo,
    });
    if (error) throw new Error(error.message);
    const res = r as {
      user_id: string | null;
      acesso_cortado: boolean;
      acesso_reativado: boolean;
      acesso_mantido_por: string | null;
      liderados_ativos: number;
    };

    if (res.user_id && (res.acesso_cortado || res.acesso_reativado)) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: u, error: banErr } = await supabaseAdmin.auth.admin.updateUserById(
        res.user_id,
        { ban_duration: res.acesso_cortado ? BANIMENTO : "none" },
      );
      if (banErr) console.error("[gente.definirStatusPessoa] banimento falhou:", banErr);
      const email = u?.user?.email ?? "";
      if (email) {
        const { aplicarConcessaoNoFinanceiro } = await import("@/lib/sessoes-irmas.functions");
        await aplicarConcessaoNoFinanceiro(res.user_id, email);
      }
    }

    return {
      acessoCortado: res.acesso_cortado,
      acessoReativado: res.acesso_reativado,
      acessoMantidoPor: res.acesso_mantido_por,
      lideradosAtivos: Number(res.liderados_ativos ?? 0),
    };
  });

// Excluir só cadastro sem histórico nenhum, o caso de quem entrou duas vezes
// por engano. O banco confere em todas as tabelas que apontam para a pessoa e
// recusa com a lista do que encontrou.
export const excluirCadastro = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pessoaId: number }) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    return { pessoaId: input.pessoaId };
  })
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as Cliente).rpc("gente_excluir_cadastro", {
      _pessoa: data.pessoaId,
    });
    if (error) {
      // "já tem histórico (gente_avaliacoes.avaliado_id, ...)": a tela não
      // precisa do nome das tabelas.
      if (error.code === "23503") {
        throw new Error(
          error.message.startsWith("Esta pessoa tem login")
            ? error.message
            : "Esta pessoa já tem histórico no Planning People (avaliação, 1:1, feedback, PDI ou liderados). Use Desligar.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export interface HistoricoRow {
  campo: string;
  antes: string | null;
  depois: string | null;
  quem: string | null;
  quando: string;
  /** "movimentação #12" quando a mudança veio de uma movimentação. */
  origem: string | null;
}

const CAMPOS_HISTORICO: Record<string, string> = {
  cadastro: "Cadastro criado",
  nome_completo: "Nome",
  email: "E-mail",
  cargo: "Cargo",
  departamento: "Departamento",
  gestor_id: "Gestor",
  tipo_vinculo: "Vínculo",
  data_admissao: "Admissão",
  unidade_id: "Unidade",
  status: "Situação",
  data_desligamento: "Data de desligamento",
};

const ROTULO_ORIGEM: Record<string, string> = {
  manual: "à mão",
  planilha: "pela planilha",
  qulture: "importado do Qulture",
  socios: "pelo cadastro de sócios",
};

const VINCULO_ROTULO: Record<string, string> = {
  socio: "Sócio",
  clt: "CLT",
  pj: "PJ",
  estagio: "Estágio",
  prolabore: "Pró-labore",
  terceiro: "Terceiro",
};

const fmtDataBR = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : null;

// Histórico do cadastro (trigger da migration 20261001230000). A RLS recorta
// pela unidade; aqui só se traduz id em nome para a tela.
export const listHistoricoPessoa = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { pessoaId: number }) => {
    if (!Number.isInteger(input?.pessoaId)) throw new Error("Pessoa inválida.");
    return { pessoaId: input.pessoaId };
  })
  .handler(async ({ data, context }): Promise<HistoricoRow[]> => {
    const supabase = context.supabase as Cliente;
    const { data: linhas, error } = await supabase
      .from("gente_pessoas_historico")
      .select("campo,antes,depois,alterado_por,alterado_em,origem")
      .eq("pessoa_id", data.pessoaId)
      .order("alterado_em", { ascending: false })
      .limit(200);
    if (error) {
      if (error.code === "42P01") return [];
      throw new Error(error.message);
    }
    type L = {
      campo: string;
      antes: string | null;
      depois: string | null;
      alterado_por: string | null;
      alterado_em: string;
      origem: string | null;
    };
    const rows = (linhas ?? []) as L[];

    const idsGestor = new Set<number>();
    const idsUnidade = new Set<number>();
    for (const r of rows) {
      for (const v of [r.antes, r.depois]) {
        if (!v) continue;
        if (r.campo === "gestor_id") idsGestor.add(Number(v));
        if (r.campo === "unidade_id") idsUnidade.add(Number(v));
      }
    }
    const autores = Array.from(
      new Set(rows.map((r) => r.alterado_por).filter(Boolean)),
    ) as string[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [gestores, unidades, perfis] = await Promise.all([
      idsGestor.size
        ? supabase
            .from("gente_diretorio")
            .select("id,nome_completo")
            .in("id", [...idsGestor])
        : Promise.resolve({ data: [] }),
      idsUnidade.size
        ? supabase
            .from("unidades")
            .select("id,nome_da_praca")
            .in("id", [...idsUnidade])
        : Promise.resolve({ data: [] }),
      // Só o nome de quem alterou: `profiles` é do Admin e a RLS não abre para o RH.
      autores.length
        ? (supabaseAdmin as Cliente).from("profiles").select("user_id,nome").in("user_id", autores)
        : Promise.resolve({ data: [] }),
    ]);
    const nomeGestor = new Map<string, string>(
      ((gestores?.data ?? []) as { id: number; nome_completo: string }[]).map((g) => [
        String(g.id),
        g.nome_completo,
      ]),
    );
    const nomeUnidade = new Map<string, string>(
      ((unidades?.data ?? []) as { id: number; nome_da_praca: string }[]).map((u) => [
        String(u.id),
        u.nome_da_praca,
      ]),
    );
    const nomeAutor = new Map<string, string>(
      ((perfis?.data ?? []) as { user_id: string; nome: string | null }[]).map((p) => [
        p.user_id,
        p.nome ?? "",
      ]),
    );

    const traduzir = (campo: string, v: string | null): string | null => {
      if (v == null || v === "") return null;
      if (campo === "gestor_id") return nomeGestor.get(v) ?? "pessoa fora do seu cadastro";
      if (campo === "unidade_id") return nomeUnidade.get(v) ?? v;
      if (campo === "tipo_vinculo") return VINCULO_ROTULO[v] ?? v;
      if (campo === "data_admissao" || campo === "data_desligamento") return fmtDataBR(v);
      if (campo === "cadastro") return ROTULO_ORIGEM[v] ?? v;
      return v;
    };

    return rows.map((r) => ({
      campo: CAMPOS_HISTORICO[r.campo] ?? r.campo,
      antes: traduzir(r.campo, r.antes),
      depois: traduzir(r.campo, r.depois),
      quem: r.alterado_por ? nomeAutor.get(r.alterado_por) || null : null,
      quando: r.alterado_em,
      origem: r.origem ?? null,
    }));
  });

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
