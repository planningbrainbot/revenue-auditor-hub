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
import { AREAS, type Item } from "@/lib/areas";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown } from "lucide-react";
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

const SOCIO_REGIONAL_GROUPS: { label: string; items: Item[] }[] = [
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

  const ehSocioRegional = primaryRole === "socio_regional";

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
      {/* Seletor de FRENTE no cabeçalho, não em lista fixa.
          Antes eram três níveis empilhados na mesma coluna: produto, área e
          página. O primeiro nível custava espaço permanente para uma escolha
          que a pessoa faz poucas vezes ao dia. Aqui ele mostra só onde você
          está e abre a lista num clique — é o padrão de troca de contexto que
          Linear, Notion e a própria Vercel usam, e some com um nível inteiro
          da leitura. */}
      <SidebarHeader className="border-b p-0">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent">
            <PlanningLogo className="h-6 w-auto shrink-0" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">
              {areaAtual?.nome ?? "Planning Brain"}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Planning Brain
            </DropdownMenuLabel>
            {areasVisiveis.map((a) => (
              <DropdownMenuItem key={a.slug} asChild>
                <Link
                  to={a.grupos[0].items[0].url}
                  onClick={() => setAreaEscolhida(a.slug)}
                  className="flex items-center gap-2"
                >
                  <a.icone className="h-4 w-4 shrink-0" />
                  <span className="flex-1">{a.nome}</span>
                  {a.slug === areaAtual?.slug && (
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      aqui
                    </span>
                  )}
                </Link>
              </DropdownMenuItem>
            ))}
            {(mostrarGrowth || mostrarFinanceiro) && <DropdownMenuSeparator />}
            {mostrarGrowth && (
              <DropdownMenuItem asChild>
                {/* Outra aplicação no mesmo domínio: <a>, não Link. */}
                <a href={GROWTH_URL} className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 shrink-0" />
                  <span>Growth</span>
                </a>
              </DropdownMenuItem>
            )}
            {mostrarFinanceiro && (
              <DropdownMenuItem asChild>
                <a href={FINANCEIRO_URL} className="flex items-center gap-2">
                  <Landmark className="h-4 w-4 shrink-0" />
                  <span>Financeiro</span>
                </a>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>
      <SidebarContent>
        {ehSocioRegional
          ? SOCIO_REGIONAL_GROUPS.map((group) => {
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
        {areaAtual?.nome ?? "Planning Brain"}
      </SidebarFooter>
    </Sidebar>
  );
}
