import {
  Activity,
  BarChart3,
  BookUser,
  BookmarkCheck,
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
  PhoneCall,
  Percent,
  Receipt,
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
  MessagesSquare,
  CalendarDays,
  ClipboardList,
  ArrowRightLeft,
  Trophy,
  HandCoins,
  Package,
  ListTodo,
  SquareKanban,
  Tags,
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
    | "remuneracao"
    | "noCadastro"
    // Fora do Planning People: a unidade do sócio paga CAC (há linha em
    // `v_cac_funil_resumo` para ele). Avaliada pela lateral, não por `resumoMenuGente`.
    | "pagaCac"
    // Idem: a unidade do sócio tem split do Asaas ativo (há linha em `v_split_cliente_mes`).
    | "temSplit";
  /**
   * Outros caminhos que contam como "estar neste item", além da `url`. Só para
   * o grifo da lateral e o cabeçalho, nunca para o portão de área.
   *
   * Existe pela Ficha da unidade do sócio: o item é /minha-unidade, mas a tela
   * é /unidades/8, que pelo prefixo diria "Administração › Unidades".
   */
  tambem?: RegExp;
};

/** Quanto do caminho o item cobre: o tamanho da url que casa, ou -1. */
export function casaComCaminho(item: Item, pathname: string): number {
  const caminho = item.url.split("?")[0];
  const casa =
    caminho === "/" ? pathname === "/" : pathname === caminho || pathname.startsWith(caminho + "/");
  if (casa) return caminho.length;
  return item.tambem?.test(pathname) ? pathname.length : -1;
}

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
 * É lista, e não uma área só, porque **quatro caminhos moram em duas áreas ao
 * mesmo tempo**: `/clientes` está em `clientes` e em `minha_unidade`;
 * `/painel-cs`, `/nps` e `/idu` em `rede` e `minha_unidade`. (`/contas-receber`
 * e `/funil-receita`, que moravam em `receita` e `minha_unidade_financeiro`,
 * foram apagadas em 16/10/2026.) (`/broker` saiu
 * da Minha Unidade em 23/09/2026: o sócio regional já tem a área `broker`.)
 * Isso é de propósito: a mesma tela é o trabalho da
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
    descricao: "Como a rede está indo: overview, IDU, realizado, CS e NPS.",
    nome: "Rede",
    icone: Activity,
    grupos: [
      {
        label: "Visão geral",
        items: [
          { title: "Overview", url: "/rede-overview", icon: Activity },
          { title: "IDU", url: "/idu", icon: Gauge },
          // O mesmo ranking que o sócio vê em Minha Unidade (02/10/2026).
          { title: "Ranking da Rede", url: "/ranking-unidades", icon: Trophy },
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
      {
        // Moraram em Base de clientes até 23/09/2026. Vieram para a Rede junto
        // com as chaves (migration 20260923190000): quem tem Rede abre, quem só
        // tem Base de clientes deixa de ver.
        label: "Carteira",
        items: [
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
        ],
      },
    ],
  },
  {
    slug: "clientes",
    descricao: "Carteira de clientes e base de contatos.",
    nome: "Base de clientes",
    icone: Building2,
    grupos: [
      {
        label: "Carteira",
        // A Base em três telas (Pedro, 15/10/2026): Clientes, Confiança e Painel na lateral. "Base de Contatos" saiu
        // do menu (a rota continua). Produtos e Listas, a construção de listas, só para quem tem a área Monetização.
        // Confiança e Painel têm chave própria (22/10/2026): o time de vendas tem a área com a chave de Clientes só.
        items: [
          { title: "Clientes", url: "/clientes", icon: Building2 },
          {
            title: "Confiança",
            url: "/clientes?view=confianca",
            icon: ShieldCheck,
            chave: "view.clientes_painel",
          },
          {
            title: "Painel",
            url: "/clientes?view=painel",
            icon: BarChart3,
            chave: "view.clientes_painel",
          },
          { title: "Produtos", url: "/clientes/produtos", icon: Package, area: "monetizacao" },
          { title: "Listas", url: "/clientes/listas", icon: ListChecks, area: "monetizacao" },
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
      // O grupo "Caixa da Partners" (Financeiro semanal e BI Financeiro) foi para a área
      // BI Financeiro em 19/10/2026.
      {
        // Eram cinco abas dentro de "Receitas Partners". A aba escondia tela
        // dentro de tela: quem não abrisse a página não sabia que Split e
        // Histórico existiam. Com a lateral por área cada destino aparece por
        // nome. Sobraram quatro: o Histórico de Royalties saiu em 22/09/2026.
        // Em 02/10/2026 a lista de Unidades foi para a Administração.
        label: "Repasses das unidades",
        items: [
          {
            title: "Apuração de Royalties",
            url: "/unidades/royalties",
            icon: Coins,
            // A apuração aberta é /royalties/<unidade>/<mês>, que nenhum item cobre: a lateral
            // caía na primeira área (Rede) com a tela da apuração na frente (16/10/2026).
            tambem: /^\/royalties\/[^/]+\/[^/]+$/,
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
          {
            // Da venda ao royalty, só unidades com split (16/10/2026).
            title: "Funil da Rede",
            url: "/unidades/funil-rede",
            icon: Target,
            chave: "view.royalties_split",
          },
          {
            // Todas as unidades, venda → contrato → recebido, e CAC × recebido (20/10/2026).
            title: "Venda ao Recebido",
            url: "/unidades/funil-recebido",
            icon: Target,
            chave: "view.funil_recebido",
          },
          {
            // A mesma lista e ficha da Administração (> Rede), para quem confere
            // repasse sem ser super admin (pedido de 16/10/2026). Ver é a chave
            // `view.unidades_rede`, que a Receita já concedia; cadastrar segue
            // com `manage.unidades_rede` e as chaves do Omie, com o super admin.
            title: "Unidades",
            url: "/unidades",
            icon: Landmark,
            chave: "view.unidades_rede",
          },
        ],
      },
      {
        // Veio da antiga área Partners. Não é redundante com o cockpit: aqui se
        // RATEIA custo por unidade e se apura comissão, lá se mostra resultado.
        label: "Custos e comissões",
        items: [
          // EBIT Operacional (/ebit-operacional) apagado em 22/10/2026.
          { title: "Comissões", url: "/comissoes", icon: Percent },
        ],
      },
    ],
  },
  {
    // BI Financeiro (19/10/2026, contrato docs/design/contratos/bi-financeiro.md): o resultado da
    // Partners contra o Forecast Oficial, o caixa e o fôlego, para o CEO acompanhar todo dia. Juntou
    // o Financeiro semanal e o BI que moravam em Receita e Repasses. Cada assunto é um item da
    // lateral (`?aba=`), como as frentes do Cockpit do CEO: a página não desenha abas (N6).
    slug: "bi_financeiro",
    nome: "BI Financeiro",
    descricao: "Resultado contra o plano, caixa e fôlego da Partners, todo dia.",
    icone: BarChart3,
    grupos: [
      {
        label: "Visão geral",
        items: [{ title: "Visão executiva", url: "/bi-financeiro", icon: LayoutDashboard }],
      },
      {
        label: "Resultado",
        items: [
          { title: "Forecast × Realizado", url: "/bi-financeiro?aba=forecast", icon: Target },
          { title: "Resultado do período", url: "/bi-financeiro?aba=geral", icon: TrendingUp },
          { title: "DRE", url: "/bi-financeiro?aba=dre", icon: ScrollText },
          {
            title: "Aquisição × Retenção",
            url: "/bi-financeiro?aba=aquisicao-retencao",
            icon: Split,
          },
          { title: "Variação", url: "/bi-financeiro?aba=variacao", icon: ArrowRightLeft },
        ],
      },
      {
        label: "Caixa",
        items: [
          // Previsibilidade de caixa: saídas pelo vencimento, lidas de `ops.saidas_omie` (22/10/2026; antes era o reporte do CEO).
          { title: "Previsibilidade de caixa", url: "/financeiro-semanal", icon: Wallet },
          { title: "Fôlego", url: "/bi-financeiro?aba=folego", icon: Gauge },
          { title: "Competência × Caixa", url: "/bi-financeiro?aba=ponte", icon: Scale },
          { title: "Entradas e saídas", url: "/bi-financeiro?aba=caixa", icon: Landmark },
          { title: "Inadimplência", url: "/bi-financeiro?aba=inadimplencia", icon: Receipt },
        ],
      },
      {
        label: "Aquisição",
        items: [
          { title: "Mídia", url: "/bi-financeiro?aba=midia", icon: Coins },
          { title: "Mídia × CAC", url: "/bi-financeiro?aba=midia-cac", icon: Filter },
          // Funil de CAC (19/10/2026): o mesmo de /unidades/funil-cac, com o degrau Recebido.
          { title: "Funil de CAC", url: "/bi-financeiro?aba=funil-cac", icon: Target },
          // Aba Vendas e ROAS (19/10/2026): vendas da rede toda, ROAS fato × safra e agenda do CAC.
          { title: "Vendas e ROAS", url: "/bi-financeiro?aba=vendas", icon: TrendingUp },
          { title: "Eficiência", url: "/bi-financeiro?aba=eficiencia", icon: Percent },
        ],
      },
      {
        label: "Fechamento",
        items: [
          { title: "Conferências", url: "/bi-financeiro?aba=conferencias", icon: ClipboardCheck },
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
          {
            title: "Movimentações",
            url: "/gente?tela=movimentacoes",
            icon: ArrowRightLeft,
            flag: "remuneracao",
          },
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
          // As telas pedem view.monetizacao; a Consultoria tem chave própria (22/10/2026): a Karol, closer da Consultoria,
          // tem a área com a chave dela só.
          { title: "Operação diária", url: "/monetizacao", icon: LayoutDashboard, chave: "view.monetizacao" },
          // Pré-venda (09/10/2026, PRD aprovado): Ritmo, Aderência e Ficha numa aba só (`visao`). Gravações virou
          // Ficha › Reuniões e Pessoas e PDI saiu (decisão 1A); os links antigos abrem a Pré-venda com aviso.
          { title: "Pré-venda", url: "/monetizacao?aba=pre-venda", icon: PhoneCall, chave: "view.monetizacao" },
          {
            title: "Consultoria",
            url: "/monetizacao?aba=handoff-consultoria",
            icon: HandCoins,
            chave: "view.consultoria",
          },
          // Forecast (14/10/2026, call com o Paulo): data esperada de fechamento e receita do mês.
          {
            title: "Forecast",
            url: "/monetizacao?aba=fechamentos",
            icon: CalendarClock,
            chave: "view.monetizacao",
          },
          // Cella (22/10/2026): contratos passados à Diehl & Cella e o valor de cada tese, lidos do funil deles.
          { title: "Cella", url: "/monetizacao?aba=cella", icon: Scale, chave: "view.monetizacao" },
          // Temporal e previsão, Projetado × realizado, Capacidade e alocação e Follow Day saíram em 09/10/2026
          // (aprovado pelo dono do produto); o link antigo abre a Operação diária com aviso.
        ],
      },
      {
        label: "Desenvolvimento comercial",
        items: [
          { title: "Funil comercial", url: "/monetizacao?aba=funil", icon: Filter, chave: "view.monetizacao" },
          {
            title: "Abordagens",
            url: "/monetizacao?aba=roteiros",
            icon: MessageSquarePlus,
            chave: "view.monetizacao",
          },
          {
            title: "Distribuição",
            url: "/monetizacao?aba=distribuicao",
            icon: GitMerge,
            chave: "view.monetizacao",
          },
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
          // Até 23/09/2026 as quatro seguintes eram abas dentro de /broker.
          // Viraram páginas quando o Broker ganhou lugar no seletor de produtos.
          { title: "Oportunidades", url: "/broker", icon: Store },
          { title: "Minhas reservas", url: "/broker/reservas", icon: BookmarkCheck },
          { title: "Movimentações", url: "/broker/movimentacoes", icon: History },
          { title: "Faturas e pagamentos", url: "/broker/faturas", icon: Wallet },
          { title: "CAC", url: "/broker/cac", icon: Receipt },
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
    // Portal de Faturamento (E1, 20/10/2026; contratos docs/design/contratos/faturamento*.md). Três áreas no
    // banco, porque a área libera todas as chaves dela (DECISIONS 15/10/2026): `faturamento` é a porta e o
    // pedido; a Fila da tesouraria e a Configuração declaram a área própria, como a Matriz do broker. Fica
    // depois do Broker para não virar a primeira tela de quem já trabalha em outra área e passar a pedir
    // faturamento. "Novo pedido" não é item: é a ação principal do cabeçalho de Meu faturamento e de Pedidos.
    slug: "faturamento",
    nome: "Faturamento",
    descricao: "Pedidos de faturamento das empresas do grupo, do dono da receita à nota no Omie.",
    icone: Receipt,
    grupos: [
      {
        label: "Visão geral",
        items: [{ title: "Meu faturamento", url: "/faturamento", icon: LayoutDashboard }],
      },
      {
        label: "Pedidos",
        items: [
          {
            title: "Pedidos",
            url: "/faturamento/pedidos",
            icon: Receipt,
            // O formulário e a ficha não são itens: acendem Pedidos, de onde se chega a eles.
            tambem: /^\/faturamento\/(novo|pedido\/[^/]+)$/,
          },
        ],
      },
      {
        label: "Tesouraria",
        items: [
          {
            title: "Fila da tesouraria",
            url: "/faturamento/tesouraria",
            icon: ListChecks,
            area: "faturamento_tesouraria",
            chave: "edit.faturamento_tesouraria",
          },
        ],
      },
      {
        label: "Controladoria",
        items: [
          {
            title: "Configuração",
            url: "/faturamento/configuracao",
            icon: ShieldCheck,
            area: "faturamento_controladoria",
            chave: "admin.faturamento",
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
    // As frentes são itens da lateral (`?frente=`), como Monetização faz com `?aba=`: a página
    // não desenha abas que trocam de assunto (NAVEGACAO.md N6). Em 23/09 o escopo passou da
    // Monetização para a empresa inteira: nove frentes, com as chaves antigas preservadas
    // (contrato docs/design/contratos/cockpit-ceo.md, revisão de 23/09).
    slug: "cockpit_ceo",
    nome: "Cockpit do CEO",
    descricao: "Plano, crescimento, ameaças e decisões, com a composição de cada número.",
    icone: Compass,
    grupos: [
      {
        label: "Cockpit do CEO",
        // "Perguntar ao Brain" (24/09/2026): conversa com consultas ao mesmo dado do cockpit.
        items: [
          { title: "Visão executiva", url: "/cockpit-ceo", icon: LayoutDashboard },
          { title: "Perguntar ao Brain", url: "/cockpit-ceo/perguntar", icon: MessagesSquare },
        ],
      },
      {
        label: "Frentes",
        items: [
          {
            title: "Receita e trajetória",
            url: "/cockpit-ceo?frente=receita",
            icon: CircleDollarSign,
          },
          {
            title: "Aquisição e conversão",
            url: "/cockpit-ceo?frente=comercial",
            icon: TrendingUp,
          },
          { title: "Clientes", url: "/cockpit-ceo?frente=clientes", icon: Building2 },
          { title: "Retenção e expansão", url: "/cockpit-ceo?frente=retencao", icon: UserX },
          { title: "Operação e capacidade", url: "/cockpit-ceo?frente=operacao", icon: ListChecks },
          { title: "Unidades", url: "/cockpit-ceo?frente=rede", icon: Store },
          {
            title: "Portfólio e monetização",
            url: "/cockpit-ceo?frente=portfolio",
            icon: Briefcase,
          },
          { title: "Caixa e margem", url: "/cockpit-ceo?frente=caixa", icon: Wallet },
          { title: "Evidências e capital", url: "/cockpit-ceo?frente=capital", icon: Database },
        ],
      },
    ],
  },
  {
    // Cockpit do COO · Expansão (29/09/2026, spec docs/superpowers/specs/2026-09-29-cockpit-coo-
    // expansao-design.md, aprovada pelo COO com ajustes). A pauta das cinco reuniões da semana do COO:
    // cada tema é um item da lateral (`?tema=`), a chave da URL é o tema e não o dia (N6, N7). O
    // perímetro são TODAS as unidades do cadastro, a pedido do COO. Área liberada só para `admin`
    // na migration 20260929120000; o COO entra pela tela de acessos.
    slug: "cockpit_coo",
    nome: "Cockpit do COO",
    descricao:
      "A pauta da semana da Expansão: números de todas as unidades, OKRs, tarefas do ClickUp e compromissos.",
    icone: CalendarDays,
    grupos: [
      {
        label: "Rotina da semana",
        items: [
          { title: "Seg · Growth", url: "/cockpit-coo?tema=growth", icon: TrendingUp },
          {
            title: "Ter · Financeiro e Operações",
            url: "/cockpit-coo?tema=financeiro-operacoes",
            icon: Wallet,
          },
          { title: "Qua · CS e RH", url: "/cockpit-coo?tema=cs-rh", icon: HeartPulse },
          { title: "Qui · Monetização", url: "/cockpit-coo?tema=monetizacao", icon: Coins },
          { title: "Sex · Estratégico", url: "/cockpit-coo?tema=estrategico", icon: Target },
        ],
      },
      {
        label: "Execução",
        items: [
          {
            title: "Tarefas e compromissos",
            url: "/cockpit-coo/compromissos",
            icon: ClipboardList,
          },
          { title: "Perguntar ao Brain", url: "/cockpit-coo/perguntar", icon: MessagesSquare },
        ],
      },
    ],
  },
  {
    // Quadros de tarefas próprios do Ops, sem ClickUp (22/10/2026, contrato tarefas.md). A área
    // abre o menu; dentro dela quem decide é ser membro do quadro, pela RLS.
    slug: "tarefas",
    nome: "Tarefas",
    descricao: "Quadros de tarefas do time e o que está com cada um.",
    icone: ListTodo,
    grupos: [
      {
        label: "Trabalho",
        items: [
          { title: "Minhas tarefas", url: "/tarefas", icon: ListTodo },
          {
            title: "Quadros",
            url: "/tarefas/quadros",
            icon: SquareKanban,
            tambem: /^\/tarefas\/quadros\/[^/]+$/,
          },
        ],
      },
      {
        label: "Configuração",
        items: [
          { title: "Departamentos", url: "/tarefas/departamentos", icon: Tags, area: "admin" },
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
          // A ficha da própria unidade (/unidades/$unidadeId), sem as chaves.
          {
            title: "Ficha da unidade",
            url: "/minha-unidade",
            icon: ScrollText,
            tambem: /^\/unidades\/\d+$/,
          },
          // Serviços contratados da matriz e o boleto de contas fixas, com 2ª via
          // (07/10/2026). Fica com a área da unidade, não com o Financeiro: é o que a
          // unidade paga à matriz, e minha_unidade_financeiro não está com nenhum sócio.
          { title: "Serviços e faturas", url: "/meus-servicos", icon: Receipt },
          // As vendas que a unidade fechou pelo pipe Sócios do Pipedrive (02/10/2026).
          { title: "Hunter Sócio", url: "/hunter-socio", icon: Target, chave: "view.hunter_socio" },
          // O Funil de CAC da rede recortado na unidade (05/10/2026). Unidade que
          // não paga CAC não vê o item: a view não devolve linha para ela.
          {
            title: "Funil de CAC",
            url: "/meu-funil-cac",
            icon: Filter,
            chave: "view.meu_funil_cac",
            flag: "pagaCac",
          },
          // O Split do Asaas da rede recortado na unidade (08/10/2026). Unidade sem
          // split ativo não vê o item: a view não devolve linha para ela.
          {
            title: "Split do Asaas",
            url: "/meu-split",
            icon: Coins,
            chave: "view.meu_split",
            flag: "temSplit",
          },
          { title: "Base de clientes", url: "/clientes", icon: Building2, chave: "view.clientes" },
          { title: "CS", url: "/painel-cs", icon: UserCheck, chave: "view.painel_cs" },
          { title: "NPS", url: "/nps", icon: MessageSquareHeart, chave: "view.nps" },
          { title: "IDU", url: "/idu", icon: Activity, chave: "view.idu" },
          // Ranking aberto entre as unidades, com números, como o IDU (decisão de 28/08/2026).
          {
            title: "Ranking da Rede",
            url: "/ranking-unidades",
            icon: Trophy,
            chave: "view.ranking_unidades",
          },
          {
            // Tela própria, e não /auditoria-interna em duas áreas: aquela é a
            // visão da matriz (ranking entre unidades, botão de sync). Esta mostra
            // só o resultado, e o recorte vem da RLS de `auditorias_internas`.
            title: "Auditorias",
            url: "/minhas-auditorias",
            icon: ClipboardCheck,
            chave: "view.minhas_auditorias",
          },
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
    descricao: "Pessoas, perfis, áreas e integrações.",
    nome: "Administração",
    icone: ShieldCheck,
    grupos: [
      {
        label: "Pessoas e acesso",
        items: [
          // Pessoas: a lista e a ficha de cada uma (o que acessa e por quê).
          // "Níveis de acesso" e "Perfis" saíram em 24/09/2026: o nível de cada
          // área está na ficha, e o cadastro de perfis está em Perfis e áreas.
          { title: "Pessoas", url: "/admin/usuarios", icon: Users },
          { title: "Perfis e áreas", url: "/admin/permissoes", icon: UserCog },
          // A mesma tela que admin e sócio abrem pelo rodapé; aqui com todas as áreas.
          { title: "Equipes", url: "/equipe", icon: UsersRound },
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
        // A lista das unidades e a ficha de cada uma (cadastro, regra de
        // repasse, sócios, acessos e chaves). Morava em Receita e Repasses
        // como "Regras da Rede"; veio para cá a pedido do Eliezek em 02/10/2026.
        label: "Rede",
        items: [{ title: "Unidades", url: "/unidades", icon: Landmark }],
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
        ],
      },
    ],
  },
];
