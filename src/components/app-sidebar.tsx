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
import { AREAS, areaDoItem, type Area, type Item } from "@/lib/areas";
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

// A Administração não divide o seletor com as áreas de trabalho.
//
// O seletor do topo responde "em que estou trabalhando agora", e a resposta
// certa nunca é "configurando quem vê o quê". Ela ficava no meio de Rede,
// Clientes e Receita custando uma linha de leitura a cada troca de contexto,
// para uma visita que o admin faz uma vez por semana. Desde 16/09/2026 mora
// fixa no rodapé, que é onde as ferramentas de manutenção ficam em quem faz
// isso bem. A área continua existindo igual: some da LISTA, não do acesso, e
// dentro dela a lateral mostra as páginas normalmente.
const AREA_RODAPE = "admin";

// A lista fixa do sócio regional saiu daqui em 15/09/2026.
//
// Eram dois menus concorrentes no mesmo arquivo, e o dele não declarava
// permissão em item nenhum: aparecia sempre, e quem segurava o dado era só a
// RLS. Agora é a área `minha_unidade` em areas.ts, concedida ao papel como
// qualquer outra, e a lateral tem um caminho só.

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const { temArea, loading } = usePermissions();

  // "Está dentro deste caminho?" — serve para descobrir a ÁREA da rota, onde
  // qualquer filha de /unidades deve acender a área de Receita e Repasses.
  const dentroDe = (url: string) => {
    const path = url.split("?")[0];
    return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(path + "/");
  };
  const consultaConfere = (url: string) => {
    const expected = new URLSearchParams(url.split("?")[1] || "");
    const current = new URLSearchParams(searchStr);
    return [...expected].every(([key, value]) => current.get(key) === value);
  };

  // Quem decide é a ÁREA, não a chave. O item só declara área própria quando a
  // fronteira do menu e a da confiança não coincidem (a Matriz do broker).
  const podeVer = (area: Area, item: Item) => !loading && temArea(areaDoItem(area, item));

  // Área fora do alcance do papel não aparece: nem na lateral, nem no seletor
  // do topo. Antes o corte era por item, e um papel com uma página de oito
  // continuava vendo a área quase vazia.
  //
  // A SEGUNDA CONDIÇÃO é o outro lado da exceção que `Item.area` já previa. Um
  // item pode declarar área própria quando a fronteira do menu e a da confiança
  // não coincidem — e aí existe o caso em que a pessoa tem SÓ a área do item, e
  // não a que o contém. É a controladoria em "Acessos do Financeiro": ela
  // administra os acessos do cockpit e não administra usuários, perfis nem
  // chaves do Asaas. Sem esta linha a Administração some inteira para ela e o
  // item nunca aparece, mesmo com a permissão certa.
  const areasVisiveis = AREAS.filter(
    (a) =>
      !loading &&
      (temArea(a.slug) ||
        a.grupos.some((g) => g.items.some((i) => i.area && temArea(i.area)))),
  )
    .map((a) => ({
      ...a,
      grupos: a.grupos
        .map((g) => ({ ...g, items: g.items.filter((i) => podeVer(a, i)) }))
        .filter((g) => g.items.length > 0),
    }))
    .filter((a) => a.grupos.length > 0);

  // Já o grifo do ITEM é do caminho mais específico que casa, não de todos os
  // que casam. Desde que /unidades ganhou filhas, "Regras da Rede" (/unidades)
  // acenderia junto com "Split do Asaas" (/unidades/split) se bastasse o
  // prefixo — dois itens grifados e nenhum deles respondendo "onde estou".
  const itemAtivo = areasVisiveis
    .flatMap((a) => a.grupos.flatMap((g) => g.items.map((i) => i.url)))
    .filter((url) => dentroDe(url) && consultaConfere(url))
    .sort((a, b) => b.length - a.length)[0];

  const isActive = (url: string) => url === itemAtivo;

  // O seletor mostra as áreas de trabalho; a Administração sai daqui e vai
  // para o rodapé. Ela CONTINUA em `areasVisiveis` de propósito: é assim que a
  // lateral acha as páginas dela quando você está dentro, e que o grifo do item
  // funciona igual ao das outras.
  const areasDoSeletor = areasVisiveis.filter((a) => a.slug !== AREA_RODAPE);
  const areaAdmin = areasVisiveis.find((a) => a.slug === AREA_RODAPE);

  // A área ativa sai da ROTA, não de estado próprio: assim link direto,
  // favorito e botão voltar abrem a lateral já na área certa. Estado à parte
  // só serviria para discordar da tela.
  const areaDaRota = areasVisiveis.find((a) =>
    a.grupos.some((g) => g.items.some((i) => dentroDe(i.url))),
  );
  const [areaEscolhida, setAreaEscolhida] = useState<string | null>(null);
  const areaAtual =
    areaDaRota ?? areasVisiveis.find((a) => a.slug === areaEscolhida) ?? areasVisiveis[0];

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
            {areasDoSeletor.map((a) => (
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
        {areaAtual?.grupos.map((group) => (
          <SidebarGroup key={`${areaAtual.slug}-${group.label}`}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={`${group.label}-${item.title}`}>
                    <SidebarMenuButton asChild isActive={isActive(item.url)} tooltip={item.title}>
                      <Link
                        to={item.url.split("?")[0]}
                        search={
                          item.url.includes("?")
                            ? Object.fromEntries(new URLSearchParams(item.url.split("?")[1]))
                            : undefined
                        }
                        className="flex items-center gap-2"
                      >
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
      </SidebarContent>
      <SidebarFooter className="border-t p-2">
        {areaAdmin ? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="sm"
                isActive={areaAtual?.slug === AREA_RODAPE}
                tooltip={areaAdmin.nome}
              >
                <Link
                  to={areaAdmin.grupos[0].items[0].url}
                  onClick={() => setAreaEscolhida(areaAdmin.slug)}
                  className="flex items-center gap-2 text-muted-foreground"
                >
                  <areaAdmin.icone className="h-4 w-4 shrink-0" />
                  <span>{areaAdmin.nome}</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        ) : (
          <div className="px-2 py-1 text-[10px] text-muted-foreground">
            {areaAtual?.nome ?? "Planning Brain"}
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
