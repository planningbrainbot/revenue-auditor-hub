import { useEffect } from "react";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Landmark, Rocket } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { meuAcessoGrowth, meusProdutos } from "@/lib/produtos.functions";
import { garantirSessoesIrmas } from "@/lib/sessoes-irmas";
import { AREAS, areaDoItem, partesDoLink, primeiraTelaAcessivel, type Area } from "@/lib/areas";
import { PlanningLogo } from "@/components/planning-logo";
import { Carregando, EstadoVazio, Filete } from "@/components/planning";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Porta de entrada da plataforma: qual produto você quer abrir.
 *
 * Existe porque Ops, Growth e Financeiro viraram um domínio só, mas continuam
 * três aplicações — e até agora a única porta era o Ops, com os outros dois
 * escondidos num item de menu. Quem usa o cockpit financeiro todo dia entrava
 * sempre pela tela errada.
 *
 * Só aparece para quem tem MAIS DE UM produto. Com um só, um seletor de uma
 * opção é pedágio: a pessoa vai direto para onde sempre foi. Ver a regra em
 * `_authenticated/index.tsx`.
 *
 * A escolha pode virar padrão ("sempre começar por aqui"), gravada no mesmo
 * cookie de domínio raiz que o tema e o estado do menu usam — então vale nos
 * três produtos e sobrevive a limpar o localStorage de um deles.
 */

export const COOKIE_PRODUTO_PADRAO = "pb_produto_inicial";
const ANO = 60 * 60 * 24 * 365;

export function gravarProdutoPadrao(slug: string) {
  if (typeof document === "undefined") return;
  const dominio = window.location.hostname.endsWith("planningbrain.com.br")
    ? "; domain=.planningbrain.com.br"
    : "";
  document.cookie = `${COOKIE_PRODUTO_PADRAO}=${slug}; path=/${dominio}; max-age=${ANO}; samesite=lax`;
}

export function lerProdutoPadrao(): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(/(?:^|; )pb_produto_inicial=([^;]*)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export const Route = createFileRoute("/_authenticated/inicio")({
  head: () => ({ meta: [{ title: "Início – Planning Brain" }] }),
  component: InicioPage,
});

type Produto = {
  slug: string;
  nome: string;
  descricao: string;
  href: string;
  Icone: React.ComponentType<{ className?: string }>;
  /** Rota interna (Ops) x outra aplicação no mesmo domínio. */
  interno?: boolean;
};

/**
 * Navegação para outra aplicação do domínio, DEPOIS da sessão dela existir. O
 * efeito que emite as sessões irmãs mora no layout, e efeito de filho roda antes
 * do de pai: sair daqui no render abriria o cockpit sem sessão, em 401.
 */
function IrParaOutraAplicacao({ href }: { href: string }) {
  useEffect(() => {
    let vivo = true;
    void garantirSessoesIrmas().finally(() => {
      if (vivo) window.location.replace(href);
    });
    return () => {
      vivo = false;
    };
  }, [href]);
  return null;
}

function InicioPage() {
  const navigate = useNavigate();
  const { temArea, can, loading } = usePermissions();

  const acessoGrowthFn = useServerFn(meuAcessoGrowth);
  const growth = useQuery({
    queryKey: ["meu-acesso-growth"],
    queryFn: () => acessoGrowthFn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // Financeiro vem de `public.produto_acesso`, a mesma fonte que o servidor usa
  // para emitir a sessão do cockpit. Antes vinha de uma chave da matriz de
  // papéis do Ops, e tela e servidor podiam discordar.
  const produtosFn = useServerFn(meusProdutos);
  const acessoProdutos = useQuery({
    queryKey: ["meus-produtos"],
    queryFn: () => produtosFn(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  if (loading || growth.isLoading || acessoProdutos.isLoading) {
    return (
      <Moldura semPergunta>
        <Carregando variante="kpis" className="w-full max-w-4xl" />
      </Moldura>
    );
  }

  // As frentes deste app entram no MESMO nível de Growth e Financeiro. Não
  // existe mais um cartão "Ops" agrupando o resto: o guarda-chuva não
  // significava nada para quem usa, e obrigava um clique a mais.
  // Mesmo critério da lateral desde 15/09/2026: quem manda é a ÁREA. O cartão
  // aponta para a primeira página que a pessoa realmente abre, que pode não ser
  // a primeira da área quando um item guarda área própria (a Matriz do broker).
  //
  // A área também entra quando a pessoa tem SÓ a área de um item dela — a mesma
  // segunda condição de `areasVisiveis` na lateral. É a controladoria: tem
  // "Acessos do Financeiro" e não tem a Administração, e sem isto o cartão não
  // existia e a tela só abria por link direto (17/09/2026).
  const alcanca = (a: Area) =>
    temArea(a.slug) || a.grupos.some((g) => g.items.some((i) => i.area && temArea(i.area)));
  const produtos: Produto[] = AREAS.filter(alcanca)
    .map<Produto | null>((a) => {
      const primeiro = a.grupos
        .flatMap((g) => g.items)
        .find((i) => temArea(areaDoItem(a, i)) && (!i.chave || can(i.chave)));
      if (!primeiro) return null;
      return {
        slug: a.slug,
        nome: a.nome,
        descricao: a.descricao,
        href: primeiro.url,
        Icone: a.icone,
        interno: true,
      };
    })
    .filter((x): x is Produto => x !== null);

  if (growth.data?.temAcesso) {
    produtos.push({
      slug: "growth",
      nome: "Growth",
      descricao: "Tráfego, criativos, comercial e pessoas.",
      href: "/growth",
      Icone: Rocket,
    });
  }
  if (acessoProdutos.data?.financeiro) {
    produtos.push({
      slug: "financeiro",
      nome: "Financeiro",
      descricao: "Cockpit, fluxo de caixa, DRE e inadimplência.",
      href: "/financeiro",
      Icone: Landmark,
    });
  }

  // Card que não carregou não some (a pessoa concluiria que perdeu o acesso):
  // aparece como "indisponível", com tentar de novo.
  const indisponiveis: { slug: string; nome: string; tentar: () => void }[] = [];
  if (growth.isError) {
    indisponiveis.push({ slug: "growth", nome: "Growth", tentar: () => void growth.refetch() });
  }
  if (acessoProdutos.isError) {
    indisponiveis.push({
      slug: "financeiro",
      nome: "Financeiro",
      tentar: () => void acessoProdutos.refetch(),
    });
  }

  // Um produto só: nada a escolher. Chegar aqui por link direto não pode virar
  // uma tela com um botão — manda para onde a pessoa ia de qualquer jeito.
  // Quando o que sobrou é o Financeiro, é para ele: quem só tem o cockpit caía
  // no /rede-overview, que não abre para ela — inclusive pelo "Ver todas as
  // frentes" de dentro do cockpit (17/09/2026). Só o Financeiro porque o "Sair"
  // dele passa por /auth?sair=1 e desloga o Ops junto; o do Growth não se sabe,
  // e mandar de volta para ele com a sessão reemitida prenderia a pessoa lá.
  // Com um card indisponível não há como saber se era mesmo um produto só.
  if (produtos.length === 1 && indisponiveis.length === 0) {
    const unico = produtos[0];
    if (unico.slug === "financeiro") return <IrParaOutraAplicacao href={unico.href} />;
    // Produto interno: a primeira tela que a pessoa abre, e não sempre o
    // Overview da Rede ou o Painel da Unidade. Quem só tinha People caía no
    // Overview sem acesso (mesmo defeito de 22/09/2026). Só o Growth fica na
    // tela, com um card, pelo motivo acima.
    if (unico.interno) {
      // A URL do item pode trazer query ("/gente?visao=minha-vez"): o roteador
      // quer path e busca separados.
      const d = partesDoLink(primeiraTelaAcessivel(temArea, can) ?? unico.href);
      return <Navigate to={d.to} search={d.search} replace />;
    }
  }

  function abrir(p: Produto, fixar: boolean) {
    if (fixar) gravarProdutoPadrao(p.slug);
    if (p.interno) {
      const d = partesDoLink(p.href);
      navigate({ to: d.to, search: d.search });
    }
    else window.location.href = p.href;
  }

  if (produtos.length === 0 && indisponiveis.length === 0) {
    return (
      <Moldura>
        <EstadoVazio
          className="w-full max-w-xl"
          titulo="Seu usuário ainda não tem acesso a nenhum produto. Peça a um admin."
        />
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {produtos.map((p) => (
          // O card não aninha controle: o botão principal (nome e descrição)
          // estica sobre o card inteiro, e "sempre começar por aqui" é irmão
          // dele, por cima. Filete da área no hover e no foco (DESIGN §8).
          <Card
            key={p.slug}
            className="group relative flex flex-col gap-3 p-5 transition-colors duration-120 ease-planning hover:border-input hover:bg-accent has-[:focus-visible]:border-input"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-3 left-0 flex opacity-0 transition-opacity duration-120 ease-planning group-hover:opacity-100 group-has-[:focus-visible]:opacity-100"
            >
              <Filete area={p.interno ? p.slug : undefined} className="rounded-l-none" />
            </span>
            <button
              type="button"
              onClick={() => abrir(p, false)}
              className="flex flex-col gap-3 rounded-sm text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 focus-visible:after:ring-offset-background"
            >
              <span aria-hidden>
                <p.Icone className="size-5 text-primary-text" />
              </span>
              <span className="block">
                <span className="block text-base font-semibold text-foreground">{p.nome}</span>
                <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">
                  {p.descricao}
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => abrir(p, true)}
              aria-label={`Sempre começar por ${p.nome}`}
              className="relative z-10 mt-auto self-start rounded-sm text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              sempre começar por aqui
            </button>
          </Card>
        ))}
        {indisponiveis.map((c) => (
          <Card key={c.slug} className="flex flex-col gap-3 border-dashed p-5">
            <div>
              <h2 className="text-base font-semibold text-foreground">{c.nome}</h2>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">
                Indisponível: não deu para conferir seu acesso agora.
              </p>
            </div>
            <Button type="button" variant="outline" size="sm" className="mt-auto self-start" onClick={c.tentar}>
              Tentar de novo
            </Button>
          </Card>
        ))}
      </div>
    </Moldura>
  );
}

/** Logo e pergunta centralizados; o conteúdo (cards, carregando, vazio) abaixo. */
function Moldura({
  children,
  semPergunta = false,
}: {
  children: React.ReactNode;
  /** Carregando: sem a pergunta, que ainda pode não valer (redirect, vazio). */
  semPergunta?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <PlanningLogo className="h-9 w-auto" />
        {!semPergunta && (
          <div>
            <h1 className="text-2xl font-bold text-foreground">Onde você quer entrar?</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Dá para trocar a qualquer momento, no topo do menu.
            </p>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
