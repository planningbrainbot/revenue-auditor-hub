import {
  Activity,
  BadgeCheck,
  BarChart3,
  BookUser,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Coins,
  FileBarChart2,
  Filter,
  Gauge,
  GitMerge,
  HeartPulse,
  History,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageSquareHeart,
  MessageSquarePlus,
  Percent,
  Scale,
  Send,
  ShieldCheck,
  Store,
  TrendingDown,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  Wallet,
} from "lucide-react";

/**
 * As frentes da plataforma que vivem NESTE app.
 *
 * Fonte única da lateral e da porta de entrada: as duas precisam concordar
 * sobre o que existe e sobre quem enxerga o quê, e duplicar a lista era o
 * caminho garantido para divergirem.
 *
 * Elas estão no mesmo nível de Growth e Financeiro, que são outras aplicações.
 * Do ponto de vista de quem usa não há diferença: são sete frentes no mesmo
 * domínio, e a fronteira técnica (mesmo app x app separado) não aparece.
 */
export type Item = {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  // Array = OR (item aparece se o usuário tiver qualquer uma das permissões) —
  // usado quando o item cobre conteúdo que veio de mais de uma página antiga.
  permission?: string | string[];
};

// Os grupos do menu.
//
// Eram 13, sete deles com um item só — a lista virava uma coluna de títulos com
// mais rótulo do que link. Aqui são 8, agrupados por ASSUNTO de quem usa, não
// pela ordem em que as telas foram nascendo.
export type Grupo = { label: string; items: Item[] };
export type Area = {
  slug: string;
  nome: string;
  /** Uma linha, para o cartão da porta de entrada. */
  descricao: string;
  icone: React.ComponentType<{ className?: string }>;
  grupos: Grupo[];
};

// As ÁREAS do Ops.
//
// O Ops virou muita coisa num lugar só: 35 telas numa lista única, e quem
// trabalha em CS convivia com contas a receber e apuração de royalties no
// mesmo menu. Agora a lateral mostra UMA área por vez, escolhida no seletor do
// topo — o mesmo gesto do trocador de produto, um nível abaixo.
//
// A área "Partners" foi dissolvida em 14/09/2026: `Financeiro Partners` era
// redundante com a DRE e o fluxo do cockpit, e o resto (despesas de C&M, EBIT
// e comissões) não tem equivalente lá, então migrou para Receita e Repasses,
// que já é a área de dinheiro dentro do Ops.
export const AREAS: Area[] = [
  {
    slug: "rede",
    descricao: "Como a rede está indo: overview, IDU, indicadores e realizado.",
    nome: "Rede",
    icone: Activity,
    grupos: [
      {
        label: "Visão geral",
        items: [
          { title: "Overview", url: "/rede-overview", icon: Activity, permission: "view.hub" },
          { title: "IDU", url: "/idu", icon: Gauge, permission: "view.idu" },
          {
            title: "Indicadores do Trimestre",
            url: "/indicadores-trimestre",
            icon: LayoutDashboard,
            permission: "view.indicadores_trimestre",
          },
        ],
      },
      {
        label: "Desempenho",
        items: [
          {
            title: "Realizado Unidades",
            url: "/rede-realizado",
            icon: BarChart3,
            permission: "view.rede_realizado",
          },
          { title: "LTV Estimado", url: "/rede-ltv", icon: TrendingUp, permission: "view.rede_ltv" },
          {
            title: "Headcount",
            url: "/rede-headcount",
            icon: Users,
            permission: "view.rede_headcount",
          },
        ],
      },
    ],
  },
  {
    slug: "clientes",
    descricao: "Carteira, CS, NPS, disparos e base de contatos.",
    nome: "Clientes",
    icone: Building2,
    grupos: [
      {
        label: "Carteira",
        items: [
          { title: "Clientes", url: "/clientes", icon: Building2, permission: "view.clientes" },
          { title: "CS", url: "/painel-cs", icon: UserCheck, permission: "view.painel_cs" },
          {
            title: "Auditoria Interna",
            url: "/auditoria-interna",
            icon: ClipboardCheck,
            permission: "view.auditoria_interna",
          },
          {
            // Estava sozinha num grupo "Ferramentas", o que a deixava solta na
            // leitura. É uma simulação que se roda PARA um cliente, então mora
            // com a carteira.
            title: "Reforma Tributária",
            url: "/reforma-tributaria",
            icon: FileBarChart2,
            permission: "view.reforma_tributaria",
          },
        ],
      },
      {
        label: "Relacionamento",
        items: [
          { title: "NPS", url: "/nps", icon: MessageSquareHeart, permission: "view.nps" },
          {
            title: "Disparos de WhatsApp",
            url: "/disparos-whatsapp",
            icon: Send,
            permission: "view.disparos_whatsapp",
          },
          {
            title: "Base de Contatos",
            url: "/base-contatos",
            icon: BookUser,
            permission: "view.base_contatos",
          },
        ],
      },
    ],
  },
  {
    slug: "receita",
    descricao: "Funil, contas a receber, repasses das unidades e comissões.",
    nome: "Receita e Repasses",
    icone: Coins,
    grupos: [
      {
        label: "Receita da rede",
        items: [
          {
            title: "Funil de Receita",
            url: "/funil-receita",
            icon: Filter,
            permission: "view.funil_receita",
          },
          {
            title: "Reconciliação",
            url: "/reconciliacao",
            icon: GitMerge,
            permission: "view.reconciliacao",
          },
          {
            title: "Contas a Receber",
            url: "/contas-receber",
            icon: Wallet,
            permission: "view.contas_receber",
          },
          { title: "BI de Vendas", url: "/bi-vendas", icon: Megaphone, permission: "view.bi_vendas" },
        ],
      },
      {
        label: "Repasses das unidades",
        items: [
          {
            title: "Receitas Partners",
            url: "/unidades",
            icon: Coins,
            permission: ["view.unidades_rede", "view.royalties_historico"],
          },
        ],
      },
      {
        // Veio da antiga área Partners. Não é redundante com o cockpit: aqui se
        // RATEIA custo por unidade e se apura comissão, lá se mostra resultado.
        label: "Custos e comissões",
        items: [
          {
            title: "Despesas Partners",
            url: "/despesas-cm",
            icon: TrendingDown,
            permission: "view.despesas_partners",
          },
          { title: "Comissões", url: "/comissoes", icon: Percent, permission: "view.comissoes" },
          {
            title: "EBIT Operacional",
            url: "/ebit-operacional",
            icon: Scale,
            permission: "view.ebit_operacional",
          },
        ],
      },
    ],
  },
  {
    slug: "people",
    nome: "Planning People",
    descricao: "Pessoas das unidades: cadastro, 1:1 e feedback.",
    icone: UsersRound,
    grupos: [
      {
        label: "Pessoas",
        items: [
          { title: "Cadastro", url: "/gente", icon: Users, permission: "view.gente" },
          {
            title: "1:1",
            url: "/gente?aba=um-a-um",
            icon: CalendarClock,
            permission: "view.gente.um_a_um",
          },
          {
            title: "Feedback",
            url: "/gente?aba=feedback",
            icon: MessageSquarePlus,
            permission: "view.gente.feedback",
          },
          {
            title: "Clima",
            url: "/gente?aba=clima",
            icon: HeartPulse,
            permission: "view.gente.clima",
          },
        ],
      },
    ],
  },
  {
    slug: "monetizacao",
    nome: "Monetização",
    descricao: "Fila de oportunidades de receita na base que já é nossa.",
    icone: ListChecks,
    grupos: [
      {
        label: "Oportunidades",
        items: [
          { title: "Fila Cella", url: "/fila-cella", icon: ListChecks, permission: "view.fila_cella" },
        ],
      },
    ],
  },
  {
    slug: "broker",
    descricao: "Fila de oportunidades e a matriz do broker.",
    nome: "Broker",
    icone: Store,
    grupos: [
      {
        label: "Broker",
        items: [
          { title: "Fila de oportunidades", url: "/broker", icon: Store, permission: "view.broker" },
          {
            title: "Matriz",
            url: "/broker/admin",
            icon: Coins,
            permission: "view.broker_admin",
          },
        ],
      },
    ],
  },
  {
    slug: "admin",
    descricao: "Usuários, papéis, permissões e integrações.",
    nome: "Administração",
    icone: ShieldCheck,
    grupos: [
      {
        label: "Pessoas e acesso",
        items: [
          { title: "Usuários", url: "/admin/usuarios", icon: Users, permission: "view.admin.users" },
          { title: "Perfis", url: "/admin/perfis", icon: UserCog, permission: "view.admin.profiles" },
          {
            title: "Permissões",
            url: "/admin/permissoes",
            icon: ShieldCheck,
            permission: "view.admin.permissions",
          },
        ],
      },
      {
        label: "Sistema",
        items: [
          {
            title: "Atividade do Sistema",
            url: "/atividade",
            icon: History,
            permission: "view.atividade",
          },
          {
            title: "Chaves de Integração",
            url: "/admin/credenciais",
            icon: KeyRound,
            permission: "view.admin.credenciais",
          },
          {
            title: "Integrações",
            url: "/admin/integracoes",
            icon: KeyRound,
            permission: "view.admin.integracoes",
          },
          {
            title: "Validação de páginas",
            url: "/admin/validacao",
            icon: BadgeCheck,
            permission: "view.admin.permissions",
          },
        ],
      },
    ],
  },
];
