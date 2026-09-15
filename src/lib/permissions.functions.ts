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
    description: "Painel inicial do sócio regional.",
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
    description: "Histórico de royalties da unidade (sócio regional).",
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
    key: "view.royalties_split",
    label: "Split do Asaas",
    description:
      "Página /unidades/split: royalty retido na fonte pelo Asaas, título x royalty retido e a cadeia da venda até o crédito na matriz.",
    group: "Acesso",
  },
  {
    key: "view.royalties_historico",
    label: "Histórico de Royalties",
    description:
      "Página /unidades/historico: histórico de royalties por cliente e evolução do valor apurado, rede toda.",
    group: "Acesso",
  },
  {
    key: "view.unidades_rede",
    label: "Regras da Rede, Apuração de Royalties e CAC",
    description:
      "As três páginas de /unidades que andam juntas: Regras da Rede, Apuração de Royalties e Apuração de CAC. Uma chave só porque quem apura precisa das três.",
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
    key: "view.gente",
    label: "Acessar o Planning People",
    description: "Cadastro de pessoas das unidades, com hierarquia de gestor.",
    group: "Acesso",
  },
  {
    key: "view.gente.individual",
    label: "People: ver pessoa a pessoa",
    description:
      "Lista nominal do cadastro, sempre recortada pela unidade de quem acessa. Sem esta chave a tela mostra só os números por unidade.",
    group: "Dados",
  },
  {
    key: "view.gente.agregado",
    label: "People: ver números por unidade",
    description:
      "Totais de pessoas, vínculo e cobertura de gestor por unidade, sem nomes. É o que a Matriz usa.",
    group: "Dados",
  },
  {
    key: "manage.gente",
    label: "Administrar o cadastro do People",
    description: "Criar, editar e importar pessoas. Dá leitura nominal do cadastro.",
    group: "Administração",
  },
  {
    key: "view.gente.um_a_um",
    label: "Gente: 1:1",
    description:
      "Liga o módulo de 1:1. Não decide qual linha aparece: isso é hierarquia, então cada um vê só os 1:1 em que é gestor ou liderado. Nota privada do gestor só o autor lê.",
    group: "Dados",
  },
  {
    key: "view.gente.feedback",
    label: "Gente: feedback contínuo",
    description:
      "Liga o feedback entre pessoas. Quem lê cada um depende da visibilidade escolhida por quem escreveu.",
    group: "Dados",
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
    key: "admin.acessos.financeiro",
    label: "Administrar acessos do Brain Financeiro",
    description:
      "Conceder e tirar acesso ao Brain Financeiro e escolher quais unidades cada pessoa abre " +
      "(BPO, MAROX, PAT…). É a ÚNICA chave da Administração que não exige ser admin global: quem " +
      "a tem enxerga a Administração com este item sozinho e não alcança usuários, perfis, " +
      "permissões nem chaves de integração. Dar isto a um perfil dá a TODAS as pessoas daquele " +
      "perfil — para uma pessoa só, use o perfil 'Admin do Financeiro'.",
    group: "Administração",
  },
  {
    key: "view.admin.credenciais",
    label: "Chaves de Integração",
    description:
      "Cadastrar as credenciais dos serviços externos (Asaas e afins). Quem tem esta chave define como o dinheiro entra — o valor nunca volta para a tela, mas quem escreve por cima redireciona a cobrança.",
    group: "Acesso",
  },
  {
    key: "view.broker",
    label: "Acessar o Broker (unidade)",
    description:
      "Fila de clientes disponíveis e carteira da própria unidade. Mostra o preço por cliente, nunca a composição do custo.",
    group: "Acesso",
  },
  {
    key: "view.broker_admin",
    label: "Acessar o Broker (matriz)",
    description:
      "Operação do broker pela matriz: fila completa, extrato e saldo de todas as unidades, multiplicador e custo apurado.",
    group: "Acesso",
  },
  {
    key: "manage.broker",
    label: "Operar o Broker",
    description:
      "Reservar e liberar oportunidades em nome de uma unidade, lançar crédito e aporte e definir o multiplicador aplicado. Sem esta chave a tela da matriz abre em leitura.",
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
  // --- As 7 que viviam só no banco ---
  // Exigidas por policy desde as migrations de Gente, CSC e Qualidade da Base,
  // mas ausentes desta lista até 15/09/2026 — logo, invisíveis em
  // /admin/permissoes e impossíveis de conceder. `view.csc_faturamento`,
  // `edit.csc_faturamento` e `view.qualidade_base` não tinham grant em papel
  // NENHUM, o que deixava csc_ciclos, csc_unidades, base_antiga_unidades e
  // qualidade_base_historico ilegíveis para todo usuário logado.
  {
    key: "view.gente.avaliacao",
    label: "Ver ciclo de avaliação",
    description: "Ciclo de avaliação de desempenho do módulo Gente.",
    group: "Dados",
  },
  {
    key: "manage.gente.avaliacao",
    label: "Administrar ciclo de avaliação",
    description: "Abrir, fechar e editar ciclos de avaliação de desempenho.",
    group: "Administração",
  },
  {
    key: "view.gente.clima",
    label: "Ver pesquisa de clima / eNPS",
    description: "Resultados da pesquisa de clima e do eNPS.",
    group: "Dados",
  },
  {
    key: "manage.gente.clima",
    label: "Administrar pesquisa de clima",
    description: "Disparar e encerrar rodadas de pesquisa de clima.",
    group: "Administração",
  },
  {
    key: "view.csc_faturamento",
    label: "Ver faturamento do CSC",
    description: "Ciclos e configuração do CSC automático das unidades.",
    group: "Acesso",
  },
  {
    key: "edit.csc_faturamento",
    label: "Editar faturamento do CSC",
    description: "Alterar valor e regra do CSC por unidade.",
    group: "Administração",
  },
  {
    key: "view.qualidade_base",
    label: "Ver Qualidade da Base",
    description: "Histórico dos 8 checks semanais Pipedrive x Pipefy x Omie.",
    group: "Acesso",
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

// ─────────────────────────────────────────────────────────────────────────────
// Permissão por ÁREA (15/09/2026)
//
// O papel concede ÁREAS; a área carrega as chaves. As chaves acima continuam
// existindo porque as 96 policies de RLS falam nelas — reescrever as 96 seria
// 96 chances de errar para um ganho que ninguém vê. Quem traduz é a tabela
// `ops.area_chaves`, e `ops.can()` já resolve por lá desde a migration
// 20260915100000_permissoes_por_area.
//
// Consequência prática: página nova NÃO precisa de chave nova nesta lista. Ela
// herda a área em que mora. A lista aqui vale como dicionário do que cada
// chave significa, e é isso que a tela de permissões mostra quando alguém abre
// uma área para ver o que tem dentro.
// ─────────────────────────────────────────────────────────────────────────────

export type Area = {
  slug: string;
  nome: string;
  descricao: string;
  /** Qual filtro de nível 2 faz sentido dentro desta área. */
  escopo: "unidade" | "empresa" | "nenhum";
  ordem: number;
};

export type EscopoDoUsuario = {
  todas_unidades: boolean;
  todas_empresas: boolean;
  unidades: number[];
  empresas: string[];
};

/**
 * Resolve papéis, áreas e chaves de uma pessoa.
 *
 * Fonte única do lado do servidor: `getMyPermissions`, o módulo Gente e a
 * emissão das sessões irmãs precisavam da mesma resposta e cada um montava a
 * sua consulta, o que já tinha deixado o Gente lendo `role_permissions` direto.
 * Com a matriz agora em `role_areas`, três consultas diferentes virariam três
 * respostas diferentes.
 */
export async function acessoDoUsuario(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
): Promise<{ roles: AppRole[]; areas: string[]; permissions: string[] }> {
  const { data: papeis } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const roles = ((papeis ?? []) as { role: string }[]).map((r) => r.role as AppRole);
  if (roles.length === 0) return { roles: [], areas: [], permissions: [] };

  const { data: grants } = await supabase
    .from("role_areas")
    .select("area")
    .in("role", roles)
    .eq("allowed", true);
  const areas = Array.from(new Set(((grants ?? []) as { area: string }[]).map((g) => g.area)));
  if (areas.length === 0) return { roles, areas: [], permissions: [] };

  const { data: chaves } = await supabase
    .from("area_chaves")
    .select("permission_key")
    .in("area", areas);
  const permissions = Array.from(
    new Set(((chaves ?? []) as { permission_key: string }[]).map((c) => c.permission_key)),
  );
  return { roles, areas, permissions };
}

export const getMyPermissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any;

    const [acesso, escopoRes, unidadesRes, empresasRes, unidadeAtual] = await Promise.all([
      acessoDoUsuario(db, userId),
      db.from("usuario_escopo").select("todas_unidades, todas_empresas").eq("user_id", userId).maybeSingle(),
      db.from("usuario_unidades").select("unidade_id").eq("user_id", userId),
      db.from("usuario_empresas").select("empresa_id").eq("user_id", userId),
      supabase.rpc("current_user_unidade"),
    ]);

    const escopo: EscopoDoUsuario = {
      // Sem linha em usuario_escopo a pessoa NÃO enxerga a rede toda. O default
      // restritivo é de propósito: um backfill que esquecesse alguém precisa
      // falhar fechando, não abrindo.
      todas_unidades: escopoRes?.data?.todas_unidades ?? false,
      todas_empresas: escopoRes?.data?.todas_empresas ?? false,
      unidades: ((unidadesRes?.data ?? []) as { unidade_id: number }[]).map((u) => u.unidade_id),
      empresas: ((empresasRes?.data ?? []) as { empresa_id: string }[]).map((e) => e.empresa_id),
    };

    return {
      roles: acesso.roles,
      areas: acesso.areas,
      permissions: acesso.permissions,
      escopo,
      unidade: (unidadeAtual?.data as string | null) ?? null,
    };
  });

/** A matriz papel x área, para /admin/permissoes. */
export const listRoleAreas = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [areasRes, grantsRes, rolesRes, chavesRes] = await Promise.all([
      db.from("areas").select("slug, nome, descricao, escopo, ordem").eq("ativa", true).order("ordem"),
      db.from("role_areas").select("role, area, allowed"),
      db.from("roles").select("key, label, description, is_system").order("is_system", { ascending: false }).order("label"),
      db.from("area_chaves").select("area, permission_key"),
    ]);
    if (areasRes.error || grantsRes.error || rolesRes.error) {
      throw new Error("Erro ao carregar as áreas.");
    }
    return {
      areas: (areasRes.data ?? []) as Area[],
      grants: (grantsRes.data ?? []) as { role: string; area: string; allowed: boolean }[],
      roles: (rolesRes.data ?? []) as { key: string; label: string; description: string; is_system: boolean }[],
      chaves: (chavesRes.data ?? []) as { area: string; permission_key: string }[],
      dicionario: KNOWN_PERMISSIONS,
    };
  });

export const upsertRoleArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { role: AppRole; area: string; allowed: boolean }) => {
    const role = (input?.role ?? "").trim();
    if (!role) throw new Error("Papel inválido.");
    if (!input?.area) throw new Error("Área inválida.");
    return { role, area: input.area, allowed: !!input.allowed };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { error } = await db.from("role_areas").upsert(
      { role: data.role, area: data.area, allowed: data.allowed, updated_at: new Date().toISOString() },
      { onConflict: "role,area" },
    );
    if (error) throw new Error("Erro ao salvar a área do papel.");
    return { ok: true };
  });

/** Nível 2: o que este usuário enxerga dentro das áreas que o papel abriu. */
export const getEscopoDoUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => ({ userId: (input?.userId ?? "").trim() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [escopo, unidades, empresas, catalogoUnidades, catalogoEmpresas] = await Promise.all([
      db.from("usuario_escopo").select("todas_unidades, todas_empresas").eq("user_id", data.userId).maybeSingle(),
      db.from("usuario_unidades").select("unidade_id").eq("user_id", data.userId),
      db.from("usuario_empresas").select("empresa_id").eq("user_id", data.userId),
      db.from("unidades").select("id, nome_da_praca").order("nome_da_praca"),
      db.schema("financeiro").from("empresas").select("id, apelido, nome_fantasia, grupo_apuracao").eq("ativa", true).order("grupo_apuracao"),
    ]);
    return {
      escopo: {
        todas_unidades: escopo?.data?.todas_unidades ?? false,
        todas_empresas: escopo?.data?.todas_empresas ?? false,
        unidades: ((unidades?.data ?? []) as { unidade_id: number }[]).map((u) => u.unidade_id),
        empresas: ((empresas?.data ?? []) as { empresa_id: string }[]).map((e) => e.empresa_id),
      } as EscopoDoUsuario,
      unidades: (catalogoUnidades?.data ?? []) as { id: number; nome_da_praca: string }[],
      empresas: (catalogoEmpresas?.data ?? []) as {
        id: string;
        apelido: string;
        nome_fantasia: string;
        grupo_apuracao: string;
      }[],
    };
  });

export const salvarEscopoDoUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      userId: string;
      todas_unidades: boolean;
      todas_empresas: boolean;
      unidades: number[];
      empresas: string[];
    }) => {
      if (!input?.userId) throw new Error("Usuário inválido.");
      return {
        userId: input.userId,
        todas_unidades: !!input.todas_unidades,
        todas_empresas: !!input.todas_empresas,
        unidades: Array.isArray(input.unidades) ? input.unidades : [],
        empresas: Array.isArray(input.empresas) ? input.empresas : [],
      };
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;

    const { error: e1 } = await db.from("usuario_escopo").upsert(
      {
        user_id: data.userId,
        todas_unidades: data.todas_unidades,
        todas_empresas: data.todas_empresas,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (e1) throw new Error("Erro ao salvar o escopo.");

    // Apaga e reinsere: a lista é pequena (11 unidades, 17 empresas) e um diff
    // incremental aqui só criaria estado intermediário para dar errado.
    await db.from("usuario_unidades").delete().eq("user_id", data.userId);
    if (!data.todas_unidades && data.unidades.length) {
      const { error } = await db
        .from("usuario_unidades")
        .insert(data.unidades.map((unidade_id) => ({ user_id: data.userId, unidade_id })));
      if (error) throw new Error("Erro ao salvar as unidades.");
    }

    await db.from("usuario_empresas").delete().eq("user_id", data.userId);
    if (!data.todas_empresas && data.empresas.length) {
      const { error } = await db
        .from("usuario_empresas")
        .insert(data.empresas.map((empresa_id) => ({ user_id: data.userId, empresa_id })));
      if (error) throw new Error("Erro ao salvar as empresas.");
    }
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
