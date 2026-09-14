import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  TrendingUp,
  TrendingDown,
  Users,
  UserCog,
  ShieldCheck,
  Building2,
  Coins,
  BadgeCheck,
  Wallet,
  Filter,
  Gauge,
  Receipt,
  Activity,
  BarChart3,
  GitMerge,
  FileBarChart2,
  KeyRound,
  Percent,
  Megaphone,
  ClipboardCheck,
  UserCheck,
  History,
  Scale,
  MessageSquareHeart,
  Send,
  BookUser,
  LayoutGrid,
  LayoutDashboard,
  ListChecks,
  Rocket,
  Landmark,
  Store,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { PlanningLogo } from "@/components/planning-logo";
import { usePermissions } from "@/hooks/use-permissions";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { meuAcessoGrowth, meusProdutos } from "@/lib/produtos.functions";

// Mesmo domínio, de propósito. O apex serve `/growth` e `/financeiro` por
// rewrite dentro deste mesmo projeto da Vercel, então trocar de produto não
// abre aba nem troca de endereço: a sessão (cookie no domínio raiz) segue junto
// e o botão "voltar" do navegador funciona como a pessoa espera.
const GROWTH_URL = "/growth";
const FINANCEIRO_URL = "/financeiro";

type Item = {
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
type Grupo = { label: string; items: Item[] };
type Area = {
  slug: string;
  nome: string;
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
const AREAS: Area[] = [
  {
    slug: "rede",
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
      {
        label: "Pessoas",
        items: [{ title: "Gente da Rede", url: "/gente", icon: Users, permission: "view.gente" }],
      },
    ],
  },
  {
    slug: "clientes",
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
      {
        label: "Ferramentas",
        items: [
          {
            title: "Reforma Tributária",
            url: "/reforma-tributaria",
            icon: FileBarChart2,
            permission: "view.reforma_tributaria",
          },
        ],
      },
    ],
  },
  {
    slug: "receita",
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
    slug: "broker",
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
          { title: "Fila Cella", url: "/fila-cella", icon: ListChecks, permission: "view.fila_cella" },
        ],
      },
    ],
  },
  {
    slug: "admin",
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

const SOCIO_FRANQUEADO_GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Minha Unidade",
    items: [
      { title: "Painel", url: "/painel-unidade", icon: Gauge },
      { title: "Clientes", url: "/clientes", icon: Building2 },
      { title: "CS", url: "/painel-cs", icon: UserCheck },
      { title: "NPS", url: "/nps", icon: MessageSquareHeart },
      { title: "Broker", url: "/broker", icon: Store, permission: "view.broker" },
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
];

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { can, loading, primaryRole } = usePermissions();

  const isActive = (url: string) =>
    url === "/" ? pathname === "/" : pathname === url || pathname.startsWith(url + "/");

  const ehSocioRegional = primaryRole === "socio_franqueado";

  const podeVer = (item: Item) =>
    !item.permission ||
    (!loading &&
      (Array.isArray(item.permission)
        ? item.permission.some((p) => can(p))
        : can(item.permission)));

  // Área só aparece se sobrar item nela depois do filtro de permissão.
  const areasVisiveis = AREAS.map((a) => ({
    ...a,
    grupos: a.grupos
      .map((g) => ({ ...g, items: g.items.filter(podeVer) }))
      .filter((g) => g.items.length > 0),
  })).filter((a) => a.grupos.length > 0);

  // A área ativa sai da ROTA, não de estado próprio: assim link direto,
  // favorito e botão voltar abrem a lateral já na área certa. Estado à parte
  // só serviria para discordar da tela.
  const areaDaRota = areasVisiveis.find((a) =>
    a.grupos.some((g) => g.items.some((i) => isActive(i.url))),
  );
  const [areaEscolhida, setAreaEscolhida] = useState<string | null>(null);
  const areaAtual = areaDaRota ?? areasVisiveis.find((a) => a.slug === areaEscolhida) ?? areasVisiveis[0];

  // Só oferece o Growth a quem realmente tem acesso lá — o link para quem não
  // tem levaria a uma tela vazia (o Growth barra por public.membros).
  const acessoGrowthFn = useServerFn(meuAcessoGrowth);
  const growthQuery = useQuery({
    queryKey: ["meu-acesso-growth"],
    queryFn: () => acessoGrowthFn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const mostrarGrowth = growthQuery.data?.temAcesso ?? false;

  // Quem abre o cockpit vem de `public.produto_acesso`, a mesma fonte que
  // autoriza a emissão da sessão irmã. Antes era uma chave da matriz de papéis
  // do Ops, e o menu e o servidor podiam discordar.
  const produtosFn = useServerFn(meusProdutos);
  const produtos = useQuery({
    queryKey: ["meus-produtos"],
    queryFn: () => produtosFn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const mostrarFinanceiro = produtos.data?.financeiro ?? false;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="border-b">
        <Link to="/" className="flex items-center gap-2 px-2 py-1.5">
          <PlanningLogo className="h-7 w-auto" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {(mostrarGrowth || mostrarFinanceiro) && (
          <SidebarGroup>
            <SidebarGroupLabel>Planning Brain</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive tooltip="Ops · você está aqui">
                    <Link to="/" className="flex items-center gap-2">
                      <LayoutGrid className="h-4 w-4 shrink-0" />
                      <span>Ops</span>
                      <span className="ml-auto text-[10px] uppercase tracking-wide opacity-60">
                        aqui
                      </span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {mostrarGrowth && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Ir para o Growth">
                      {/* <a> e não <Link>: é outra aplicação, servida por rewrite
                          no mesmo domínio. O router daqui não conhece essa rota. */}
                      <a href={GROWTH_URL} className="flex items-center gap-2">
                        <Rocket className="h-4 w-4 shrink-0" />
                        <span>Growth</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {mostrarFinanceiro && (
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild tooltip="Ir para o Financeiro">
                      <a href={FINANCEIRO_URL} className="flex items-center gap-2">
                        <Landmark className="h-4 w-4 shrink-0" />
                        <span>Financeiro</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
        {ehSocioRegional
          ? SOCIO_FRANQUEADO_GROUPS.map((group) => {
              const visible = group.items.filter(podeVer);
              if (visible.length === 0) return null;
              return (
                <SidebarGroup key={group.label}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {visible.map((item) => (
                        <SidebarMenuItem key={`${group.label}-${item.title}`}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                            tooltip={item.title}
                          >
                            <Link to={item.url} className="flex items-center gap-2">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              );
            })
          : (
            <>
              {areasVisiveis.length > 1 && (
                <SidebarGroup>
                  <SidebarGroupLabel>Áreas</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {areasVisiveis.map((a) => (
                        <SidebarMenuItem key={a.slug}>
                          <SidebarMenuButton
                            asChild
                            isActive={a.slug === areaAtual?.slug}
                            tooltip={a.nome}
                          >
                            {/* Clicar na área abre a primeira tela dela: seletor que
                                não leva a lugar nenhum obriga um segundo clique. */}
                            <Link
                              to={a.grupos[0].items[0].url}
                              onClick={() => setAreaEscolhida(a.slug)}
                              className="flex items-center gap-2"
                            >
                              <a.icone className="h-4 w-4 shrink-0" />
                              <span>{a.nome}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )}

              {areaAtual?.grupos.map((group) => (
                <SidebarGroup key={`${areaAtual.slug}-${group.label}`}>
                  <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {group.items.map((item) => (
                        <SidebarMenuItem key={`${group.label}-${item.title}`}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive(item.url)}
                            tooltip={item.title}
                          >
                            <Link to={item.url} className="flex items-center gap-2">
                              <item.icon className="h-4 w-4 shrink-0" />
                              <span>{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </>
          )}
      </SidebarContent>
      <SidebarFooter className="border-t px-2 py-2 text-[10px] text-muted-foreground">
        Planning Brain · Ops
      </SidebarFooter>
    </Sidebar>
  );
}
