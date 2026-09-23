import {
  Activity,
  BadgeCheck,
  BarChart3,
  BookUser,
  Building2,
  CalendarClock,
  ClipboardCheck,
  Coins,
  Compass,
  FileBarChart2,
  Filter,
  Gauge,
  GitMerge,
  GraduationCap,
  HeartPulse,
  History,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  MessageSquareHeart,
  MessageSquarePlus,
  Percent,
  Scale,
  ScrollText,
  Send,
  ShieldCheck,
  Sparkles,
  Split,
  Store,
  Target,
  TrendingUp,
  UserCheck,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  Briefcase,
  CircleDollarSign,
  Database,
  UserX,
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
   * do menu e a fronteira de confiança não coincidem — a Matriz do broker, que
   * mora no menu ao lado da fila mas guarda multiplicador e composição de CAC,
   * e o bloco Financeiro da unidade, que o sócio regional pode ou não abrir.
   */
  area?: string;
  /**
   * Página que o item abre, quando ela pode ser dada a uma pessoa sozinha.
   * Desde 17/09/2026 o sócio escolhe as páginas de cada colaborador dentro da
   * área, então ter a área não basta: o item só aparece com a chave.
   */
  chave?: string;
  /**
   * Condição de FATO para o item aparecer, quando permissão não resolve.
   *
   * No Planning People a área concede todas as chaves, então `can()` responde
   * `true` para todo mundo e não separa o colaborador de quem administra. O que
   * separa é lidera alguém, está em ciclo, tem PDI. Quem avalia a flag é a
   * lateral, contra `resumoMenuGente`.
   */
  flag?:
    | "lideraAlguem"
    | "emCiclo"
    | "verAvaliacao"
    | "temPdi"
    | "administra"
    | "redeInteira"
    | "noCadastro";
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

/**
 * Quebra a URL de um item do menu em path e busca.
 *
 * Os itens guardam a URL inteira ("/gente?visao=minha-vez") porque é assim que
 * o menu foi escrito, mas o roteador quer as duas partes separadas. A lateral
 * já fazia esse split na mão; aqui vira função, para quem navegar por código
 * não repetir o truque e não mandar a query junto do path.
 */
export function partesDoLink(url: string): { to: string; search: Record<string, string> } {
  const [caminho, busca] = url.split("?");
  return {
    to: caminho,
    search: busca ? Object.fromEntries(new URLSearchParams(busca)) : {},
  };
}

/**
 * TODAS as áreas que respondem por um caminho, segundo o próprio menu.
 *
 * Devolve lista vazia para caminho que não está em área nenhuma (admin,
 * /equipe, /inicio e afins), e aí o portão do layout não opina: quem manda
 * continua sendo a checagem da própria página.
 *
 * Casa pelo path, ignorando a query, porque o mesmo path serve várias telas
 * ("/gente?visao=..." é tudo Planning People).
 *
 * É lista, e não uma área só, porque **sete caminhos moram em duas áreas ao
 * mesmo tempo**: `/clientes`, `/painel-cs` e `/nps` estão em `clientes` e em
 * `minha_unidade`; `/idu` em `rede` e `minha_unidade`; `/funil-receita` e
 * `/contas-receber` em `receita` e `minha_unidade_financeiro`; `/broker` em
 * `broker` e `minha_unidade`. Isso é de propósito: a mesma tela é o trabalho da
 * matriz e o da unidade, e `ops.area_chaves` concede `view.clientes` pelos dois
 * lados. A versão anterior devolvia a PRIMEIRA área da lista e trancava o sócio
 * regional em quatro dos seis itens do próprio menu dele (relatado em
 * 23/09/2026: "Esta página é da área Base de clientes" para quem tem
 * `minha_unidade`).
 */
export function areasDoCaminho(pathname: string): string[] {
  const slugs: string[] = [];
  for (const area of AREAS) {
    for (const grupo of area.grupos) {
      for (const item of grupo.items) {
        if (item.url.split("?")[0] !== pathname) continue;
        const slug = areaDoItem(area, item);
        if (!slugs.includes(slug)) slugs.push(slug);
      }
    }
  }
  return slugs;
}

/**
 * A primeira área que responde por um caminho. **Só para aparência.**
 *
 * É o que o cabeçalho e a cor da área usam quando precisam de um slug só, e aí
 * a escolha é de gosto: a carteira pinta de `clientes` mesmo quando quem abriu
 * foi o sócio. Para DECIDIR ACESSO use `areasDoCaminho`, porque quem tem a
 * segunda área também entra.
 */
export function areaDoCaminho(pathname: string): string | null {
  return areasDoCaminho(pathname)[0] ?? null;
}

/**
 * A primeira tela que a pessoa consegue abrir de verdade.
 *
 * Existe porque o redirecionamento pós-login mandava todo mundo que só tem o
 * Ops para `/rede-overview`, sem perguntar se a pessoa tem a área Rede. Quem
 * tem só Planning People caía numa página que não pode ler e via "Esta página
 * não carregou" como primeira tela do produto (relatado em 22/09/2026).
 *
 * Devolve `null` quando não há nenhuma área, e aí quem chama decide o destino.
 */
export function primeiraTelaAcessivel(
  temArea: (slug: string) => boolean,
  can: (chave: string) => boolean,
): string | null {
  for (const area of AREAS) {
    for (const grupo of area.grupos) {
      for (const item of grupo.items) {
        if (temArea(areaDoItem(area, item)) && (!item.chave || can(item.chave))) {
          return item.url;
        }
      }
    }
  }
  return null;
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
    nome: "Base de clientes",
    icone: Building2,
    grupos: [
      {
        label: "Carteira",
        items: [
          { title: "Base de clientes", url: "/clientes", icon: Building2 },
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
            // Bloqueada desde 17/09/2026: só o super admin dispara. Disparo custa
            // por conversa e fala com o cliente em nome da rede.
            area: "disparos_whatsapp",
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
        // A área tinha nove telas e nenhuma porta: quem entrava caía no Funil
        // de Receita sem saber se a apuração do mês tinha fechado, se a fatura
        // saiu ou se a unidade pagou. Por ser o primeiro item, é também a tela
        // que `primeiraTelaAcessivel` escolhe depois do login.
        label: "Visão geral",
        items: [{ title: "Visão geral", url: "/receita-overview", icon: LayoutDashboard }],
      },
      {
        label: "Receita da rede",
        items: [
          {
            title: "Funil de Receita",
            url: "/funil-receita",
            icon: Filter,
          },
          {
            title: "Contas a Receber",
            url: "/contas-receber",
            icon: Wallet,
          },
        ],
      },
      {
        // Eram cinco abas dentro de "Receitas Partners". A aba escondia tela
        // dentro de tela: quem não abrisse a página não sabia que Split e
        // Histórico existiam. Com a lateral por área cada destino aparece por
        // nome. Sobraram quatro: o Histórico de Royalties saiu em 22/09/2026.
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
            title: "Funil de CAC",
            url: "/unidades/funil-cac",
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
    descricao: "As pessoas das unidades: cadastro, conversas, desenvolvimento, avaliação e clima.",
    icone: UsersRound,
    grupos: [
      // Módulo a módulo na lateral, a pedido de quem vai implantar o produto
      // na rede (22/09/2026): "assim o usuário entra só no módulo que deseja".
      //
      // A diferença para o desenho antigo, que também era por módulo, está em
      // `flag`: o item só aparece para quem aquele módulo serve. Quem implanta
      // vê os onze; quem só responde vê meia dúzia. Antes eram oito iguais para
      // todo mundo, e seis vinham vazios para a maioria.
      {
        label: "Minha rotina",
        items: [
          { title: "Minha vez", url: "/gente?tela=minha-vez", icon: UserCheck },
          {
            title: "Meu time",
            url: "/gente?tela=meu-time",
            icon: Users,
            flag: "lideraAlguem",
          },
        ],
      },
      {
        label: "Conversas",
        items: [
          { title: "1:1", url: "/gente?tela=um-a-um", icon: CalendarClock },
          {
            title: "Sentimento e prioridades",
            url: "/gente?tela=lideranca",
            icon: HeartPulse,
            flag: "noCadastro",
          },
          { title: "Feedback", url: "/gente?tela=feedback", icon: MessageSquarePlus },
          { title: "Elogios", url: "/gente?tela=elogios", icon: Sparkles },
        ],
      },
      {
        label: "Desenvolvimento",
        items: [
          {
            title: "Avaliação",
            url: "/gente?tela=avaliacao",
            icon: Target,
            flag: "verAvaliacao",
          },
          { title: "PDI", url: "/gente?tela=pdi", icon: GraduationCap, flag: "temPdi" },
        ],
      },
      {
        label: "A rede",
        items: [
          { title: "Cadastro", url: "/gente?tela=cadastro", icon: BookUser },
          { title: "Clima", url: "/gente?tela=clima", icon: Gauge, flag: "administra" },
          {
            title: "Adoção por unidade",
            url: "/gente?tela=adocao",
            icon: Activity,
            flag: "redeInteira",
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
    // Cockpit do CEO (piloto de 22/09/2026). Área própria porque o PRD o põe no seletor de módulos
    // e porque a fronteira de confiança é outra: ver a Base não dá visão consolidada da empresa.
    // A área existe em `ops.areas` desde 22/09/2026, liberada só para o papel `admin`
    // (supabase/migrations/20260922220000_cockpit_ceo_area.sql). Fica depois do Broker, e não em
    // primeiro, para não virar a área padrão da lateral de quem a receber. Área própria com card no
    // /inicio, e não dentro de "Estratégia & Execução": decisão do Pedro em 23/09/2026.
    //
    // As seis frentes são itens da lateral (`?frente=`), como Monetização faz com `?aba=`: a
    // página não desenha abas que trocam de assunto (NAVEGACAO.md N6; contrato
    // docs/design/contratos/cockpit-ceo.md, aprovado em 23/09).
    slug: "cockpit_ceo",
    nome: "Cockpit do CEO",
    descricao: "Plano, crescimento, ameaças e decisões, com a composição de cada número.",
    icone: Compass,
    grupos: [
      {
        label: "Cockpit do CEO",
        items: [{ title: "Visão executiva", url: "/cockpit-ceo", icon: LayoutDashboard }],
      },
      {
        label: "Frentes",
        items: [
          {
            title: "Receita e crescimento",
            url: "/cockpit-ceo?frente=receita",
            icon: CircleDollarSign,
          },
          { title: "Clientes e produtos", url: "/cockpit-ceo?frente=clientes", icon: Building2 },
          { title: "Execução comercial", url: "/cockpit-ceo?frente=comercial", icon: Briefcase },
          { title: "Saúde da rede", url: "/cockpit-ceo?frente=rede", icon: Store },
          { title: "Retenção e entrega", url: "/cockpit-ceo?frente=retencao", icon: UserX },
          { title: "Capital e evidências", url: "/cockpit-ceo?frente=capital", icon: Database },
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
          { title: "Painel", url: "/painel-unidade", icon: Gauge, chave: "view.painel_unidade" },
          { title: "Base de clientes", url: "/clientes", icon: Building2, chave: "view.clientes" },
          { title: "CS", url: "/painel-cs", icon: UserCheck, chave: "view.painel_cs" },
          { title: "NPS", url: "/nps", icon: MessageSquareHeart, chave: "view.nps" },
          { title: "IDU", url: "/idu", icon: Activity, chave: "view.idu" },
        ],
      },
      {
        // Segunda exceção à regra de "a área libera tudo", pelo mesmo motivo da
        // Matriz do broker: o bloco mora no menu da unidade porque é assunto
        // dela, mas dar carteira, CS e NPS ao sócio não deve dar junto o
        // financeiro. Desde 16/09/2026 quem concede é `minha_unidade_financeiro`.
        label: "Financeiro",
        items: [
          {
            title: "Funil de Receita",
            url: "/funil-receita",
            icon: Filter,
            area: "minha_unidade_financeiro",
          },
          {
            title: "Contas a Receber",
            url: "/contas-receber",
            icon: Wallet,
            area: "minha_unidade_financeiro",
          },
          {
            title: "Meus Royalties",
            url: "/meus-royalties",
            icon: Coins,
            area: "minha_unidade_financeiro",
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
          { title: "Usuários", url: "/admin/usuarios", icon: Users },
          // O quadro do super admin: nível de cada pessoa em cada área.
          { title: "Níveis de acesso", url: "/admin/niveis", icon: ShieldCheck },
          // A mesma tela que admin e sócio abrem pelo rodapé; aqui com todas as áreas.
          { title: "Equipes", url: "/equipe", icon: UsersRound },
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
