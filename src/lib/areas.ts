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
  Landmark,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  MessageSquareHeart,
  MessageSquarePlus,
  Percent,
  Scale,
  ScrollText,
  Send,
  ShieldCheck,
  Split,
  Store,
  Target,
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
  /**
   * Área de permissão do item, quando difere da área que o contém.
   *
   * O normal é o item NÃO declarar nada: quem tem a área tem todas as páginas
   * dela, que é a regra desde 15/09/2026. A exceção existe quando a fronteira
   * do menu e a fronteira de confiança não coincidem — hoje só a Matriz do
   * broker, que mora no menu ao lado da fila mas guarda multiplicador e
   * composição de CAC, que não circulam na rede.
   */
  area?: string;
};

// Os grupos do menu.
//
// Eram 13, sete deles com um item só — a lista virava uma coluna de títulos com
// mais rótulo do que link. Aqui são 8, agrupados por ASSUNTO de quem usa, não
// pela ordem em que as telas foram nascendo.
export type Grupo = { label: string; items: Item[] };
export type Area = {
  /** Chave da área em `ops.areas`. É o que o papel concede. */
  slug: string;
  nome: string;
  /** Uma linha, para o cartão da porta de entrada. */
  descricao: string;
  icone: React.ComponentType<{ className?: string }>;
  grupos: Grupo[];
};

/** A área que decide se este item aparece. */
export function areaDoItem(area: Area, item: Item): string {
  return item.area ?? area.slug;
}

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
          { title: "Overview", url: "/rede-overview", icon: Activity },
          { title: "IDU", url: "/idu", icon: Gauge },
          {
            title: "Indicadores do Trimestre",
            url: "/indicadores-trimestre",
            icon: LayoutDashboard,
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
          },
          { title: "LTV Estimado", url: "/rede-ltv", icon: TrendingUp },
          {
            title: "Headcount",
            url: "/rede-headcount",
            icon: Users,
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
          { title: "Clientes", url: "/clientes", icon: Building2 },
          { title: "Aquário", url: "/aquario", icon: Users },
          { title: "CS", url: "/painel-cs", icon: UserCheck },
          {
            title: "Auditoria Interna",
            url: "/auditoria-interna",
            icon: ClipboardCheck,
          },
          {
            // Estava sozinha num grupo "Ferramentas", o que a deixava solta na
            // leitura. É uma simulação que se roda PARA um cliente, então mora
            // com a carteira.
            title: "Reforma Tributária",
            url: "/reforma-tributaria",
            icon: FileBarChart2,
          },
        ],
      },
      {
        label: "Relacionamento",
        items: [
          { title: "NPS", url: "/nps", icon: MessageSquareHeart },
          {
            title: "Disparos de WhatsApp",
            url: "/disparos-whatsapp",
            icon: Send,
          },
          {
            title: "Base de Contatos",
            url: "/base-contatos",
            icon: BookUser,
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
          },
          {
            title: "Reconciliação",
            url: "/reconciliacao",
            icon: GitMerge,
          },
          {
            title: "Contas a Receber",
            url: "/contas-receber",
            icon: Wallet,
          },
          { title: "BI de Vendas", url: "/bi-vendas", icon: Megaphone },
        ],
      },
      {
        // Eram cinco abas dentro de "Receitas Partners". A aba escondia tela
        // dentro de tela: quem não abrisse a página não sabia que Split e
        // Histórico existiam. Com a lateral por área há espaço para os cinco
        // destinos aparecerem por nome.
        label: "Repasses das unidades",
        items: [
          {
            title: "Regras da Rede",
            url: "/unidades",
            icon: ScrollText,
          },
          {
            title: "Apuração de Royalties",
            url: "/unidades/royalties",
            icon: Coins,
          },
          {
            title: "Histórico de Royalties",
            url: "/unidades/historico",
            icon: History,
          },
          {
            title: "Apuração de CAC",
            url: "/unidades/cac",
            icon: Target,
          },
          {
            title: "Split do Asaas",
            url: "/unidades/split",
            icon: Split,
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
          },
          { title: "Comissões", url: "/comissoes", icon: Percent },
          {
            title: "EBIT Operacional",
            url: "/ebit-operacional",
            icon: Scale,
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
          { title: "Cadastro", url: "/gente", icon: Users },
          {
            title: "1:1",
            url: "/gente?aba=um-a-um",
            icon: CalendarClock,
          },
          {
            title: "Feedback",
            url: "/gente?aba=feedback",
            icon: MessageSquarePlus,
          },
          {
            title: "Clima",
            url: "/gente?aba=clima",
            icon: HeartPulse,
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
          { title: "Operação diária", url: "/monetizacao", icon: LayoutDashboard },
          { title: "Temporal e previsão", url: "/monetizacao?aba=temporal", icon: TrendingUp },
          { title: "Projetado × realizado", url: "/monetizacao?aba=forecast", icon: BarChart3 },
          { title: "Capacidade e alocação", url: "/monetizacao?aba=capacidade", icon: Gauge },
          { title: "Follow Day", url: "/monetizacao?aba=follow-day", icon: CalendarClock },
          { title: "Fila Cella", url: "/fila-cella", icon: ListChecks },
        ],
      },
      {
        label: "Desenvolvimento comercial",
        items: [
          { title: "Funil comercial", url: "/monetizacao?aba=funil", icon: Filter },
          { title: "Pessoas e PDI", url: "/monetizacao?aba=pessoas", icon: Users },
          { title: "Abordagens", url: "/monetizacao?aba=roteiros", icon: MessageSquarePlus },
          { title: "Distribuição", url: "/monetizacao?aba=distribuicao", icon: GitMerge },
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
          { title: "Fila de oportunidades", url: "/broker", icon: Store },
          {
            // Única exceção à regra de "a área libera tudo": a Matriz mostra o
            // multiplicador e a composição do CAC, que são camada interna. Ela
            // mora no menu ao lado da fila porque é o mesmo assunto, mas quem
            // concede é a área `broker_matriz`.
            title: "Matriz",
            url: "/broker/admin",
            icon: Coins,
            area: "broker_matriz",
          },
        ],
      },
    ],
  },
  {
    // O menu do sócio regional. Até 15/09/2026 isto era `SOCIO_REGIONAL_GROUPS`,
    // uma lista fixa dentro de app-sidebar.tsx cujos itens não declaravam
    // permissão nenhuma — apareciam sempre, e quem segurava o dado era só a
    // RLS. Virou área para ter dono no /admin/permissoes e, principalmente,
    // para que dar "Contas a Receber" ao sócio não signifique dar comissões,
    // EBIT e DRE Partners junto, que é o que aconteceria se ele recebesse a
    // área Receita inteira.
    slug: "minha_unidade",
    nome: "Minha Unidade",
    descricao: "A unidade do sócio regional: carteira, CS, NPS e repasses.",
    icone: Gauge,
    grupos: [
      {
        label: "Minha Unidade",
        items: [
          { title: "Painel", url: "/painel-unidade", icon: Gauge },
          { title: "Clientes", url: "/clientes", icon: Building2 },
          { title: "CS", url: "/painel-cs", icon: UserCheck },
          { title: "NPS", url: "/nps", icon: MessageSquareHeart },
          { title: "IDU", url: "/idu", icon: Activity },
          { title: "Broker", url: "/broker", icon: Store, area: "broker" },
        ],
      },
      {
        label: "Financeiro",
        items: [
          { title: "Funil de Receita", url: "/funil-receita", icon: Filter },
          { title: "Contas a Receber", url: "/contas-receber", icon: Wallet },
          { title: "Meus Royalties", url: "/meus-royalties", icon: Coins },
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
          { title: "Usuários", url: "/admin/usuarios", icon: Users },
          { title: "Perfis", url: "/admin/perfis", icon: UserCog },
          {
            title: "Permissões",
            url: "/admin/permissoes",
            icon: ShieldCheck,
          },
          // A EXCEÇÃO de que o tipo `Item` fala, e o único item da Administração
          // que declara área própria. A fronteira do MENU diz "isto é
          // administração"; a fronteira de CONFIANÇA diz outra coisa: quem
          // administra os acessos do Financeiro não administra usuários,
          // perfis, permissões nem chaves do Asaas. Sem `area` própria o item
          // herdaria `admin` e a controladoria continuaria barrada — que é
          // exatamente o que o dono pediu para deixar de acontecer.
          {
            title: "Acessos do Financeiro",
            url: "/admin/acessos-financeiro",
            icon: Landmark,
            area: "admin_financeiro",
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
          },
          {
            title: "Chaves de Integração",
            url: "/admin/credenciais",
            icon: KeyRound,
          },
          {
            title: "Integrações",
            url: "/admin/integracoes",
            icon: KeyRound,
          },
          {
            title: "Validação de páginas",
            url: "/admin/validacao",
            icon: BadgeCheck,
          },
        ],
      },
    ],
  },
];
