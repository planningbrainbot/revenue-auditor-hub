import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { UnidadeCadastro } from "@/components/unidades/unidade-dialog";

// Ficha da unidade (/unidades/$unidadeId), desde 01/10/2026. Pedido do
// Eliezek: "a página da unidade deveria conter tudo, dados cadastrais, chaves
// de acesso, ao invés de ter informações separadas". Até aqui cadastro e regra
// moravam em Regras da Rede, os sócios numa linha expandida da mesma tabela,
// quem tem login em /admin/usuarios, a chave do Omie em /admin/integracoes e o
// e-mail do DP no Gente.
//
// Quem abre e o que vê (decisões do Eliezek em 01/10/2026):
//   - a matriz, com view.unidades_rede: qualquer unidade, tudo menos as chaves;
//   - o sócio: só a própria unidade (ops.minhas_unidades), sem as chaves e sem
//     os vínculos com os sistemas. A regra de repasse só com a área
//     minha_unidade_financeiro, a mesma que abre Meus Royalties;
//   - as chaves do Omie: só o super admin, fora da simulação de unidade. O
//     secret sai mascarado e só se revela por revealOmieSecret, que registra.
//
// A autorização é feita aqui, com o cliente de quem pediu; a leitura, com o
// service role, porque o sócio não lê socios, profiles nem o Auth.

export type PessoaDaUnidade = {
  /** Linha de ops.socios; nulo para quem só tem a unidade no escopo. */
  socioId: number | null;
  nome: string;
  cargo: string | null;
  email: string | null;
  telefone: string | null;
  userId: string | null;
  /** Conta no banco único: nulo quando não há login. */
  conta: {
    ativo: boolean;
    papeis: string[];
    ultimoLogin: string | null;
    senhaProvisoria: boolean;
  } | null;
};

export type ChaveOmie = {
  id: string;
  aplicativo: string;
  appKey: string;
  appSecretMascarado: string;
  ativo: boolean;
  atualizadoEm: string | null;
};

export type CscDaUnidade = {
  sigla: string | null;
  valor: number | null;
  emails: string[];
  automatico: boolean;
  ativo: boolean;
};

export type FichaDaUnidade = {
  unidade: UnidadeCadastro & {
    split_ativo_desde: string | null;
    asaas_account_id: string | null;
    cac_honorario_minimo_mensal: number | null;
  };
  /** O que esta pessoa pode ver e fazer na ficha. */
  pode: {
    rede: boolean;
    financeiro: boolean;
    sistemas: boolean;
    cadastrar: boolean;
    editarCsc: boolean;
    chaves: boolean;
  };
  /** null quando quem olha não vê o financeiro; `noFaturamento` falso é unidade fora de Emitir faturas. */
  csc: { noFaturamento: boolean; registro: CscDaUnidade | null } | null;
  pessoas: PessoaDaUnidade[];
  emailDp: string | null;
  /** null quando quem olha não é super admin. */
  chavesOmie: ChaveOmie[] | null;
};

const CAMPOS_FINANCEIROS = [
  "royalties_percentual",
  "csc_valor_fixo",
  "csc_percentual_base_antiga",
  "midia_mensal",
  "midia_cac",
  "paga_cac",
  "cac_desde",
  "absorve_midia",
  "observacoes_financeiras",
  "split_ativo_desde",
  "cac_honorario_minimo_mensal",
] as const;

const CAMPOS_SISTEMAS = [
  "id_omie",
  "id_asaas",
  "asaas_account_id",
  "pipefy_id",
  "pipedrive_opcao_id",
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpcBool(db: any, fn: string, args?: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await db.rpc(fn, args);
  if (error) {
    console.error(`[fichaDaUnidade] ${fn} falhou:`, error.message);
    throw new Error("Erro de autorização. Tente novamente.");
  }
  return Boolean(data);
}

export const fichaDaUnidade = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: number }) => {
    const id = Number(input?.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("Unidade inválida.");
    return { id };
  })
  .handler(async ({ data, context }): Promise<FichaDaUnidade> => {
    const { supabase, userId } = context;

    const [rede, cadastrar, editarCsc, areaFinanceiro, superAdmin, simulando] = await Promise.all([
      rpcBool(supabase, "can", { _key: "view.unidades_rede" }),
      rpcBool(supabase, "can", { _key: "manage.unidades_rede" }),
      rpcBool(supabase, "can", { _key: "edit.csc_faturamento" }),
      rpcBool(supabase, "tem_area", { _area: "minha_unidade_financeiro" }),
      rpcBool(supabase, "eh_super_admin", { _user: userId }),
      rpcBool(supabase, "ver_como_ativa"),
    ]);

    if (!rede) {
      // minhas_unidades não está nos tipos gerados.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: minhas, error } = await (supabase as any).rpc("minhas_unidades");
      if (error) throw new Error("Erro de autorização. Tente novamente.");
      const ids = ((minhas ?? []) as unknown[]).map(Number);
      if (!ids.includes(data.id)) throw new Error("Acesso negado: esta não é a sua unidade.");
    }

    const pode = {
      rede,
      financeiro: rede || areaFinanceiro,
      sistemas: rede,
      cadastrar,
      editarCsc,
      // Na simulação o super admin está vestido de sócio: as chaves somem com o resto.
      chaves: superAdmin && !simulando,
    };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;

    const [uRes, sRes, euRes, cscRes, dpRes, omieRes] = await Promise.all([
      db.from("unidades").select("*").eq("id", data.id).maybeSingle(),
      db
        .from("socios")
        .select("id,nome_completo,cargo,email,telefone,user_id")
        .eq("unidade_id", data.id)
        .order("nome_completo"),
      db.from("usuario_unidades").select("user_id").eq("unidade_id", data.id),
      pode.financeiro
        ? db
            .from("csc_unidades")
            .select("sigla,valor_csc,emails,csc_automatico,ativo")
            .eq("unidade_id", data.id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      db.from("gente_config_unidade").select("email_dp").eq("unidade_id", data.id).maybeSingle(),
      pode.chaves
        ? db
            .from("omie_credentials")
            .select("id,unidade,app_key,app_secret,ativo,updated_at")
            .eq("unidade_id", data.id)
            .order("unidade")
        : Promise.resolve({ data: null, error: null }),
    ]);
    for (const [nome, r] of [
      ["unidades", uRes],
      ["socios", sRes],
      ["usuario_unidades", euRes],
      ["csc_unidades", cscRes],
      ["gente_config_unidade", dpRes],
      ["omie_credentials", omieRes],
    ] as const) {
      if (r.error) {
        console.error(`[fichaDaUnidade] ${nome} falhou:`, r.error);
        throw new Error("Não foi possível ler a unidade.");
      }
    }
    if (!uRes.data) throw new Error("Unidade não encontrada.");

    const unidade = { ...uRes.data } as FichaDaUnidade["unidade"];
    if (!pode.financeiro)
      for (const c of CAMPOS_FINANCEIROS) (unidade as Record<string, unknown>)[c] = null;
    if (!pode.sistemas)
      for (const c of CAMPOS_SISTEMAS) (unidade as Record<string, unknown>)[c] = null;

    type SocioLinha = {
      id: number;
      nome_completo: string | null;
      cargo: string | null;
      email: string | null;
      telefone: string | null;
      user_id: string | null;
    };
    const socios = (sRes.data ?? []) as SocioLinha[];
    const idsDosSocios = new Set(socios.map((s) => s.user_id).filter(Boolean));
    // usuario_unidades tem 13 a 15 contas da matriz em cada unidade (01/10/2026):
    // gente com "todas as unidades" no escopo ou com a lista inteira marcada.
    // Elas veem a rede, não esta unidade, e na ficha só fariam volume. Ficam as
    // de recorte de verdade, como a do Gente de Maceió.
    const candidatos = ((euRes.data ?? []) as { user_id: string }[])
      .map((r) => r.user_id)
      .filter((id) => !idsDosSocios.has(id));
    let outros: string[] = [];
    if (candidatos.length) {
      const [esc, listas, total] = await Promise.all([
        db.from("usuario_escopo").select("user_id,todas_unidades").in("user_id", candidatos),
        db.from("usuario_unidades").select("user_id").in("user_id", candidatos),
        db.from("unidades").select("id", { count: "exact", head: true }),
      ]);
      if (esc.error || listas.error || total.error) {
        throw new Error("Não foi possível ler quem acessa a unidade.");
      }
      const redeInteira = new Set(
        ((esc.data ?? []) as { user_id: string; todas_unidades: boolean }[])
          .filter((e) => e.todas_unidades)
          .map((e) => e.user_id),
      );
      const quantas = new Map<string, number>();
      for (const r of (listas.data ?? []) as { user_id: string }[]) {
        quantas.set(r.user_id, (quantas.get(r.user_id) ?? 0) + 1);
      }
      outros = candidatos.filter(
        (id) => !redeInteira.has(id) && (quantas.get(id) ?? 0) < (total.count ?? Infinity),
      );
    }
    const todosIds = [...new Set([...idsDosSocios, ...outros])] as string[];

    // Perfil, papel e último login de cada conta. São poucas por unidade (10 em
    // Goiânia, a maior), então uma chamada ao Auth por conta é aceitável.
    const [perfis, papeis, auth] = await Promise.all([
      todosIds.length
        ? db
            .schema("public")
            .from("profiles")
            .select("user_id,nome,email,ativo")
            .in("user_id", todosIds)
        : Promise.resolve({ data: [], error: null }),
      todosIds.length
        ? db.from("user_roles").select("user_id,role").in("user_id", todosIds)
        : Promise.resolve({ data: [], error: null }),
      Promise.all(todosIds.map((id) => db.auth.admin.getUserById(id))),
    ]);
    if (perfis.error) throw new Error("Não foi possível ler as contas da unidade.");
    if (papeis.error) throw new Error("Não foi possível ler os perfis das contas.");
    const perfilDe = new Map(
      (
        (perfis.data ?? []) as {
          user_id: string;
          nome: string | null;
          email: string | null;
          ativo: boolean;
        }[]
      ).map((p) => [p.user_id, p]),
    );
    const papeisDe = new Map<string, string[]>();
    for (const r of (papeis.data ?? []) as { user_id: string; role: string }[]) {
      papeisDe.set(r.user_id, [...(papeisDe.get(r.user_id) ?? []), r.role]);
    }
    const authDe = new Map<
      string,
      { last_sign_in_at?: string | null; app_metadata?: Record<string, unknown> }
    >();
    todosIds.forEach((id, i) => {
      const u = auth[i]?.data?.user;
      if (u) authDe.set(id, u);
    });

    const contaDe = (id: string | null): PessoaDaUnidade["conta"] => {
      if (!id) return null;
      const p = perfilDe.get(id);
      if (!p) return null;
      const a = authDe.get(id);
      return {
        ativo: p.ativo,
        papeis: papeisDe.get(id) ?? [],
        ultimoLogin: a?.last_sign_in_at ?? null,
        senhaProvisoria: Boolean(a?.app_metadata?.senha_provisoria),
      };
    };

    const pessoas: PessoaDaUnidade[] = [
      ...socios.map((s) => ({
        socioId: s.id,
        nome: s.nome_completo ?? s.email ?? "Sem nome",
        cargo: s.cargo,
        email: s.email,
        telefone: s.telefone,
        userId: s.user_id,
        conta: contaDe(s.user_id),
      })),
      ...outros.map((id) => {
        const p = perfilDe.get(id);
        return {
          socioId: null,
          nome: p?.nome || p?.email || "Sem nome",
          cargo: null,
          email: p?.email ?? null,
          telefone: null,
          userId: id,
          conta: contaDe(id),
        };
      }),
    ];

    const csc = cscRes.data as {
      sigla: string | null;
      valor_csc: number | null;
      emails: string[] | null;
      csc_automatico: boolean | null;
      ativo: boolean | null;
    } | null;

    return {
      unidade,
      pode,
      csc: pode.financeiro
        ? {
            noFaturamento: csc != null,
            registro: csc
              ? {
                  sigla: csc.sigla,
                  valor: csc.valor_csc,
                  emails: csc.emails ?? [],
                  automatico: Boolean(csc.csc_automatico),
                  ativo: csc.ativo !== false,
                }
              : null,
          }
        : null,
      pessoas,
      emailDp: (dpRes.data as { email_dp: string | null } | null)?.email_dp ?? null,
      chavesOmie: pode.chaves
        ? (
            (omieRes.data ?? []) as {
              id: string;
              unidade: string;
              app_key: string;
              app_secret: string;
              ativo: boolean;
              updated_at: string | null;
            }[]
          ).map((c) => ({
            id: c.id,
            aplicativo: c.unidade,
            appKey: c.app_key,
            appSecretMascarado: `••••••••${c.app_secret.slice(-4)}`,
            ativo: c.ativo,
            atualizadoEm: c.updated_at,
          }))
        : null,
    };
  });
