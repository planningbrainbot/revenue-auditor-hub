import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LayoutGrid, Landmark, Rocket } from "lucide-react";
import { usePermissions } from "@/hooks/use-permissions";
import { meuAcessoGrowth, meusProdutos } from "@/lib/produtos.functions";
import { PlanningLogo } from "@/components/planning-logo";
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

function InicioPage() {
  const navigate = useNavigate();
  const { can, loading, primaryRole } = usePermissions();

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

  if (loading || growth.isLoading || acessoProdutos.isLoading) return null;

  const opsHref = primaryRole === "socio_franqueado" ? "/painel-unidade" : "/rede-overview";

  const produtos: Produto[] = [
    {
      slug: "ops",
      nome: "Operação",
      descricao: "Clientes, rede, receita, CS e broker.",
      href: opsHref,
      Icone: LayoutGrid,
      interno: true,
    },
  ];
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

  // Um produto só: nada a escolher. Chegar aqui por link direto não pode virar
  // uma tela com um botão — manda para onde a pessoa ia de qualquer jeito.
  if (produtos.length === 1) return <Navigate to={opsHref} replace />;

  function abrir(p: Produto, fixar: boolean) {
    if (fixar) gravarProdutoPadrao(p.slug);
    if (p.interno) navigate({ to: p.href });
    else window.location.href = p.href;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-background px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <PlanningLogo className="h-9 w-auto" />
        <div>
          <h1 className="text-xl font-semibold text-foreground">Onde você quer entrar?</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Os três abrem no mesmo lugar; dá para trocar a qualquer momento pelo menu.
          </p>
        </div>
      </div>

      <div className="grid w-full max-w-3xl gap-4 sm:grid-cols-3">
        {produtos.map((p) => (
          <Card
            key={p.slug}
            className="group flex cursor-pointer flex-col gap-3 p-5 transition-colors hover:border-primary/50 hover:bg-accent"
            onClick={() => abrir(p, false)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                abrir(p, false);
              }
            }}
          >
            <p.Icone className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{p.nome}</h2>
              <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{p.descricao}</p>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                abrir(p, true);
              }}
              className="mt-auto self-start text-[11px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            >
              sempre começar por aqui
            </button>
          </Card>
        ))}
      </div>
    </div>
  );
}
