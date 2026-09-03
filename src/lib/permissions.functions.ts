import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertAdmin } from "@/lib/server-utils";

export type AppRole = string;

export const KNOWN_PERMISSIONS: {
  key: string;
  label: string;
  description: string;
  group: string;
}[] = [
  {
    key: "view.hub",
    label: "Acessar Hub inicial",
    description: "Página inicial / portal de módulos.",
    group: "Acesso",
  },
  {
    key: "view.painel_unidade",
    label: "Painel da Unidade",
    description: "Painel inicial do sócio franqueado.",
    group: "Acesso",
  },
  {
    key: "view.clientes",
    label: "Acessar Rede (Clientes/Operação)",
    description: "Módulos de Clientes e Operação.",
    group: "Acesso",
  },
  {
    key: "view.auditoria",
    label: "Acessar Auditoria",
    description: "Módulo de auditoria de recebimentos.",
    group: "Acesso",
  },
  {
    key: "view.funil_receita",
    label: "Acessar Funil de Receita",
    description: "Visão MRR→Faturado→Recebido.",
    group: "Acesso",
  },
  {
    key: "view.contas_receber",
    label: "Acessar Contas a Receber",
    description: "Faturas emitidas pelas unidades (origem Omie).",
    group: "Acesso",
  },
  {
    key: "view.comissoes",
    label: "Acessar Apuração de Comissões",
    description: "Vendas × 1º pagamento por Closer/SDR, para apuração de comissão.",
    group: "Acesso",
  },
  {
    key: "view.meus_royalties",
    label: "Acessar Meus Royalties",
    description: "Histórico de royalties da unidade (sócio franqueado).",
    group: "Acesso",
  },
  {
    key: "view.auditoria.cac",
    label: "Aba CAC (Auditoria)",
    description: "Visualizar aba de CAC dentro de Auditoria.",
    group: "Auditoria",
  },
  {
    key: "view.auditoria.royalties",
    label: "Aba Royalties (Auditoria)",
    description: "Visualizar aba de Royalties dentro de Auditoria.",
    group: "Auditoria",
  },
  {
    key: "view.auditoria.unmapped",
    label: "Aba Não Mapeados",
    description: "Visualizar aba de Registros Não Mapeados.",
    group: "Auditoria",
  },
  {
    key: "view.roas",
    label: "Acessar ROAS & Payback",
    description: "Módulo de ROAS e payback.",
    group: "Acesso",
  },
  {
    key: "view.bi_vendas",
    label: "Acessar BI de Vendas",
    description: "Propostas, vendas, contratos e ROAS de mídia por BU.",
    group: "Acesso",
  },
  {
    key: "view.rede_ltv",
    label: "LTV Estimado",
    description: "Página de LTV estimado por unidade.",
    group: "Acesso",
  },
  {
    key: "view.rede_headcount",
    label: "Headcount",
    description: "Página de headcount por unidade.",
    group: "Acesso",
  },
  {
    key: "view.rede_realizado",
    label: "Realizado Unidades",
    description: "Página de realizado por unidade.",
    group: "Acesso",
  },
  {
    key: "view.reconciliacao",
    label: "Reconciliação",
    description: "Página de reconciliação de royalties.",
    group: "Acesso",
  },
  {
    key: "view.royalties_historico",
    label: "Receitas Partners — aba Histórico",
    description:
      "Aba Histórico da página Receitas Partners: histórico de royalties por cliente e evolução do valor apurado, rede toda.",
    group: "Acesso",
  },
  {
    key: "view.unidades_rede",
    label: "Receitas Partners — abas Regras/Royalties/CAC",
    description: "Página Receitas Partners (ex-Unidades): regras da rede, apuração de royalties e CAC.",
    group: "Acesso",
  },
  {
    key: "view.reforma_tributaria",
    label: "Acessar Reforma Tributária",
    description: "Gerador de mapa da reforma tributária para clientes.",
    group: "Ferramentas",
  },
  {
    key: "view.auditoria_interna",
    label: "Acessar Auditoria Interna",
    description:
      "Tela executiva do pipe Pipefy 'Auditoria Interna' — auditorias fiscais (ICMS/PIS/COFINS) por cliente.",
    group: "Acesso",
  },
  {
    key: "view.painel_cs",
    label: "Acessar CS",
    description:
      "Página unificada de CS — Onboarding (pipe Pipefy), Saúde da Carteira e Tratativas.",
    group: "Acesso",
  },
  {
    key: "view.nps",
    label: "Acessar NPS",
    description:
      "Análise das respostas da pesquisa de satisfação — NPS/CSAT, evolução, por unidade e respostas individuais.",
    group: "Acesso",
  },
  {
    key: "view.disparos_whatsapp",
    label: "Acessar Disparos de WhatsApp",
    description:
      "Estrutura de disparo em massa via WhatsApp e acompanhamento de status (enviado/entregue/lido/falhou) — usada hoje pelo NPS, mas genérica pra qualquer campanha.",
    group: "Acesso",
  },
  {
    key: "view.base_contatos",
    label: "Acessar Base de Contatos",
    description:
      "Cobertura de contato de WhatsApp por unidade e plano de ação do CS pra completar cadastro de contatos faltantes.",
    group: "Acesso",
  },
  {
    key: "view.network.benchmarks",
    label: "Benchmarks da rede",
    description: "Permite ver médias e comparativos agregados da rede.",
    group: "Dados",
  },
  {
    key: "view.admin.users",
    label: "Gerenciar usuários",
    description: "Cadastrar, editar e excluir usuários.",
    group: "Administração",
  },
  {
    key: "view.admin.profiles",
    label: "Gerenciar perfis",
    description: "Criar, editar e excluir perfis de usuário customizados.",
    group: "Administração",
  },
  {
    key: "view.admin.permissions",
    label: "Configurar permissões",
    description: "Editar a matriz de permissões por papel.",
    group: "Administração",
  },
  {
    key: "view.admin.integracoes",
    label: "Gerenciar integrações",
    description: "Cadastrar credenciais de APIs externas (ex: Omie por unidade).",
    group: "Administração",
  },
  {
    key: "data.scope.own_unit_only",
    label: "Restringe à própria unidade",
    description: "Filtra todos os dados pela unidade do usuário.",
    group: "Dados",
  },
  {
    key: "manage.repasses",
    label: "Lançar repasses (Royalties/CAC)",
    description: "Importar planilha e lançar/excluir repasses recebidos das unidades.",
    group: "Auditoria",
  },
  {
    key: "view.financeiro_partners",
    label: "Acessar Financeiro Partners",
    description:
      "DRE Projetada, DRE Realizada e FCx (fluxo de caixa realizado) da Planning Partners.",
    group: "Planning Partners",
  },
  {
    key: "view.despesas_partners",
    label: "Acessar Despesas Partners",
    description: "Despesas (Confronto Mensal) da Planning Partners.",
    group: "Planning Partners",
  },
  {
    key: "view.atividade",
    label: "Acessar Atividade do Sistema",
    description: "Resumo diário de commits — o que mudou no Ops Board, dia a dia.",
    group: "Administração",
  },
  {
    key: "view.ebit_operacional",
    label: "Acessar EBIT Operacional",
    description:
      "Custo operacional do time (Google Sheets) x venda de serviços internos para unidades (Pipefy) — meta de EBIT zero.",
    group: "Acesso",
  },
  {
    key: "view.contatos",
    label: "Ver contatos dos clientes",
    description:
      "Contatos (stakeholders) vinculados a cada cliente, na tela de Clientes — nome, cargo, e-mail e WhatsApp.",
    group: "Dados",
  },
  {
    key: "view.idu",
    label: "Acessar IDU",
    description:
      "Índice de Desempenho da Unidade: ranking aberto da rede, decomposição por pilar e percentual do forecast liberado no trimestre seguinte.",
    group: "Acesso",
  },
  {
    key: "edit.idu_metas",
    label: "Definir metas do IDU",
    description:
      "Registrar a meta de cada indicador por unidade e por trimestre. Sem meta pactuada o indicador sai do denominador da nota.",
    group: "Dados",
  },
  {
    key: "view.indicadores_trimestre",
    label: "Acessar Indicadores do Trimestre",
    description:
      "Os dois slides do deck de Expansão (financeiro e comercial) por unidade, com o comparativo da rede.",
    group: "Acesso",
  },
  {
    key: "manage.clientes_churn",
    label: "Marcar churn de clientes",
    description:
      "Marcar um cliente como churn na tela de Clientes (cria card no pipe Pipefy 'Tratativas'). Admins sempre podem; esta permissão libera para outros papéis.",
    group: "Dados",
  },
  {
    key: "view.fila_cella",
    label: "Acessar Fila Cella",
    description:
      "Fila do canal dedicado sobre a base instalada (Funil B) — score, gatilho da ECD, cadência e log de toques.",
    group: "Acesso",
  },
  {
    key: "manage.fila_cella",
    label: "Operar a Fila Cella",
    description:
      "Editar a camada operada (relacionamento, estágio, frente, urgência), abrir/encerrar ciclo e registrar toque. Sem esta chave a tela abre em leitura.",
    group: "Dados",
  },
  {
    key: "manage.de_para_cnpj",
    label: "Resolver CNPJ de contas",
    description:
      "Confirmar o vínculo conta → CNPJ em empresa_cnpj_de_para. Grava o revisor, e linha revisada não é sobrescrita por rotina.",
    group: "Dados",
  },
  {
    key: "manage.fila_cella_sync",
    label: "Sincronizar a Fila Cella",
    description: "Disparar o rebuild da camada apurada da fila a partir do Growth.",
    group: "Administração",
  },
  {
    key: "manage.fila_cella_override",
    label: "Furar a trava da Fila Cella",
    description:
      "Reabrir ciclo antes do bloqueio de 60/180 dias, com fato novo e justificativa. Escape hatch auditável — o desvio fica caro e visível, não impossível.",
    group: "Administração",
  },
  // --- Financial Brain (planningbrain.com.br/financeiro) ---
  // Produto separado, em outro projeto Supabase. A concessão acontece aqui e
  // viaja no token: quando o Ops emite a sessão do Financial, grava estas
  // chaves no app_metadata do usuário de lá, e o cockpit lê a claim sem
  // consultar o banco do Ops a cada requisição.
  //
  // As chaves de escopo espelham `unidades_navegacao` do Financial. Se um
  // escopo novo for criado lá, precisa de uma chave nova aqui — senão ninguém
  // consegue concedê-lo. Mesmo contrato de GROWTH_PAPEIS em client.growth.server.ts.
  {
    key: "view.brain_financeiro",
    label: "Acessar Brain Financeiro",
    description:
      "Abre o cockpit financeiro. Sem esta chave a pessoa não entra, mesmo tendo escopo liberado abaixo.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_bpo",
    label: "Brain Financeiro · BPO",
    description: "Escopo BPO (grupo) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_doc",
    label: "Brain Financeiro · DOC",
    description: "Escopo DOC (grupo) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_expansao",
    label: "Brain Financeiro · Expansão",
    description: "Escopo EXPANSÃO (empresa) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_marox",
    label: "Brain Financeiro · MAROX",
    description: "Escopo MAROX (grupo) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_pat",
    label: "Brain Financeiro · PAT",
    description: "Escopo PAT (grupo) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_pis",
    label: "Brain Financeiro · PIS",
    description: "Escopo PIS (grupo) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_negocios_estruturados",
    label: "Brain Financeiro · Negócios Estruturados",
    description: "Escopo Negócios Estruturados (departamento) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
  {
    key: "view.brain_financeiro_finance",
    label: "Brain Financeiro · Finance",
    description: "Escopo Finance (departamento) no cockpit financeiro.",
    group: "Brain Financeiro",
  },
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
    const { data: role } = await context.supabase
      .from("roles")
      .select("key")
      .eq("key", data.role)
      .maybeSingle();
    if (!role) throw new Error("Papel inválido.");
    const { error } = await context.supabase.from("role_permissions").upsert(
      {
        role: data.role,
        permission_key: data.permission_key,
        allowed: data.allowed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "role,permission_key" },
    );
    if (error) throw new Error("Erro ao salvar permissão.");
    return { ok: true };
  });

export const getSocioUnidadeByEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { email: string }) => ({
    email: (input?.email ?? "").trim().toLowerCase(),
  }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (!data.email) return { unidade: null as string | null };
    const { supabase } = context;
    const { data: u } = await supabase.rpc("get_socio_unidade_by_email", { _email: data.email });
    return { unidade: (u as string | null) ?? null };
  });
