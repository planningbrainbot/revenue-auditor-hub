import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";


export type AppRole = string;

export const KNOWN_PERMISSIONS: { key: string; label: string; description: string; group: string }[] = [
  { key: "view.hub", label: "Acessar Hub inicial", description: "Página inicial / portal de módulos.", group: "Acesso" },
  { key: "view.painel_unidade", label: "Painel da Unidade", description: "Painel inicial do sócio franqueado.", group: "Acesso" },
  { key: "view.clientes", label: "Acessar Rede (Clientes/Operação)", description: "Módulos de Clientes e Operação.", group: "Acesso" },
  { key: "view.auditoria", label: "Acessar Auditoria", description: "Módulo de auditoria de recebimentos.", group: "Acesso" },
  { key: "view.funil_receita", label: "Acessar Funil de Receita", description: "Visão MRR→Faturado→Recebido.", group: "Acesso" },
  { key: "view.contas_receber", label: "Acessar Contas a Receber", description: "Faturas emitidas pelas unidades (origem Omie).", group: "Acesso" },
  { key: "view.comissoes", label: "Acessar Apuração de Comissões", description: "Vendas × 1º pagamento por Closer/SDR, para apuração de comissão.", group: "Acesso" },
  { key: "view.meus_royalties", label: "Acessar Meus Royalties", description: "Histórico de royalties da unidade (sócio franqueado).", group: "Acesso" },
  { key: "view.auditoria.cac", label: "Aba CAC (Auditoria)", description: "Visualizar aba de CAC dentro de Auditoria.", group: "Auditoria" },
  { key: "view.auditoria.royalties", label: "Aba Royalties (Auditoria)", description: "Visualizar aba de Royalties dentro de Auditoria.", group: "Auditoria" },
  { key: "view.auditoria.unmapped", label: "Aba Não Mapeados", description: "Visualizar aba de Registros Não Mapeados.", group: "Auditoria" },
  { key: "view.roas", label: "Acessar ROAS & Payback", description: "Módulo de ROAS e payback.", group: "Acesso" },
  { key: "view.bi_vendas", label: "Acessar BI de Vendas", description: "Propostas, vendas, contratos e ROAS de mídia por BU.", group: "Acesso" },
  { key: "view.rede_ltv", label: "LTV Estimado", description: "Página de LTV estimado por unidade.", group: "Acesso" },
  { key: "view.rede_headcount", label: "Headcount", description: "Página de headcount por unidade.", group: "Acesso" },
  { key: "view.rede_realizado", label: "Realizado Unidades", description: "Página de realizado por unidade.", group: "Acesso" },
  { key: "view.reconciliacao", label: "Reconciliação", description: "Página de reconciliação de royalties.", group: "Acesso" },
  { key: "view.royalties_historico", label: "Royalties (histórico)", description: "Histórico de royalties por cliente e evolução do valor apurado, rede toda.", group: "Acesso" },
  { key: "view.unidades_rede", label: "Unidades (Receita da Rede)", description: "Página de unidades no grupo Receita da Rede.", group: "Acesso" },
  { key: "view.reforma_tributaria", label: "Acessar Reforma Tributária", description: "Gerador de mapa da reforma tributária para clientes.", group: "Ferramentas" },
  { key: "view.auditoria_interna", label: "Acessar Auditoria Interna", description: "Tela executiva do pipe Pipefy 'Auditoria Interna' — auditorias fiscais (ICMS/PIS/COFINS) por cliente.", group: "Acesso" },
  { key: "view.painel_cs", label: "Acessar CS", description: "Página unificada de CS — Onboarding (pipe Pipefy), Saúde da Carteira, Tratativas e NPS.", group: "Acesso" },
  { key: "view.network.benchmarks", label: "Benchmarks da rede", description: "Permite ver médias e comparativos agregados da rede.", group: "Dados" },
  { key: "view.admin.users", label: "Gerenciar usuários", description: "Cadastrar, editar e excluir usuários.", group: "Administração" },
  { key: "view.admin.profiles", label: "Gerenciar perfis", description: "Criar, editar e excluir perfis de usuário customizados.", group: "Administração" },
  { key: "view.admin.permissions", label: "Configurar permissões", description: "Editar a matriz de permissões por papel.", group: "Administração" },
  { key: "view.admin.integracoes", label: "Gerenciar integrações", description: "Cadastrar credenciais de APIs externas (ex: Omie por unidade).", group: "Administração" },
  { key: "data.scope.own_unit_only", label: "Restringe à própria unidade", description: "Filtra todos os dados pela unidade do usuário.", group: "Dados" },
  { key: "manage.repasses", label: "Lançar repasses (Royalties/CAC)", description: "Importar planilha e lançar/excluir repasses recebidos das unidades.", group: "Auditoria" },
  { key: "view.financeiro_partners", label: "Acessar Financeiro Partners", description: "DRE Projetada e FCx (fluxo de caixa realizado) da Planning Partners.", group: "Planning Partners" },
  { key: "view.receita_partners", label: "Acessar Receita Partners", description: "Financeiro — Gestão da Rede e Receitas da Planning Partners.", group: "Planning Partners" },
  { key: "view.despesas_partners", label: "Acessar Despesas Partners", description: "Despesas (Confronto Mensal) da Planning Partners.", group: "Planning Partners" },
];

// (admin check usa helper compartilhado em @/lib/server-utils)


export const getMyPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [rolesRes, unidadeRes] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.rpc("current_user_unidade"),
    ]);
    const roles = (rolesRes.data ?? []).map((r) => r.role as AppRole);
    if (roles.length === 0) {
      return { roles: [], permissions: [] as string[], unidade: null as string | null };
    }
    const { data: perms } = await supabase
      .from("role_permissions")
      .select("permission_key, allowed")
      .in("role", roles)
      .eq("allowed", true);
    const permissions = Array.from(new Set((perms ?? []).map((p) => p.permission_key)));
    const unidade = (unidadeRes.data as string | null) ?? null;
    return { roles, permissions, unidade };
  });

export const listRolePermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const [{ data, error }, { data: roleRows, error: rolesErr }] = await Promise.all([
      context.supabase.from("role_permissions").select("role, permission_key, allowed"),
      context.supabase
        .from("roles")
        .select("key, label, description, is_system")
        .order("is_system", { ascending: false })
        .order("label", { ascending: true }),
    ]);
    if (error || rolesErr) throw new Error("Erro ao carregar permissões.");
    return { rows: data ?? [], permissions: KNOWN_PERMISSIONS, roles: roleRows ?? [] };
  });

export const upsertRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role: AppRole; permission_key: string; allowed: boolean }) => {
    const role = (input?.role ?? "").trim();
    if (!role) throw new Error("Papel inválido.");
    if (!input.permission_key) throw new Error("Permissão inválida.");
    return { role, permission_key: input.permission_key, allowed: !!input.allowed };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: role } = await context.supabase.from("roles").select("key").eq("key", data.role).maybeSingle();
    if (!role) throw new Error("Papel inválido.");
    const { error } = await context.supabase
      .from("role_permissions")
      .upsert(
        { role: data.role, permission_key: data.permission_key, allowed: data.allowed, updated_at: new Date().toISOString() },
        { onConflict: "role,permission_key" },
      );
    if (error) throw new Error("Erro ao salvar permissão.");
    return { ok: true };
  });

export const getSocioUnidadeByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => ({ email: (input?.email ?? "").trim().toLowerCase() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (!data.email) return { unidade: null as string | null };
    const { supabase } = context;
    const { data: u } = await supabase.rpc("get_socio_unidade_by_email", { _email: data.email });
    return { unidade: (u as string | null) ?? null };
  });
