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
  { key: "view.aquario", label: "Aquário de clientes", description: "Carteiras, perfis de produto e listas para sócios, no escopo autorizado.", group: "Clientes" },
  { key: "view.monetizacao", label: "Operação e análises de Monetização", description: "Daily, previsão, capacidade e desenvolvimento comercial.", group: "Monetização" },
  { key: "manage.aquario", label: "Gerir listas e planos", description: "Preparar listas, registrar validações, metas e desenvolvimento.", group: "Monetização" },
  { key: "send.monetizacao", label: "Enviar oportunidades ao Pipedrive", description: "Somente ofertas selecionadas e validadas, com proteção contra duplicidade.", group: "Monetização" },
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
    // A página /reconciliacao foi apagada em 17/09/2026, mas a chave fica:
    // policies de RLS de contratos e contas_receber ainda leem can('view.reconciliacao').
    key: "view.reconciliacao",
    label: "Reconciliação",
    description: "Leitura de contratos e contas a receber (a página foi removida; a chave segue nas regras de acesso).",
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
    key: "send.whatsapp",
    label: "Disparar WhatsApp",
    description:
      "Abrir a tela de Disparos de WhatsApp e enviar mensagens (em massa ou individual). Só o Super admin desde 17/09/2026.",
    group: "Dados",
  },
  {
    key: "edit.nps",
    label: "Operar NPS",
    description:
      "Registrar ligação, resposta e gravação do NPS e disparar campanha. Separada de ver desde 17/09/2026: usuário só consulta.",
    group: "Dados",
  },
  {
    key: "edit.gente.conversas",
    label: "Gente: registrar 1:1 e feedback",
    description:
      "Criar 1:1 como gestor e enviar feedback. Ver continua com as chaves de 1:1 e feedback; registrar é esta.",
    group: "Dados",
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
  // Áreas e chaves saem de `ops.acesso_do_usuario`, a MESMA regra do
  // `can_user` que a RLS usa. Até 17/09/2026 isto era remontado aqui lendo só
  // `role_areas`, e quem entra por delegação (admin, sócio, colaborador de
  // unidade) ficaria sem menu mesmo com acesso concedido no banco.
  const [papeisRes, acessoRes] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.rpc("acesso_do_usuario", { _user: userId }),
  ]);
  const roles = ((papeisRes?.data ?? []) as { role: string }[]).map((r) => r.role as AppRole);
  if (acessoRes?.error) {
    console.error("[acessoDoUsuario] acesso_do_usuario falhou:", acessoRes.error);
    return { roles, areas: [], permissions: [] };
  }
  const acesso = (acessoRes?.data ?? {}) as { areas?: string[]; permissions?: string[] };
  return { roles, areas: acesso.areas ?? [], permissions: acesso.permissions ?? [] };
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

    // Áreas que a pessoa administra (admin ou sócio): abre "Minha equipe".
    const { data: administra } = await db.from("area_admins").select("area").eq("user_id", userId);

    return {
      roles: acesso.roles,
      areas: acesso.areas,
      permissions: acesso.permissions,
      administra: ((administra ?? []) as { area: string }[]).map((a) => a.area),
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

// ─────────────────────────────────────────────────────────────
// Níveis por área (Fase 2 do PLANO-ADMIN-DELEGADO, 17/09/2026)
//
// Super admin decide, área por área, se a pessoa é admin, sócio, usuário (e
// quais páginas vê) ou nada. Quem grava é o banco, pelas funções
// `ops.acesso_*`: elas conferem nível e recorte, então esta camada não repete
// regra nenhuma. Chamamos com o cliente DA PESSOA LOGADA de propósito, para
// que `auth.uid()` lá dentro seja quem está mexendo.
// ─────────────────────────────────────────────────────────────

/** `bloqueado`: o super admin tirou a área desta pessoa, mesmo que o perfil a abra. */
export type NivelNaArea = "nenhum" | "bloqueado" | "usuario" | "socio" | "admin";

export type AcessoPorArea = {
  slug: string;
  nome: string;
  escopo: "unidade" | "empresa" | "nenhum";
  /** A pessoa já entra nesta área pelo papel (modelo antigo, decisão 11). */
  pelo_papel: boolean;
  nivel: NivelNaArea;
  /** Chaves de ver da área, com rótulo, para o usuário escolher. */
  paginas: { key: string; label: string }[];
  /** Páginas liberadas por delegação. */
  liberadas: string[];
  /** Páginas negadas a esta pessoa, venham de onde vierem. */
  negadas: string[];
};

export const getAcessosDoUsuario = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string }) => ({ userId: (input?.userId ?? "").trim() }))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [areasRes, papeisRes, chavesRes, adminsRes, membrosRes, porPessoaRes, unidadesRes] =
      await Promise.all([
        db.from("areas").select("slug, nome, escopo, ordem").eq("ativa", true).order("ordem"),
        db.from("user_roles").select("role").eq("user_id", data.userId),
        db.from("area_chaves").select("area, permission_key"),
        db.from("area_admins").select("area, nivel").eq("user_id", data.userId),
        db.from("usuario_areas").select("area, allowed").eq("user_id", data.userId),
        db.from("usuario_chaves").select("permission_key, allowed").eq("user_id", data.userId),
        db.from("usuario_unidades").select("unidade_id").eq("user_id", data.userId),
      ]);
    for (const r of [areasRes, papeisRes, chavesRes, adminsRes, membrosRes, porPessoaRes]) {
      if (r?.error) {
        console.error("[getAcessosDoUsuario]", r.error);
        throw new Error("Erro ao carregar os acessos.");
      }
    }

    const papeis = ((papeisRes.data ?? []) as { role: string }[]).map((r) => r.role);
    const [{ data: pelosPapeis }, { data: rotulosPapeis }] = await Promise.all([
      papeis.length
        ? db.from("role_areas").select("area").in("role", papeis).eq("allowed", true)
        : Promise.resolve({ data: [] }),
      papeis.length ? db.from("roles").select("key, label").in("key", papeis) : Promise.resolve({ data: [] }),
    ]);
    const areasDoPapel = new Set(((pelosPapeis ?? []) as { area: string }[]).map((r) => r.area));

    const rotulo = new Map(KNOWN_PERMISSIONS.map((p) => [p.key, p.label]));
    const chavesPorArea = new Map<string, string[]>();
    for (const c of (chavesRes.data ?? []) as { area: string; permission_key: string }[]) {
      const l = chavesPorArea.get(c.area) ?? [];
      l.push(c.permission_key);
      chavesPorArea.set(c.area, l);
    }
    const nivelDelegado = new Map(
      ((adminsRes.data ?? []) as { area: string; nivel: "admin" | "socio" }[]).map((a) => [a.area, a.nivel]),
    );
    const membro = new Set(
      ((membrosRes.data ?? []) as { area: string; allowed: boolean }[]).filter((m) => m.allowed).map((m) => m.area),
    );
    const bloqueada = new Set(
      ((membrosRes.data ?? []) as { area: string; allowed: boolean }[]).filter((m) => !m.allowed).map((m) => m.area),
    );
    const porPessoa = (porPessoaRes.data ?? []) as { permission_key: string; allowed: boolean }[];
    const liberadas = new Set(porPessoa.filter((p) => p.allowed).map((p) => p.permission_key));
    const negadas = new Set(porPessoa.filter((p) => !p.allowed).map((p) => p.permission_key));

    const areas: AcessoPorArea[] = ((areasRes.data ?? []) as Omit<AcessoPorArea, "pelo_papel" | "nivel" | "paginas" | "liberadas" | "negadas">[]).map((a) => {
      const chaves = chavesPorArea.get(a.slug) ?? [];
      return {
        slug: a.slug,
        nome: a.nome,
        escopo: a.escopo,
        pelo_papel: areasDoPapel.has(a.slug),
        nivel: bloqueada.has(a.slug)
          ? "bloqueado"
          : nivelDelegado.get(a.slug) ?? (membro.has(a.slug) ? "usuario" : "nenhum"),
        paginas: chaves
          .filter((k) => k.startsWith("view."))
          .map((k) => ({ key: k, label: rotulo.get(k) ?? k }))
          .sort((x, y) => x.label.localeCompare(y.label, "pt-BR")),
        liberadas: chaves.filter((k) => liberadas.has(k)),
        negadas: chaves.filter((k) => negadas.has(k)),
      };
    });

    return {
      superAdmin: papeis.includes("admin"),
      papeis: ((rotulosPapeis ?? []) as { key: string; label: string }[]).map((r) => r.label),
      temUnidade: ((unidadesRes?.data ?? []) as unknown[]).length > 0,
      areas,
    };
  });

export const salvarAcessoNaArea = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { userId: string; area: string; nivel: NivelNaArea; paginas?: string[] }) => {
    const userId = (input?.userId ?? "").trim();
    const area = (input?.area ?? "").trim();
    if (!userId || !area) throw new Error("Pessoa e área são obrigatórias.");
    if (!["nenhum", "bloqueado", "usuario", "socio", "admin"].includes(input?.nivel)) throw new Error("Nível inválido.");
    const paginas = Array.from(new Set((input?.paginas ?? []).map((p) => p.trim()).filter(Boolean)));
    return { userId, area, nivel: input.nivel, paginas };
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;

    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data: out, error } = await db.rpc(fn, args);
      // As funções do banco já falam português e dizem o motivo; repassamos.
      if (error) throw new Error(error.message || "Erro ao salvar o acesso.");
      return out;
    };

    const { data: atual } = await db
      .from("area_admins")
      .select("nivel")
      .eq("user_id", data.userId)
      .eq("area", data.area)
      .maybeSingle();
    const { data: membro } = await db
      .from("usuario_areas")
      .select("allowed")
      .eq("user_id", data.userId)
      .eq("area", data.area)
      .maybeSingle();

    const { data: bloqueio } = await db
      .from("usuario_areas")
      .select("allowed")
      .eq("user_id", data.userId)
      .eq("area", data.area)
      .eq("allowed", false)
      .maybeSingle();

    let ficouSemArea = false;
    if (data.nivel === "bloqueado") {
      await rpc("acesso_bloquear_area", { _alvo: data.userId, _area: data.area, _bloquear: true });
      return { ok: true, ficouSemArea };
    }
    // Qualquer outra escolha começa tirando o bloqueio, se houver.
    if (bloqueio) {
      await rpc("acesso_bloquear_area", { _alvo: data.userId, _area: data.area, _bloquear: false });
    }
    if (data.nivel === "admin" || data.nivel === "socio") {
      await rpc("acesso_nomear", { _alvo: data.userId, _area: data.area, _nivel: data.nivel });
    } else if (data.nivel === "usuario") {
      if (atual) {
        // Rebaixar: sai da administração e volta como membro com as páginas escolhidas.
        await rpc("acesso_remover_da_area", { _alvo: data.userId, _area: data.area });
        await rpc("acesso_adicionar_na_area", {
          _alvo: data.userId, _area: data.area, _unidades: [], _chaves: data.paginas,
        });
      } else if (membro?.allowed) {
        await rpc("acesso_definir_paginas", { _alvo: data.userId, _area: data.area, _chaves: data.paginas });
      } else {
        await rpc("acesso_adicionar_na_area", {
          _alvo: data.userId, _area: data.area, _unidades: [], _chaves: data.paginas,
        });
      }
    } else if (atual || membro?.allowed) {
      ficouSemArea = Boolean(
        await rpc("acesso_remover_da_area", { _alvo: data.userId, _area: data.area }),
      );
    }
    return { ok: true, ficouSemArea };
  });

/** Quem administra cada área, para a matriz de /admin/permissoes. */
export const listAdministradoresPorArea = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const { data: linhas, error } = await db.from("area_admins").select("user_id, area, nivel");
    if (error) throw new Error("Erro ao carregar quem administra as áreas.");
    const ids = Array.from(new Set(((linhas ?? []) as { user_id: string }[]).map((l) => l.user_id)));
    const { data: perfis } = ids.length
      ? await db.from("profiles").select("user_id, nome, email").in("user_id", ids)
      : { data: [] };
    const nome = new Map(
      ((perfis ?? []) as { user_id: string; nome: string | null; email: string | null }[]).map((p) => [
        p.user_id,
        p.nome || p.email || p.user_id,
      ]),
    );
    return ((linhas ?? []) as { user_id: string; area: string; nivel: "admin" | "socio" }[]).map((l) => ({
      ...l,
      nome: nome.get(l.user_id) ?? l.user_id,
    }));
  });

/**
 * O quadro de /admin/niveis: cada pessoa, o perfil, e o nível em cada área.
 * Só para o super admin.
 */
export const listNiveisDeAcesso = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = context.supabase as any;
    const [areasRes, perfisRes, papeisRes, rotulosRes, roleAreasRes, adminsRes, membrosRes] = await Promise.all([
      db.from("areas").select("slug, nome, ordem").eq("ativa", true).neq("slug", "admin").order("ordem"),
      db.from("profiles").select("user_id, nome, email"),
      db.from("user_roles").select("user_id, role"),
      db.from("roles").select("key, label"),
      db.from("role_areas").select("role, area").eq("allowed", true),
      db.from("area_admins").select("user_id, area, nivel"),
      db.from("usuario_areas").select("user_id, area, allowed"),
    ]);
    for (const r of [areasRes, perfisRes, papeisRes, rotulosRes, roleAreasRes, adminsRes, membrosRes]) {
      if (r?.error) {
        console.error("[listNiveisDeAcesso]", r.error);
        throw new Error("Erro ao carregar os níveis de acesso.");
      }
    }
    const rotulo = new Map(((rotulosRes.data ?? []) as { key: string; label: string }[]).map((r) => [r.key, r.label]));
    const areasDoPapel = new Map<string, Set<string>>();
    for (const r of (roleAreasRes.data ?? []) as { role: string; area: string }[]) {
      const set = areasDoPapel.get(r.role) ?? new Set<string>();
      set.add(r.area);
      areasDoPapel.set(r.role, set);
    }
    const papeisDe = new Map<string, string[]>();
    for (const r of (papeisRes.data ?? []) as { user_id: string; role: string }[]) {
      papeisDe.set(r.user_id, [...(papeisDe.get(r.user_id) ?? []), r.role]);
    }
    const delegado = new Map<string, "admin" | "socio" | "usuario" | "bloqueado">();
    for (const m of (membrosRes.data ?? []) as { user_id: string; area: string; allowed: boolean }[])
      delegado.set(`${m.user_id}|${m.area}`, m.allowed ? "usuario" : "bloqueado");
    for (const a of (adminsRes.data ?? []) as { user_id: string; area: string; nivel: "admin" | "socio" }[])
      delegado.set(`${a.user_id}|${a.area}`, a.nivel);

    const areas = (areasRes.data ?? []) as { slug: string; nome: string }[];
    const pessoas = ((perfisRes.data ?? []) as { user_id: string; nome: string | null; email: string | null }[])
      .map((p) => {
        const papeis = papeisDe.get(p.user_id) ?? [];
        const superAdmin = papeis.includes("admin");
        const pelosPapeis = new Set(papeis.flatMap((r) => [...(areasDoPapel.get(r) ?? [])]));
        return {
          userId: p.user_id,
          nome: p.nome || p.email || "Sem nome",
          email: p.email ?? "",
          perfis: papeis.map((r) => rotulo.get(r) ?? r),
          superAdmin,
          niveis: Object.fromEntries(
            areas.map((a) => [
              a.slug,
              superAdmin
                ? "super_admin"
                : delegado.get(`${p.user_id}|${a.slug}`) ?? (pelosPapeis.has(a.slug) ? "perfil" : "nenhum"),
            ]),
          ) as Record<string, "super_admin" | "admin" | "socio" | "usuario" | "perfil" | "bloqueado" | "nenhum">,
        };
      })
      .sort((x, y) => Number(y.superAdmin) - Number(x.superAdmin) || x.nome.localeCompare(y.nome, "pt-BR"));
    return { areas, pessoas };
  });
